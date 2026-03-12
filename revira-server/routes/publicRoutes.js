import express from "express";
import { createAppointment, getOpenSlots } from "../controllers/publicController.js";

const router = express.Router();

router.get("/slots", getOpenSlots);
router.post("/appointments", createAppointment);

export default router;