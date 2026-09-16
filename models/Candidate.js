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

// NOTE: This model is intentionally informational-only. It has no vote count,
// no "score", and no ballot/registration fields. It exists to let citizens
// read public biographical information about people running for office —
// nothing here casts, counts, or represents a vote of any kind.
const candidateSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    position: { type: String, enum: ["president", "senator"], required: true },
    // Region is required for senators (they represent a region) and left
    // null for presidential candidates (a national race).
    region: { type: String, enum: REGIONS, default: null },
    party: { type: String, trim: true, default: "" },
    bio: { type: String, trim: true, default: "" },
    photoUrl: { type: String, trim: true, default: "" },
    sourceUrl: { type: String, trim: true, default: "" }, // link to an official/public source for the bio
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Candidate", candidateSchema);
