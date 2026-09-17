const Appointment = require("../models/Appointment");

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// YYYY-MM-DD for "today" in server local time.
function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Generates the raw slot grid for a service (does not check bookings)
function generateSlotGrid(service) {
  const slots = [];
  const start = timeToMinutes(service.openTime);
  const end = timeToMinutes(service.closeTime);
  for (let t = start; t < end; t += service.durationMinutes) {
    slots.push(minutesToTime(t));
  }
  return slots;
}

// Returns slots with remaining capacity for a given date, excluding cancelled
// bookings, and marks any slot earlier than the current time on today's date
// as "past" so it can no longer be booked.
async function getAvailableSlots(service, date) {
  const grid = generateSlotGrid(service);
  const bookings = await Appointment.aggregate([
    {
      $match: {
        service: service._id,
        date,
        status: { $in: ["pending", "confirmed", "completed"] },
      },
    },
    { $group: { _id: "$time", count: { $sum: 1 } } },
  ]);
  const bookedMap = {};
  bookings.forEach((b) => {
    bookedMap[b._id] = b.count;
  });

  const isToday = date === getTodayString();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return grid.map((time) => {
    const booked = bookedMap[time] || 0;
    const full = booked >= service.capacityPerSlot;
    const past = isToday && timeToMinutes(time) < nowMinutes;
    return {
      time,
      capacity: service.capacityPerSlot,
      booked,
      remaining: Math.max(service.capacityPerSlot - booked, 0),
      full,
      past,
      // Convenience flag: true if the slot cannot be booked for ANY reason
      // (already full, or the time has already passed today).
      unavailable: full || past,
    };
  });
}

module.exports = { generateSlotGrid, getAvailableSlots, timeToMinutes, getTodayString };
