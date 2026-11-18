// Write the grant effects (tools/grants-data.mjs) into the item JSON sources.
// Usage: node tools/grants.mjs [--check]   (--check: report only, write nothing)
import fs from "node:fs";
import path from "node:path";
import { GRANTS, PARTS } from "./grants-data.mjs";
import { stableId, effectSource } from "./effect-template.mjs";

const MODULE_ID = "artantares-mutations";
const DIR = path.join("src", "packs", "items");
const check = process.argv.includes("--check");

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json"));
const docs = files.map(f => ({ file: path.join(DIR, f), data: JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) }))
  .filter(d => d.data.type === "mutation");
const byName = new Map(docs.map(d => [d.data.name, d]));
const errors = [];


// Fill module UUIDs into mutation entries and strip undefined keys.
function link(node, where) {
  if (Array.isArray(node)) return node.map(n => link(n, where));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) if (v !== undefined) out[k] = link(v, where);
  if (out.t === "mutation") {
    const target = byName.get(out.n);
    if (!target) errors.push(`${where}: no module mutation named "${out.n}"`);
    else out.u = `Compendium.${MODULE_ID}.items.Item.${target.data._id}`;
  }
  if ((out.t === "talent" || out.t === "trait" || out.t === "psychology") && !out.u) out.nolink = true;
  return out;
}
const clean = (node) => JSON.parse(JSON.stringify(node, (k, v) => k === "nolink" ? undefined : v));

function script(spec) {
  return [
    `const api = game.modules.get("${MODULE_ID}")?.api;`,
    `if (!api?.grant) return ui.notifications.warn(\`\${this.item.name}: Antares | Mutant's Handbook is not active, so nothing was added.\`);`,
    `await api.grant(this, ${JSON.stringify(spec, null, 2)});`
  ].join("\n");
}

function effect(item, spec) {
  const id = stableId(`${item._id}-grants`);
  return effectSource({
    item, id, name: item.name,
    scriptData: [
      { script: script(spec), label: "Add granted Talents, Traits and items", trigger: "addItems", options: {}, async: true },
      { script: `await game.modules.get("${MODULE_ID}")?.api?.revert(this);`, label: "Remove granted items", trigger: "deleteEffect", options: {}, async: true }
    ],
    flags: { [MODULE_ID]: { grants: true } }
  });
}

const stats = { effects: 0, parts: 0, nolink: new Set() };
const touched = new Set();
const collectNoLink = (node) => JSON.stringify(node, (k, v) => { if (v && v.nolink) stats.nolink.add(`${v.t}:${v.n}`); return v; });

for (const [name, spec] of Object.entries(GRANTS)) {
  const d = byName.get(name);
  if (!d) { errors.push(`GRANTS: no item named "${name}"`); continue; }
  const linked = link(spec, name);
  collectNoLink(linked);
  d.data.effects = (d.data.effects ?? []).filter(e => !e.flags?.[MODULE_ID]?.grants);
  d.data.effects.push(effect(d.data, clean(linked)));
  stats.effects++;
  touched.add(d);
}
for (const [name, parts] of Object.entries(PARTS)) {
  const d = byName.get(name);
  if (!d) { errors.push(`PARTS: no item named "${name}"`); continue; }
  const linked = link(parts, name);
  collectNoLink(linked);
  d.data.flags[MODULE_ID] = { ...(d.data.flags[MODULE_ID] ?? {}), parts: clean(linked) };
  stats.parts++;
  touched.add(d);
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
if (!check) for (const d of touched) fs.writeFileSync(d.file, JSON.stringify(d.data, null, 2) + "\n");
console.log(`${check ? "[check] " : ""}${stats.effects} grant effects, ${stats.parts} part tables`);
console.log(`Resolved by name at runtime (no wfrp4e-core link): ${[...stats.nolink].sort().join(", ")}`);
