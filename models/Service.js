const mongoose = require("mongoose");
const { REGIONS } = require("../utils/regions");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// One document = one service offered at one specific office in one region.
const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: "", maxlength: 1000 },
    office: { type: String, required: true, trim: true, maxlength: 200 },
    region: { type: String, enum: REGIONS, required: true, index: true },
    category: {
      type: String,
      enum: ["identity", "civil_status", "transport", "tax", "other"],
      default: "other",
    },
    icon: { type: String, default: "document-text-outline", maxlength: 60 },
    durationMinutes: { type: Number, default: 30, min: 5, max: 240 },
    capacityPerSlot: { type: Number, default: 3, min: 1, max: 100 },
    openTime: { type: String, default: "08:00", match: TIME_RE },
    closeTime: { type: String, default: "15:30", match: TIME_RE },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0=Sunday ... 6=Saturday
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
module.exports.REGIONS = REGIONS;
