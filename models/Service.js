const mongoose = require("mongoose");

const REGIONS = [
  "Adamaoua",
  "Centre",
  "Est",
  "Extreme-Nord",
  "Littoral",
  "Nord",
  "Nord-Ouest",
  "Ouest",
  "Sud",
  "Sud-Ouest",
];

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    office: { type: String, required: true, trim: true }, // e.g. "Centre Regional Delegation, Yaoundé"
    region: { type: String, enum: REGIONS, required: true },
    category: {
      type: String,
      enum: ["identity", "civil_status", "transport", "tax", "other"],
      default: "other",
    },
    icon: { type: String, default: "document-text-outline" }, // ionicons name
    durationMinutes: { type: Number, default: 30 },
    capacityPerSlot: { type: Number, default: 3 }, // how many citizens can be booked per time slot
    openTime: { type: String, default: "08:00" }, // HH:mm
    closeTime: { type: String, default: "15:30" }, // HH:mm
    workingDays: {
      type: [Number], // 0=Sunday ... 6=Saturday
      default: [1, 2, 3, 4, 5],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
module.exports.REGIONS = REGIONS;
