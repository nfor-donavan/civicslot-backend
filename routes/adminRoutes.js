const express = require("express");
const Appointment = require("../models/Appointment");
const Service = require("../models/Service");
const User = require("../models/User");
const Candidate = require("../models/Candidate");
const AuditLog = require("../models/AuditLog");
const { protect, adminOnly, superadminOnly } = require("../middleware/auth");
const { resolveRegionFilter } = require("../utils/scope");
const { HttpError, asyncHandler } = require("../utils/errors");
const { todayString, addDays, isValidDateString } = require("../utils/time");
const { REGIONS, isRegion } = require("../utils/regions");

const router = express.Router();

const STATUS_KEYS = ["pending", "confirmed", "completed", "cancelled", "no_show"];
const emptyCounts = () => ({ total: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 });
const AUDIT_CATEGORIES = ["auth", "security", "appointment", "service", "admin", "candidate"];

// Booking statistics. A regional admin always receives their own region only;
// a superadmin receives the whole platform, or one region with ?region=.
router.get(
  "/stats",
  protect,
  adminOnly,
  asyncHandler(async (req, res) => {
    const region = await resolveRegionFilter(req, req.query.region);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 60);

    const services = await Service.find(region ? { region } : {}).select("name office region active").lean();
    const svcById = new Map(services.map((s) => [String(s._id), s]));
    const baseMatch = region ? { service: { $in: services.map((s) => s._id) } } : {};

    const today = todayString();
    const from = addDays(today, -(days - 1));
    const to = addDays(today, 7);

    const [byServiceStatus, dailyRaw] = await Promise.all([
      Appointment.aggregate([
        { $match: baseMatch },
        { $group: { _id: { service: "$service", status: "$status" }, count: { $sum: 1 } } },
      ]),
      Appointment.aggregate([
        { $match: { ...baseMatch, date: { $gte: from, $lte: to } } },
        { $group: { _id: { date: "$date", status: "$status" }, count: { $sum: 1 } } },
      ]),
    ]);

    const totals = emptyCounts();
    const perService = new Map(services.map((s) => [String(s._id), emptyCounts()]));
    const perRegion = new Map(REGIONS.map((r) => [r, emptyCounts()]));
    for (const row of byServiceStatus) {
      const { service, status } = row._id;
      if (!STATUS_KEYS.includes(status)) continue;
      totals[status] += row.count;
      totals.total += row.count;
      const svc = svcById.get(String(service));
      if (svc) {
        const s = perService.get(String(service));
        s[status] += row.count;
        s.total += row.count;
        const r = perRegion.get(svc.region);
        r[status] += row.count;
        r.total += row.count;
      }
    }

    const dailyMap = new Map();
    for (const row of dailyRaw) {
      const { date, status } = row._id;
      if (!dailyMap.has(date)) dailyMap.set(date, emptyCounts());
      const d = dailyMap.get(date);
      if (STATUS_KEYS.includes(status)) {
        d[status] += row.count;
        d.total += row.count;
      }
    }
    const daily = [];
    for (let date = from; date <= to; date = addDays(date, 1)) daily.push({ date, ...(dailyMap.get(date) || emptyCounts()) });

    const live = (c) => c.total - c.cancelled; // bookings that still count as "scheduled"
    const todayRow = daily.find((d) => d.date === today);
    const upcoming7 = daily.filter((d) => d.date >= today && d.date < addDays(today, 7)).reduce((n, d) => n + live(d), 0);
    const attended = totals.completed + totals.no_show;
    const ratio = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

    const body = {
      scope: { region },
      generatedAt: new Date().toISOString(),
      window: { from, to, days },
      totals,
      today: { date: today, count: todayRow ? live(todayRow) : 0 },
      upcoming7,
      rates: {
        attendancePercent: ratio(totals.completed, attended), // completed / (completed + no-show)
        noShowPercent: ratio(totals.no_show, attended),
        cancellationPercent: ratio(totals.cancelled, totals.total),
      },
      daily,
      byService: services
        .map((s) => ({ serviceId: s._id, name: s.name, office: s.office, region: s.region, active: s.active, ...perService.get(String(s._id)) }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    };

    if (req.user.role === "superadmin" && !region) {
      const admins = await User.find({ role: "admin" }).select("region active").lean();
      const svcByRegion = {};
      services.forEach((s) => (svcByRegion[s.region] = (svcByRegion[s.region] || 0) + 1));
      body.byRegion = REGIONS.map((r) => ({
        region: r,
        services: svcByRegion[r] || 0,
        admins: admins.filter((a) => a.region === r && a.active !== false).length,
        ...perRegion.get(r),
      }));
      const [citizens, activeCandidates] = await Promise.all([
        User.countDocuments({ role: "citizen" }),
        Candidate.countDocuments({ active: true }),
      ]);
      body.platform = {
        citizens,
        regionalAdmins: admins.length,
        activeRegionalAdmins: admins.filter((a) => a.active !== false).length,
        services: services.length,
        activeServices: services.filter((s) => s.active).length,
        activeCandidates,
      };
    }
    res.json(body);
  })
);

// Audit trail. Superadmin only; read-only (no endpoint can modify or delete entries).
router.get(
  "/audit",
  protect,
  superadminOnly,
  asyncHandler(async (req, res) => {
    const q = req.query;
    const filter = {};
    if (q.category !== undefined && q.category !== "") {
      if (!AUDIT_CATEGORIES.includes(q.category)) throw new HttpError(400, "Category is not valid");
      filter.action = new RegExp(`^${q.category}\\.`);
    }
    if (q.action !== undefined && q.action !== "") {
      if (typeof q.action !== "string" || !/^[a-z_]+\.[a-z_]+$/.test(q.action)) throw new HttpError(400, "Action is not valid");
      filter.action = q.action;
    }
    if (q.region !== undefined && q.region !== "") {
      if (!isRegion(q.region)) throw new HttpError(400, "Region is not valid");
      filter.region = q.region;
    }
    for (const key of ["from", "to"]) {
      if (q[key] !== undefined && q[key] !== "" && !isValidDateString(q[key])) throw new HttpError(400, `${key} must be in the format YYYY-MM-DD`);
    }
    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) filter.createdAt.$lte = new Date(`${q.to}T23:59:59.999Z`);
    }

    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const [total, rows] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({
      entries: rows.map((r) => ({
        id: r._id,
        createdAt: r.createdAt,
        actorName: r.actorName,
        actorRole: r.actorRole,
        actorRegion: r.actorRegion,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        region: r.region,
        details: r.details,
        ip: r.ip,
      })),
      total,
      page,
      limit,
      pages: Math.max(Math.ceil(total / limit), 1),
    });
  })
);

module.exports = router;
