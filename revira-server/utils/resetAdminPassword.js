import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDB } from "../config/db.js";
import { BCRYPT_ROUNDS, MIN_ADMIN_PASSWORD_LENGTH } from "../config/passwordPolicy.js";
import AdminUser from "../models/AdminUser.js";

dotenv.config();

export const REQUIRED_RESET_CONFIRMATION = "RESET_REVIRA_ADMIN";

export const validateResetConfig = (env = process.env) => {
  if (env.NODE_ENV !== "development") {
    throw new Error("Admin password reset is allowed only when NODE_ENV=development");
  }
  if (env.ALLOW_ADMIN_RESET !== REQUIRED_RESET_CONFIRMATION) {
    throw new Error("Explicit development admin reset confirmation is required");
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

export const resetAdminPassword = async ({
  env = process.env,
  connect = connectDB,
  AdminModel = AdminUser,
  hash = bcrypt.hash,
  logger = console
} = {}) => {
  const { username, password } = validateResetConfig(env);
  await connect();

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const admin = await AdminModel.findOneAndUpdate(
    { username },
    { $set: { passwordHash } },
    { new: true, runValidators: true }
  );
  if (!admin) {
    throw new Error("Admin account was not found; use npm run seed-admin for initial creation");
  }

  logger.log("Admin password reset completed successfully");
  return { updated: true };
};

const runCli = async () => {
  try {
    await resetAdminPassword();
  } catch (error) {
    console.error("Admin password reset failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
