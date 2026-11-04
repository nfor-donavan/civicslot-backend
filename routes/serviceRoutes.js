const express = require("express");
const Service = require("../models/Service");
const Appointment = require("../models/Appointment");
const { protect, adminOnly, optionalAuth } = require("../middleware/auth");
const { resolveRegionFilter, denyCrossRegion } = require("../utils/scope");
const { getAvailableSlots } = require("../utils/slots");
const { HttpError, asyncHandler } = require("../utils/errors");
const { record } = require("../utils/audit");
const { isValidDateString, isValidTimeString, weekdayOf, timeToMinutes } = require("../utils/time");
const { isRegion } = require("../utils/regions");
const v = require("../utils/validate");

const router = express.Router();
const CATEGORIES = ["identity", "civil_status", "transport", "tax", "other"];

// Whitelists and validates the writable fields (no mass assignment).
function parseServiceBody(b, partial) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has("name")) out.name = v.reqString(b.name, "Service name", { max: 120 });
  if (!partial || has("office")) out.office = v.reqString(b.office, "Office", { max: 200 });
  if (has("description")) out.description = v.optString(b.description, "Description", { max: 1000 }) ?? "";
  if (has("category")) {
    if (!CATEGORIES.includes(b.category)) throw new HttpError(400, "Category is not valid");
    out.category = b.category;
  }
  if (has("icon")) out.icon = v.optString(b.icon, "Icon", { max: 60 }) || "document-text-outline";
  if (has("durationMinutes")) out.durationMinutes = v.optInt(b.durationMinutes, "Duration", { min: 5, max: 240 });
  if (has("capacityPerSlot")) out.capacityPerSlot = v.optInt(b.capacityPerSlot, "Capacity per slot", { min: 1, max: 100 });
  for (const key of ["openTime", "closeTime"]) {
    if (has(key)) {
      if (!isValidTimeString(b[key])) throw new HttpError(400, `${key === "openTime" ? "Opening" : "Closing"} time must be HH:mm`);
      out[key] = b[key];
    }
  }
  if (has("workingDays")) {
    const d = b.workingDays;
    if (!Array.isArray(d) || d.length === 0 || d.length > 7 || !d.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)) {
      throw new HttpError(400, "Working days must be a list of numbers from 0 (Sunday) to 6 (Saturday)");
    }
    out.workingDays = [...new Set(d)].sort();
  }
  if (has("active")) {
    if (typeof b.active !== "boolean") throw new HttpError(400, "Active must be true or false");
    out.active = b.active;
  }
  return out;
}

function assertOpeningHours(openTime, closeTime) {
  if (timeToMinutes(closeTime) <= timeToMinutes(openTime)) {
    throw new HttpError(400, "Closing time must be after opening time");
  }
}

// Public catalogue of active services. Administrators can pass ?all=true to
// include inactive ones; a regional admin is always confined to their region.
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = req.user && ["admin", "superadmin"].includes(req.user.role);
    const filter = {};
    if (!(req.query.all === "true" && isAdmin)) filter.active = true;

    if (req.query.all === "true" && isAdmin && req.user.role === "admin") {
      filter.region = req.user.region;
    } else if (req.query.region !== undefined && req.query.region !== "") {
      if (!isRegion(req.query.region)) throw new HttpError(400, "Region is not valid");
      filter.region = req.query.region;
    }
    const services = await Service.find(filter).sort({ createdAt: -1 });
    res.json({ services });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Service");
    const service = await Service.findById(req.params.id);
    if (!service) throw new HttpError(404, "Service not found");
    res.json({ service });
  })
);

router.get(
  "/:id/slots",
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Service");
    const { date } = req.query;
    if (!isValidDateString(date)) throw new HttpError(400, "date must be in the format YYYY-MM-DD");
    const service = await Service.findById(req.params.id);
    if (!service) throw new HttpError(404, "Service not found");
    if (!service.workingDays.includes(weekdayOf(date))) return res.json({ slots: [], closed: true });
    res.json({ slots: await getAvailableSlots(service, date), closed: false });
  })
);

router.post(
  "/",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const clean = parseServiceBody(b, false);
    const region = await resolveRegionFilter(req, b.region); // regional admin: own region only
    if (!region) throw new HttpError(400, "Region is required");
    assertOpeningHours(clean.openTime || "08:00", clean.closeTime || "15:30");
    const service = await Service.create({ ...clean, region });
    await record(req, { action: "service.created", entityType: "service", entityId: service._id, region, details: { name: service.name, office: service.office } });
    res.status(201).json({ service });
  })
);

router.put(
  "/:id",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Service");
    const service = await Service.findById(req.params.id);
    if (!service) throw new HttpError(404, "Service not found");
    if (req.user.role === "admin" && service.region !== req.user.region) {
      return denyCrossRegion(req, { entityType: "service", entityId: service._id, region: service.region });
    }

    const b = req.body || {};
    const clean = parseServiceBody(b, true);
    if (b.region !== undefined && b.region !== service.region) {
      // Only a superadmin may move a service to another region.
      if (req.user.role !== "superadmin") await resolveRegionFilter(req, b.region); // throws 403 + audit
      clean.region = v.reqRegion(b.region);
    }
    assertOpeningHours(clean.openTime || service.openTime, clean.closeTime || service.closeTime);

    const changed = Object.keys(clean);
    if (changed.length === 0) throw new HttpError(400, "No changes supplied");
    service.set(clean);
    await service.save();
    await record(req, { action: "service.updated", entityType: "service", entityId: service._id, region: service.region, details: { changed, name: service.name } });
    res.json({ service });
  })
);

router.delete(
  "/:id",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    v.reqObjectId(req.params.id, "Service");
    const service = await Service.findById(req.params.id);
    if (!service) throw new HttpError(404, "Service not found");
    if (req.user.role === "admin" && service.region !== req.user.region) {
      return denyCrossRegion(req, { entityType: "service", entityId: service._id, region: service.region });
    }
    const bookings = await Appointment.countDocuments({ service: service._id });
    if (bookings > 0) {
      throw new HttpError(409, `This service has ${bookings} appointment(s) on record and cannot be deleted. Deactivate it instead.`);
    }
    await service.deleteOne();
    await record(req, { action: "service.deleted", entityType: "service", entityId: service._id, region: service.region, details: { name: service.name, office: service.office } });
    res.json({ message: "Service deleted" });
  })
);

module.exports = router;
