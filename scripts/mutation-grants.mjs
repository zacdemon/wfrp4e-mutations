/**
 * Antares | Mutant's Handbook - item grants.
 *
 * Mutation items carry an effect with two scripts:
 *   - "addItems" (runs when the mutation is created on an actor):
 *         await game.modules.get("artantares-mutations").api.grant(this, SPEC)
 *   - "deleteEffect" (runs when the mutation, or that effect, is deleted):
 *         await game.modules.get("artantares-mutations").api.revert(this)
 *
 * SPEC is plain JSON, written by tools/grants.mjs from tools/grants-data.mjs, so a GM can read and
 * edit it in the effect's script editor.
 *
 * Every item a grant creates is flagged `flags.artantares-mutations.grantedBy = <mutation item id>`.
 * Changes made to items the actor already had (skill advances, a bumped trait damage, a replaced
 * Size or Fear rating) are recorded on the mutation in `flags.artantares-mutations.undo`.
 * revert() deletes the flagged items and plays the undo list back. Item ids are unique per actor,
 * so two copies of the same mutation never remove each other's items (the system's own
 * `fromEffect` flag uses the effect id, which every copy of a compendium item shares).
 *
 * SPEC
 *   { grants: [Entry...] }                 entries applied the first time
 *   { levels: [[Entry...], [Entry...]] }   levels[n] is used when the actor already has n copies
 *                                          (the last level repeats); without `levels`, a repeat
 *                                          uses `grants` again (Talents go up a level, p10).
 * Entry (concrete)
 *   { t: "talent"|"trait"|"psychology", n, u?, s?, ask?, opts?, x? }
 *        n name, u wfrp4e-core UUID (falls back to a name search), s specialisation (talent/psych:
 *        "Name (s)"; trait: specification), ask = prompt text for the specialisation, opts =
 *        suggestions, x = how many copies (Talent levels)
 *   trait extras: d damage bonus (the +X over the bonus characteristic; stored in
 *        system.specification.value, as wfrp4e 10.1.x does), l name label "Name (l)" (replaces a
 *        "#" in the name, e.g. "# Tentacles" -> "2 Tentacles"), set { path: value } overrides, q [qualities], off true = add disabled (toggle on when the ability is used),
 *        max true = one rating only; a higher rating replaces a lower one
 *   { t: "skill", n, adv, c?, u?, mod?, ref? }  adv number or dice formula; adds advances or the skill
 *        (u: uuid in module mod, used when it is active; else a placeholder with Characteristic c)
 *   { t: "mutation", n, u, v?, tbl? }      a module mutation; v pre-sets its sub-table result
 *   { t: "armour", n, ap, q?, f? }         natural armour item on the affected locations
 *   { t: "bump", n, d }                    +d damage to a trait the actor already has
 *   { t: "size", step, at? }               Size trait one step up/down; at[sizeKey] = more entries
 * Entry (control)
 *   { choose: text, of: [Entry|[Entry...]], n? }   pick n (default 1)
 *   { roll: formula, text, res: [[lo, hi, Entry|[Entry...]|null], ...] }
 *   { variant: { key: [Entry...] }, tbl, key }     by the sub-table result recorded on the item
 *   { body: "arms"|"legs"|"head"|"all", tbl, key } Bestial / Unnatural parts of the recorded variant
 *   { patron: { god: [Entry...] }, else: [Entry...] }
 *   { note: text }                                  shown on the summary card
 * Entry (modifiers, written into the mutation's "<Mutation> (Modifiers)" effect, see modifier-scripts.mjs)
 *   { t: "mod", k, v }        k a characteristic key (ws..fel), "move" or "wounds"; v a number or a dice
 *                             formula ("1d10", "-2d10") rolled once now and stored as a plain number
 *   { t: "mod", k, half }     halve characteristic k (or "move"), rounded up
 *   { t: "dialog", d }        add a script to the effect (a dialog option, targeter option, crit hook...)
 *   { t: "status", k, v, unless } k fortune|fate|resilience|resolve: change the actor's pool by v now
 *                             (undone when the mutation is deleted); skipped if the granted item
 *                             named `unless` has its own script for that pool
 * Fixed modifiers are not entries: tools/modifiers.mjs writes them straight into the effect.
 */
import { activateOracle, endOracle, activateLunacy, longArmsReach } from "./mutation-powers.mjs";
import { MODULE_ID as MID, STATUS, changeFor, modifierEffectData, woundsScriptData, characteristicsScriptData, critHookModifier } from "./modifier-scripts.mjs";

