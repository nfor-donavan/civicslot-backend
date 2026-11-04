// Generates docs/generated/DATA_MODEL.md and API_REFERENCE.md from the real
// Mongoose schemas and the route manifest, so documentation cannot drift from code.
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const manifest = require("./route-manifest");

["User", "Service", "Appointment", "Candidate", "AuditLog"].forEach((m) => require(`../models/${m}`));

const outDir = path.join(__dirname, "..", "..", "docs", "generated");
fs.mkdirSync(outDir, { recursive: true });
const stamp = "_Generated from the source code by `npm run docs` (backend). Do not edit by hand._\n";

const typeOf = (p) => {
  if (p.instance === "Array") return `Array<${p.caster?.instance || p.options?.type?.[0]?.name || "Mixed"}>`;
  if (p.instance === "ObjectId" || p.instance === "ObjectID") return p.options?.ref ? `ObjectId → ${p.options.ref}` : "ObjectId";
  return p.instance;
};
const fmt = (v) => (typeof v === "function" ? "(function)" : JSON.stringify(v));

let md = `# Data model (MongoDB collections)\n\n${stamp}\nDatabase: one MongoDB Atlas database (name set in \`MONGO_URI\`). All collections have \`_id\`; those with timestamps also have \`createdAt\`/\`updatedAt\`.\n`;
for (const [name, model] of Object.entries(mongoose.models)) {
  md += `\n## ${name}  (collection: \`${model.collection.name}\`)\n\n| Field | Type | Required | Default | Constraints |\n|---|---|---|---|---|\n`;
  for (const [key, p] of Object.entries(model.schema.paths)) {
    if (["_id", "__v"].includes(key)) continue;
    const o = p.options || {};
    const cons = [];
    if (o.enum) cons.push(`one of: ${(Array.isArray(o.enum) ? o.enum : o.enum.values || []).join(", ")}`);
    if (o.maxlength) cons.push(`max length ${o.maxlength}`);
    if (o.minlength) cons.push(`min length ${o.minlength}`);
    if (o.min !== undefined) cons.push(`min ${o.min}`);
    if (o.max !== undefined) cons.push(`max ${o.max}`);
    if (o.unique) cons.push("unique");
    if (o.index) cons.push("indexed");
    if (o.select === false) cons.push("never returned by queries by default");
    if (o.match) cons.push(`pattern ${o.match}`);
    const def = o.default === undefined ? "" : fmt(o.default);
    md += `| \`${key}\` | ${typeOf(p)} | ${p.isRequired ? "yes" : ""} | ${def.replace(/\|/g, "\\|")} | ${cons.join("; ").replace(/\|/g, "\\|")} |\n`;
  }
  const idx = model.schema.indexes().map(([f, o]) => `\`${JSON.stringify(f)}\`${o && o.unique ? " (unique)" : ""}`);
  if (idx.length) md += `\nCompound/declared indexes: ${idx.join(", ")}\n`;
}
fs.writeFileSync(path.join(outDir, "DATA_MODEL.md"), md);

const accessText = { public: "Public", auth: "Any signed-in user", admin: "Regional admin or superadmin", superadmin: "Superadmin only" };
let api = `# API reference and access-control matrix\n\n${stamp}\nBase path: \`/api\`. Authentication: \`Authorization: Bearer <JWT>\`. The role and region used for every decision are read from the database, not from the token.\n\n`;
api += `**Region-scoped** = for regional administrators the handler restricts results/actions to the administrator's assigned region and answers attempts outside it with 403 (explicit region) or 404 (record in another region), and writes a \`security.cross_region_attempt\` audit entry.\n\n`;
api += `| Method | Path | Access | Region-scoped | Purpose |\n|---|---|---|---|---|\n`;
for (const r of manifest) api += `| ${r.method} | \`${r.path}\` | ${accessText[r.access]} | ${r.scoped ? "yes" : ""} | ${r.summary} |\n`;
const count = (a) => manifest.filter((r) => r.access === a).length;
api += `\n**Totals:** ${manifest.length} endpoints — ${count("public")} public, ${count("auth")} authenticated, ${count("admin")} admin, ${count("superadmin")} superadmin.\n`;
api += `\nThe automated test \`tests/rbac.test.js\` fails if an implemented route is missing from this list, and calls every non-public route anonymously, as a citizen and as a regional admin to verify the access level declared here is actually enforced.\n`;
fs.writeFileSync(path.join(outDir, "API_REFERENCE.md"), api);
console.log("Generated docs in", outDir);
