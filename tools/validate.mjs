// Validate JSON pack sources for the Mutant's Handbook module:
//  - every JSON file parses; macro commands, effect scripts and module scripts are syntactically valid
//  - every link to this module (Compendium.<id>.<pack>...) resolves, and no link uses a stale module id
//  - every @Table[key] used in text resolves to a module table
//  - table ranges are contiguous from 1 and match the formula's die size
//  - severity tables (key "mutation", column "<severity>-<type>[-necro]") only link mutations of that
//    severity and type, and result names match the linked item
//  - every mutation carries flags.<id>.severity that matches its header line
// Known problems that need the supplement PDF to resolve are listed in KNOWN and reported as warnings.
import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";

const ROOT = path.join("src", "packs");
const MODULE = JSON.parse(fs.readFileSync("module.json", "utf8"));
const MODULE_ID = MODULE.id;
const PACKS = Object.fromEntries(MODULE.packs.map(p => [p.name, p.type]));
const STALE_IDS = ["wfrp4e-mutations", "arcturus-mutations"];
const EXTERNAL_OK = new Set(["wfrp4e-core", "wfrp4e"]);
const SEVERITIES = ["trivial", "minor", "major"];
// Table keys provided by the wfrp4e system or the wfrp4e-core module, used in mutation text.
const EXTERNAL_TABLE_KEYS = new Set(["hitloc", "minormis", "majormis", "species", "eyes", "stinking-drunk", "corruption", "mutatephys", "mutatemental"]);

// Known issues still open: reported as warnings, not errors. Remove an entry once fixed.
const KNOWN = [];

// Placements that look wrong but are exactly as printed in The Mutant's Handbook v1.1: reported as notes.
// The table decides the severity of a rolled result; the item header is the catalogue entry's own label.
const AS_PRINTED = [
  [/^Table Major Physical Corruption \[25,26\] Chthonian Crawler: links a minor mutation/, "Major Physical table p16; catalogue header 'Minor Physical Mutation' p31"],
  [/^Table Major Physical Corruption \[92,92\] Unnatural Arms: links a minor mutation/, "Major Physical table p16; catalogue header 'Minor Physical Mutation' p67"],
  [/^Table Trivial Physical Corruption \[99,99\] Uncanny Resemblance: links a mental mutation/, "Trivial Physical table p14; catalogue header 'Trivial Mental Mutation, Tolerable' p69"],
];

const errors = [];
const warnings = [];
const stats = { files: 0, docs: 0, scripts: 0, links: 0, tables: 0, results: 0, mutations: 0 };
const notes = [];
const report = (msg) => {
  const asPrinted = AS_PRINTED.find(([re]) => re.test(msg));
  if (asPrinted) notes.push(`${msg} (as printed: ${asPrinted[1]})`);
  else (KNOWN.some(re => re.test(msg)) ? warnings : errors).push(msg);
};

const docs = {}; // pack -> id -> doc
const subIds = {}; // pack -> Set of embedded ids (journal pages, table results)
for (const pack of Object.keys(PACKS)) {
  docs[pack] = {}; subIds[pack] = new Set();
  const dir = path.join(ROOT, pack);
  for (const f of fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith(".json"))) {
    stats.files++;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch (e) { errors.push(`JSON parse error in ${pack}/${f}: ${e.message}`); continue; }
    if (!d._key?.startsWith("!folders!")) stats.docs++;
    docs[pack][d._id] = d;
    for (const p of d.pages ?? []) subIds[pack].add(p._id);
    for (const r of d.results ?? []) subIds[pack].add(r._id);
  }
}
const isFolder = d => d._key?.startsWith("!folders!");
const all = Object.entries(docs).flatMap(([pack, m]) => Object.values(m).map(d => [pack, d]));

function checkScript(code, where, sourceType = "script") {
  if (typeof code !== "string" || !code.trim()) return;
  if (/^\s*\[Script\.\w+\]\s*$/.test(code)) return;
  stats.scripts++;
  try {
    if (sourceType === "module") acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
    else acorn.parse(`(async function(args){\n${code}\n})`, { ecmaVersion: "latest" });
  } catch (e) { errors.push(`Script syntax error in ${where}: ${e.message}`); }
}

