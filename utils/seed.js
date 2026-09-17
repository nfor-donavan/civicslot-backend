require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const Service = require("../models/Service");

const services = [
  {
    name: "National ID Card (CNI)",
    description: "Apply for or renew your national identity card.",
    office: "Centre Regional Delegation of National Security, Yaoundé",
    region: "Centre",
    category: "identity",
    icon: "card-outline",
    durationMinutes: 30,
    capacityPerSlot: 4,
    openTime: "08:00",
    closeTime: "15:30",
    workingDays: [1, 2, 3, 4, 5],
  },
  {
    name: "National ID Card (CNI)",
    description: "Apply for or renew your national identity card.",
    office: "Littoral Regional Delegation of National Security, Douala",
    region: "Littoral",
    category: "identity",
    icon: "card-outline",
    durationMinutes: 30,
    capacityPerSlot: 4,
    openTime: "08:00",
    closeTime: "15:30",
    workingDays: [1, 2, 3, 4, 5],
  },
  {
    name: "Passport Application",
    description: "New passport applications and renewals.",
    office: "Delegation Generale a la Surete Nationale, Yaoundé",
    region: "Centre",
    category: "identity",
    icon: "airplane-outline",
    durationMinutes: 45,
    capacityPerSlot: 3,
    openTime: "08:00",
    closeTime: "14:30",
    workingDays: [1, 2, 3, 4, 5],
  },
  {
    name: "Birth Certificate",
    description: "Request certified copies or corrections of birth certificates.",
    office: "Civil Status Registry, Yaoundé I Council",
    region: "Centre",
    category: "civil_status",
    icon: "document-text-outline",
    durationMinutes: 20,
    capacityPerSlot: 5,
    openTime: "07:30",
    closeTime: "15:00",
    workingDays: [1, 2, 3, 4, 5],
  },
  {
    name: "Birth Certificate",
    description: "Request certified copies or corrections of birth certificates.",
    office: "Civil Status Registry, Bamenda Council",
    region: "Nord-Ouest",
    category: "civil_status",
    icon: "document-text-outline",
    durationMinutes: 20,
    capacityPerSlot: 5,
    openTime: "07:30",
    closeTime: "15:00",
    workingDays: [1, 2, 3, 4, 5],
  },
  {
    name: "Driver's License",
    description: "New license applications, renewals and category upgrades.",
    office: "Ministry of Transport, Regional Delegation, Yaoundé",
    region: "Centre",
    category: "transport",
    icon: "car-outline",
    durationMinutes: 30,
    capacityPerSlot: 3,
    openTime: "08:00",
    closeTime: "15:00",
    workingDays: [1, 2, 3, 4, 5, 6],
  },
  {
    name: "Vehicle Registration (Carte Grise)",
    description: "Register a new vehicle or transfer ownership.",
    office: "Ministry of Transport, Regional Delegation, Douala",
    region: "Littoral",
    category: "transport",
    icon: "car-sport-outline",
    durationMinutes: 30,
    capacityPerSlot: 3,
    openTime: "08:00",
    closeTime: "15:00",
    workingDays: [1, 2, 3, 4, 5],
  },
  {
    name: "Tax Clearance Certificate",
    description: "Obtain a tax clearance certificate (attestation de non-redevance).",
    office: "Directorate General of Taxation, Centre Division",
    region: "Centre",
    category: "tax",
    icon: "receipt-outline",
    durationMinutes: 25,
    capacityPerSlot: 4,
    openTime: "08:00",
    closeTime: "15:30",
    workingDays: [1, 2, 3, 4, 5],
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected. Seeding...");

  // The original seeded account is now the SUPERADMIN — sees and manages
  // everything, across every region.
  const superadminEmail = "admin@civicslot.cm";
  let superadmin = await User.findOne({ email: superadminEmail });
  if (!superadmin) {
    superadmin = await User.create({
      fullName: "CivicSlot Admin",
      email: superadminEmail,
      phone: "+237600000000",
      password: "Admin123!",
      role: "superadmin",
    });
    console.log(`Superadmin created -> email: ${superadminEmail}  password: Admin123!`);
  } else if (superadmin.role !== "superadmin") {
    superadmin.role = "superadmin";
    superadmin.region = undefined;
    await superadmin.save();
    console.log(`Upgraded existing account ${superadminEmail} to superadmin.`);
  } else {
    console.log("Superadmin already exists, skipping.");
  }

  // One example regional admin, scoped to Centre, so you have something to
  // test regional scoping with immediately.
  const regionalAdminEmail = "centre.admin@civicslot.cm";
  let regionalAdmin = await User.findOne({ email: regionalAdminEmail });
  if (!regionalAdmin) {
    regionalAdmin = await User.create({
      fullName: "Centre Regional Admin",
      email: regionalAdminEmail,
      phone: "+237600000001",
      password: "Admin123!",
      role: "admin",
      region: "Centre",
    });
    console.log(`Regional admin created -> email: ${regionalAdminEmail}  password: Admin123!  region: Centre`);
  } else {
    console.log("Example regional admin already exists, skipping.");
  }

  for (const s of services) {
    const exists = await Service.findOne({ name: s.name, office: s.office });
    if (!exists) {
      await Service.create(s);
      console.log(`Service created: ${s.name}`);
    }
  }

  console.log("Seeding complete.");
  console.log(
    "Note: no candidates were seeded. Add real candidate profiles yourself from the admin Candidates tab — CivicSlot doesn't ship with pre-filled political data."
  );
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
