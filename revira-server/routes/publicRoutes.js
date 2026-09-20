import express from "express";
import { createAppointment, getOpenSlots } from "../controllers/publicController.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { bookingBodySchema, publicSlotsQuerySchema } from "../validation/schemas.js";

const router = express.Router();

router.get("/slots", validateRequest({ query: publicSlotsQuerySchema }), getOpenSlots);
router.post("/appointments", validateRequest({ body: bookingBodySchema }), createAppointment);

export default router;
