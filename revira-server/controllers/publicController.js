import Appointment from "../models/Appointment.js";
import Slot from "../models/Slot.js";

export const getOpenSlots = async (req, res) => {
  try {
    const { from, to } = req.query;

    const filter = {
      isOpen: true,
      status: "available"
    };

    if (from && to) {
      filter.date = { $gte: from, $lte: to };
    }

    const slots = await Slot.find(filter).sort({ date: 1, startTime: 1 });
    return res.json(slots);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const createAppointment = async (req, res) => {
  try {
    const { slotId, clientName, clientPhone, treatment, notes, lang } = req.body;

    if (!slotId || !clientName || !clientPhone || !treatment) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const slot = await Slot.findById(slotId);

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    if (!slot.isOpen || slot.status !== "available") {
      return res.status(400).json({ message: "Slot is not available" });
    }

    const appointment = await Appointment.create({
      slotId,
      clientName,
      clientPhone,
      treatment,
      notes,
      lang
    });

    slot.status = "booked";
    slot.appointmentId = appointment._id;
    await slot.save();

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
    return res.status(500).json({ message: error.message });
  }
};