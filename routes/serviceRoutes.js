const express = require("express");
const Service = require("../models/Service");
const { protect, adminOnly, optionalAuth } = require("../middleware/auth");
const { getAvailableSlots } = require("../utils/slots");

const router = express.Router();

// GET /api/services - public list of active services (citizens browse).
// When an admin calls this with ?all=true, regional admins are
// automatically scoped to their own region.
router.get("/", optionalAuth, async (req, res) => {
  try {
    const includeInactive = req.query.all === "true";
    const filter = includeInactive ? {} : { active: true };
    if (req.query.region) filter.region = req.query.region;

    // If this is a logged-in regional admin managing services (all=true),
    // force the region filter to their own region regardless of query params.
    if (includeInactive && req.user && req.user.role === "admin") {
      filter.region = req.user.region;
    }

    const services = await Service.find(filter).sort({ createdAt: -1 });
    res.json({ services });
  } catch (err) {
    res.status(500).json({ message: "Could not load services", error: err.message });
  }
});

// GET /api/services/:id
router.get("/:id", async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ message: "Service not found" });
    res.json({ service });
  } catch (err) {
    res.status(500).json({ message: "Could not load service", error: err.message });
  }
});

// GET /api/services/:id/slots?date=YYYY-MM-DD
router.get("/:id/slots", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: "date query param is required" });
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ message: "Service not found" });

    const day = new Date(`${date}T00:00:00`).getDay();
    if (!service.workingDays.includes(day)) {
      return res.json({ slots: [], closed: true });
    }
    const slots = await getAvailableSlots(service, date);
    res.json({ slots, closed: false });
  } catch (err) {
    res.status(500).json({ message: "Could not compute slots", error: err.message });
  }
});

// POST /api/services - admin only. Regional admins can only create
// services within their own region — the region is forced server-side.
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user.role === "admin") {
      payload.region = req.user.region; // ignore whatever the client sent
    } else if (!payload.region) {
      return res.status(400).json({ message: "region is required" });
    }
    const service = await Service.create(payload);
    res.status(201).json({ service });
  } catch (err) {
    res.status(400).json({ message: "Could not create service", error: err.message });
  }
});

// PUT /api/services/:id - admin only. Regional admins can only edit
// services already in their own region, and cannot move a service to a
// different region.
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const existing = await Service.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Service not found" });

    if (req.user.role === "admin") {
      if (existing.region !== req.user.region) {
        return res.status(403).json({ message: "This service is outside your assigned region" });
      }
      delete req.body.region; // regional admins cannot reassign region
    }

    const service = await Service.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    res.json({ service });
  } catch (err) {
    res.status(400).json({ message: "Could not update service", error: err.message });
  }
});

// DELETE /api/services/:id - admin only, same region restriction as above.
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const existing = await Service.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Service not found" });

    if (req.user.role === "admin" && existing.region !== req.user.region) {
      return res.status(403).json({ message: "This service is outside your assigned region" });
    }

    await Service.findByIdAndDelete(req.params.id);
    res.json({ message: "Service deleted" });
  } catch (err) {
    res.status(500).json({ message: "Could not delete service", error: err.message });
  }
});

module.exports = router;
