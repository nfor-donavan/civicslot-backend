const express = require("express");
const Appointment = require("../models/Appointment");
const Service = require("../models/Service");
const User = require("../models/User");
const { protect, adminOnly } = require("../middleware/auth");
const { resolveRegionFilter, denyCrossRegion } = require("../utils/scope");
const { getAvailableSlots } = require("../utils/slots");
const { HttpError, asyncHandler } = require("../utils/errors");
const { record } = require("../utils/audit");
const { isValidDateString, isValidTimeString, weekdayOf, todayString, addDays } = require("../utils/time");
const v = require("../utils/validate");

const router = express.Router();

const STATUSES = ["pending", "confirmed", "completed", "cancelled", "no_show"];
// Allowed administrator transitions. completed / cancelled / no_show are final.
const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};
const MAX_DAYS_AHEAD = 90;

// ---- Citizen endpoints ----------------------------------------------------

router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const serviceId = v.reqObjectId(b.serviceId, "Service");
    if (!isValidDateString(b.date)) throw new HttpError(400, "Date must be in the format YYYY-MM-DD");
    if (!isValidTimeString(b.time)) throw new HttpError(400, "Time must be in the format HH:mm");
    const notes = v.optString(b.notes, "Notes", { max: 500 }) || "";

    const service = await Service.findById(serviceId);
    if (!service || !service.active) throw new HttpError(404, "Service not available");

    const today = todayString();
    if (b.date < today) throw new HttpError(400, "You cannot book an appointment in the past");
    if (b.date > addDays(today, MAX_DAYS_AHEAD)) {
      throw new HttpError(400, `Appointments can be booked up to ${MAX_DAYS_AHEAD} days ahead`);
    }
    if (!service.workingDays.includes(weekdayOf(b.date))) {
      throw new HttpError(400, "This office is closed on the selected day");
    }

    const slots = await getAvailableSlots(service, b.date);
    const slot = slots.find((s) => s.time === b.time);
    if (!slot) throw new HttpError(400, "That time slot does not exist for this service.");
    if (slot.past) throw new HttpError(400, "That time has already passed today. Please pick a later time.");
    if (slot.full) throw new HttpError(409, "This time slot is no longer available. Please pick another.");

    const dup = await Appointment.findOne({
      user: req.user._id,
      service: serviceId,
      date: b.date,
      status: { $in: ["pending", "confirmed"] },
    });
    if (dup) throw new HttpError(409, "You already have a booking for this service on this date");

    const appointment = await Appointment.create({
      user: req.user._id,
      service: serviceId,
      date: b.date,
      time: b.time,
      notes,
      status: "pending",
    });
    res.status(201).json({ appointment: await appointment.populate("service") });
  })
);

router.get(
  "/mine",
  protect,
  asyncHandler(async (req, res) => {
    const appointments = await Appointment.find({ user: req.user._id }).populate("service").sort({ date: -1, time: -1 });
    res.json({ appointments });
  })
);

router.patch(
  "/:id/cancel",
  protect,
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Appointment");
    const appointment = await Appointment.findOne({ _id: req.params.id, user: req.user._id });
    if (!appointment) throw new HttpError(404, "Appointment not found");
    if (["completed", "cancelled", "no_show"].includes(appointment.status)) {
      throw new HttpError(400, `Cannot cancel a ${appointment.status} appointment`);
    }
    appointment.status = "cancelled";
    appointment.statusUpdatedAt = new Date();
    await appointment.save();
    res.json({ appointment });
  })
);

// ---- Administrator endpoints (scoped by region) ---------------------------

// List with filters + pagination. Regional admins only ever see their region.
router.get(
  "/",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const q = req.query;
    const region = await resolveRegionFilter(req, q.region);
    const filter = {};

    if (region) filter.service = { $in: await Service.distinct("_id", { region }) };

    if (q.serviceId !== undefined && q.serviceId !== "") {
      v.reqObjectId(q.serviceId, "Service");
      const svc = await Service.findById(q.serviceId).select("region");
      if (!svc) throw new HttpError(404, "Service not found");
      if (req.user.role === "admin" && svc.region !== req.user.region) {
        return denyCrossRegion(req, { entityType: "service", entityId: svc._id, region: svc.region });
      }
      if (region && svc.region !== region) return res.json({ appointments: [], total: 0, page: 1, limit: 0, pages: 0 });
      filter.service = svc._id;
    }

    if (q.status !== undefined && q.status !== "") {
      if (typeof q.status !== "string" || !STATUSES.includes(q.status)) throw new HttpError(400, "Status is not valid");
      filter.status = q.status;
    }

    for (const key of ["date", "dateFrom", "dateTo"]) {
      if (q[key] !== undefined && q[key] !== "" && !isValidDateString(q[key])) {
        throw new HttpError(400, `${key} must be in the format YYYY-MM-DD`);
      }
    }
    if (q.date) filter.date = q.date;
    else if (q.dateFrom || q.dateTo) {
      filter.date = {};
      if (q.dateFrom) filter.date.$gte = q.dateFrom;
      if (q.dateTo) filter.date.$lte = q.dateTo;
    }

    const search = typeof q.q === "string" ? q.q.trim().slice(0, 100) : "";
    if (search) {
      const rx = new RegExp(v.escapeRegex(search), "i");
      const userIds = await User.distinct("_id", { $or: [{ fullName: rx }, { email: rx }, { phone: rx }] });
      filter.$or = [{ reference: new RegExp(`^${v.escapeRegex(search.toUpperCase())}`) }, { user: { $in: userIds } }];
    }

    // No `limit` => return up to 500 (keeps the mobile admin list working unchanged).
    const limit = q.limit === undefined ? 500 : Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const sort = q.sort === "soonest" ? { date: 1, time: 1 } : { date: -1, time: -1 };

    const [total, appointments] = await Promise.all([
      Appointment.countDocuments(filter),
      Appointment.find(filter)
        .populate("service")
        .populate("user", "fullName email phone")
        .populate("statusUpdatedBy", "fullName")
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit),
    ]);
    res.json({ appointments, total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) });
  })
);

router.patch(
  "/:id/status",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Appointment");
    const { status } = req.body || {};
    if (typeof status !== "string" || !STATUSES.includes(status)) throw new HttpError(400, "Invalid status value");
    const adminNote = v.optString(req.body.reason ?? req.body.adminNote, "Reason", { max: 500 });

    const appointment = await Appointment.findById(req.params.id).populate("service");
    if (!appointment) throw new HttpError(404, "Appointment not found");

    const apptRegion = appointment.service ? appointment.service.region : null;
    if (req.user.role === "admin" && apptRegion !== req.user.region) {
      return denyCrossRegion(req, { entityType: "appointment", entityId: appointment._id, region: apptRegion });
    }

    const from = appointment.status;
    if (!TRANSITIONS[from].includes(status)) {
      throw new HttpError(409, `An appointment that is ${from.replace("_", "-")} cannot be changed to ${status.replace("_", "-")}`);
    }

    appointment.status = status;
    appointment.statusUpdatedBy = req.user._id;
    appointment.statusUpdatedAt = new Date();
    if (adminNote) appointment.adminNote = adminNote;
    await appointment.save();
    await record(req, {
      action: "appointment.status_changed",
      entityType: "appointment",
      entityId: appointment._id,
      region: apptRegion,
      details: { reference: appointment.reference, from, to: status, ...(adminNote ? { reason: adminNote } : {}) },
    });

    await appointment.populate("user", "fullName email phone");
    res.json({ appointment });
  })
);

module.exports = router;
module.exports.TRANSITIONS = TRANSITIONS;
