const Appointment = require("../models/Appointment");
const { nowParts, timeToMinutes, minutesToTime } = require("./time");

// Raw slot grid for a service (does not look at bookings).
function generateSlotGrid(service) {
  const slots = [];
  const start = timeToMinutes(service.openTime);
  const end = timeToMinutes(service.closeTime);
  for (let t = start; t < end; t += service.durationMinutes) slots.push(minutesToTime(t));
  return slots;
}

// Slots for one date with remaining capacity. Cancelled / no-show bookings do
// not consume capacity. For today's date (in the platform timezone) any slot
// whose start time has already passed is flagged `past`.
async function getAvailableSlots(service, date, now = new Date()) {
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

  const clock = nowParts(now);
  const isToday = date === clock.date;

  return grid.map((time) => {
    const booked = bookedMap[time] || 0;
    const full = booked >= service.capacityPerSlot;
    const past = isToday && timeToMinutes(time) < clock.minutes;
    return {
      time,
      capacity: service.capacityPerSlot,
      booked,
      remaining: Math.max(service.capacityPerSlot - booked, 0),
      full,
      past,
      unavailable: full || past,
    };
  });
}

module.exports = { generateSlotGrid, getAvailableSlots };
