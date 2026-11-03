import jwt from "jsonwebtoken";
import { AppError } from "../lib/errors.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new AppError(401, "Please log in to continue."));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    next(new AppError(401, "Your session is invalid or expired. Please log in again."));
  }
}
