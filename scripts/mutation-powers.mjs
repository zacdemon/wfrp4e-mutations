/**
 * Mutant's Handbook powers driven by buttons on a mutation's effects (wh-lib "manual" scripts):
 *   Oracle   "Activate Oracle": Challenging (+0) Willpower Test; success = +10 Initiative and
 *            +1 Fortune per level in the mutation for a scene; a fumble rolls a Minor Miscast.
 *   Lunacy   "Activate Lunacy": pick Morrslieb's state; switches on that phase's effect (and off
 *            the others); full Morrslieb also gives +1 Fortune (per copy).
 * And Elongated Limbs (arms) weapon reach in opposed melee tests (preOpposedAttacker/Defender).
 * Fortune is changed with one-off actor updates (api.adjustStatus), the way core effects do it.
 */
const MODULE_ID = "artantares-mutations";
const L = (key, data) => data ? game.i18n.format(`AMUT.Power.${key}`, data) : game.i18n.localize(`AMUT.Power.${key}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const api = () => game.modules.get(MODULE_ID)?.api;

/** Every copy of this mutation on the actor (levels), the clicked one first if it is there. */
function copiesOf(actor, item) {
  const all = actor?.items?.filter(i => i.type === "mutation" && i.name === item?.name) ?? [];
  return all.length ? all : [item].filter(Boolean);
}
const toggles = (item) => (item?.effects?.contents ?? item?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "toggle"));

async function say(actor, text) {
  return ChatMessage.create({ content: `<p><strong>${esc(actor.name)}</strong>: ${text}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
}

async function minorMiscast(actor) {
  try {
    const html = await game.wfrp4e.tables.formatChatRoll("minormis");
    if (html) return ChatMessage.create({ content: html, speaker: ChatMessage.getSpeaker({ actor }) });
  } catch (e) { console.warn(`${MODULE_ID} | Minor Miscast roll failed`, e); }
  return say(actor, `@Table[minormis]{${esc(L("MinorMiscast"))}}`);
}

/** Take back what is left of temporary Fortune an effect gave (flags.<id>.fortune), never below 0. */
async function takeBackFortune(actor, effect, why) {
  const given = Number(effect.getFlag(MODULE_ID, "fortune")) || 0;
  const have = Number(actor.system?.status?.fortune?.value) || 0;
  const n = Math.min(given, have);
  if (n > 0) await api()?.adjustStatus(actor, { fortune: -n }, why);
  return n;
}

/* Oracle ---------------------------------------------------------------- */

export async function activateOracle(actor, item) {
  if (!actor || !item) return;
  const copies = copiesOf(actor, item);
  const effect = toggles(copies[0])[0];
  if (effect && !effect.disabled) return ui.notifications.info(L("OracleActive", { name: item.name }));
  let test;
  try {
    test = await actor.setupCharacteristic("wp", { fields: { difficulty: "challenging" }, appendTitle: ` - ${item.name}`, skipTargets: true });
  } catch (e) { return; }                     // dialog closed
  if (!test) return;
  await test.roll();
  if (test.isCriticalFumble === "fumble") await minorMiscast(actor);
  if (!test.succeeded) return say(actor, esc(L("OracleFailed", { name: item.name })));
  const levels = copies.length;
  const r = await api()?.adjustStatus(actor, { fortune: levels }, L("OracleReason", { name: item.name, n: levels }));
  if (effect) await effect.update({ disabled: false, [`flags.${MODULE_ID}.fortune`]: r?.applied?.fortune ?? 0 });
}

/** End of the scene: switch the Initiative bonus off and remove the Fortune it gave that is still unspent. */
export async function endOracle(actor, effect) {
  if (!actor || !effect) return;
  await takeBackFortune(actor, effect, L("OracleEnd", { name: effect.parent?.name ?? "" }));
  await effect.update({ disabled: true, [`flags.${MODULE_ID}.fortune`]: 0 });
}

/* Lunacy ---------------------------------------------------------------- */

export const MORRSLIEB = ["day", "absent", "small", "large", "full"];

