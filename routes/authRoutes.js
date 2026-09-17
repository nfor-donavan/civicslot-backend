const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect, superadminOnly } = require("../middleware/auth");

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function sanitize(user) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    idNumber: user.idNumber,
    region: user.region,
  };
}

// POST /api/auth/register — always creates a citizen. Admin accounts are
// created separately by a superadmin (see /create-admin below), never
// through public self-registration.
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, phone, password, idNumber, region } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "Full name, email and password are required" });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }
    const user = await User.create({
      fullName,
      email,
      phone,
      password,
      idNumber,
      region,
      role: "citizen",
    });
    const token = signToken(user);
    res.status(201).json({ token, user: sanitize(user) });
  } catch (err) {
    res.status(500).json({ message: "Registration failed", error: err.message });
  }
});

// POST /api/auth/create-admin — superadmin only. Creates a regional admin
// account scoped to one region.
router.post("/create-admin", protect, superadminOnly, async (req, res) => {
  try {
    const { fullName, email, phone, password, region } = req.body;
    if (!fullName || !email || !password || !region) {
      return res.status(400).json({ message: "Full name, email, password and region are required" });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }
    const admin = await User.create({
      fullName,
      email,
      phone,
      password,
      region,
      role: "admin",
    });
    res.status(201).json({ admin: sanitize(admin) });
  } catch (err) {
    res.status(500).json({ message: "Could not create admin", error: err.message });
  }
});

// GET /api/auth/admins — superadmin only. List all regional admins.
router.get("/admins", protect, superadminOnly, async (req, res) => {
  try {
    const admins = await User.find({ role: "admin" }).sort({ region: 1, fullName: 1 });
    res.json({ admins: admins.map(sanitize) });
  } catch (err) {
    res.status(500).json({ message: "Could not load admins", error: err.message });
  }
});

// DELETE /api/auth/admins/:id — superadmin only. Remove a regional admin's access.
router.delete("/admins/:id", protect, superadminOnly, async (req, res) => {
  try {
    const admin = await User.findOneAndDelete({ _id: req.params.id, role: "admin" });
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.json({ message: "Admin removed" });
  } catch (err) {
    res.status(500).json({ message: "Could not remove admin", error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const token = signToken(user);
    res.json({ token, user: sanitize(user) });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

// GET /api/auth/me
router.get("/me", protect, async (req, res) => {
  res.json({ user: sanitize(req.user) });
});

// PATCH /api/auth/me - update own region/phone (citizens only update themselves this way)
router.patch("/me", protect, async (req, res) => {
  try {
    const { region, phone } = req.body;
    if (region !== undefined) req.user.region = region;
    if (phone !== undefined) req.user.phone = phone;
    await req.user.save();
    res.json({ user: sanitize(req.user) });
  } catch (err) {
    res.status(400).json({ message: "Could not update profile", error: err.message });
  }
});

module.exports = router;
