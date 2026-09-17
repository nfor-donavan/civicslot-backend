const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, no token provided" });
    }
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Not authorized, token invalid or expired" });
  }
};

// Any admin-level account (regional admin OR superadmin) may pass.
// Route handlers are still responsible for scoping regional admins to
// their own region — this middleware only checks "is this an admin at all".
const adminOnly = (req, res, next) => {
  if (!["admin", "superadmin"].includes(req.user?.role)) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
};

// Only the top-level superadmin may pass — used for creating new admin
// accounts and managing national civic-info content (candidates).
const superadminOnly = (req, res, next) => {
  if (req.user?.role !== "superadmin") {
    return res.status(403).json({ message: "Superadmin access required" });
  }
  next();
};

// Populates req.user if a valid token is present, but never blocks the
// request if it's missing or invalid — for public routes that behave
// slightly differently when the caller happens to be a logged-in admin.
const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      const token = header.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user) req.user = user;
    }
  } catch (err) {
    // ignore — treat as anonymous
  }
  next();
};

module.exports = { protect, adminOnly, superadminOnly, optionalAuth };