export async function activateLunacy(actor, item, phase = null) {
  if (!actor || !item) return;
  const copies = copiesOf(actor, item);
  const phaseEffects = copies.flatMap(c => toggles(c)).filter(e => e.getFlag(MODULE_ID, "phase"));
  const current = phaseEffects.find(e => !e.disabled)?.getFlag(MODULE_ID, "phase") ?? "day";
  phase ??= await askPhase(item.name, current);
  if (!phase || !MORRSLIEB.includes(phase)) return;
  for (const e of phaseEffects) {
    const on = e.getFlag(MODULE_ID, "phase") === phase;
    if (!on && !e.disabled && e.getFlag(MODULE_ID, "phase") === "full") await takeBackFortune(actor, e, L("LunacyFullEnds"));
    if (e.disabled === on) await e.update({ disabled: !on, ...(on ? {} : { [`flags.${MODULE_ID}.fortune`]: 0 }) });
  }
  if (phase === "full" && current !== "full") {
    const full = phaseEffects.filter(e => e.getFlag(MODULE_ID, "phase") === "full");
    const r = await api()?.adjustStatus(actor, { fortune: full.length }, L("LunacyFull"));
    let left = r?.applied?.fortune ?? 0;      // 1 per copy, remembered on each copy's effect
    for (const e of full) { const n = left > 0 ? 1 : 0; left -= n; await e.update({ [`flags.${MODULE_ID}.fortune`]: n }); }
  }
  if (phase !== current) await say(actor, esc(`${item.name}: ${L(`Morrslieb.${phase}`)}`));
}

async function askPhase(title, current) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const content = `<p>${esc(L("LunacyAsk"))}</p><div style="display:flex;flex-direction:column;gap:4px">
    ${MORRSLIEB.map(p => `<label><input type="radio" name="phase" value="${p}" ${p === current ? "checked" : ""}> ${esc(L(`Morrslieb.${p}`))}</label>`).join("")}</div>`;
  return DialogV2.wait({
    window: { title }, content, rejectClose: false,
    buttons: [
      { action: "ok", label: game.i18n.localize("AMUT.Grant.Ok"), default: true, callback: (event, button) => button.form.querySelector('input[name="phase"]:checked')?.value ?? null },
      { action: "cancel", label: game.i18n.localize("Cancel"), callback: () => null }
    ]
  });
}

/* Elongated Limbs: long arms --------------------------------------------- */

/** Does this actor have the long arms result (a Modifiers effect carrying the reach script)? */
export function hasLongArms(actor) {
  return !!actor?.items?.some(i => (i.effects?.contents ?? i.effects ?? []).some(e => !e.disabled
    && (e.system?.scriptData ?? []).some(s => String(s.script ?? "").includes("longArmsReach"))));
}

/**
 * Weapon length (core p297, system setting "Weapon Length"): in an opposed melee test the attacker
 * gets -10 when the defender's weapon is longer. Long arms make the mutant's weapon one Reach step
 * longer, so this re-runs that comparison with the longer Reach before the system applies its own:
 *   - the mutant defends with the same Reach as the attacker: the attacker gets the -10
 *   - the mutant attacks a weapon one step longer: lengths are equal, the system's -10 is offset
 * As in wfrp4e 10.1.2 checkPostModifiers: only the Infighter Talent (attackerTest.result.infighter)
 * skips the comparison; the In-fighting status works through the weapons it makes Improvised.
 * Called from preOpposedAttacker / preOpposedDefender; runs once per opposed test.
 */
export function longArmsReach(args, side) {
  const { attackerTest: atk, defenderTest: def, opposedTest } = args ?? {};
  if (!atk || !def || !opposedTest) return;
  if (!game.settings.get("wfrp4e", "weaponLength")) return;
  if (atk.weapon?.attackType != "melee" || def.weapon?.attackType != "melee") return;
  const aLong = hasLongArms(atk.actor), dLong = hasLongArms(def.actor);
  if (side === "attacker" && dLong) return;   // the defender's script handles both
  if (atk.result?.infighter) return;          // the system skips weapon length only for the Infighter Talent
  const a = Number(atk.item?.reachNum) || 0, d = Number(def.item?.reachNum) || 0;
  const systemPenalty = d > a;
  const penalty = d + (dLong ? 1 : 0) > a + (aLong ? 1 : 0);
  if (penalty === systemPenalty) return;
  const m = opposedTest.result.modifiers;
  const names = { attacker: atk.actor?.prototypeToken?.name ?? atk.actor?.name, defender: def.actor?.prototypeToken?.name ?? def.actor?.name };
  if (penalty) {
    m.attacker.target -= 10;
    m.message.push(L("ReachPenalty", names));
  } else {
    m.attacker.target += 10;                   // cancels the system's -10, added right after this
    m.message.push(L("ReachEven", names));
  }
}
