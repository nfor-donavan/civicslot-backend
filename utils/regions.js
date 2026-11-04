// Single source of truth for the 10 regions of Cameroon (database keys).
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

module.exports = { REGIONS, isRegion: (v) => typeof v === "string" && REGIONS.includes(v) };
