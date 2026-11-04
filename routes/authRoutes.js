const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { signToken, protect, superadminOnly } = require("../middleware/auth");
const { authLimiter } = require("../middleware/security");
const { getConfig } = require("../config");
const { HttpError, asyncHandler } = require("../utils/errors");
const { record } = require("../utils/audit");
const v = require("../utils/validate");

const ADMIN_ROLES = ["admin", "superadmin"];
const DUMMY_HASH = bcrypt.hashSync("civicslot-timing-equaliser", 10);

function sanitize(user) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    idNumber: user.idNumber,
    region: user.region,
    active: user.active !== false,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
  };
}

// Shared credential check for /login and /admin-login.
async function authenticate(req, rawEmail, rawPassword) {
  if (typeof rawEmail !== "string" || typeof rawPassword !== "string" || !rawEmail || !rawPassword) {
    throw new HttpError(400, "Email and password are required");
  }
  const cfg = getConfig();
  const user = await User.findOne({ email: rawEmail.trim().toLowerCase() }).select("+password");
  if (!user) {
    await bcrypt.compare(rawPassword, DUMMY_HASH); // keep timing similar for unknown accounts
    throw new HttpError(401, "Invalid email or password");
  }

  const isAdminRole = ADMIN_ROLES.includes(user.role);
  if (isAdminRole && user.isLocked()) {
    const mins = Math.max(1, Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000));
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute(s).`);
  }

  if (!(await user.comparePassword(rawPassword))) {
    if (isAdminRole) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      let locked = false;
      if (user.failedLoginAttempts >= cfg.maxFailedLogins) {
        user.lockUntil = new Date(Date.now() + cfg.lockoutMinutes * 60000);
        user.failedLoginAttempts = 0;
        locked = true;
      }
      await user.save({ validateBeforeSave: false });
      await record(req, { action: locked ? "auth.account_locked" : "auth.login_failed", actor: user, region: user.region || null });
    }
    throw new HttpError(401, "Invalid email or password");
  }

  // Credentials are right; only now reveal account state.
  if (user.active === false) {
    throw new HttpError(403, "This account has been suspended. Contact the platform administrator.");
  }

  if (isAdminRole) {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
  }
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });
  if (isAdminRole) await record(req, { action: "auth.login", actor: user, region: user.region || null });
  return user;
}

module.exports = function createAuthRouter() {
  const cfg = getConfig();
  const limit = authLimiter(cfg);
  const router = express.Router();

  // Public: citizen self-registration. Always creates a citizen - the role can
  // never be chosen by the client.
  router.post(
    "/register",
    limit,
    asyncHandler(async (req, res) => {
      const b = req.body || {};
      const fullName = v.reqString(b.fullName, "Full name", { min: 2, max: 100 });
      const email = v.reqEmail(b.email);
      const password = v.reqString(b.password, "Password", { min: 6, max: 128, trim: false });
      const phone = v.optString(b.phone, "Phone", { max: 30 });
      const idNumber = v.optString(b.idNumber, "ID number", { max: 50 });
      const region = v.optRegion(b.region);

      if (await User.findOne({ email })) throw new HttpError(409, "An account with this email already exists");
      const user = await User.create({ fullName, email, phone, password, idNumber, region, role: "citizen" });
      res.status(201).json({ token: signToken(user, cfg.jwtExpiresIn), user: sanitize(user) });
    })
  );

  // Public: mobile app login (all roles).
  router.post(
    "/login",
    limit,
    asyncHandler(async (req, res) => {
      const user = await authenticate(req, req.body?.email, req.body?.password);
      res.json({ token: signToken(user, cfg.jwtExpiresIn), user: sanitize(user) });
    })
  );

  // Public: web administration portal login. Administrators only; shorter session.
  router.post(
    "/admin-login",
    limit,
    asyncHandler(async (req, res) => {
      const user = await authenticate(req, req.body?.email, req.body?.password);
      if (!ADMIN_ROLES.includes(user.role)) {
        throw new HttpError(403, "This portal is for authorised administrators only");
      }
      res.json({ token: signToken(user, cfg.jwtAdminExpiresIn), user: sanitize(user) });
    })
  );

  router.get("/me", protect, (req, res) => res.json({ user: sanitize(req.user) }));

  // Citizens may update their phone and home region. Administrators may only
  // update their phone: a regional admin's region is assigned by a superadmin.
  router.patch(
    "/me",
    protect,
    asyncHandler(async (req, res) => {
      const b = req.body || {};
      if (b.region !== undefined) {
        if (req.user.role !== "citizen") {
          await record(req, {
            action: "security.region_self_change_blocked",
            region: req.user.region || null,
            details: { attemptedRegion: String(b.region).slice(0, 30) },
          });
          throw new HttpError(403, "Your region can only be changed by a superadmin");
        }
        req.user.region = v.optRegion(b.region) || null;
      }
      if (b.phone !== undefined) req.user.phone = v.optString(b.phone, "Phone", { max: 30 }) || "";
      await req.user.save();
      res.json({ user: sanitize(req.user) });
    })
  );

  router.post(
    "/change-password",
    limit,
    protect,
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body || {};
      if (typeof currentPassword !== "string" || !currentPassword) throw new HttpError(400, "Current password is required");
      v.checkPasswordStrength(newPassword, "New password");
      const user = await User.findById(req.user._id).select("+password");
      if (!(await user.comparePassword(currentPassword))) throw new HttpError(400, "Current password is incorrect");
      if (currentPassword === newPassword) throw new HttpError(400, "New password must be different from the current one");
      user.password = newPassword;
      user.passwordChangedAt = new Date();
      user.tokenVersion = (user.tokenVersion || 0) + 1; // ends every other session
      await user.save();
      if (ADMIN_ROLES.includes(user.role)) {
        await record(req, { action: "auth.password_changed", region: user.region || null });
      }
      const expires = ADMIN_ROLES.includes(user.role) ? cfg.jwtAdminExpiresIn : cfg.jwtExpiresIn;
      res.json({ token: signToken(user, expires), user: sanitize(user) });
    })
  );

  // ---- Regional administrator account management (superadmin only) ----

  router.post(
    "/create-admin",
    protect,
    superadminOnly,
    asyncHandler(async (req, res) => {
      const b = req.body || {};
      const fullName = v.reqString(b.fullName, "Full name", { min: 2, max: 100 });
      const email = v.reqEmail(b.email);
      const password = v.checkPasswordStrength(b.password);
      const phone = v.optString(b.phone, "Phone", { max: 30 });
      const region = v.reqRegion(b.region, "Assigned region");
      if (await User.findOne({ email })) throw new HttpError(409, "An account with this email already exists");
      const admin = await User.create({ fullName, email, phone, password, region, role: "admin" });
      await record(req, {
        action: "admin.created",
        entityType: "user",
        entityId: admin._id,
        region,
        details: { email, fullName },
      });
      res.status(201).json({ admin: sanitize(admin) });
    })
  );

  router.get(
    "/admins",
    protect,
    superadminOnly,
    asyncHandler(async (req, res) => {
      const admins = await User.find({ role: "admin" }).sort({ region: 1, fullName: 1 });
      res.json({ admins: admins.map(sanitize) });
    })
  );

  router.patch(
    "/admins/:id",
    protect,
    superadminOnly,
    asyncHandler(async (req, res) => {
      v.reqObjectId(req.params.id);
      const admin = await User.findOne({ _id: req.params.id, role: "admin" });
      if (!admin) throw new HttpError(404, "Admin not found");
      const b = req.body || {};
      const changed = [];
      const details = {};

      if (b.fullName !== undefined) {
        admin.fullName = v.reqString(b.fullName, "Full name", { min: 2, max: 100 });
        changed.push("fullName");
      }
      if (b.phone !== undefined) {
        admin.phone = v.optString(b.phone, "Phone", { max: 30 }) || "";
        changed.push("phone");
      }
      if (b.region !== undefined) {
        const region = v.reqRegion(b.region, "Assigned region");
        if (region !== admin.region) details.regionChange = { from: admin.region, to: region };
        admin.region = region;
        changed.push("region");
      }
      if (b.active !== undefined) {
        if (typeof b.active !== "boolean") throw new HttpError(400, "Active must be true or false");
        if (b.active !== admin.active) {
          details.active = b.active;
          // Suspending also invalidates every token issued so far.
          if (!b.active) admin.tokenVersion = (admin.tokenVersion || 0) + 1;
        }
        admin.active = b.active;
        changed.push("active");
      }
      if (b.password !== undefined) {
        admin.password = v.checkPasswordStrength(b.password);
        admin.passwordChangedAt = new Date();
        admin.tokenVersion = (admin.tokenVersion || 0) + 1;
        admin.failedLoginAttempts = 0;
        admin.lockUntil = null;
        details.passwordReset = true;
        changed.push("password");
      }
      if (changed.length === 0) throw new HttpError(400, "No changes supplied");

      await admin.save();
      await record(req, {
        action: "admin.updated",
        entityType: "user",
        entityId: admin._id,
        region: admin.region,
        details: { ...details, changed, email: admin.email },
      });
      res.json({ admin: sanitize(admin) });
    })
  );

  router.delete(
    "/admins/:id",
    protect,
    superadminOnly,
    asyncHandler(async (req, res) => {
      v.reqObjectId(req.params.id);
      const admin = await User.findOne({ _id: req.params.id, role: "admin" });
      if (!admin) throw new HttpError(404, "Admin not found");
      await admin.deleteOne();
      await record(req, {
        action: "admin.deleted",
        entityType: "user",
        entityId: admin._id,
        region: admin.region,
        details: { email: admin.email, fullName: admin.fullName },
      });
      res.json({ message: "Admin removed" });
    })
  );

  return router;
};
module.exports.sanitize = sanitize;
