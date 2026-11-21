/**
 * Antares | Mutant's Handbook - script bodies for the "<Mutation> (Modifiers)" effects.
 *
 * Pure strings and helpers (no Foundry globals at import time), shared by the runtime
 * (scripts/mutation-grants.mjs, for rolled and chosen modifiers) and the pack builder
 * (tools/modifiers.mjs, for the fixed ones).
 *
 * A Modifiers effect holds:
 *   system.changes        ActiveEffect changes, e.g. { key: "system.characteristics.ag.modifier", type: "add", value: "10" }
 *                         and { key: "system.details.move.value", type: "add", value: "-1" }
 *   flags.<id>.wounds     added to max Wounds by a "woundCalc" script (the system recalculates Wounds
 *                         from SB/TB/WPB and size, so a change to status.wounds.max would be overwritten)
 *   flags.<id>.halve      characteristic keys or "move" halved (rounded up) by a "computeCharacteristics" script
 *   flags.<id>.rolled     what was rolled or picked when the mutation was added, for reference
 *   dialog scripts        situational test modifiers, shown as options in the roll dialog
 */

export const MODULE_ID = "artantares-mutations";
export const CHARACTERISTICS = ["ws", "bs", "s", "t", "i", "ag", "dex", "int", "wp", "fel"];

export const charKey = (k) => `system.characteristics.${k}.modifier`;
export const MOVE_KEY = "system.details.move.value";
// Foundry v14 change shape (value is a string; "add" casts it to a number for numeric fields).
export const changeFor = (k, value) => ({ key: k === "move" ? MOVE_KEY : charKey(k), type: "add", value: String(Number(value)), phase: "initial", priority: null });

// Wounds: added after the system's size-based formula (same trigger core uses for Hardy-style effects).
// Never below 1 Wound.
export const WOUNDS_SCRIPT = `args.wounds = Math.max(1, args.wounds + (Number(this.effect.getFlag("${MODULE_ID}", "wounds")) || 0));`;

// Characteristics never drop below 0 (p10), halved values (Cyclopean Horror, Blob) round up, and
// capped values (Hideous Appearance: Fellowship never above 0) are clamped.
// computeCharacteristics runs after the system has added the modifiers and before Movement is derived.
export const CHARACTERISTICS_SCRIPT = `const sys = this.actor.system;
const rebonus = (c) => { c.bonus = Math.max(0, Math.floor(c.value / 10) + (c.bonusMod || 0)); };
for (const k of this.effect.getFlag("${MODULE_ID}", "halve") ?? []) {
  if (k === "move") sys.details.move.value = Math.ceil(Number(sys.details.move.value) / 2);
  else if (sys.characteristics[k]) { const c = sys.characteristics[k]; c.value = Math.ceil(c.value / 2); rebonus(c); }
}
for (const [k, max] of Object.entries(this.effect.getFlag("${MODULE_ID}", "cap") ?? {})) {
  const c = sys.characteristics[k];
  if (c && c.value > max) { c.value = max; rebonus(c); }
}
for (const c of Object.values(sys.characteristics)) {
  if (c.value < 0) { c.value = 0; c.bonus = Math.max(0, c.bonusMod || 0); }
}`;

export const woundsScriptData = () => ({ label: "Wounds from this mutation", trigger: "woundCalc", script: WOUNDS_SCRIPT, options: {} });
export const characteristicsScriptData = () => ({ label: "Halved or capped values, Characteristics not below 0", trigger: "computeCharacteristics", script: CHARACTERISTICS_SCRIPT, options: {} });

/**
 * Dialog script for a situational test modifier.
 * when: { skills: ["Stealth", ...] (system NAME.* keys, matched on the start of the skill name, so
 *         "Stealth" covers "Stealth (Urban)"), chars: ["wp", ...], weapon: "melee" (melee weapon tests),
 *         attack: "melee" (melee weapon or trait attacks), cast: true (casting tests), any: true }
 * active: true = ticked by default when it applies; false = offered, ticked by the player; a string
 *         = a JS condition for ticking it (e.g. the attacker is in-fighting).
 * mod: { modifier, slBonus, slFrom, expr } (slFrom: a characteristic whose bonus is added to SL;
 *      expr: a raw statement)
 * targeter: true = the option sits on THIS actor but shows in the dialog of whoever targets it
 *      (the system's "targeter" dialog scripts, as core Conditions like Prone use); `args` is the
 *      attacker's dialog, `this.actor` is the mutant.
 */
