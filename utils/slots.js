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

// Returns slots with remaining capacity for a given date, excluding cancelled bookings
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

  return grid.map((time) => {
    const booked = bookedMap[time] || 0;
    return {
      time,
      capacity: service.capacityPerSlot,
      booked,
      remaining: Math.max(service.capacityPerSlot - booked, 0),
      full: booked >= service.capacityPerSlot,
    };
  });
}

module.exports = { generateSlotGrid, getAvailableSlots, timeToMinutes };
