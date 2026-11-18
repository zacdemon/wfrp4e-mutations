// Write the "<Mutation> (Modifiers)" effects (tools/modifiers-data.mjs) into the item JSON sources.
// Also gives an (initially empty) Modifiers effect to every mutation whose grant spec can roll or
// choose a modifier, so the runtime fills a visible, named effect instead of creating one.
// Usage: node tools/modifiers.mjs [--check]   (--check: report only, write nothing)
import fs from "node:fs";
import path from "node:path";
import { MODS } from "./modifiers-data.mjs";
import { GRANTS, PARTS } from "./grants-data.mjs";
import { stableId, effectSource } from "./effect-template.mjs";
import { MODULE_ID, CHARACTERISTICS, changeFor, dialogScriptData, woundsScriptData, characteristicsScriptData } from "../scripts/modifier-scripts.mjs";

const DIR = path.join("src", "packs", "items");
const check = process.argv.includes("--check");
const docs = fs.readdirSync(DIR).filter(f => f.endsWith(".json"))
  .map(f => ({ file: path.join(DIR, f), data: JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) }))
  .filter(d => d.data.type === "mutation");
const byName = new Map(docs.map(d => [d.data.name, d]));
const errors = [];

// Which mutations can get modifiers at grant time, and of what kind.
const hasEntry = (node, pred) => (function walk(n) {
  if (Array.isArray(n)) return n.some(walk);
  if (!n || typeof n !== "object") return false;
  if (pred(n)) return true;
  return Object.values(n).some(walk);
})(node);
const isMod = (n) => n.t === "mod" || n.t === "dialog";
const partsOf = (tbl) => Object.entries(PARTS).filter(([k]) => k.startsWith(tbl)).map(([, v]) => v);
function dynamicSpec(name) {
  const spec = GRANTS[name];
  if (!spec) return null;
  const nodes = [spec];
  // body() controls pull in the part lists of their table.
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    if (n.body && n.tbl) nodes.push(...partsOf(n.tbl).map(p => n.body === "all" ? p : p[n.body]));
    Object.values(n).forEach(walk);
  })(spec);
  return hasEntry(nodes, isMod) ? nodes : null;
}

const stats = { fixed: 0, changes: 0, wounds: 0, halve: 0, caps: 0, dialogs: 0, targeter: 0, scripts: 0, pools: 0, toggles: 0, dynamicOnly: 0, dynamic: 0, kinds: {} };
const touched = new Set();
const names = new Set([...Object.keys(MODS), ...Object.keys(GRANTS).filter(n => dynamicSpec(n))]);

// One list of entries -> changes, scripts and flags for one effect.
function build(name, list) {
  const changes = [], scripts = [], halve = [], toggles = [], cap = {}, extra = {};
  let wounds = 0;
  for (const e of list) {
    if (e.c) {
      if (e.c !== "move" && !CHARACTERISTICS.includes(e.c)) errors.push(`${name}: unknown characteristic "${e.c}"`);
      changes.push(changeFor(e.c, e.v));
      stats.kinds[e.c] = (stats.kinds[e.c] ?? 0) + 1;
    }
    else if (e.wounds) { wounds += e.wounds; stats.wounds++; }
    else if (e.half) { halve.push(e.half); stats.halve++; }
    else if (e.cap) {
      if (!CHARACTERISTICS.includes(e.cap)) errors.push(`${name}: unknown characteristic "${e.cap}"`);
      cap[e.cap] = e.v; stats.caps++;
    }
    else if (e.test) {
      scripts.push(dialogScriptData(e.test.label, e.test.mod, e.test.when, e.test.on, { targeter: !!e.test.targeter }));
      e.test.targeter ? stats.targeter++ : stats.dialogs++;
    }
    else if (e.script) { scripts.push(e.script); stats.scripts++; }
    else if (e.flag) Object.assign(extra, e.flag);
    else if (e.toggle) toggles.push(e);
    else errors.push(`${name}: unknown entry ${JSON.stringify(e)}`);
  }
  stats.changes += changes.length;
  if (wounds) scripts.push(woundsScriptData());
  if (halve.length || Object.keys(cap).length || changes.some(c => Number(c.value) < 0 && c.key.includes("characteristics"))) scripts.push(characteristicsScriptData());
  const flags = { ...(wounds ? { wounds } : {}), ...(halve.length ? { halve } : {}), ...(Object.keys(cap).length ? { cap } : {}), ...extra };
  return { changes, scripts, flags, toggles };
}

// Mutations that no longer have modifiers lose their old generated effects.
for (const d of docs) if (!names.has(d.data.name)) {
  const keep = (d.data.effects ?? []).filter(e => !e.flags?.[MODULE_ID]?.modifiers && !e.flags?.[MODULE_ID]?.toggle);
  if (keep.length !== (d.data.effects ?? []).length) { d.data.effects = keep; touched.add(d); }
}

for (const name of [...names].sort()) {
  const d = byName.get(name);
  if (!d) { errors.push(`no item named "${name}"`); continue; }
  const item = d.data;
  const dyn = dynamicSpec(name);
  const { changes, scripts, flags, toggles } = build(name, MODS[name] ?? []);

  item.effects = (item.effects ?? []).filter(e => !e.flags?.[MODULE_ID]?.modifiers && !e.flags?.[MODULE_ID]?.toggle);
  if (changes.length || scripts.length || dyn || Object.keys(flags).length) {
    const id = stableId(`${item._id}-modifiers`);
    item.effects.push(effectSource({ item, id, name: `${item.name} (Modifiers)`, scriptData: scripts, changes, flags: { [MODULE_ID]: { modifiers: true, ...flags } } }));
    if (changes.length || scripts.length) stats.fixed++;
    if (dyn) stats.dynamic++;
    if (dyn && !changes.length && !scripts.length) stats.dynamicOnly++;
  }
  toggles.forEach((t, i) => {
    const id = stableId(`${item._id}-toggle-${i}`);
    const b = build(name, t.list);
    if (b.toggles.length) errors.push(`${name}: nested toggle`);
    item.effects.push(effectSource({ item, id, name: `${item.name}: ${t.toggle}`, scriptData: b.scripts, changes: b.changes, disabled: true, flags: { [MODULE_ID]: { toggle: true, ...b.flags } } }));
    stats.toggles++;
  });
  touched.add(d);
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
if (!check) for (const d of touched) fs.writeFileSync(d.file, JSON.stringify(d.data, null, 2) + "\n");
console.log(`${check ? "[check] " : ""}${touched.size} mutations: ${stats.fixed} with fixed modifiers (${stats.changes} changes, ${stats.wounds} Wounds, ${stats.halve} halved, ${stats.caps} capped, ${stats.dialogs} own test options, ${stats.targeter} options for people targeting the mutant, ${stats.scripts} other scripts), ${stats.toggles} switchable effects, ${stats.dynamic} with rolled/chosen modifiers (${stats.dynamicOnly} of them only those)`);
console.log(`Fixed changes by key: ${Object.entries(stats.kinds).map(([k, n]) => `${k} ${n}`).join(", ")}`);
