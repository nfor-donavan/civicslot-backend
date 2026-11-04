const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getConfig } = require("../config");
const { HttpError } = require("../utils/errors");
const { isObjectId } = require("../utils/validate");

function signToken(user, expiresIn) {
  return jwt.sign({ id: String(user._id), role: user.role, tv: user.tokenVersion || 0 }, getConfig().jwtSecret, {
    expiresIn,
    algorithm: "HS256",
  });
}

// Resolves the authenticated user from the Authorization header.
// The role/region are ALWAYS read from the database, never from the token,
// so suspending an account or changing its region takes effect immediately.
async function userFromRequest(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "Not authorized, no token provided");
  }
  let decoded;
  try {
    decoded = jwt.verify(header.slice(7).trim(), getConfig().jwtSecret, { algorithms: ["HS256"] });
  } catch {
    throw new HttpError(401, "Not authorized, token invalid or expired");
  }
  if (!isObjectId(decoded.id)) throw new HttpError(401, "Not authorized, token invalid or expired");

  const user = await User.findById(decoded.id);
  if (!user) throw new HttpError(401, "User no longer exists");
  if (user.active === false) throw new HttpError(401, "This account has been suspended");
  // Tokens issued before this feature carry no "tv" and count as version 0.
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    throw new HttpError(401, "Your session is no longer valid, please sign in again");
  }
  return user;
}

const protect = async (req, res, next) => {
  try {
    req.user = await userFromRequest(req);
    next();
  } catch (err) {
    next(err);
  }
};

// Populates req.user when a valid token is present; never blocks the request.
const optionalAuth = async (req, res, next) => {
  try {
    if (req.headers.authorization) req.user = await userFromRequest(req);
  } catch {
    // treated as anonymous
  }
  next();
};

// Any admin-level account (regional admin OR superadmin). Handlers are still
// responsible for scoping regional admins to their own region.
const adminOnly = (req, res, next) => {
  if (!req.user || !["admin", "superadmin"].includes(req.user.role)) {
    return next(new HttpError(403, "Admin access required"));
  }
  next();
};

const superadminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "superadmin") {
    return next(new HttpError(403, "Superadmin access required"));
  }
  next();
};

module.exports = { signToken, protect, optionalAuth, adminOnly, superadminOnly };
