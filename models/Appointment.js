const mongoose = require("mongoose");
const crypto = require("crypto");

function generateReference() {
  // CS-XXXXXXXX (8 chars, unambiguous alphabet) - not guessable from a counter.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return `CS-${out}`;
}

const appointmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (platform timezone)
    time: { type: String, required: true }, // HH:mm
    status: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled", "no_show"],
      default: "pending",
    },
    reference: { type: String, unique: true, default: generateReference },
    notes: { type: String, default: "", maxlength: 500 }, // written by the citizen
    adminNote: { type: String, default: "", maxlength: 500 }, // reason / remark by an administrator
    statusUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    statusUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

appointmentSchema.index({ service: 1, date: 1, time: 1 });
appointmentSchema.index({ status: 1, date: 1 });

module.exports = mongoose.model("Appointment", appointmentSchema);
