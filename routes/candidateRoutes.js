const express = require("express");
const Candidate = require("../models/Candidate");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

// GET /api/candidates?position=president|senator&region=Centre
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

// POST /api/candidates - admin only
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const candidate = await Candidate.create(req.body);
    res.status(201).json({ candidate });
  } catch (err) {
    res.status(400).json({ message: "Could not create candidate", error: err.message });
  }
});

// PUT /api/candidates/:id - admin only
router.put("/:id", protect, adminOnly, async (req, res) => {
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

// DELETE /api/candidates/:id - admin only
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const candidate = await Candidate.findByIdAndDelete(req.params.id);
    if (!candidate) return res.status(404).json({ message: "Candidate not found" });
    res.json({ message: "Candidate deleted" });
  } catch (err) {
    res.status(500).json({ message: "Could not delete candidate", error: err.message });
  }
});

module.exports = router;
