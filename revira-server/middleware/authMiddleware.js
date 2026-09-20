import jwt from "jsonwebtoken";

export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (typeof authHeader !== "string") {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const match = /^Bearer ([^\s]+)$/.exec(authHeader);
    if (!match) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });

    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
