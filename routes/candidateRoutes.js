const express = require("express");
const Candidate = require("../models/Candidate");
const { protect, superadminOnly, optionalAuth } = require("../middleware/auth");
const { HttpError, asyncHandler } = require("../utils/errors");
const { record } = require("../utils/audit");
const { isRegion } = require("../utils/regions");
const v = require("../utils/validate");

const router = express.Router();
const POSITIONS = ["president", "senator"];

function parseCandidate(b, existing) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!existing || has("fullName")) out.fullName = v.reqString(b.fullName, "Full name", { max: 120 });
  const position = has("position") ? b.position : existing?.position;
  if (!POSITIONS.includes(position)) throw new HttpError(400, "Position must be president or senator");
  if (has("position") || !existing) out.position = position;
  if (position === "senator") {
    const region = has("region") ? b.region : existing?.region;
    if (!isRegion(region)) throw new HttpError(400, "A region is required for a senator profile");
    out.region = region;
  } else {
    out.region = null; // presidential race is national
  }
  if (has("party")) out.party = v.optString(b.party, "Party", { max: 120 }) ?? "";
  if (has("bio")) out.bio = v.optString(b.bio, "Biography", { max: 4000 }) ?? "";
  // Only http(s) links are accepted so a stored value can never be a javascript: URL.
  if (has("photoUrl")) out.photoUrl = v.optHttpUrl(b.photoUrl, "Photo URL") ?? "";
  if (has("sourceUrl")) out.sourceUrl = v.optHttpUrl(b.sourceUrl, "Source URL") ?? "";
  if (has("active")) {
    if (typeof b.active !== "boolean") throw new HttpError(400, "Active must be true or false");
    out.active = b.active;
  }
  return out;
}

// Public + read-only. Inactive profiles are only returned to a superadmin (?all=true).
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { position, region } = req.query;
    const filter = req.query.all === "true" && req.user?.role === "superadmin" ? {} : { active: true };
    if (position !== undefined && position !== "") {
      if (!POSITIONS.includes(position)) throw new HttpError(400, "Position is not valid");
      filter.position = position;
    }
    if (region !== undefined && region !== "") {
      if (!isRegion(region)) throw new HttpError(400, "Region is not valid");
      filter.region = region;
    }
    res.json({ candidates: await Candidate.find(filter).sort({ fullName: 1 }) });
  })
);

// Candidate profiles are national civic-information content: superadmin only.
router.post(
  "/",
  protect,
  superadminOnly,
  asyncHandler(async (req, res) => {
    const candidate = await Candidate.create(parseCandidate(req.body || {}, null));
    await record(req, { action: "candidate.created", entityType: "candidate", entityId: candidate._id, region: candidate.region, details: { name: candidate.fullName, position: candidate.position } });
    res.status(201).json({ candidate });
  })
);

router.put(
  "/:id",
  protect,
  superadminOnly,
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Candidate");
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) throw new HttpError(404, "Candidate not found");
    const clean = parseCandidate(req.body || {}, candidate);
    candidate.set(clean);
    await candidate.save();
    await record(req, { action: "candidate.updated", entityType: "candidate", entityId: candidate._id, region: candidate.region, details: { changed: Object.keys(clean), name: candidate.fullName } });
    res.json({ candidate });
  })
);

router.delete(
  "/:id",
  protect,
  superadminOnly,
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Candidate");
    const candidate = await Candidate.findByIdAndDelete(req.params.id);
    if (!candidate) throw new HttpError(404, "Candidate not found");
    await record(req, { action: "candidate.deleted", entityType: "candidate", entityId: candidate._id, region: candidate.region, details: { name: candidate.fullName, position: candidate.position } });
    res.json({ message: "Candidate deleted" });
  })
);

module.exports = router;
