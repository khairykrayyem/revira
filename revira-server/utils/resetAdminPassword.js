import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import AdminUser from "../models/AdminUser.js";

dotenv.config();

const REQUIRED_CONFIRMATION = "RESET_REVIRA_ADMIN";

const resetAdminPassword = async () => {
  try {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Admin password reset is disabled in production");
    }

    if (process.env.ALLOW_ADMIN_RESET !== REQUIRED_CONFIRMATION) {
      throw new Error(
        `Set ALLOW_ADMIN_RESET=${REQUIRED_CONFIRMATION} to confirm this development-only reset`
      );
    }

    const username = process.env.ADMIN_USERNAME?.trim();
    const password = process.env.ADMIN_PASSWORD;

    if (!process.env.MONGO_URI || !username || !password) {
      throw new Error("MONGO_URI, ADMIN_USERNAME, and ADMIN_PASSWORD are required");
    }

    if (password.length < 12) {
      throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
    }

    await connectDB();

    const admin = await AdminUser.findOne({ username });
    if (!admin) {
      throw new Error(
        "Admin account was not found; use npm run seed-admin for initial creation"
      );
    }

    admin.passwordHash = await bcrypt.hash(password, 12);
    await admin.save();

    console.log(`Password reset completed for admin user: ${username}`);
  } catch (error) {
    console.error("Admin password reset failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

resetAdminPassword();
