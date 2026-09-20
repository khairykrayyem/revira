import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDB } from "../config/db.js";
import { BCRYPT_ROUNDS, MIN_ADMIN_PASSWORD_LENGTH } from "../config/passwordPolicy.js";
import AdminUser from "../models/AdminUser.js";

dotenv.config();

export const REQUIRED_SEED_CONFIRMATION = "SEED_REVIRA_ADMIN";

export const validateSeedConfig = (env = process.env) => {
  if (env.NODE_ENV !== "development") {
    throw new Error("Admin seeding is allowed only when NODE_ENV=development");
  }
  if (env.ALLOW_ADMIN_SEED !== REQUIRED_SEED_CONFIRMATION) {
    throw new Error("Explicit development admin seed confirmation is required");
  }

  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;
  if (typeof env.MONGO_URI !== "string" || env.MONGO_URI.trim().length === 0) {
    throw new Error("MONGO_URI is required");
  }
  if (!username) {
    throw new Error("ADMIN_USERNAME is required");
  }
  if (typeof password !== "string" || password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must contain at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`
    );
  }

  return { username, password };
};

export const seedAdmin = async ({
  env = process.env,
  connect = connectDB,
  AdminModel = AdminUser,
  hash = bcrypt.hash,
  logger = console
} = {}) => {
  const { username, password } = validateSeedConfig(env);
  await connect();

  const existingAdmin = await AdminModel.findOne({ username });
  if (existingAdmin) {
    logger.log("Admin already exists");
    return { created: false };
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  await AdminModel.create({ username, passwordHash });
  logger.log("Admin created successfully");
  return { created: true };
};

const runCli = async () => {
  try {
    await seedAdmin();
  } catch (error) {
    console.error("Seed admin failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
