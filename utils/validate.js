const mongoose = require("mongoose");
const { HttpError } = require("./errors");
const { isRegion } = require("./regions");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const bad = (msg) => new HttpError(400, msg);

function reqString(value, label, { min = 1, max = 200, trim = true } = {}) {
  if (typeof value !== "string") throw bad(`${label} is required`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw bad(min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`);
  if (v.length > max) throw bad(`${label} must be at most ${max} characters`);
  return v;
}

function optString(value, label, { max = 500 } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw bad(`${label} must be text`);
  const v = value.trim();
  if (v.length > max) throw bad(`${label} must be at most ${max} characters`);
  return v;
}

function reqEmail(value) {
  const v = reqString(value, "Email", { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw bad("Email address is not valid");
  return v;
}

function optRegion(value, label = "Region") {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isRegion(value)) throw bad(`${label} is not a valid region`);
  return value;
}

function reqRegion(value, label = "Region") {
  const v = optRegion(value, label);
  if (!v) throw bad(`${label} is required`);
  return v;
}

function optHttpUrl(value, label) {
  const v = optString(value, label, { max: 500 });
  if (!v) return v;
  let u;
  try {
    u = new URL(v);
  } catch {
    throw bad(`${label} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(u.protocol)) throw bad(`${label} must start with http:// or https://`);
  return v;
}

function isObjectId(v) {
  return typeof v === "string" && /^[a-f\d]{24}$/i.test(v) && mongoose.isValidObjectId(v);
}

function reqObjectId(value, label = "Identifier") {
  if (!isObjectId(value)) throw bad(`${label} is not valid`);
  return value;
}

function optInt(value, label, { min, max }) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

// Passwords for admin accounts: 8+ characters, at least one letter and one digit.
function checkPasswordStrength(password, label = "Password") {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw bad(`${label} must be between 8 and 128 characters`);
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw bad(`${label} must contain at least one letter and one number`);
  }
  return password;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  reqString,
  optString,
  reqEmail,
  optRegion,
  reqRegion,
  optHttpUrl,
  isObjectId,
  reqObjectId,
  optInt,
  checkPasswordStrength,
  escapeRegex,
};
