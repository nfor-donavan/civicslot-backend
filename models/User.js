const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const REGIONS = [
  "Adamaoua",
  "Centre",
  "Est",
  "Extreme-Nord",
  "Littoral",
  "Nord",
  "Nord-Ouest",
  "Ouest",
  "Sud",
  "Sud-Ouest",
];

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    // citizen: ordinary user. admin: scoped to one region's offices only.
    // superadmin: sees/manages everything, and is the only role that can
    // create new admin accounts or manage candidate profiles.
    role: { type: String, enum: ["citizen", "admin", "superadmin"], default: "citizen" },
    idNumber: { type: String, trim: true }, // national ID / CNI number, optional
    region: {
      // For citizens: the region they live in (optional, just for filtering).
      // For admins: the region they are allowed to manage (REQUIRED).
      // For superadmins: not used — they aren't limited to one region.
      type: String,
      enum: REGIONS,
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("User", userSchema);