// Scripts
for (const [pack, d] of all) {
  if (pack === "macros" && !isFolder(d)) checkScript(d.command, `macro ${d.name}`);
  for (const e of d.effects ?? [])
    for (const [i, s] of (e.system?.scriptData ?? []).entries()) checkScript(s.script, `${d.name} / ${e.name} [${s.trigger} #${i}]`);
}
for (const f of MODULE.esmodules ?? []) {
  const p = f.replace(/^\//, "");
  if (!fs.existsSync(p)) { errors.push(`module.json esmodule missing: ${f}`); continue; }
  checkScript(fs.readFileSync(p, "utf8"), p, "module");
}
if (!MODULE.relationships?.requires?.some(r => r.id === "wfrp4e-core")) errors.push("module.json does not declare wfrp4e-core in relationships.requires");

// Links and @Table references (skip _stats provenance)
const tableKeys = new Set(Object.values(docs.rolltables).filter(d => !isFolder(d)).map(d => d.flags?.wfrp4e?.key).filter(Boolean));
function strings(o, out = []) {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) o.forEach(v => strings(v, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) if (k !== "_stats") strings(v, out);
  return out;
}
for (const [pack, d] of all) {
  const where = `${pack}/${d.name}`;
  for (const s of strings(d)) {
    for (const m of s.matchAll(/Compendium\.([\w-]+)\.([\w-]+)\.(?:(\w+)\.)?([A-Za-z0-9]{16})(?:\.JournalEntryPage\.([A-Za-z0-9]{16}))?/g)) {
      const [, mod, tp, , id, page] = m;
      stats.links++;
      if (STALE_IDS.includes(mod)) { errors.push(`${where}: stale module id in ${m[0]}`); continue; }
      if (mod !== MODULE_ID) { if (!EXTERNAL_OK.has(mod)) errors.push(`${where}: link to unknown module ${m[0]}`); continue; }
      if (!docs[tp]) { errors.push(`${where}: link to unknown pack ${m[0]}`); continue; }
      if (!docs[tp][id]) errors.push(`${where}: link target not found ${m[0]}`);
      else if (page && !subIds[tp].has(page)) errors.push(`${where}: journal page not found ${m[0]}`);
    }
    for (const m of s.matchAll(/@Table\[([^\]]+)\]/g))
      if (!tableKeys.has(m[1]) && !EXTERNAL_TABLE_KEYS.has(m[1])) report(`${where}: @Table[${m[1]}] has no matching module table key`);
  }
  for (const str of strings(d)) {
    const m = str.match(/[\u{100000}-\u{10FFFF}\uE000-\uF8FF\u2000\u0129\uFB01\uFB02]|(?<![\w@\]}"=/.-])[a-z]+:u[a-z]+|(?<=[\s>]):u[a-z]+/u);
    if (m) errors.push(`${where}: PDF copy-paste damage near '${str.slice(Math.max(0, m.index - 20), m.index + 20)}'`);
  }
  for (const n of [d.name, ...(d.results ?? []).map(r => r.name), ...(d.pages ?? []).map(p => p.name)])
    if (/&[a-z]+;|&#\d+;/i.test(n ?? "")) errors.push(`${where}: HTML entity in name '${n}'`);
}

// Mutations
const HEADER = /^\s*<p[^>]*>\s*<(?:strong|b)>\s*(Trivial|Minor|Major)\s+(Physical|Mental)\s+Mutation\s*(,\s*Tolerable)?\s*<\/(?:strong|b)>/i;
for (const d of Object.values(docs.items).filter(d => d.type === "mutation")) {
  stats.mutations++;
  const fl = d.flags?.[MODULE_ID] ?? {};
  if (!SEVERITIES.includes(fl.severity)) { errors.push(`Mutation ${d.name}: missing/invalid flags.${MODULE_ID}.severity`); continue; }
  if (fl.variantOf) continue;
  const m = (d.system?.description?.value ?? "").match(HEADER);
  if (!m) { errors.push(`Mutation ${d.name}: no severity header line`); continue; }
  if (m[1].toLowerCase() !== fl.severity) errors.push(`Mutation ${d.name}: severity flag ${fl.severity} != header ${m[1]}`);
  if (m[2].toLowerCase() !== d.system.mutationType.value) errors.push(`Mutation ${d.name}: mutationType ${d.system.mutationType.value} != header ${m[2]}`);
  if (Boolean(m[3]) !== Boolean(fl.tolerable)) errors.push(`Mutation ${d.name}: tolerable flag mismatch`);
}

// Tables
for (const t of Object.values(docs.rolltables).filter(d => !isFolder(d))) {
  stats.tables++;
  const { key = "", column = "" } = t.flags?.wfrp4e ?? {};
  const die = Number(t.formula?.match(/^1d(\d+)$/)?.[1]);
  if (!die) errors.push(`Table ${t.name}: unexpected formula ${t.formula}`);
  else if (![10, 100].includes(die)) report(`Table ${t.name}: formula ${t.formula} (expected 1d10 or 1d100)`);
  const ranges = (t.results ?? []).map(r => r.range).sort((a, b) => a[0] - b[0]);
  let next = 1;
  for (const [lo, hi] of ranges) {
    if (lo !== next || hi < lo) report(`Table ${t.name}: range ${lo < next ? "overlap" : "gap"} at [${lo},${hi}] (expected start ${next})`);
    next = Math.max(next, hi + 1);
  }
  if (die && next !== die + 1) report(`Table ${t.name}: ends at ${next - 1}, formula ${t.formula}`);

  const [sev, type] = column.split("-");
  const severityTable = key === "mutation" && SEVERITIES.includes(sev);
  for (const r of t.results ?? []) {
    stats.results++;
    if (r.type !== "document") continue;
    const m = (r.documentUuid ?? "").match(new RegExp(`^Compendium\\.${MODULE_ID}\\.items\\.Item\\.([A-Za-z0-9]{16})$`));
    const label = `Table ${t.name} [${r.range}] ${r.name}`;
    if (!m) { errors.push(`${label}: bad documentUuid '${r.documentUuid}'`); continue; }
    const item = docs.items[m[1]];
    if (!item) { errors.push(`${label}: item ${m[1]} not found`); continue; }
    if (item.name !== r.name) errors.push(`${label}: result name differs from item '${item.name}'`);
    if (severityTable) {
      const isev = item.flags?.[MODULE_ID]?.severity;
      if (item.system.mutationType.value !== type) report(`${label}: links a ${item.system.mutationType.value} mutation`);
      else if (isev !== sev) report(`${label}: links a ${isev} mutation`);
    }
  }
}

console.log(`Checked ${stats.files} files (${stats.docs} documents, ${stats.mutations} mutations), ${stats.tables} tables / ${stats.results} results, ${stats.links} compendium links, ${stats.scripts} scripts.`);
if (notes.length) console.log(`\n${notes.length} note(s), as printed in the handbook:\n  ${notes.join("\n  ")}`);
if (warnings.length) console.log(`\n${warnings.length} known open issue(s):\n  ${warnings.join("\n  ")}`);
if (errors.length) { console.error(`\n${errors.length} error(s):\n  ${errors.join("\n  ")}`); process.exit(1); }
console.log("\nOK");
