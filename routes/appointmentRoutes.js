const express = require("express");
const Appointment = require("../models/Appointment");
const Service = require("../models/Service");
const { protect, adminOnly } = require("../middleware/auth");
const { getAvailableSlots } = require("../utils/slots");

const router = express.Router();

// POST /api/appointments - citizen books a slot
router.post("/", protect, async (req, res) => {
  try {
    const { serviceId, date, time, notes } = req.body;
    if (!serviceId || !date || !time) {
      return res.status(400).json({ message: "serviceId, date and time are required" });
    }
    const service = await Service.findById(serviceId);
    if (!service || !service.active) {
      return res.status(404).json({ message: "Service not available" });
    }

    const day = new Date(`${date}T00:00:00`).getDay();
    if (!service.workingDays.includes(day)) {
      return res.status(400).json({ message: "This office is closed on the selected day" });
    }

    // Re-check capacity at booking time to prevent double-booking / overbooking
    const slots = await getAvailableSlots(service, date);
    const slot = slots.find((s) => s.time === time);
    if (!slot) {
      return res.status(400).json({ message: "That time slot does not exist for this service." });
    }
    if (slot.past) {
      return res.status(400).json({ message: "That time has already passed today. Please pick a later time." });
    }
    if (slot.full) {
      return res.status(409).json({ message: "This time slot is no longer available. Please pick another." });
    }

    // Prevent the same citizen from booking the same service twice on the same day
    const dup = await Appointment.findOne({
      user: req.user._id,
      service: serviceId,
      date,
      status: { $in: ["pending", "confirmed"] },
    });
    if (dup) {
      return res.status(409).json({ message: "You already have a booking for this service on this date" });
    }

    const appointment = await Appointment.create({
      user: req.user._id,
      service: serviceId,
      date,
      time,
      notes: notes || "",
      status: "pending",
    });
    const populated = await appointment.populate("service");
    res.status(201).json({ appointment: populated });
  } catch (err) {
    res.status(500).json({ message: "Could not book appointment", error: err.message });
  }
});

// GET /api/appointments/mine - citizen's own bookings
router.get("/mine", protect, async (req, res) => {
  try {
    const appointments = await Appointment.find({ user: req.user._id })
      .populate("service")
      .sort({ date: -1, time: -1 });
    res.json({ appointments });
  } catch (err) {
    res.status(500).json({ message: "Could not load appointments", error: err.message });
  }
});

// PATCH /api/appointments/:id/cancel - citizen cancels own booking
router.patch("/:id/cancel", protect, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, user: req.user._id });
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    if (["completed", "cancelled"].includes(appointment.status)) {
      return res.status(400).json({ message: `Cannot cancel a ${appointment.status} appointment` });
    }
    appointment.status = "cancelled";
    await appointment.save();
    res.json({ appointment });
  } catch (err) {
    res.status(500).json({ message: "Could not cancel appointment", error: err.message });
  }
});

// GET /api/appointments - admin: list appointments.
// Regional admins ONLY see appointments for services in their own region.
// Superadmins see everything, optionally narrowed with ?region=
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const { status, date, serviceId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (date) filter.date = date;
    if (serviceId) filter.service = serviceId;

    if (req.user.role === "admin") {
      // Hard scope: ignore anything the client sends and restrict to this
      // admin's own region, resolved through which services belong to it.
      const regionalServiceIds = await Service.find({ region: req.user.region }).distinct("_id");
      filter.service = filter.service
        ? (regionalServiceIds.some((id) => id.equals(filter.service)) ? filter.service : null)
        : { $in: regionalServiceIds };
      if (filter.service === null) {
        return res.json({ appointments: [] }); // requested a service outside their region
      }
    } else if (req.query.region) {
      // Superadmin optionally narrowing by region for oversight browsing.
      const regionalServiceIds = await Service.find({ region: req.query.region }).distinct("_id");
      filter.service = { $in: regionalServiceIds };
    }

    const appointments = await Appointment.find(filter)
      .populate("service")
      .populate("user", "fullName email phone")
      .sort({ date: -1, time: -1 });
    res.json({ appointments });
  } catch (err) {
    res.status(500).json({ message: "Could not load appointments", error: err.message });
  }
});

// PATCH /api/appointments/:id/status - admin updates status.
// Regional admins can only update appointments within their own region.
router.patch("/:id/status", protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ["pending", "confirmed", "completed", "cancelled", "no_show"];
    if (!valid.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const appointment = await Appointment.findById(req.params.id).populate("service");
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });

    if (req.user.role === "admin" && appointment.service?.region !== req.user.region) {
      return res.status(403).json({ message: "This appointment is outside your assigned region" });
    }

    appointment.status = status;
    await appointment.save();
    const populated = await appointment.populate("user", "fullName email phone");
    res.json({ appointment: populated });
  } catch (err) {
    res.status(500).json({ message: "Could not update appointment", error: err.message });
  }
});

module.exports = router;
