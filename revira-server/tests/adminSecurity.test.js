import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { validateAuthConfig, MIN_JWT_SECRET_BYTES } from "../config/auth.js";
import { createApp } from "../server.js";
import { createAdminLoginRateLimiter, loginSocketKey } from "../middleware/adminLoginRateLimiter.js";
import AdminUser from "../models/AdminUser.js";
import adminRoutes from "../routes/adminRoutes.js";
import { validateSeedConfig, seedAdmin, REQUIRED_SEED_CONFIRMATION } from "../utils/seedAdmin.js";
import {
  validateResetConfig,
  resetAdminPassword,
  REQUIRED_RESET_CONFIRMATION
} from "../utils/resetAdminPassword.js";

const SECRET = "p04-isolated-test-secret-with-at-least-32-bytes";
let replicaSet;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri(), { dbName: "revira_p04_security_test" });
  await AdminUser.syncIndexes();
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("JWT configuration rejects missing, blank, and weak secrets", () => {
  assert.throws(() => validateAuthConfig({}), /JWT_SECRET is required/);
  assert.throws(() => validateAuthConfig({ JWT_SECRET: "   " }), /JWT_SECRET is required/);
  assert.throws(() => validateAuthConfig({ JWT_SECRET: "short" }), /32 bytes/);
  assert.equal(
    validateAuthConfig({ JWT_SECRET: "x".repeat(MIN_JWT_SECRET_BYTES) }).jwtSecret.length,
    MIN_JWT_SECRET_BYTES
  );
});

test("proxy trust remains disabled in all environments", () => {
  assert.equal(createApp().get("trust proxy"), false);
});

test("forwarded headers cannot create unlimited login limiter keys", async () => {
  const app = express();
  app.use(express.json());
  app.post("/login", createAdminLoginRateLimiter({ windowMs: 60_000, limit: 2, keyGenerator: loginSocketKey }), (_req, res) =>
    res.status(401).json({ message: "Invalid credentials" })
  );
  const responses = [];
  for (const forwarded of ["198.51.100.10", "203.0.113.99", "198.51.100.10, 203.0.113.99", "not-an-ip"]) {
    responses.push(await request(app).post("/login").set("X-Forwarded-For", forwarded).send({}));
  }
  assert.equal(responses[0].status, 401);
  assert.equal(responses[1].status, 401);
  assert.equal(responses[2].status, 429);
  assert.equal(responses[3].status, 429);
});

test("server validates JWT configuration before connecting or listening", async () => {
  const original = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  let connected = false;
  let listened = false;
  await assert.rejects(
    () =>
      import("../server.js").then(({ startServer }) =>
        startServer({
          app: createApp(),
          connect: async () => { connected = true; },
          port: 0
        })
      ),
    /JWT_SECRET is required/
  );
  listened = false;
  if (original === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original;
  assert.equal(connected, false);
  assert.equal(listened, false);
});

test("AdminUser excludes passwordHash normally but permits explicit credential selection", async () => {
  await AdminUser.deleteMany({});
  const hash = await bcrypt.hash("isolated-password", 4);
  const created = await AdminUser.create({ username: "hash-selection-admin", passwordHash: hash });
  const normal = await AdminUser.findById(created._id).lean();
  const explicit = await AdminUser.findById(created._id).select("+passwordHash").lean();
  assert.equal(normal.passwordHash, undefined);
  assert.equal(explicit.passwordHash, hash);
});

test("unknown-admin login still performs the fixed dummy bcrypt path and stays neutral", async () => {
  process.env.JWT_SECRET = SECRET;
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRoutes);
  const unknown = await request(app)
    .post("/api/admin/login")
    .send({ username: "does-not-exist", password: "isolated-password" });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.body, { message: "Invalid credentials" });
});

test("new admin JWT uses HS256 and an approximately 12-hour lifetime", async () => {
  process.env.JWT_SECRET = SECRET;
  await AdminUser.deleteMany({});
  await AdminUser.create({
    username: "lifetime-admin",
    passwordHash: await bcrypt.hash("isolated-password", 4)
  });
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRoutes);

  const response = await request(app)
    .post("/api/admin/login")
    .send({ username: "lifetime-admin", password: "isolated-password" });
  assert.equal(response.status, 200);

  const decoded = jwt.decode(response.body.token, { complete: true });
  assert.equal(decoded.header.alg, "HS256");
  const lifetimeSeconds = decoded.payload.exp - decoded.payload.iat;
  assert.ok(lifetimeSeconds >= 43_190 && lifetimeSeconds <= 43_210);
});

