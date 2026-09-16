const mongoose = require("mongoose");

function generateReference() {
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  const ts = Date.now().toString().slice(-4);
  return `CS-${rand}${ts}`;
}

const appointmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    time: { type: String, required: true }, // HH:mm
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled", "no_show"],
      default: "pending",
    },
    reference: { type: String, unique: true, default: generateReference },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

// Prevent the same citizen from double-booking the same service/date/time
appointmentSchema.index({ user: 1, service: 1, date: 1, time: 1 }, { unique: false });

module.exports = mongoose.model("Appointment", appointmentSchema);
