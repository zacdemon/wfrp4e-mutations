/**
 * Mutant's Handbook in-play triggers: what the text says happens when something comes up in play,
 * with no Test by the mutant ("Eating the wrong food will make you gain 1 Fatigued Condition").
 * One button per entry (labels in TRIGGER_BUTTONS, scripts/modifier-scripts.mjs), on the mutation's
 * first copy:
 *   self:    ops applied to the mutant (a Condition, a timed effect)
 *   targets: ops applied to each targeted creature; a Test in them is rolled by that creature's
 *            active player, else the GM (applyOps in mutation-activations.mjs: changes to actors this
 *            user can't update go to the active GM, like the powers' results)
 *   fear:    a Fear card (the system's psych message) for the mutant or the targets
 * The result is a chat card with what was applied and any GM note.
 * Bleeder needs no button: an extra Bleeding is added whenever its owner gains Bleeding.
 */
import { applyOps, hasMutation } from "./mutation-activations.mjs";

const MODULE_ID = "artantares-mutations";
const F = (key, data) => data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const nameOf = (a) => a?.token?.name ?? a?.prototypeToken?.name ?? a?.name ?? "";
const END = { skill: "NAME.Endurance" }, COOL = { skill: "NAME.Cool" }, WP = { char: "wp" };
const T = (k) => `AMUT.Trig.${k}`;

const fatigued = (key) => ({ self: () => [{ condition: "fatigued", n: 1 }], line: T(`${key}.Line`) });
const restless = (key) => ({ self: () => [{ condition: "fatigued", n: 1 }], line: T(`${key}.Line`), gm: T("Restless.GM") });

export const TRIGGERS = {
  acquiredTaste: fatigued("acquiredTaste"),
  princeOfNothing: fatigued("princeOfNothing"),
  scryingTouch: { ...fatigued("scryingTouch"), gm: T("scryingTouch.GM") },
  warpSpasm: { ...fatigued("warpSpasm"), gm: T("warpSpasm.GM") },
  doomProphet: restless("doomProphet"), metamorphosis: restless("metamorphosis"),
  rebelliousMind: restless("rebelliousMind"), saintOfTheDamned: restless("saintOfTheDamned"),
  // "1 Fatigued Condition for the first two hours of every day": the Condition and a 2-hour effect that takes it away again.
  chaoticDreams: { self: (c) => [{ condition: "fatigued", n: 1 }, { effect: {
      name: F(T("chaoticDreams.Effect")), img: c.item.img, duration: { value: 2, units: "hours" },
      description: `<p>${esc(F(T("chaoticDreams.EffectText")))}</p>`,
      flags: { [MODULE_ID]: { trigger: "chaoticDreams", endRemove: { fatigued: 1 } } } } }],
    line: T("chaoticDreams.Line"), gm: T("chaoticDreams.GM") },
  darkFate: { fear: 1, line: T("darkFate.Line") },
  suspiciousMind: { fear: 1, line: T("suspiciousMind.Line") },
  alienMind: { targets: () => [{ test: COOL, difficulty: "challenging", title: F("AMUT.Act.AlienMind.Title"),
      failText: F("AMUT.Act.AlienMind.FailText"), fail: [{ condition: "stunned" }] }], line: T("alienMind.Line") },
  horridScream: { targets: (c, t) => [{ condition: "deafened", n: 1 },
      ...(t.items.some(i => i.type === "trait" && i.name.split("(")[0].trim() === "Skittish") ? [{ condition: "broken", n: 3 }] : [])],
    targetFear: 1, line: T("horridScream.Line") },
  frostbite: { targets: () => [{ test: END, difficulty: "challenging", title: "Frostbite", failText: F(T("frostbite.FailText")), fail: [{ condition: "stunned" }] }],
    line: T("frostbite.Line"), gm: T("frostbite.GM") },
  burningBody: { targets: () => [{ test: END, difficulty: "challenging", title: "Burning Body", failText: F(T("burningBody.FailText")), fail: [{ condition: "ablaze", n: 1 }] }],
    line: T("burningBody.Line") },
  infernalFurnace: { targets: () => [{ test: END, difficulty: "average", title: "Infernal Furnace", failText: F(T("infernalFurnace.FailText")), fail: [{ condition: "ablaze", n: 1 }] }],
    line: T("infernalFurnace.Line") },
  infernalFurnaceDeath: { targets: (c) => [{ damage: 3 * c.tb, loc: "body" }, { condition: "ablaze", n: 1 }], line: T("infernalFurnaceDeath.Line") },
  miasmaOfTerror: { targets: () => [{ condition: "fatigued", n: 1 }], line: T("miasmaOfTerror.Line"), gm: T("miasmaOfTerror.GM") },
  tantalisingAura: { targets: () => [{ test: WP, difficulty: "average", title: "Tantalising Aura", failText: F(T("tantalisingAura.FailText")), fail: [{ condition: "surprised", n: 1 }] }],
    line: T("tantalisingAura.Line"), gm: T("tantalisingAura.GM") }
};

