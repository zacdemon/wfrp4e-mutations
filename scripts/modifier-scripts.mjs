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

// Characteristics never drop below 0 (p10), and halved values (Cyclopean Horror, Blob) round up.
// computeCharacteristics runs after the system has added the modifiers and before Movement is derived.
export const CHARACTERISTICS_SCRIPT = `const sys = this.actor.system;
for (const k of this.effect.getFlag("${MODULE_ID}", "halve") ?? []) {
  if (k === "move") sys.details.move.value = Math.ceil(Number(sys.details.move.value) / 2);
  else if (sys.characteristics[k]) {
    const c = sys.characteristics[k];
    c.value = Math.ceil(c.value / 2);
    c.bonus = Math.floor(c.value / 10) + (c.bonusMod || 0);
  }
}
for (const c of Object.values(sys.characteristics)) {
  if (c.value < 0) { c.value = 0; c.bonus = Math.max(0, c.bonusMod || 0); }
}`;

export const woundsScriptData = () => ({ label: "Wounds from this mutation", trigger: "woundCalc", script: WOUNDS_SCRIPT, options: {} });
export const characteristicsScriptData = () => ({ label: "Halved values, Characteristics not below 0", trigger: "computeCharacteristics", script: CHARACTERISTICS_SCRIPT, options: {} });

/**
 * Dialog script for a situational test modifier.
 * when: { skills: ["Stealth", ...] (system NAME.* keys, matched on the start of the skill name, so
 *         "Stealth" covers "Stealth (Urban)"), chars: ["wp", ...], melee: true, any: true }
 * active: true = ticked by default when it applies; false = offered, ticked by the player.
 * mod: { modifier, slBonus, slFrom } (slFrom: a characteristic whose bonus is added to SL)
 */
export function dialogScriptData(label, mod, when = {}, active = false) {
  const conds = [];
  if (when.skills?.length) conds.push(`[${when.skills.map(s => `game.i18n.localize("NAME.${s}")`).join(", ")}].some(n => args.skill?.name?.startsWith(n))`);
  if (when.chars?.length) conds.push(`${JSON.stringify(when.chars)}.includes(args.characteristic)`);
  if (when.melee) conds.push(`!!args.weapon?.system?.isMelee`);
  const cond = conds.length ? conds.join(" || ") : "true";
  const body = [];
  if (mod.modifier) body.push(`args.fields.modifier += ${Number(mod.modifier)};`);
  if (mod.slBonus) body.push(`args.fields.slBonus += ${Number(mod.slBonus)};`);
  if (mod.slFrom) body.push(`args.fields.slBonus += Number(this.actor.system.characteristics.${mod.slFrom}.bonus) || 0;`);
  return {
    label, trigger: "dialog", script: body.join("\n"),
    options: {
      hideScript: conds.length && !when.any ? `return !(${cond});` : "",
      activateScript: active ? `return ${cond};` : "",
      submissionScript: ""
    }
  };
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