export function dialogScriptData(label, mod, when = {}, active = false, { targeter = false } = {}) {
  const conds = [];
  if (when.skills?.length) conds.push(`[${when.skills.map(s => `game.i18n.localize("NAME.${s}")`).join(", ")}].some(n => args.skill?.name?.startsWith(n))`);
  if (when.chars?.length) conds.push(`${JSON.stringify(when.chars)}.includes(args.characteristic)`);
  if (when.weapon === "melee") conds.push(`!!args.weapon?.system?.isMelee`);
  if (when.attack) conds.push(`args.item?.system?.attackType == "${when.attack}"`);
  if (when.cast) conds.push(`args.type == "cast"`);
  const cond = conds.length ? conds.join(" || ") : "true";
  const body = [];
  if (mod.modifier) body.push(`args.fields.modifier += ${Number(mod.modifier)};`);
  if (mod.slBonus) body.push(`args.fields.slBonus += ${Number(mod.slBonus)};`);
  if (mod.slFrom) body.push(`args.fields.slBonus += Number(this.actor.system.characteristics.${mod.slFrom}.bonus) || 0;`);
  if (mod.expr) body.push(mod.expr);
  const activate = typeof active === "string" ? `return (${cond}) && (${active});` : active ? `return ${cond};` : "";
  // Same option shape as core's own dialog scripts (e.g. Magic Resistance): flat options, which
  // warhammer-lib reads, plus the nested "dialog" copy the wfrp4e 10.x script editor writes.
  const dialog = {
    ...(targeter ? { targeter: true } : {}),
    hideScript: conds.length && !when.any ? `return !(${cond});` : "",
    activateScript: activate,
    submissionScript: ""
  };
  return { label, trigger: "dialog", script: body.join("\n"), options: { ...dialog, dialog: { ...dialog } } };
}

/** A "<Mutation> (Modifiers)" effect for a mutation item that has none yet (runtime fallback). */
export function modifierEffectData(item) {
  return {
    name: `${item.name} (Modifiers)`, img: item.img, type: "base", transfer: true, disabled: false,
    system: {
      transferData: { type: "document", originalType: "document", documentType: "Actor" },
      scriptData: [],
      changes: []
    },
    flags: { [MODULE_ID]: { modifiers: true } }
  };
}


/* Fortune, Fate, Resilience and Resolve
 * These are pools the actor stores (system.status.<k>.value, characters only) and the sheet spends,
 * so an ActiveEffect change would come back every time a point is spent. Like core effects, they
 * are changed with one-off actor updates:
 *   - permanent: Time Warp grants a level of the Luck Talent (+1 Fortune, which session reset
 *     macros such as GM Toolkit's Reset Fortune count) and adds the point now; undone on deletion
 *   - temporary: buttons ("manual" scripts) on the effect, shown on the actor's Effects tab
 */
export const STATUS = ["fortune", "fate", "resilience", "resolve"];
const API = `game.modules.get("${MODULE_ID}")?.api`;


/** Power Item Obsession: -1 Fortune while the item is away; the point actually lost is remembered
 * (not added up, so pressing it again after a session's Fortune reset is right) and given back. */
export const powerItemButtons = () => [
  {
    label: "Power item not on me: -1 Fortune", trigger: "manual",
    script: `const r = await ${API}?.adjustStatus(this.actor, { fortune: -1 }, "Power Item Obsession: item not on you");
await this.effect.update({ "flags.${MODULE_ID}.lost": -(r?.applied?.fortune ?? 0) });`,
    options: {}
  },
  {
    label: "Power item back: +1 Fortune", trigger: "manual",
    script: `const n = Number(this.effect.getFlag("${MODULE_ID}", "lost")) || 0;
if (n) await ${API}?.adjustStatus(this.actor, { fortune: n }, "Power Item Obsession: item back");
await this.effect.update({ "flags.${MODULE_ID}.lost": 0 });`,
    options: { hideScript: `return !(Number(this.effect.getFlag("${MODULE_ID}", "lost")) > 0);` }
  }
];

// Shown once per actor, on the first copy of the mutation (the power counts every copy as a level).
const FIRST_COPY = `return this.actor?.items?.find(i => i.type === "mutation" && i.name === this.item?.name)?.id !== this.item?.id;`;

/** Oracle: "Activate Oracle" (Willpower Test, +10 Initiative and +1 Fortune per level) and its end. */
export const oracleButton = () => ({ label: "Activate Oracle", trigger: "manual", script: `await ${API}?.activateOracle(this.actor, this.item);`, options: { hideScript: FIRST_COPY } });
export const oracleEndButton = () => ({ label: "End Oracle (scene over): remove unspent Fortune", trigger: "manual", script: `await ${API}?.endOracle(this.actor, this.effect);`, options: {} });

