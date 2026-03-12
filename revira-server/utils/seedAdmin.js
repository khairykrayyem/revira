import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db.js";
import AdminUser from "../models/AdminUser.js";

dotenv.config();

const seedAdmin = async () => {
  try {
    await connectDB();

    const existingAdmin = await AdminUser.findOne({
      username: process.env.ADMIN_USERNAME
    });

    if (existingAdmin) {
      console.log("Admin already exists");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

    await AdminUser.create({
      username: process.env.ADMIN_USERNAME,
      passwordHash
    });

    console.log("Admin created successfully");
    process.exit(0);
  } catch (error) {
    console.error("Seed admin error:", error.message);
    process.exit(1);
  }
};

seedAdmin();