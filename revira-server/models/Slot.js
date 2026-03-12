import mongoose from "mongoose";

const slotSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true
    },
    startTime: {
      type: String,
      required: true
    },
    endTime: {
      type: String,
      required: true
    },
    isOpen: {
      type: Boolean,
      default: true
    },
    status: {
      type: String,
      enum: ["available", "booked", "closed"],
      default: "available"
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null
    }
  },
  { timestamps: true }
);

slotSchema.index({ date: 1, startTime: 1 }, { unique: true });

export default mongoose.model("Slot", slotSchema);