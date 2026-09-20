import { ipKeyGenerator, rateLimit } from "express-rate-limit";

export const ADMIN_LOGIN_LIMIT = 5;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_LOGIN_GLOBAL_LIMIT = 20;

export const loginSocketKey = (req) =>
  ipKeyGenerator(req.socket.remoteAddress || "unknown", 64);
const usernameKey = (req) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "invalid";
  return `username:${username.trim().toLowerCase()}`;
};

export const createAdminLoginRateLimiter = ({
  windowMs = ADMIN_LOGIN_WINDOW_MS,
  limit = ADMIN_LOGIN_LIMIT,
  keyGenerator
} = {}) =>
  rateLimit({
    windowMs,
    limit,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) =>
      res.status(429).json({ message: "Too many login attempts. Please try again later." })
  });

export const adminLoginRateLimiter = createAdminLoginRateLimiter({
  limit: ADMIN_LOGIN_GLOBAL_LIMIT,
  keyGenerator: loginSocketKey
});

export const adminLoginUsernameRateLimiter = rateLimit({
  windowMs: ADMIN_LOGIN_WINDOW_MS,
  limit: ADMIN_LOGIN_LIMIT,
  keyGenerator: usernameKey,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({ message: "Too many login attempts. Please try again later." })
});
