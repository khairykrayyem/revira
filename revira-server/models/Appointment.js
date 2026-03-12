import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Slot",
      required: true
    },
    clientName: {
      type: String,
      required: true,
      trim: true
    },
    clientPhone: {
      type: String,
      required: true,
      trim: true
    },
    treatment: {
      type: String,
      required: true,
      trim: true
    },
    notes: {
      type: String,
      default: "",
      trim: true
    },
    lang: {
      type: String,
      enum: ["he", "ar"],
      default: "he"
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled"],
      default: "pending"
    }
  },
  { timestamps: true }
);

export default mongoose.model("Appointment", appointmentSchema);