const MODULE_ID = MID;
const PACK_ITEMS = `${MODULE_ID}.items`;
const PACK_TABLES = `${MODULE_ID}.rolltables`;
const LOCS = { arms: ["lArm", "rArm"], body: ["body"], legs: ["lLeg", "rLeg"], head: ["head"] };
const ALL_LOCS = ["head", "body", "lArm", "rArm", "lLeg", "rLeg"];
const PARTS = ["arms", "body", "legs", "head"];
const SIZES = ["tiny", "ltl", "sml", "avg", "lrg", "enor", "mnst"];

const L = (key, data) => data ? game.i18n.format(`AMUT.Grant.${key}`, data) : game.i18n.localize(`AMUT.Grant.${key}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const baseName = (name) => String(name ?? "").split("(")[0].trim();
const enabled = () => { try { return game.settings.get(MODULE_ID, "autoGrants"); } catch { return true; } };

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "autoGrants", {
    name: "AMUT.Settings.AutoGrants.Name", hint: "AMUT.Settings.AutoGrants.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  const mod = game.modules.get(MODULE_ID);
  mod.api = Object.assign(mod.api ?? {}, { grant, revert, grantedItems, adjustStatus, addModifier, activateOracle, endOracle, activateLunacy, longArmsReach });
  Hooks.on("wfrp4e:rollTable", critHookModifier);   // wound-Critical modifiers (see modifier-scripts.mjs)
});

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

/** Items on the actor that were created by this mutation. */
export function grantedItems(item) {
  return item?.actor?.items.filter(i => i.getFlag(MODULE_ID, "grantedBy") === item.id) ?? [];
}

export async function grant(ctx, spec = {}) {
  const { actor, item } = ctx ?? {};
  if (!actor || !item || !enabled()) return;
  if (item._amutGranted) return;          // wh-lib and the system can both fire create scripts
  item._amutGranted = true;

  // Copies the actor already has, including ones another mutation granted (Fangs from a Bestial Head).
  const copies = actor.items.filter(i => i.id !== item.id && i.type === item.type
    && baseName(i.name) === baseName(item.name)).length;
  const list = spec.levels ? spec.levels[Math.min(copies, spec.levels.length - 1)] : (spec.grants ?? []);

  const st = { actor, item, log: [], notes: [], undo: [], create: [], rename: null, variants: null, mods: [], rolled: [] };
  if (copies) st.log.push(L("Level", { n: copies + 1 }));
  try {
    const flat = dedupe(await expand(list, st, { locs: item.getFlag(MODULE_ID, "locs") ?? null }));
    for (const entry of flat) await applyEntry(entry, st);

    let created = [];
    if (st.create.length) {
      for (const data of st.create) foundry.utils.setProperty(data, `flags.${MODULE_ID}.grantedBy`, item.id);
      created = await actor.createEmbeddedDocuments("Item", st.create);
    }
    if (st.mods.length) await applyModifiers(st);
    const update = {};
    if (st.undo.length) update[`flags.${MODULE_ID}.undo`] = [...(item.getFlag(MODULE_ID, "undo") ?? []), ...st.undo];
    if (st.rename) update.name = st.rename;
    if (st.variants) update[`flags.${MODULE_ID}.variants`] = st.variants;
    if (!foundry.utils.isEmpty(update)) await item.update(update);
    await postSummary(st, created);
  }
  catch (err) {
    console.error(`${MODULE_ID} | grant failed for ${item.name}`, err);
    ui.notifications.error(L("Failed", { name: item.name, error: err.message ?? err }));
  }
}

export async function revert(ctx) {
  const { actor, item } = ctx ?? {};
  if (!actor || !item || item._amutReverted) return;
  item._amutReverted = true;
  const ids = actor.items.filter(i => i.getFlag(MODULE_ID, "grantedBy") === item.id).map(i => i.id);
  if (ids.length) {
    ui.notifications.info(L("Removing", { name: item.name, items: ids.map(id => actor.items.get(id)?.name).join(", ") }));
    await actor.deleteEmbeddedDocuments("Item", ids);
  }
  // Mutation changes are free: skipExperienceChecks stops the system's "Advancement Cost" XP prompt.
  const opts = { skipExperienceChecks: true };
  for (const u of [...(item.getFlag(MODULE_ID, "undo") ?? [])].reverse()) {
    const target = u.actor ? actor : actor.items.get(u.id);
    if (!target) continue;
    if (u.actor) await target.update({ [u.path]: Math.max(0, (Number(foundry.utils.getProperty(target, u.path)) || 0) - u.delta) }, opts);
    else if (u.delta !== undefined) await target.update({ [u.path]: (Number(foundry.utils.getProperty(target, u.path)) || 0) - u.delta }, opts);
    else await target.update({ [u.path]: u.value }, opts);
  }
}

/* -------------------------------------------- */
/*  Expansion: choices, rolls, variants, parts  */
/* -------------------------------------------- */

async function expand(list, st, ctx) {
  const out = [];
  for (const e of [].concat(list ?? [])) {
    if (e == null) continue;
    if (Array.isArray(e)) out.push(...await expand(e, st, ctx));
    else if (e.note) st.notes.push(e.note);
    else if (e.choose) {
      const picks = await choose(st.item.name, e.choose, e.of.map(labelOf), e.n ?? 1);
      if (!picks) { st.notes.push(L("NoChoice", { text: e.choose })); continue; }
      st.log.push(`${e.choose}: ${picks.map(i => labelOf(e.of[i])).join(", ")}`);
      for (const i of picks) out.push(...await expand(e.of[i], st, ctx));
    }
    else if (e.roll) {
      const roll = await new Roll(e.roll).evaluate();
      const hit = e.res.find(([lo, hi]) => roll.total >= lo && roll.total <= hi);
      st.log.push(`${e.text ?? e.roll} (${e.roll}): ${roll.total}${hit?.[3] ? ` - ${hit[3]}` : ""}`);
      if (hit) out.push(...await expand(hit[2], st, ctx));
    }
    else if (e.variant) out.push(...await expandVariant(e, st, ctx));
    else if (e.body) out.push(...await expandBody(e, st));
    else if (e.patron) {
      const god = st.actor.getFlag(MODULE_ID, "patron");
      if (god && e.patron[god]) { st.log.push(L("Patron", { god: game.i18n.localize(`AMUT.God.${god}`) })); out.push(...await expand(e.patron[god], st, ctx)); }
      else out.push(...await expand(e.else, st, ctx));
    }
    else out.push(ctx.locs && !e.locs && (e.t === "armour" || e.t === "mutation") ? { ...e, locs: ctx.locs } : { ...e });
  }
  return out;
}

/** The sub-table result the flow recorded on the item (flags.variants), or one picked/rolled now. */
async function recordedVariant(st, tbl) {
  const vars = st.item.getFlag(MODULE_ID, "variants") ?? [];
  return vars.find(v => String(v.table ?? "").toLowerCase() === String(tbl).toLowerCase()) ?? null;
}

async function expandVariant(e, st, ctx) {
  const keys = Object.keys(e.variant);
  const rec = await recordedVariant(st, e.tbl);
  const match = (label) => {
    const lc = String(label ?? "").toLowerCase();
    return keys.find(k => lc.startsWith(k.toLowerCase())) ?? keys.find(k => lc.includes(k.toLowerCase()));
  };
  let key = rec ? match(rec.label) : null;
  if (!key) {
    const picked = await chooseOrRoll(st, e.tbl, e.key, keys);
    if (!picked) { st.notes.push(L("NoVariant", { table: e.tbl })); return []; }
    key = match(picked.label) ?? picked.label;
    if (!keys.includes(key)) { st.notes.push(L("VariantMiss", { table: e.tbl, label: picked.label })); return []; }
    recordVariant(st, e.tbl, picked.full ?? key, picked.uuid);
  }
  st.log.push(`${e.tbl}: ${key}`);
  return expand(e.variant[key], st, ctx);
}

async function expandBody(e, st) {
  const rec = await recordedVariant(st, e.tbl);
  let doc = rec?.uuid ? await fromUuid(rec.uuid) : null;
  if (!doc) {
    const table = await findTable(e.key);
    const docs = table ? table.results.contents.filter(r => r.documentUuid).sort((a, b) => a.range[0] - b.range[0]) : [];
    if (!docs.length) { st.notes.push(L("NoVariant", { table: e.tbl })); return []; }
    const picked = await chooseOrRoll(st, e.tbl, e.key, docs.map(r => r.name ?? r.description));
    const result = picked && docs.find(r => (r.name ?? r.description) === picked.label || r.documentUuid === picked.uuid);
    if (!result) { st.notes.push(L("NoVariant", { table: e.tbl })); return []; }
    doc = await fromUuid(result.documentUuid);
    recordVariant(st, e.tbl, doc?.name ?? picked.label, result.documentUuid);
  }
  const parts = doc?.getFlag(MODULE_ID, "parts");
  if (!parts) { st.notes.push(L("NoParts", { name: doc?.name ?? e.tbl })); return []; }
  const short = String(doc.name).split(" - ").pop();
  st.log.push(`${e.tbl}: ${short}`);
  const out = [];
  for (const part of e.body === "all" ? PARTS : [e.body]) {
    out.push(...await expand(parts[part] ?? [], st, { locs: LOCS[part], part }));
  }
  return out;
}

function recordVariant(st, table, label, uuid = null) {
  const vars = [...(st.variants ?? st.item.getFlag(MODULE_ID, "variants") ?? [])].filter(v => v.table !== table);
  vars.push({ table, label, uuid });
  st.variants = vars;
  const short = String(label).split(/[:,]/)[0].split(" - ").pop().trim();
  st.rename = `${(st.rename ?? st.item.name)} (${short})`;
}

/** Merge duplicates (one Magical trait for a whole Unnatural Body, armour locations unioned). */
function dedupe(list) {
  const map = new Map();
  const out = [];
  for (const e of list) {
    if (e.t === "bump" || e.t === "size" || e.t === "mod" || e.t === "dialog" || e.t === "status") { out.push(e); continue; }
    const key = e.t === "armour" ? `armour|${e.n}`
      : e.max ? `${e.t}|${e.n}`
      : `${e.t}|${e.n}|${e.s ?? ""}|${e.d ?? ""}|${e.l ?? ""}|${e.v ?? ""}|${e.ask ?? ""}`;
    const prev = map.get(key);
    if (!prev) { map.set(key, e); out.push(e); continue; }
    if (e.locs || prev.locs) prev.locs = [...new Set([...(prev.locs ?? ALL_LOCS), ...(e.locs ?? ALL_LOCS)])];
    if (e.max && Number(e.s) > Number(prev.s)) prev.s = e.s;
    if (e.ap > (prev.ap ?? 0)) prev.ap = e.ap;
    if ((e.x ?? 1) > (prev.x ?? 1)) prev.x = e.x;
    if (e.t === "skill" && Number(e.adv) > Number(prev.adv)) prev.adv = e.adv;
  }
  return out;
}

/* -------------------------------------------- */
/*  Applying entries                            */
/* -------------------------------------------- */

async function applyEntry(e, st) {
  switch (e.t) {
    case "talent":
    case "psychology": return applyNamed(e, st);
    case "trait": return applyTrait(e, st);
    case "skill": return applySkill(e, st);
    case "mutation": return applyMutation(e, st);
    case "armour": return applyArmour(e, st);
    case "bump": return applyBump(e, st);
    case "size": return applySize(e, st);
    case "mod": return applyMod(e, st);
    case "dialog": st.mods.push({ dialog: e.d }); return st.log.push(L("TestModifier", { label: e.d.label }));
    case "status": return applyStatus(e, st);
  }
}

async function resolve(e) {
  let doc = null;
  if (e.u) { try { doc = await fromUuid(e.u); } catch { doc = null; } }
  if (doc && e.t && e.t !== "mutation" && doc.type !== e.t) {
    console.warn(`${MODULE_ID} | ${e.u} is a ${doc.type}, expected ${e.t} "${e.n}"; searching by name`);
    doc = null;
  }
  if (!doc && e.t !== "mutation") {
    try { doc = await game.wfrp4e.utility.find(e.n, e.t); } catch { doc = null; }
  }
  if (!doc && e.t === "mutation") {
    const pack = game.packs.get(PACK_ITEMS);
    const hit = pack?.index.find(i => i.name === e.n);
    if (hit) doc = await pack.getDocument(hit._id);
  }
  return doc;
}

function itemData(doc) {
  const data = doc.toObject();
  delete data._id;
  data._stats = { ...(data._stats ?? {}), compendiumSource: doc.uuid ?? data._stats?.compendiumSource ?? null };
  return data;
}

async function specFor(e, st) {
  if (e.s) return e.s;
  if (!e.ask) return null;
  const value = await askText(st.item.name, e.ask, e.opts ?? []);
  if (value) st.log.push(`${e.ask}: ${value}`);
  return value || null;
}

async function applyNamed(e, st) {
  const doc = await resolve(e);
  if (!doc) return st.notes.push(L("NotFound", { name: e.n, type: e.t }));
  const spec = await specFor(e, st);
  const data = itemData(doc);
  data.name = spec ? `${baseName(doc.name)} (${spec})` : doc.name;
  if (e.t === "psychology" && st.actor.itemTypes.psychology?.some(i => i.name === data.name)) {
    return st.log.push(L("AlreadyHas", { name: data.name }));
  }
  for (let i = 0; i < (e.x ?? 1); i++) st.create.push(foundry.utils.deepClone(data));
}

// Core placeholder names: "Horns (Feature)", "Tongue Attack (Range)", "Hatred (Target)"...
const PLACEHOLDER = /\s*\((Feature|Target|Range|Rating)\)$/;

async function applyTrait(e, st) {
  const doc = await resolve(e);
  if (!doc) return st.notes.push(L("NotFound", { name: e.n, type: e.t }));
  const data = itemData(doc);
  const spec = await specFor(e, st);
  if (e.l) data.name = doc.name.includes("#") ? doc.name.replace("#", e.l) : `${baseName(doc.name)} (${e.l})`;
  else if (PLACEHOLDER.test(doc.name)) data.name = baseName(doc.name);   // "Horns (Feature)" -> "Horns"
  if (spec) foundry.utils.setProperty(data, "system.specification.value", String(spec));
  if (e.d !== undefined && e.d !== null) {
    // wfrp4e 10.1.x: damage lives in the specification (+ rollable.bonusCharacteristic). Later
    // system builds migrate it to system.attack, so honour that shape if a trait has it.
    if (data.system?.attack?.type) data.system.attack.damage.value = Number(e.d);
    else foundry.utils.setProperty(data, "system.specification.value", String(e.d));
  }
  for (const [path, value] of Object.entries(e.set ?? {})) foundry.utils.setProperty(data, path, value);
  if (e.q?.length) data.system.qualities = { value: [...(data.system.qualities?.value ?? []), ...e.q.map(name => ({ name }))] };
  if (e.off) data.system.disabled = true;

  const same = st.actor.itemTypes.trait.filter(t => baseName(t.name) === baseName(data.name));
  if (e.max) {
    const have = same.find(t => Number.isFinite(Number(t.system.specification?.value)));
    if (have) {
      const old = Number(have.system.specification.value);
      if (old >= Number(spec)) return st.log.push(L("AlreadyHas", { name: `${have.name} ${old}` }));
      st.undo.push({ id: have.id, path: "system.specification.value", value: have.system.specification.value });
      await have.update({ "system.specification.value": String(spec) });
      return st.log.push(L("Raised", { name: have.name, from: old, to: spec }));
    }
  }
  const dup = same.find(t => t.name === data.name
    && String(t.system.specification?.value ?? "") === String(data.system.specification?.value ?? "")
    && (t.system.attack?.damage?.value ?? null) === (data.system.attack?.damage?.value ?? null));
  if (dup) return st.log.push(L("AlreadyHas", { name: dup.name }));
  st.create.push(data);
}

async function applySkill(e, st) {
  let adv = e.adv ?? 0;
  if (typeof adv === "string") {
    const roll = await new Roll(adv).evaluate();
    st.log.push(`${e.n} +${adv}: ${roll.total}`);
    adv = roll.total;
  }
  const have = st.actor.itemTypes.skill.find(s => s.name === e.n);
  if (have) {
    if (!adv) return st.log.push(L("AlreadyHas", { name: have.name }));
    st.undo.push({ id: have.id, path: "system.advances.value", delta: adv });
    await have.update({ "system.advances.value": (have.system.advances.value ?? 0) + adv }, { skipExperienceChecks: true });   // free advances: no XP prompt
    return st.log.push(L("Advanced", { name: have.name, n: adv }));
  }
  let doc = null;
  // A skill from another module (u, e.g. Winds of Magic): only when that module is active.
  const modActive = !e.mod || !!game.modules.get(e.mod)?.active;
  if (e.u && modActive) { try { doc = await fromUuid(e.u); } catch { doc = null; } if (doc && doc.type !== "skill") doc = null; }
  if (!doc) { try { doc = await game.wfrp4e.utility.findSkill(e.n); } catch { doc = null; } }
  const modTitle = e.mod ? (game.modules.get(e.mod)?.title ?? e.mod) : "";
  const stubText = e.mod && !modActive ? L("SkillStubModule", { name: e.n, module: modTitle, ref: e.ref ?? "" }) : L("SkillStub", { name: e.n, ref: e.ref ?? "" });
  const data = doc ? itemData(doc) : {
    name: e.n, type: "skill", img: "systems/wfrp4e/icons/blank.png",
    system: { characteristic: { value: e.c ?? "int" }, advanced: { value: "adv" }, grouped: { value: "noSpec" },
      description: { value: `<p>${esc(stubText)}</p>` } },
    flags: { [MODULE_ID]: { stubFor: e.u ?? null } }
  };
  data.name = e.n;
  foundry.utils.setProperty(data, "system.advances.value", adv);
  if (!doc) st.notes.push(e.mod && !modActive ? L("SkillStubModuleNote", { name: e.n, module: modTitle, ref: e.ref ?? "", char: game.i18n.localize(game.wfrp4e.config.characteristics?.[e.c] ?? e.c) })
    : L("SkillStubNote", { name: e.n, ref: e.ref ?? "" }));
  st.create.push(data);
}

async function applyMutation(e, st) {
  const doc = await resolve(e);
  if (!doc) return st.notes.push(L("NotFound", { name: e.n, type: e.t }));
  const data = itemData(doc);
  const flags = data.flags[MODULE_ID] ?? (data.flags[MODULE_ID] = {});
  if (e.v) {
    data.name = `${doc.name} (${e.v})`;
    flags.variants = [{ table: e.tbl ?? doc.name, label: e.v, uuid: null }];
  }
  if (e.locs) flags.locs = e.locs;
  flags.rolledOn = L("GrantedFrom", { name: st.item.name });
  st.create.push(data);
}

async function applyArmour(e, st) {
  const locs = e.locs ?? ALL_LOCS;
  const AP = Object.fromEntries(ALL_LOCS.map(l => [l, locs.includes(l) ? e.ap : 0]));
  st.create.push({
    name: e.n, type: "armour", img: st.item.img,
    system: {
      description: { value: `<p>${esc(L("NaturalArmour", { name: st.item.name }))}</p>${e.text ? `<p>${esc(e.text)}</p>` : ""}` },
      armorType: { value: "other" }, AP, equipped: { value: true },
      encumbrance: { value: 0 }, price: { gc: 0, ss: 0, bp: 0 },
      qualities: { value: (e.q ?? []).map(name => ({ name })) }, flaws: { value: (e.f ?? []).map(name => ({ name })) }
    }
  });
}

async function applyBump(e, st) {
  const traits = st.actor.itemTypes.trait.filter(t => baseName(t.name) === e.n);
  const sibling = traits.find(t => {
    const src = st.actor.items.get(t.getFlag(MODULE_ID, "grantedBy"));
    return src && src.id !== st.item.id && baseName(src.name) === baseName(st.item.name);
  }) ?? traits[0];
  if (!sibling) return st.notes.push(L("NoBump", { name: e.n }));
  if (sibling.system.attack?.type) {
    const old = Number(sibling.system.attack.damage.value) || 0;
    st.undo.push({ id: sibling.id, path: "system.attack.damage.value", delta: e.d });
    await sibling.update({ "system.attack.damage.value": old + e.d });
  }
  else {
    const old = Number(sibling.system.specification?.value) || 0;
    st.undo.push({ id: sibling.id, path: "system.specification.value", value: sibling.system.specification?.value ?? "" });
    await sibling.update({ "system.specification.value": String(old + e.d) });
  }
  st.log.push(L("Bumped", { name: sibling.name, n: e.d }));
}

async function applySize(e, st) {
  const label = (key) => game.i18n.localize(game.wfrp4e.config.actorSizes[key]);
  const current = st.actor.system.details?.size?.value ?? "avg";
  const idx = SIZES.indexOf(current);
  const next = SIZES[Math.max(0, Math.min(SIZES.length - 1, idx + e.step))];
  if (next === current) return st.notes.push(L("SizeLimit", { size: label(current) }));
  const sizeName = game.i18n.localize("NAME.Size");
  const have = st.actor.itemTypes.trait.find(t => t.name === sizeName && t.system.enabled);
  if (have) {
    st.undo.push({ id: have.id, path: "system.specification.value", value: have.system.specification.value });
    await have.update({ "system.specification.value": label(next) });
  }
  else {
    const doc = await resolve({ t: "trait", n: sizeName, u: e.u });
    if (!doc) return st.notes.push(L("NotFound", { name: sizeName, type: "trait" }));
    const data = itemData(doc);
    data.system.specification.value = label(next);
    st.create.push(data);
  }
  st.log.push(L("Size", { from: label(current), to: label(next) }));
  const more = e.at?.[next];
  if (more) for (const m of dedupe(await expand(more, st, {}))) await applyEntry(m, st);
}

/* -------------------------------------------- */
/*  Modifiers                                   */
/* -------------------------------------------- */

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

function modName(k) {
  if (k === "move") return L("Movement");
  if (k === "wounds") return L("Wounds");
  return game.i18n.localize(game.wfrp4e.config.characteristics?.[k] ?? k);
}

async function applyMod(e, st) {
  if (e.half) {
    st.mods.push({ half: e.k });
    return st.log.push(L("Halved", { name: modName(e.k) }));
  }
  let value = e.v;
  if (typeof value === "string") {
    const neg = value.trim().startsWith("-");
    const roll = await new Roll(value.trim().replace(/^[-+]\s*/, "")).evaluate();
    value = neg ? -roll.total : roll.total;
    st.rolled.push({ k: e.k, formula: e.v, value });
    st.log.push(`${modName(e.k)} ${e.v}: ${signed(value)}`);
  }
  else st.log.push(`${modName(e.k)} ${signed(Number(value))}`);
  st.mods.push({ k: e.k, value: Number(value) });
}

const poolName = (k) => game.i18n.localize(`AMUT.Grant.Pool.${k}`);

async function applyStatus(e, st) {
  const path = `system.status.${e.k}.value`;
  const cur = foundry.utils.getProperty(st.actor, path);
  if (!STATUS.includes(e.k) || cur === undefined) return st.notes.push(L("NoPool", { pool: poolName(e.k), name: st.actor.name }));
  // unless: an item this grant adds (e.g. core's Luck Talent) already changes the pool with its own script
  if (e.unless && st.create.some(d => d.name === e.unless && JSON.stringify(d.effects ?? []).includes(`status.${e.k}`))) return;
  const next = Math.max(0, (Number(cur) || 0) + e.v);
  await st.actor.update({ [path]: next }, { skipExperienceChecks: true });
  st.undo.push({ actor: true, path, delta: next - (Number(cur) || 0) });
  st.log.push(`${poolName(e.k)} ${signed(e.v)} (${cur} > ${next})`);
}

/**
 * Change Fortune / Fate / Resilience / Resolve by the given amounts (never below 0) and say so in chat.
 * Used by the buttons on mutation effects, e.g. Lunacy "Morrslieb full": +1 Fortune.
 * Returns { applied: { fortune: <actual change> ... } }.
 */
export async function adjustStatus(actor, deltas = {}, reason = "") {
  if (!actor) return;
  const update = {}, bits = [], applied = {};
  for (const [k, d] of Object.entries(deltas)) {
    const path = `system.status.${k}.value`;
    const cur = foundry.utils.getProperty(actor, path);
    if (!STATUS.includes(k) || cur === undefined) { ui.notifications.warn(L("NoPool", { pool: poolName(k), name: actor.name })); continue; }
    const next = Math.max(0, (Number(cur) || 0) + Number(d));
    update[path] = next;
    applied[k] = next - (Number(cur) || 0);
    bits.push(`${poolName(k)} ${cur} > ${next}`);
  }
  if (foundry.utils.isEmpty(update)) return { applied };
  await actor.update(update, { skipExperienceChecks: true });
  const message = await ChatMessage.create({ content: `<p><strong>${esc(actor.name)}</strong>: ${esc(bits.join(", "))}${reason ? ` <em>(${esc(reason)})</em>` : ""}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
  return { applied, message };
}