/** Lunacy: "Activate Lunacy" asks for Morrslieb's state and switches on that phase's effect. */
export const lunacyButton = () => ({ label: "Activate Lunacy", trigger: "manual", script: `await ${API}?.activateLunacy(this.actor, this.item);`, options: { hideScript: FIRST_COPY } });

/** Elongated Limbs (arms): weapon length in opposed melee tests (see mutation-powers.mjs). */
export const longArmsScripts = () => [
  { label: "Elongated Limbs: long arms Reach (attacking)", trigger: "preOpposedAttacker", script: `${API}?.longArmsReach(args, "attacker");`, options: {} },
  { label: "Elongated Limbs: long arms Reach (defending)", trigger: "preOpposedDefender", script: `${API}?.longArmsReach(args, "defender");`, options: {} }
];

/** Regeneration: -1 Fellowship for each regenerated Critical Wound (added to this effect). */
export const regenerationButton = () => ({
  label: "Critical Wound regenerated: -1 Fellowship (not with Inhuman Beauty)", trigger: "manual",
  script: `await ${API}?.addModifier(this.effect, "fel", -1, "Regeneration: scarring");`,
  options: {}
});

/*
 * Critical modifiers.
 * Attack-roll Criticals (doubles that hit): rollTest runs after the system has built the Critical
 * link (result.tables.critical), so both the stored modifier and the link are raised (like core's
 * head +40 scripts). Wound Criticals ("Up in Arms" Criticals setting): wfrp4e 10.1.2 builds the
 * Critical link in applyDamage after the scripts ran and does not read a modifier back from them,
 * so these entries only carry a marker; the module's "wfrp4e:rollTable" hook (critHookModifier)
 * adds them when the link of that opposed test is clicked (attacker: dealt, defender: taken).
 */
export const critRollScriptData = (label, n) => ({
  label, trigger: "rollTest",
  script: `const r = args.test.result;
if (r.tables?.critical && !r.tables.critical.nulled) {
  r.critModifier = (Number(r.critModifier) || 0) + ${Number(n)};
  r.tables.critical.modifier = (Number(r.tables.critical.modifier) || 0) + ${Number(n)};
  r.tables.critical.label += " (${label.split(":")[0]})";   // the system appends the total modifier itself
}`,
  options: {}
});
export const CRIT_MARK = "/*amut-crit ";
const critMark = (o) => `${CRIT_MARK}${JSON.stringify(o)} */`;
export const critDealtScriptData = (label, n) => ({ label, trigger: "applyDamage", script: critMark({ side: "dealt", n: Number(n) }), options: {} });
export const critTakenScriptData = (label, n, loc) => ({ label, trigger: "takeDamage", script: critMark({ side: "taken", n: Number(n), ...(loc ? { loc } : {}) }), options: {} });

/** Sum of an actor's active wound-Critical markers for one side ("dealt"/"taken") and location. */
export function critMarkTotal(actor, side, loc) {
  let total = 0;
  const effects = typeof actor?.allApplicableEffects === "function" ? [...actor.allApplicableEffects()] : [];
  for (const e of effects) {
    if (e.disabled || e.isSuppressed) continue;
    for (const s of e.system?.scriptData ?? []) {
      const src = String(s.script ?? "");
      if (!src.startsWith(CRIT_MARK)) continue;
      let o; try { o = JSON.parse(src.slice(CRIT_MARK.length, src.lastIndexOf("*/"))); } catch { continue; }
      if (o.side === side && (!o.loc || o.loc === loc)) total += Number(o.n) || 0;
    }
  }
  return total;
}

/**
 * "wfrp4e:rollTable" hook (synchronous, before the roll; options are passed on by reference).
 * Only Critical tables rolled from an opposed-test message (where damage was applied), only with
 * the Up in Arms Criticals setting, and once per roll.
 */
export function critHookModifier({ tableKey, options } = {}) {
  if (!options || options._amutCrit || !game.settings.get("wfrp4e", "uiaCrits")) return;
  const m = /^crit(.+)$/.exec(String(tableKey ?? ""));
  if (!m) return;
  const ot = game.messages.get(options.messageId)?.system?.opposedTest;
  if (!ot) return;
  const loc = m[1];
  const n = critMarkTotal(ot.attackerTest?.actor, "dealt", loc) + critMarkTotal(ot.defenderTest?.actor, "taken", loc);
  options._amutCrit = true;
  if (n) options.modifier = (Number(options.modifier) || 0) + n;
}