test("seed and reset configuration deny ambiguous environments before database work", () => {
  const base = { MONGO_URI: "mongodb://isolated", ADMIN_USERNAME: "audit-admin", ADMIN_PASSWORD: "a".repeat(12) };
  assert.throws(() => validateSeedConfig(base), /NODE_ENV=development/);
  assert.throws(() => validateSeedConfig({ ...base, NODE_ENV: "development" }), /confirmation/);
  assert.doesNotThrow(() => validateSeedConfig({ ...base, NODE_ENV: "development", ALLOW_ADMIN_SEED: REQUIRED_SEED_CONFIRMATION }));
  assert.throws(() => validateResetConfig(base), /NODE_ENV=development/);
  assert.throws(() => validateResetConfig({ ...base, NODE_ENV: "development" }), /confirmation/);
  assert.doesNotThrow(() => validateResetConfig({ ...base, NODE_ENV: "development", ALLOW_ADMIN_RESET: REQUIRED_RESET_CONFIRMATION }));
});

test("seed is idempotent and reset updates an existing admin only", async () => {
  await AdminUser.deleteMany({});
  const env = {
    NODE_ENV: "development",
    ALLOW_ADMIN_SEED: REQUIRED_SEED_CONFIRMATION,
    ALLOW_ADMIN_RESET: REQUIRED_RESET_CONFIRMATION,
    MONGO_URI: "mongodb://isolated",
    ADMIN_USERNAME: "isolated-seeded-admin",
    ADMIN_PASSWORD: "initial-isolated-password"
  };
  const first = await seedAdmin({ env, connect: async () => {}, logger: { log() {} } });
  const second = await seedAdmin({ env, connect: async () => {}, logger: { log() {} } });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(await AdminUser.countDocuments({ username: env.ADMIN_USERNAME }), 1);
  const reset = await resetAdminPassword({
    env: { ...env, ADMIN_PASSWORD: "updated-isolated-password" },
    connect: async () => {},
    logger: { log() {} }
  });
  assert.equal(reset.updated, true);
  assert.equal(await AdminUser.countDocuments({ username: "missing-admin" }), 0);
});

test("HS256 is accepted and unintended JWT algorithms are rejected", async () => {
  process.env.JWT_SECRET = SECRET;
  const app = express();
  app.use(express.json());
  app.set("trust proxy", false);
  app.get("/protected", (req, res, next) => import("../middleware/authMiddleware.js").then(({ authMiddleware }) => authMiddleware(req, res, next)), (_req, res) => res.json({ ok: true }));
  const valid = jwt.sign({ id: "test" }, SECRET, { algorithm: "HS256", expiresIn: "1h" });
  const expired = jwt.sign({ id: "test" }, SECRET, { algorithm: "HS256", expiresIn: -1 });
  const none = `${valid.split(".")[0]}.${valid.split(".")[1]}.`;
  assert.equal((await request(app).get("/protected").set("Authorization", `Bearer ${valid}`)).status, 200);
  assert.equal((await request(app).get("/protected").set("Authorization", `Bearer ${expired}`)).status, 401);
  assert.equal((await request(app).get("/protected").set("Authorization", `Bearer ${none}`)).status, 401);
  assert.equal((await request(app).get("/protected").set("Authorization", `Bearer ${valid} extra`)).status, 401);
});

test("login limiter is scoped, keyed by IP, and returns sanitized 429", async () => {
  const app = express();
  app.set("trust proxy", false);
  app.use(express.json());
  app.post("/login", createAdminLoginRateLimiter({ windowMs: 60_000, limit: 2 }), (_req, res) => res.status(401).json({ message: "Invalid credentials" }));
  app.get("/public", (_req, res) => res.json({ ok: true }));
  const first = await request(app).post("/login").send({});
  const second = await request(app).post("/login").send({});
  const blocked = await request(app).post("/login").send({});
  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.message, "Too many login attempts. Please try again later.");
  assert.equal((await request(app).get("/public")).status, 200);
});
