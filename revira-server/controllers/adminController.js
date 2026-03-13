import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import AdminUser from "../models/AdminUser.js";
import Appointment from "../models/Appointment.js";
import Slot from "../models/Slot.js";

const DEFAULT_TIMES = [
  { startTime: "08:00", endTime: "09:30" },
  { startTime: "09:30", endTime: "11:00" },
  { startTime: "11:00", endTime: "12:30" },
  { startTime: "12:30", endTime: "14:00" },
  { startTime: "14:00", endTime: "15:30" },
  { startTime: "15:30", endTime: "17:00" }
];

const formatDate = (dateObj) => {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDatesInRange = (startDate, endDate) => {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const day = current.getDay(); // 0 Sunday, 6 Saturday
    if (day >= 0 && day <= 5) {
      dates.push(formatDate(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
};

export const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    const admin = await AdminUser.findOne({ username });
    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const openRangeSlots = async (req, res) => {
  try {
    const { startDate, endDate, times } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "startDate and endDate are required" });
    }

    const selectedTimes = Array.isArray(times) && times.length ? times : DEFAULT_TIMES;
    const dates = getDatesInRange(startDate, endDate);

    let createdCount = 0;

    for (const date of dates) {
      for (const time of selectedTimes) {
        try {
          await Slot.create({
            date,
            startTime: time.startTime,
            endTime: time.endTime,
            isOpen: true,
            status: "available"
          });
          createdCount += 1;
        } catch (error) {
          // duplicate slot -> skip
        }
      }
    }

    return res.json({
      message: "Slots opened successfully",
      createdCount
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateDaySlots = async (req, res) => {
  try {
    const { date } = req.params;
    const { action, times } = req.body;

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    if (!["open", "close"].includes(action)) {
      return res.status(400).json({ message: "action must be open or close" });
    }

    const selectedTimes = Array.isArray(times) && times.length ? times : DEFAULT_TIMES;

    if (action === "open") {
      for (const time of selectedTimes) {
        const existingSlot = await Slot.findOne({
          date,
          startTime: time.startTime
        });

        if (!existingSlot) {
          await Slot.create({
            date,
            startTime: time.startTime,
            endTime: time.endTime,
            isOpen: true,
            status: "available"
          });
          continue;
        }

        if (existingSlot.status !== "booked") {
          existingSlot.isOpen = true;
          existingSlot.status = "available";
          await existingSlot.save();
        }
      }
    }

    if (action === "close") {
      await Slot.updateMany(
        {
          date,
          status: { $ne: "booked" }
        },
        {
          $set: {
            isOpen: false,
            status: "closed"
          }
        }
      );
    }

    const updatedSlots = await Slot.find({ date }).sort({ startTime: 1 });

    return res.json({
      message: `Day slots ${action}ed successfully`,
      slots: updatedSlots
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getMonthOverview = async (req, res) => {
  try {
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ message: "month is required" });
    }

    const [year, monthNumber] = month.split("-");
    const start = `${year}-${monthNumber}-01`;
    const endDateObj = new Date(Number(year), Number(monthNumber), 0);
    const end = formatDate(endDateObj);

    const slots = await Slot.find({
      date: { $gte: start, $lte: end }
    }).sort({ date: 1 });

    const summary = {};

    slots.forEach((slot) => {
      if (!summary[slot.date]) {
        summary[slot.date] = {
          date: slot.date,
          openCount: 0,
          bookedCount: 0,
          closedCount: 0
        };
      }

      if (slot.status === "available") summary[slot.date].openCount += 1;
      if (slot.status === "booked") summary[slot.date].bookedCount += 1;
      if (slot.status === "closed") summary[slot.date].closedCount += 1;
    });

    return res.json(Object.values(summary));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getDaySlots = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    const slots = await Slot.find({ date }).sort({ startTime: 1 });
    return res.json(slots);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateSlot = async (req, res) => {
  try {
    const { id } = req.params;
    const { isOpen, status } = req.body;

    const slot = await Slot.findById(id);

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    if (slot.status === "booked") {
      return res.status(400).json({ message: "Booked slot cannot be changed manually" });
    }

    if (typeof isOpen === "boolean") {
      slot.isOpen = isOpen;
    }

    if (status) {
      slot.status = status;
    } else {
      slot.status = slot.isOpen ? "available" : "closed";
    }

    await slot.save();

    return res.json({
      message: "Slot updated successfully",
      slot
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getAppointments = async (_req, res) => {
  try {
    const appointments = await Appointment.find()
      .populate("slotId")
      .sort({ createdAt: -1 });

    return res.json(appointments);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    appointment.status = status || appointment.status;
    await appointment.save();

    if (status === "cancelled") {
      await Slot.findByIdAndUpdate(appointment.slotId, {
        isOpen: true,
        status: "available",
        appointmentId: null
      });
    }

    if (status === "confirmed") {
      await Slot.findByIdAndUpdate(appointment.slotId, {
        isOpen: false,
        status: "booked"
      });
    }

    return res.json({
      message: "Appointment updated successfully",
      appointment
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};