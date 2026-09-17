const express = require("express");
const Candidate = require("../models/Candidate");
const { protect, superadminOnly } = require("../middleware/auth");

const router = express.Router();

// GET /api/candidates?position=president|senator&region=Centre
// Public and read-only for everyone (citizens and admins alike).
router.get("/", async (req, res) => {
  try {
    const { position, region, all } = req.query;
    const filter = all === "true" ? {} : { active: true };
    if (position) filter.position = position;
    if (region) filter.region = region;
    const candidates = await Candidate.find(filter).sort({ fullName: 1 });
    res.json({ candidates });
  } catch (err) {
    res.status(500).json({ message: "Could not load candidates", error: err.message });
  }
});

// Candidate profiles are national civic-info content, not tied to any one
// office — so only the superadmin manages them, not regional admins.

// POST /api/candidates - superadmin only
router.post("/", protect, superadminOnly, async (req, res) => {
  try {
    const candidate = await Candidate.create(req.body);
    res.status(201).json({ candidate });
  } catch (err) {
    res.status(400).json({ message: "Could not create candidate", error: err.message });
  }
});

// PUT /api/candidates/:id - superadmin only
router.put("/:id", protect, superadminOnly, async (req, res) => {
  try {
    const candidate = await Candidate.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });
    res.json({ candidate });
  } catch (err) {
    res.status(400).json({ message: "Could not update candidate", error: err.message });
  }
});

// DELETE /api/candidates/:id - superadmin only
router.delete("/:id", protect, superadminOnly, async (req, res) => {
  try {
    const candidate = await Candidate.findByIdAndDelete(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });
    res.json({ message: "Candidate deleted" });
  } catch (err) {
    res.status(500).json({ message: "Could not delete candidate", error: err.message });
  }
});

module.exports = router;
