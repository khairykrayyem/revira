import express from "express";
import {
  adminLogin,
  getAppointments,
  getDaySlots,
  getMonthOverview,
  openRangeSlots,
  updateAppointment,
  updateSlot
} from "../controllers/adminController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/login", adminLogin);

router.post("/slots/open-range", authMiddleware, openRangeSlots);
router.get("/month", authMiddleware, getMonthOverview);
router.get("/slots", authMiddleware, getDaySlots);
router.patch("/slots/:id", authMiddleware, updateSlot);

router.get("/appointments", authMiddleware, getAppointments);
router.patch("/appointments/:id", authMiddleware, updateAppointment);

export default router;