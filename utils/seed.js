require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Service = require("../models/Service");

// Demo data. Office names are PLACEHOLDERS, not verified real offices.
const base = { workingDays: [1, 2, 3, 4, 5], openTime: "08:00", closeTime: "15:30" };
const services = [
  { ...base, name: "National ID Card (CNI)", description: "Apply for or renew your national identity card.", office: "Centre Regional Delegation of National Security, Yaoundé", region: "Centre", category: "identity", icon: "card-outline", durationMinutes: 30, capacityPerSlot: 4 },
  { ...base, name: "National ID Card (CNI)", description: "Apply for or renew your national identity card.", office: "Littoral Regional Delegation of National Security, Douala", region: "Littoral", category: "identity", icon: "card-outline", durationMinutes: 30, capacityPerSlot: 4 },
  { ...base, name: "Passport Application", description: "New passport applications and renewals.", office: "Delegation Generale a la Surete Nationale, Yaoundé", region: "Centre", category: "identity", icon: "airplane-outline", durationMinutes: 45, capacityPerSlot: 3, closeTime: "14:30" },
  { ...base, name: "Birth Certificate", description: "Request certified copies or corrections of birth certificates.", office: "Civil Status Registry, Yaoundé I Council", region: "Centre", category: "civil_status", icon: "document-text-outline", durationMinutes: 20, capacityPerSlot: 5, openTime: "07:30", closeTime: "15:00" },
  { ...base, name: "Birth Certificate", description: "Request certified copies or corrections of birth certificates.", office: "Civil Status Registry, Bamenda Council", region: "Nord-Ouest", category: "civil_status", icon: "document-text-outline", durationMinutes: 20, capacityPerSlot: 5, openTime: "07:30", closeTime: "15:00" },
  { ...base, name: "Driver's License", description: "New license applications, renewals and category upgrades.", office: "Ministry of Transport, Regional Delegation, Yaoundé", region: "Centre", category: "transport", icon: "car-outline", durationMinutes: 30, capacityPerSlot: 3, closeTime: "15:00", workingDays: [1, 2, 3, 4, 5, 6] },
  { ...base, name: "Vehicle Registration (Carte Grise)", description: "Register a new vehicle or transfer ownership.", office: "Ministry of Transport, Regional Delegation, Douala", region: "Littoral", category: "transport", icon: "car-sport-outline", durationMinutes: 30, capacityPerSlot: 3, closeTime: "15:00" },
  { ...base, name: "Tax Clearance Certificate", description: "Obtain a tax clearance certificate (attestation de non-redevance).", office: "Directorate General of Taxation, Centre Division", region: "Centre", category: "tax", icon: "receipt-outline", durationMinutes: 25, capacityPerSlot: 4 },
];

async function seed() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected. Seeding...");

  const superPassword = process.env.SEED_SUPERADMIN_PASSWORD || "Admin123!";
  const regionalPassword = process.env.SEED_REGIONAL_ADMIN_PASSWORD || "Admin123!";
  if (!process.env.SEED_SUPERADMIN_PASSWORD) {
    console.warn("WARNING: using the default demo password for the superadmin. Set SEED_SUPERADMIN_PASSWORD or change it in the portal (Account) before any real use.");
  }

  const superEmail = "admin@civicslot.cm";
  let superadmin = await User.findOne({ email: superEmail });
  if (!superadmin) {
    await User.create({ fullName: "CivicSlot Admin", email: superEmail, phone: "+237600000000", password: superPassword, role: "superadmin" });
    console.log(`Superadmin created -> ${superEmail}`);
  } else if (superadmin.role !== "superadmin") {
    superadmin.role = "superadmin";
    superadmin.region = null;
    await superadmin.save();
    console.log(`Upgraded existing account ${superEmail} to superadmin.`);
  } else {
    console.log("Superadmin already exists, skipping.");
  }

  const regionalEmail = "centre.admin@civicslot.cm";
  if (!(await User.findOne({ email: regionalEmail }))) {
    await User.create({ fullName: "Centre Regional Admin", email: regionalEmail, phone: "+237600000001", password: regionalPassword, role: "admin", region: "Centre" });
    console.log(`Regional admin created -> ${regionalEmail} (region: Centre)`);
  } else {
    console.log("Example regional admin already exists, skipping.");
  }

  for (const s of services) {
    if (!(await Service.findOne({ name: s.name, office: s.office }))) {
      await Service.create(s);
      console.log(`Service created: ${s.name} (${s.region})`);
    }
  }

  console.log("Seeding complete. No candidates are seeded: add real, sourced profiles from the portal (superadmin).");
  await mongoose.disconnect();
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
