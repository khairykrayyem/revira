import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import publicRoutes from "./routes/publicRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { jsonErrorHandler } from "./middleware/jsonErrorHandler.js";
import { validateAuthConfig } from "./config/auth.js";
import { pathToFileURL } from "node:url";

dotenv.config();

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "32kb" }));
  app.use(jsonErrorHandler);

  app.get("/", (_req, res) => {
    res.send("REVIRA API is running");
  });

  app.use("/api", publicRoutes);
  app.use("/api/admin", adminRoutes);

  return app;
};

export const startServer = async ({
  app = createApp(),
  connect = connectDB,
  port = process.env.PORT || 5000
} = {}) => {
  validateAuthConfig();
  await connect();

  return app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