/** Add one more change to a Modifiers effect (Regeneration: -1 Fellowship per regenerated Critical). */
export async function addModifier(effect, k, v, reason = "") {
  if (!effect) return;
  const data = effect.toObject();
  const changes = [...(data.system?.changes ?? []), changeFor(k, v)];
  const scripts = [...(data.system?.scriptData ?? [])];
  if (Number(v) < 0 && !scripts.some(s => s.trigger === "computeCharacteristics")) scripts.push(characteristicsScriptData());
  await effect.update({ "system.changes": changes, "system.scriptData": scripts });
  const actor = effect.actor ?? effect.parent?.actor;
  return ChatMessage.create({ content: `<p><strong>${esc(actor?.name ?? "")}</strong>: ${esc(`${modName(k)} ${signed(Number(v))}`)}${reason ? ` <em>(${esc(reason)})</em>` : ""}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
}

/** Write rolled / chosen modifiers into the mutation's Modifiers effect (created if missing). */
async function applyModifiers(st) {
  let effect = st.item.effects?.find(e => e.getFlag(MODULE_ID, "modifiers"));
  if (!effect) [effect] = await st.item.createEmbeddedDocuments("ActiveEffect", [modifierEffectData(st.item)]);
  if (!effect) return;
  const data = effect.toObject();
  const flags = data.flags?.[MODULE_ID] ?? {};
  const changes = [...(data.system?.changes ?? [])];
  const scripts = [...(data.system?.scriptData ?? [])];
  const halve = [...(flags.halve ?? [])];
  let wounds = Number(flags.wounds) || 0;
  for (const m of st.mods) {
    if (m.dialog) scripts.push(m.dialog);
    else if (m.half) halve.push(m.half);
    else if (m.k === "wounds") wounds += m.value;
    else if (m.value) changes.push(changeFor(m.k, m.value));
  }
  if (wounds && !scripts.some(s => s.trigger === "woundCalc")) scripts.push(woundsScriptData());
  const lowers = halve.length || changes.some(c => Number(c.value) < 0 && c.key.startsWith("system.characteristics."));
  if (lowers && !scripts.some(s => s.trigger === "computeCharacteristics")) scripts.push(characteristicsScriptData());
  await effect.update({
    "system.changes": changes,
    "system.scriptData": scripts,
    [`flags.${MODULE_ID}.wounds`]: wounds,
    [`flags.${MODULE_ID}.halve`]: halve,
    [`flags.${MODULE_ID}.rolled`]: [...(flags.rolled ?? []), ...st.rolled]
  });
}

/* -------------------------------------------- */
/*  Prompts                                     */
/* -------------------------------------------- */

function labelOf(e) {
  if (Array.isArray(e)) return e.map(labelOf).join(" + ");
  if (e.label) return e.label;
  if (e.note) return e.note;
  if (e.choose) return e.choose;
  if (e.t === "mod") return e.half ? L("Halved", { name: modName(e.k) }) : `${typeof e.v === "number" ? signed(e.v) : e.v} ${modName(e.k)}`;
  if (e.t === "dialog") return e.d.label;
  if (e.t === "status") return `${signed(e.v)} ${poolName(e.k)}`;
  const bits = [e.n];
  if (e.s) bits.push(`(${e.s})`);
  if (e.l) bits.push(`(${e.l})`);
  if (e.v) bits.push(`(${e.v})`);
  if (e.d !== undefined && e.t === "trait") bits.push(`+${e.d}`);
  if (e.t === "bump") bits.push(`+${e.d} ${L("Damage")}`);
  if (e.t === "skill" && e.adv) bits.push(`+${e.adv}`);
  if (e.x > 1) bits.push(`x${e.x}`);
  return bits.join(" ");
}

async function choose(title, text, labels, n = 1) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const type = n > 1 ? "checkbox" : "radio";
  const content = `<p>${esc(text)}</p>${n > 1 ? `<p><em>${esc(L("PickN", { n }))}</em></p>` : ""}
    <div class="amut-choices" style="display:flex;flex-direction:column;gap:4px">
    ${labels.map((l, i) => `<label><input type="${type}" name="pick" value="${i}" ${i === 0 && n === 1 ? "checked" : ""}> ${esc(l)}</label>`).join("")}
    </div>`;
  const picks = await DialogV2.wait({
    window: { title }, content, rejectClose: false,
    buttons: [
      { action: "ok", label: L("Ok"), default: true,
        callback: (event, button) => [...button.form.querySelectorAll('input[name="pick"]:checked')].map(i => Number(i.value)) },
      { action: "cancel", label: L("Skip"), callback: () => null }
    ]
  });
  if (!Array.isArray(picks) || !picks.length) return null;
  return picks.slice(0, n);
}

async function askText(title, text, opts = []) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const id = `amut-opts-${foundry.utils.randomID()}`;
  const content = `<div class="form-group"><label>${esc(text)}</label>
    <input type="text" name="value" list="${id}" autofocus>
    <datalist id="${id}">${opts.map(o => `<option value="${esc(o)}"></option>`).join("")}</datalist></div>`;
  const value = await DialogV2.wait({
    window: { title }, content, rejectClose: false,
    buttons: [
      { action: "ok", label: L("Ok"), default: true, callback: (event, button) => button.form.elements.value.value.trim() },
      { action: "cancel", label: L("Skip"), callback: () => null }
    ]
  });
  return typeof value === "string" ? value : null;
}

async function findTable(key) {
  const pack = game.packs.get(PACK_TABLES);
  if (!pack) return null;
  const docs = await pack.getDocuments();
  return docs.find(t => t.getFlag("wfrp4e", "key") === key) ?? null;
}

/** Pick a sub-table result by hand, or roll it on the module table. Returns { label, full, uuid }. */
async function chooseOrRoll(st, tbl, key, labels) {
  const all = [L("RollTable", { table: tbl }), ...labels];
  const pick = await choose(st.item.name, L("PickVariant", { table: tbl }), all, 1);
  if (!pick) return null;
  if (pick[0] > 0) return { label: labels[pick[0] - 1] };
  const table = await findTable(key);
  if (!table) return null;
  const draw = await table.draw({ displayChat: false });
  const result = draw.results[0];
  if (!result) return null;
  const full = result.documentUuid ? (result.name ?? "") : String(result.description ?? result.name ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  st.log.push(`${tbl} (${table.formula}): ${draw.roll.total}`);
  return { label: full, full, uuid: result.documentUuid ?? null };
}

/* -------------------------------------------- */
/*  Summary card                                */
/* -------------------------------------------- */

async function postSummary(st, created) {
  if (!created.length && !st.log.length && !st.notes.length && !st.undo.length) return;
  const names = created.map(i => `@UUID[${i.uuid}]{${i.name}}`);
  const content = `<h3>${esc(L("Title", { name: st.rename ?? st.item.name }))}</h3>
    ${st.log.length ? `<ul>${st.log.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    ${names.length ? `<p><strong>${esc(L("Added"))}:</strong> ${names.join(", ")}</p>` : ""}
    ${st.notes.length ? st.notes.map(n => `<p><em>${esc(n)}</em></p>`).join("") : ""}`;
  return ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: ChatMessage.getSpeaker({ actor: st.actor })
  });
}
