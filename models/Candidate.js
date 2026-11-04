const mongoose = require("mongoose");
const { REGIONS } = require("../utils/regions");

// Informational only: no vote counts, scores, ballots or registration fields.
const candidateSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    position: { type: String, enum: ["president", "senator"], required: true },
    // Required for senators; null for presidential candidates (national race).
    region: { type: String, enum: REGIONS, default: null },
    party: { type: String, trim: true, default: "", maxlength: 120 },
    bio: { type: String, trim: true, default: "", maxlength: 4000 },
    photoUrl: { type: String, trim: true, default: "", maxlength: 500 },
    sourceUrl: { type: String, trim: true, default: "", maxlength: 500 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Candidate", candidateSchema);
