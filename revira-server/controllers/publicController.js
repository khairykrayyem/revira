import Appointment from "../models/Appointment.js";
import Slot from "../models/Slot.js";
import mongoose from "mongoose";
import { buildFutureSlotFilter } from "../utils/clinicTime.js";

class BookingConflictError extends Error {}

export const getOpenSlotsAt = async (req, res, now) => {
  try {
    const { from, to } = req.query;

    const filter = {
      isOpen: true,
      status: "available",
      appointmentId: null,
      ...buildFutureSlotFilter(now)
    };

    if (from && to) {
      filter.date = { $gte: from, $lte: to };
    }

    const slots = await Slot.find(filter).sort({ date: 1, startTime: 1 });
    return res.json(slots);
  } catch {
    return res.status(500).json({ message: "Failed to fetch slots" });
  }
};

export const getOpenSlots = async (req, res) => getOpenSlotsAt(req, res, new Date());

export const createAppointmentAt = async (req, res, now) => {
  let session;

  try {
    session = await mongoose.startSession();

    const { slotId, clientName, clientPhone, treatment, notes, lang } = req.body;

    if (!slotId || !clientName || !clientPhone || !treatment) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const appointmentId = new mongoose.Types.ObjectId();
    let appointment;
    let slot;

    await session.withTransaction(async () => {
      slot = await Slot.findOneAndUpdate(
        {
          _id: slotId,
          isOpen: true,
          status: "available",
          appointmentId: null,
          ...buildFutureSlotFilter(now)
        },
        {
          $set: {
            isOpen: false,
            status: "booked",
            appointmentId
          }
        },
        { new: true, session }
      );

      if (!slot) {
        throw new BookingConflictError("Slot is no longer available");
      }

      [appointment] = await Appointment.create(
        [{
          _id: appointmentId,
          slotId,
          clientName,
          clientPhone,
          treatment,
          notes,
          lang
        }],
        { session }
      );
    });

    const whatsappMessage = `נקבע תור חדש ב-REVIRA
שם: ${clientName}
טלפון: ${clientPhone}
טיפול: ${treatment}
תאריך: ${slot.date}
שעה: ${slot.startTime}-${slot.endTime}`;

    const whatsappUrl = `https://wa.me/${process.env.WHATSAPP_NUMBER}?text=${encodeURIComponent(
      whatsappMessage
    )}`;

    return res.status(201).json({
      message: "Appointment created successfully",
      appointment,
      whatsappUrl
    });
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return res.status(409).json({ message: "Slot is no longer available" });
    }

    return res.status(500).json({ message: "Failed to create appointment" });
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch {
        // Cleanup failure must not replace the endpoint response.
      }
    }
  }
};

export const createAppointment = async (req, res) => createAppointmentAt(req, res, new Date());
