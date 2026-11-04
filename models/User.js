const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { REGIONS } = require("../utils/regions");

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 30 },
    password: { type: String, required: true, minlength: 6, select: false },
    // citizen: ordinary user (mobile app).
    // admin: regional administrator, restricted to ONE region (region required).
    // superadmin: platform-wide oversight; not limited to a region.
    role: { type: String, enum: ["citizen", "admin", "superadmin"], default: "citizen" },
    idNumber: { type: String, trim: true, maxlength: 50 },
    // Citizens: home region (optional, used for filtering).
    // Admins: the region they are allowed to manage (required).
    region: { type: String, enum: REGIONS, default: null },
    // false = suspended: cannot log in and existing tokens stop working.
    active: { type: Boolean, default: true },
    // Brute-force protection (enforced for admin roles).
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null }, // informational
    // Embedded in every JWT. Incremented on password change/reset and on
    // suspension, which instantly invalidates all earlier tokens.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.pre("validate", function (next) {
  if (this.role === "admin" && !this.region) {
    this.invalidate("region", "A regional administrator must be assigned a region");
  }
  next();
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

module.exports = mongoose.model("User", userSchema);