async function postFear(n, source) {
  const Psych = CONFIG.ChatMessage.dataModels?.psych;
  if (Psych?.createFearMessage) return Psych.createFearMessage(n, source);
  return game.wfrp4e.utility.postFear(n, source);
}

export async function triggerMutation(actor, item, key) {
  const t = TRIGGERS[key];
  if (!actor || !item || !t) return;
  if (!actor.isOwner) return ui.notifications.error(F("AMUT.Act.NotOwner"));
  const c = { actor, item, key, tb: Number(actor.system.characteristics?.t?.bonus) || 0, lines: [], gm: [] };
  const targets = [...game.user.targets].map(tk => tk.actor).filter(a => a && a !== actor);
  if (t.targets && !targets.length) return ui.notifications.warn(F("AMUT.Trig.NoTargets", { name: item.name }));
  const data = { actor: nameOf(actor), tb3: 3 * c.tb, targets: targets.map(nameOf).join(", ") };
  if (t.self) await applyOps(actor, t.self(c), { sourceUuid: actor.uuid });
  if (t.targets) for (const target of targets) {
    const ok = await applyOps(target, t.targets(c, target), { sourceUuid: actor.uuid });
    if (!ok) c.gm.push(F("AMUT.Act.NoGM"));
  }
  if (t.line) c.lines.push(F(t.line, data));
  if (t.gm) c.gm.push(F(t.gm, data));
  const content = `<div class="amut-power">
<p><strong>${esc(nameOf(actor))}</strong> &middot; ${esc(item.name)}</p>
${c.lines.map(l => `<p>${esc(l)}</p>`).join("")}
${c.gm.map(l => `<p><strong>${esc(F("AMUT.Act.GMNote"))}</strong> ${esc(l)}</p>`).join("")}</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }), flags: { [MODULE_ID]: { trigger: key } } });
  if (t.fear) await postFear(t.fear, item.name);
  if (t.targetFear) await postFear(t.targetFear, `${item.name} (${nameOf(actor)})`);
}

/* Chaotic Dreams: when the 2-hour effect ends (expiry or deleted), the Fatigued it gave goes. */
Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
  const remove = effect.getFlag?.(MODULE_ID, "endRemove");
  if (!remove || userId !== game.user.id || !(effect.parent instanceof Actor)) return;
  for (const [cond, n] of Object.entries(remove)) if (effect.parent.hasCondition(cond)) await effect.parent.removeCondition(cond, n);
});

/* Bleeder: "When you get Bleeding Conditions you gain an additional one." Run by the user who added them. */
const isBleeding = (e) => e.statuses?.has?.("bleeding");
const bleederOf = (e) => (e.parent instanceof Actor && hasMutation(e.parent, "Bleeder")) ? e.parent : null;
async function bleed(effect, from) {
  const actor = bleederOf(effect), now = Number(effect.system?.condition?.value) || 0;
  if (!actor || now <= from) return;
  await effect.update({ "system.condition.value": now + 1 }, { amutBleeder: true });
  await ChatMessage.create({ content: `<p><strong>${esc(nameOf(actor))}</strong> &middot; ${esc(F("AMUT.Trig.bleeder.Line", { n: now + 1 }))}</p>`,
    speaker: ChatMessage.getSpeaker({ actor }) });
}
Hooks.on("createActiveEffect", (effect, options, userId) => {
  if (userId === game.user.id && isBleeding(effect) && !options?.amutBleeder) bleed(effect, 0);
});
Hooks.on("preUpdateActiveEffect", (effect, changes, options) => {
  if (isBleeding(effect)) options.amutBleedFrom = Number(effect.system?.condition?.value) || 0;
});
Hooks.on("updateActiveEffect", (effect, changes, options, userId) => {
  if (userId !== game.user.id || !isBleeding(effect) || options?.amutBleeder) return;
  if (foundry.utils.getProperty(changes, "system.condition.value") === undefined) return;
  bleed(effect, options.amutBleedFrom ?? 0);
});
