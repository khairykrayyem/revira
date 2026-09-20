import express from "express";
import {
  adminLogin,
  getAppointments,
  getDaySlots,
  getMonthOverview,
  openRangeSlots,
  updateAppointment,
  updateDaySlots,
  updateSlot
} from "../controllers/adminController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  dayParamsSchema,
  dayQuerySchema,
  idParamsSchema,
  loginBodySchema,
  monthQuerySchema,
  openRangeBodySchema,
  updateAppointmentBodySchema,
  updateDayBodySchema,
  updateSlotBodySchema
} from "../validation/schemas.js";

const router = express.Router();

router.post("/login", validateRequest({ body: loginBodySchema }), adminLogin);

router.post(
  "/slots/open-range",
  authMiddleware,
  validateRequest({ body: openRangeBodySchema }),
  openRangeSlots
);
router.patch(
  "/slots/day/:date",
  authMiddleware,
  validateRequest({ params: dayParamsSchema, body: updateDayBodySchema }),
  updateDaySlots
);
router.get("/month", authMiddleware, validateRequest({ query: monthQuerySchema }), getMonthOverview);
router.get("/slots", authMiddleware, validateRequest({ query: dayQuerySchema }), getDaySlots);
router.patch(
  "/slots/:id",
  authMiddleware,
  validateRequest({ params: idParamsSchema, body: updateSlotBodySchema }),
  updateSlot
);

router.get("/appointments", authMiddleware, getAppointments);
router.patch(
  "/appointments/:id",
  authMiddleware,
  validateRequest({ params: idParamsSchema, body: updateAppointmentBodySchema }),
  updateAppointment
);

export default router;
