/**
 * Mutant's Handbook powers a character switches on with a Test: one button per mutation
 * ("Activate Ethereal", ...; labels in POWER_BUTTONS, scripts/modifier-scripts.mjs) that rolls the
 * handbook's Test with its Difficulty and applies the result:
 *   - timed powers create an effect on the actor with the book's duration (Rounds, minutes or
 *     hours, from the Test's SL). Rounds count down on the combat tracker and the effect expires
 *     like any system effect (warhammer-lib deletes it). Traits the power gives (Ethereal, Flight,
 *     Swarm) are the switched-off copies the mutation granted, switched on while the effect lasts;
 *     without one (granted items off) a core copy is added and deleted with the effect.
 *   - values the book derives from the Test (damage, healing, passengers, hours entranced) are
 *     worked out and shown on a card; healing, damage and Conditions are applied where the target
 *     is known, everything the module cannot judge is a GM note on the card.
 *   - a Fumble rolls the Miscast the text names.
 * Opposed powers (Evil Eye, Entrancement, Beast Alpha, Telepathy's mind reading, Thunderhead's shock)
 * roll against the targeted token through the system's opposed Test. The attacker's roll message is
 * flagged; once the defender rolls, the system's "wfrp4e:opposedTestResult" hook hands the result to the
 * active GM, who applies the outcome once per defender (Conditions, timed marker effects) and sends any
 * follow-up Test (Evil Eye's Endurance Test, Pyrokinesis' Ablaze, Bloomblight's symptom) to the
 * creature's active player, else rolls it on the GM's client.
 */
const MODULE_ID = "artantares-mutations";
const F = (key, data) => data ? game.i18n.format(key, data) : game.i18n.localize(key);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const baseName = (name) => String(name ?? "").split("(")[0].trim();
const DIFFS = ["veasy", "easy", "average", "challenging", "difficult", "hard", "vhard"];
const CORE_TRAITS = { "Ethereal": "tNWrJUOArwfWXsPw", "Flight": "EO05HX7jql0g605A", "Swarm": "E2Es82TvBKa7CoDG" };

const ch = (actor, k) => actor.system.characteristics[k] ?? { value: 0, bonus: 0 };
const copiesOf = (actor, item) => {
  const all = actor?.items?.filter(i => i.type === "mutation" && i.name === item?.name) ?? [];
  return all.length ? all : [item].filter(Boolean);
};
const doubled = (n, levels) => n * 2 ** Math.max(0, levels - 1);   // "each additional time ... the duration doubles"
const worsen = (diff, steps) => DIFFS[Math.min(DIFFS.length - 1, DIFFS.indexOf(diff) + Math.max(0, steps))];
const diffLabel = (d) => game.i18n.localize(game.wfrp4e.config.difficultyLabels[d] ?? d);
const targetActor = (c) => c.targets.length === 1 ? c.targets[0] : null;   // targets as they were before the roll (the system may clear them)
async function roll(formula) { const r = await new Roll(formula).evaluate(); return r.total; }
async function hitLoc() { return (await game.wfrp4e.tables.rollTable("hitloc"))?.result ?? "body"; }
const locName = (loc) => game.i18n.localize(game.wfrp4e.config.locations[loc] ?? loc);
/** A marker effect with a duration (Entranced, a mind that can't be read again yet). */
function markerEffect(o, name, value, units, text) {
  return { name, img: o.item?.img ?? "icons/svg/aura.svg", description: `<p>${esc(text)}</p>`, duration: { value, units },
    flags: { [MODULE_ID]: { marker: o.key, source: o.actor.uuid } } };
}
/** One of the system's disease symptoms (set up by the core module) as a timed effect. */
function symptomEffect(key, days, source) {
  const src = game.wfrp4e.config.symptomEffects?.[key];
  if (!src) return null;
  const e = foundry.utils.deepClone(src);
  delete e._id;
  e.name = `${game.i18n.localize(e.name ?? key)} (${source})`;
  e.duration = { value: days, units: "days" };
  foundry.utils.setProperty(e, `flags.${MODULE_ID}.marker`, "bloomblightTouch");
  return e;
}

/* Power effects on the actor ------------------------------------------------ */

const powerEffects = (actor, item, key) => actor.effects.filter(e => e.getFlag(MODULE_ID, "power") === key
  && copiesOf(actor, item).some(c => c.id === e.getFlag(MODULE_ID, "item")));

/**
 * Start a power: an actor effect (duration in "rounds" | "minutes" | "hours", or none = until ended
 * with its End button) that switches on the traits it lists.
 */
async function startPower(ctx, { label, value = null, units = "rounds", traits = [], description = "" }) {
  const { actor, item, key } = ctx;
  const ids = copiesOf(actor, item).map(c => c.id);
  const restore = [], create = [];
  for (const t of traits) {
    const granted = actor.items.find(i => i.type === "trait" && baseName(i.name) === t.name && ids.includes(i.getFlag(MODULE_ID, "grantedBy")));
    if (granted) restore.push({ id: granted.id, disabled: !!granted.system.disabled, spec: granted.system.specification?.value ?? null, set: t.spec ?? null });
    else create.push(t);
  }
  const data = {
    name: `${item.name}: ${label}`, img: item.img, description,
    system: { scriptData: [{ label: F("AMUT.Act.EndButton", { name: item.name }), trigger: "manual",
      script: `await game.modules.get("${MODULE_ID}")?.api?.endPower(this.actor, this.effect);`, options: {} }] },
    flags: { [MODULE_ID]: { power: key, item: item.id, restore } }
  };
  if (value) data.duration = { value: Math.max(1, Math.round(value)), units };
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  if (restore.length) await actor.updateEmbeddedDocuments("Item", restore.map(r => ({ _id: r.id, "system.disabled": false,
    ...(r.set != null ? { "system.specification.value": r.set } : {}) })));
  for (const t of create) {
    const src = await fromUuid(`Compendium.wfrp4e-core.items.Item.${CORE_TRAITS[t.name]}`).catch(() => null);
    if (!src) { ctx.gm.push(F("AMUT.Act.NoTrait", { name: t.name })); continue; }
    const itemData = src.toObject(); delete itemData._id;
    itemData.system.disabled = false;
    if (t.spec != null) itemData.system.specification.value = t.spec;
    await actor.createEmbeddedDocuments("Item", [itemData], { fromEffect: effect.id });   // deleted with the effect (warhammer-lib)
  }
  return effect;
}

/** The End button on a power effect. */
export async function endPower(actor, effect) {
  if (!actor || !effect) return;
  await effect.delete();
}

/** Undo what the power switched on (any way the effect goes: End button, expiry, deleted by hand). */
Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
  const key = effect.getFlag?.(MODULE_ID, "power");
  if (!key || userId !== game.user.id || !(effect.parent instanceof Actor)) return;
  const actor = effect.parent;
  const updates = (effect.getFlag(MODULE_ID, "restore") ?? []).filter(r => actor.items.has(r.id))
    .map(r => ({ _id: r.id, "system.disabled": r.disabled, ...(r.set != null ? { "system.specification.value": r.spec } : {}) }));
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  await ChatMessage.create({ content: `<p>${esc(F(options?.expired ? "AMUT.Act.Expired" : "AMUT.Act.Ended", { name: effect.name }))}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
});

/* Applying results to actors ------------------------------------------------- */
/*
 * Results are lists of operations on one actor:
 *   { condition: "fatigued", n } | { removeCondition: "bleeding", n } | { heal: n } | { effect: data }
 *   { damage: n, ignoreAP, loc } (the system's applyBasicDamage, which routes itself to the owner)
 *   { test: { char | skill }, difficulty, title, pass: [ops], fail: [ops], passText, failText }
 * Changes to an actor this user can't update go to the active GM (query "applyOps"). A follow-up
 * Test is rolled by the actor's active player, else the GM (query "rollTest"), like the crits
 * module's "Who rolls" default; its outcome is then applied on that client.
 */
const Q_APPLY = `${MODULE_ID}.applyOps`, Q_TEST = `${MODULE_ID}.rollTest`, Q_OPPOSED = `${MODULE_ID}.opposedResult`;
const TEST_TIMEOUT = 5 * 60 * 1000;
const nameOf = (a) => a?.token?.name ?? a?.prototypeToken?.name ?? a?.name ?? "";

function rollerFor(actor) {
  const owner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return owner ?? game.users.activeGM ?? game.user;
}

/** Apply ops to an actor; returns false if nobody could (no GM connected). */
export async function applyOps(actor, ops, meta = {}) {
  if (!actor || !ops?.length) return true;
  const tests = ops.filter(o => o.test), direct = ops.filter(o => !o.test);
  if (direct.length) {
    if (actor.isOwner) await applyDirect(actor, direct);
    else if (game.users.activeGM) await game.users.activeGM.query(Q_APPLY, { actorUuid: actor.uuid, ops: direct, sourceUuid: meta.sourceUuid });
    else return false;
  }
  for (const op of tests) followUp(actor, op, meta);   // not awaited: the roller may take a while
  return true;
}

async function applyDirect(actor, ops) {
  for (const o of ops) {
    if (o.condition) await actor.addCondition(o.condition, o.n ?? 1);
    else if (o.removeCondition) { if (actor.hasCondition(o.removeCondition)) await actor.removeCondition(o.removeCondition, o.n ?? 1); }
    else if (o.heal) {
      const w = actor.system.status.wounds;
      await actor.update({ "system.status.wounds.value": Math.min(Number(w.max) || 0, (Number(w.value) || 0) + o.heal) });
    }
    else if (o.damage) await actor.applyBasicDamage(o.damage, { damageType: game.wfrp4e.config.DAMAGE_TYPE[o.ignoreAP ? "IGNORE_AP" : "NORMAL"], minimumOne: true, loc: o.loc ?? "body" });
    else if (o.effect) await actor.createEmbeddedDocuments("ActiveEffect", [o.effect]);
  }
}

async function followUp(actor, op, meta) {
  const roller = rollerFor(actor);
  let result = null;
  try {
    if (roller.isSelf) result = await rollFollowUp(actor, op);
    else {
      ui.notifications.info(F("AMUT.Act.Waiting", { user: roller.name, test: describe(op), actor: nameOf(actor) }));
      result = await roller.query(Q_TEST, { actorUuid: actor.uuid, op, sourceUuid: meta.sourceUuid }, { timeout: TEST_TIMEOUT });
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | follow-up Test not rolled by ${roller.name}`, e);
    // The player left before answering: roll it here. Any other error (timeout, an error after the roll) is left to the GM.
    if (/not (currently )?(active|connected)|offline|inactive/i.test(String(e?.message ?? e))) result = await rollFollowUp(actor, op).catch(() => null);
  }
  if (!result) await note(actor, F("AMUT.Act.NotRolled", { test: describe(op), title: op.title ?? "", actor: nameOf(actor) }));
  return result;
}

/** On the roller's client: roll the Test, then apply what its outcome gives. */
async function rollFollowUp(actor, op) {
  // A Test rolled while the actor is still flagged as the defender of the opposed Test that called for it
  // would be taken as a second defence: wait for the system to clear that flag.
  // If it never clears (the system's defence fails part-way when one player defends against another
  // player's Test: it may not update that player's opposed message), clear it here.
  for (let i = 0; i < 15 && actor.isOpposing; i++) await new Promise(r => setTimeout(r, 200));
  if (actor.isOpposing && (op.oppose ?? []).includes(actor.flags.oppose?.opposeMessageId))
    await actor.update({ "flags.oppose": new foundry.data.operators.ForcedDeletion() });
  const context = { skipTargets: true, appendTitle: ` - ${op.title ?? ""}`, fields: { difficulty: op.difficulty ?? "challenging" }, context: {} };
  if (op.passText) context.context.success = `<strong>${esc(op.title)}</strong>: ${esc(op.passText)}`;
  if (op.failText) context.context.failure = `<strong>${esc(op.title)}</strong>: ${esc(op.failText)}`;
  const options = { resolveClose: true };
  let test;
  try {
    test = op.test.char ? await actor.setupCharacteristic(op.test.char, context, options)
      : await actor.setupSkill(op.test.skill.startsWith("NAME.") ? game.i18n.localize(op.test.skill) : op.test.skill, context, options);
  } catch (e) { return null; }
  if (!test) return null;
  await test.roll();
  const ok = !!test.succeeded;
  await applyOps(actor, ok ? op.pass : op.fail, {});
  return { succeeded: ok, SL: test.result?.SL };
}

function describe(op) {
  const what = op.test.char ? game.wfrp4e.config.characteristics[op.test.char] : game.i18n.localize(op.test.skill);
  return `${diffLabel(op.difficulty ?? "challenging")} ${game.i18n.localize(what)}`;
}

function note(actor, text) {
  const whisper = game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);
  return ChatMessage.create({ content: `<p>${esc(text)}</p>`, speaker: ChatMessage.getSpeaker({ actor }), whisper });
}

Hooks.once("init", () => {
  // GM: apply changes a player's power makes to an actor that player can't update.
  CONFIG.queries[Q_APPLY] = async ({ actorUuid, ops, sourceUuid } = {}, { user } = {}) => {
    if (!game.user.isGM) throw new Error("not GM");
    const source = sourceUuid ? await fromUuid(sourceUuid).catch(() => null) : null;
    if (!user?.isGM && !source?.testUserPermission(user, "OWNER")) throw new Error("not the owner of the mutant");   // only a power of a character the player owns
    const doc = await fromUuid(actorUuid).catch(() => null), actor = doc?.actor ?? doc;
    if (!actor) throw new Error("no actor");
    await applyDirect(actor, (ops ?? []).filter(o => !o.test));
    return true;
  };
  // The actor's owner rolls a follow-up Test.
  CONFIG.queries[Q_TEST] = async ({ actorUuid, op } = {}) => {
    const doc = await fromUuid(actorUuid).catch(() => null), actor = doc?.actor ?? doc;
    if (!actor?.isOwner || !op?.test) return null;
    return rollFollowUp(actor, op);
  };
  // GM: resolve an opposed power Test (returns at once; follow-up Tests run on their own).
  CONFIG.queries[Q_OPPOSED] = async (data) => { if (game.user.isGM) resolveOpposed(data); return true; };
});

/* Opposed powers: once the defender has rolled -------------------------------- */

const resolved = new Set();
Hooks.on("wfrp4e:opposedTestResult", (opposedTest, attackerTest, defenderTest) => {
  const msg = attackerTest?.message;
  if (!msg?.getFlag(MODULE_ID, "powerTest")) return;
  const r = opposedTest?.result ?? {};
  // Once per defender: a Fortune reroll or a later Test re-runs the opposed Test.
  const data = { attackerMessageId: msg.id, defenderKey: defenderTest?.actor?.uuid ?? "unopposed",
    defenderUuid: defenderTest?.actor?.uuid, winner: r.winner, differenceSL: Number(r.differenceSL) || 0,
    critical: attackerTest.isCriticalFumble === "critical", opposeIds: [...(attackerTest.context?.opposedMessageIds ?? [])] };
  const gm = game.users.activeGM;
  if (gm && !gm.isSelf) gm.query(Q_OPPOSED, data).catch(e => console.warn(`${MODULE_ID} | opposed power result not sent`, e));
  else resolveOpposed(data);
});

async function resolveOpposed({ attackerMessageId, defenderKey, defenderUuid, winner, differenceSL, critical, opposeIds = [] }) {
  const msg = game.messages.get(attackerMessageId);
  const p = msg?.getFlag(MODULE_ID, "powerTest");
  if (!p || !winner) return;
  const id = `${attackerMessageId}.${defenderKey}`;
  if (resolved.has(id) || (msg.getFlag(MODULE_ID, "powerResolved") ?? []).includes(defenderKey)) return;   // once per defender (a Fortune reroll re-runs the opposed Test)
  resolved.add(id);
  if (msg.isOwner) await msg.setFlag(MODULE_ID, "powerResolved", [...(msg.getFlag(MODULE_ID, "powerResolved") ?? []), defenderKey]);
  const actor = await fromUuid(p.actorUuid).catch(() => null);
  const item = await fromUuid(p.itemUuid).catch(() => null);
  const tdoc = await fromUuid(defenderUuid).catch(() => null), target = tdoc?.actor ?? tdoc;
  if (!actor || !target) return;
  if (!user_owns(msg.author, actor)) return;   // the power card's author must own the mutant
  const power = POWERS[p.key], spec = p.use ? power?.uses?.find(u => u.id === p.use) : power;
  const handler = spec?.opposed === true ? null : spec?.opposed;
  if (!handler) return;
  const o = { actor, item, target, key: p.key, use: p.use, win: winner === "attacker", diff: differenceSL, critical,
    wpb: p.wpb, wp: p.wp, levels: p.levels, lines: [], gm: [], opposeIds };
  await handler(o);
  // The system leaves a player's character flagged as defending when that player defends against another
  // player's Test (it can't update the attacker's opposed message), so its next Test would defend again.
  setTimeout(() => {
    if (target.isOwner && target.isOpposing && opposeIds.includes(target.flags.oppose?.opposeMessageId))
      target.update({ "flags.oppose": new foundry.data.operators.ForcedDeletion() }).catch(() => {});
  }, 4000);
  const head = F(o.win ? "AMUT.Act.OpposedWon" : "AMUT.Act.OpposedLost", { actor: nameOf(actor), target: nameOf(target), sl: differenceSL });
  const content = `<div class="amut-power">
<p><strong>${esc(nameOf(actor))}</strong> &middot; ${esc(item?.name ?? "")}${p.use ? `: ${esc(F(`AMUT.Act.${p.key}.Use.${p.use}`))}` : ""}</p>
<p><em>${esc(head)}</em></p>
${o.lines.map(l => `<p>${esc(l)}</p>`).join("")}
${o.gm.map(l => `<p><strong>${esc(F("AMUT.Act.GMNote"))}</strong> ${esc(l)}</p>`).join("")}</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }), whisper: msg.whisper?.length ? msg.whisper : undefined,
    flags: { [MODULE_ID]: { powerResult: p.key } } });
}
const user_owns = (user, actor) => !!user && (user.isGM || actor.testUserPermission(user, "OWNER"));

/** Apply ops to the mutant's target (or anyone): line on success, a "no GM" note otherwise. */
async function onActor(c, actor, ops, line) {
  if (!actor) return false;
  if (c.opposeIds) ops = ops.map(o => o.test ? { ...o, oppose: c.opposeIds } : o);
  const ok = await applyOps(actor, ops, { sourceUuid: c.actor.uuid });
  if (!ok) c.gm.push(F("AMUT.Act.NoGM"));
  else if (line) c.lines.push(line);
  return ok;
}

/* The powers --------------------------------------------------------------- */

const WP = { char: "wp" };
const END = { skill: "NAME.Endurance" };
const COOL = { skill: "NAME.Cool" };
const morning = (key) => ({ test: COOL, difficulty: "average",
  success: (c) => c.lines.push(F(`AMUT.Act.${key}.Pass`)), failure: (c) => c.lines.push(F(`AMUT.Act.${key}.Fail`)) });

export const POWERS = {
  ethereal: { test: WP, difficulty: "challenging", miscast: "minormis", timed: true,
    success: async (c) => {
      const n = c.wpb + c.sl;
      await startPower(c, { label: F("AMUT.Act.ethereal.Label"), value: n, traits: [{ name: "Ethereal" }] });
      c.lines.push(F("AMUT.Act.ethereal.Success", { n, wpb: c.wpb, sl: c.sl }));
      c.gm.push(F("AMUT.Act.ethereal.GM"));
    } },
  invisibility: { test: WP, difficulty: "challenging", miscast: "minormis", timed: true,
    success: async (c) => {
      const n = doubled(c.wp + c.sl, c.levels);
      await startPower(c, { label: F("AMUT.Act.invisibility.Label"), value: n });
      c.lines.push(F("AMUT.Act.invisibility.Success", { n, wp: c.wp, sl: c.sl, x: 2 ** (c.levels - 1) }));
      c.gm.push(F("AMUT.Act.invisibility.GM"));
    } },
  levitation: { test: WP, difficulty: "challenging", miscast: "minormis", timed: true,
    success: async (c) => {
      const n = doubled(c.wpb + c.sl, c.levels), rating = 30 * c.levels;
      await startPower(c, { label: F("AMUT.Act.levitation.Label"), value: n, traits: [{ name: "Flight", spec: String(rating) }] });
      c.lines.push(F("AMUT.Act.levitation.Success", { n, rating, wpb: c.wpb, sl: c.sl, x: 2 ** (c.levels - 1) }));
    } },
  swarmform: { test: END, difficulty: "challenging", miscast: "minormis", timed: true,
    success: async (c) => {
      let type = c.item.getFlag(MODULE_ID, "swarmType");
      if (!type) {                                  // rolled once, the first time: the swarm is always the same creatures
        const r = await roll("1d100");
        type = SWARM_TYPES.find(([hi]) => r <= hi)[1];
        await c.item.setFlag(MODULE_ID, "swarmType", type);
        c.lines.push(F("AMUT.Act.swarmform.Rolled", { r }));
      }
      await startPower(c, { label: F("AMUT.Act.swarmform.Label"), traits: [{ name: "Swarm" }] });
      c.lines.push(F("AMUT.Act.swarmform.Success", { type: F(`AMUT.Act.swarmform.Type.${type}`) }));
      c.gm.push(F("AMUT.Act.swarmform.GM"));
    } },
  shapeshifter: { test: END, difficulty: "challenging", miscast: "minormis", timed: true,
    success: async (c) => {
      const n = c.tb + c.sl;
      await startPower(c, { label: F("AMUT.Act.shapeshifter.Label"), value: n, units: "hours" });
      c.lines.push(F("AMUT.Act.shapeshifter.Success", { n, tb: c.tb, sl: c.sl }));
      c.gm.push(F("AMUT.Act.shapeshifter.GM"));
    } },
  werebeast: { test: WP, difficulty: "challenging", miscast: "minormis",
    prepare: async (c) => {
      const active = powerEffects(c.actor, c.item, "werebeast")[0];
      const lunacy = c.actor.items.contents.flatMap(i => i.effects?.contents ?? []).find(e => !e.disabled && e.getFlag(MODULE_ID, "phase"))?.getFlag(MODULE_ID, "phase");
      const r = await askWerebeast(c.item.name, active ? "back" : "turn", lunacy === "absent" ? "day" : (lunacy ?? "day"));
      if (!r) return false;
      Object.assign(c, r, { active });
      c.modifier = WEREBEAST_MOD[r.phase] * (r.dir === "turn" ? 1 : -1);
    },
    success: async (c) => {
      if (c.dir === "back") {
        for (const e of powerEffects(c.actor, c.item, "werebeast")) await e.delete();
        return c.lines.push(F("AMUT.Act.werebeast.Back"));
      }
      if (!c.active) await startPower(c, { label: F("AMUT.Act.werebeast.Label") });
      c.lines.push(F("AMUT.Act.werebeast.Success"));
      c.gm.push(F("AMUT.Act.werebeast.GM"));
    },
    failure: (c) => c.lines.push(F(c.dir === "back" ? "AMUT.Act.werebeast.FailBack" : "AMUT.Act.werebeast.Fail")) },
  mirrorImage: { test: WP, difficulty: "challenging", miscast: "minormis", timed: true,
    success: async (c) => {
      const n = doubled(c.wp + c.sl * 10, c.levels);
      await startPower(c, { label: F("AMUT.Act.mirrorImage.Label"), value: n, units: "minutes" });
      c.lines.push(F("AMUT.Act.mirrorImage.Success", { n, wp: c.wp, sl: c.sl, x: 2 ** (c.levels - 1) }));
      c.gm.push(F("AMUT.Act.mirrorImage.GM"));
    } },
  phantasmalMind: { uses: [
    { id: "create", test: WP, difficulty: "challenging", miscast: "minormis", timed: true,
      success: async (c) => {
        const n = c.wp + c.sl * 10;
        await startPower(c, { label: F("AMUT.Act.phantasmalMind.Label"), value: n, units: "minutes" });
        c.lines.push(F("AMUT.Act.phantasmalMind.Success", { n, wp: c.wp, sl: c.sl }));
        c.gm.push(F("AMUT.Act.phantasmalMind.GM"));
      } },
    { id: "animate", test: WP, difficulty: "hard", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.phantasmalMind.Animated")) }] },
  temporalInstability: { test: WP, difficulty: "challenging", miscast: "majormis",
    success: async (c) => {
      c.lines.push(F("AMUT.Act.temporalInstability.Success"));
      const r = await roll("1d10");
      if (r < 10) return c.lines.push(F("AMUT.Act.temporalInstability.NoAge", { r }));
      const age = Number(c.actor.system.details?.age?.value);
      if (Number.isFinite(age) && String(c.actor.system.details.age.value).trim() !== "") {
        await c.actor.update({ "system.details.age.value": String(age + 1) });
        c.lines.push(F("AMUT.Act.temporalInstability.Aged", { r, age: age + 1 }));
      } else c.lines.push(F("AMUT.Act.temporalInstability.AgedManual", { r }));
    } },
  dimensionalInstability: { test: WP, difficulty: "average", miscast: "minormis",
    prepare: async (c) => {
      const used = Number(c.item.getFlag(MODULE_ID, "uses.dimensionalInstability")) || 0;
      const passengers = await askNumber(c.item.name, F("AMUT.Act.dimensionalInstability.Ask", { used }));
      if (passengers == null) return false;
      Object.assign(c, { used, passengers });
      c.difficulty = worsen("average", used + passengers);
      if (DIFFS.indexOf("average") + used + passengers > DIFFS.length - 1) c.gm.push(F("AMUT.Act.dimensionalInstability.Capped"));
    },
    success: async (c) => {
      await c.item.setFlag(MODULE_ID, "uses.dimensionalInstability", c.used + 1);
      c.lines.push(F("AMUT.Act.dimensionalInstability.Success", { yards: c.wp, n: c.passengers, sl: c.sl }));
      if (c.passengers > c.sl) c.gm.push(F("AMUT.Act.dimensionalInstability.TooMany", { n: c.passengers, sl: c.sl }));
    } },
  telekinesis: { uses: [
    { id: "move", test: WP, difficulty: "average", miscast: "minormis",
      success: async (c) => {
        await startPower(c, { label: F("AMUT.Act.telekinesis.Label"), value: c.wp });
        c.lines.push(F("AMUT.Act.telekinesis.Move", { yards: c.wpb, n: c.wp }));
      } },
    { id: "hurl", test: WP, difficulty: "challenging", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.telekinesis.Hurl", { wpb: c.wpb })) }] },
  pyrokinesis: { uses: [
    { id: "ignite", test: WP, difficulty: "average", miscast: "minormis",
      success: async (c) => {
        c.lines.push(F("AMUT.Act.pyrokinesis.Ignite", { yards: c.wp }));
        for (const t of c.targets) await onActor(c, t, [{ condition: "ablaze" }], F("AMUT.Act.pyrokinesis.Ablaze", { target: nameOf(t) }));
      } },
    { id: "blast", test: WP, difficulty: "challenging", miscast: "minormis",
      success: async (c) => {
        const dmg = c.wpb + c.sl;
        c.lines.push(F(c.targets.length ? "AMUT.Act.pyrokinesis.BlastAt" : "AMUT.Act.pyrokinesis.Blast", { dmg, wpb: c.wpb, sl: c.sl, yards: c.wpb }));
        for (const t of c.targets) {
          const loc = await hitLoc();
          await onActor(c, t, [{ damage: dmg, loc }, { test: END, difficulty: "average", title: c.item.name,
            failText: F("AMUT.Act.pyrokinesis.FailText"), fail: [{ condition: "ablaze" }] }],
            F("AMUT.Act.pyrokinesis.BlastHit", { target: nameOf(t), dmg, loc: locName(loc) }));
        }
      } }] },
  greenSovereign: { uses: [
    { id: "small", test: WP, difficulty: "average", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.greenSovereign.Small", { yards: c.wp })) },
    { id: "strike", test: WP, difficulty: "challenging", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.greenSovereign.Strike", { wpb: c.wpb })) }] },
  windCaller: { uses: [
    { id: "small", test: WP, difficulty: "average", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.windCaller.Small", { yards: c.wp })) },
    { id: "gust", test: WP, difficulty: "challenging", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.windCaller.Gust", { wpb: c.wpb })) }] },
  thunderhead: { uses: [
    { id: "shock", test: WP, difficulty: "challenging", miscast: "minormis",
      opposed: async (o) => {
        if (!o.win) return o.lines.push(F("AMUT.Act.thunderhead.ShockLost", { target: nameOf(o.target) }));
        await onActor(o, o.target, [{ condition: "stunned" }], F("AMUT.Act.thunderhead.ShockWon", { target: nameOf(o.target) }));
      },
      after: (c) => c.lines.push(F(c.targets.length ? "AMUT.Act.thunderhead.ShockTouch" : "AMUT.Act.thunderhead.Shock")) },
    { id: "bolt", test: WP, difficulty: "challenging", miscast: "minormis",
      success: async (c) => {
        const dmg = c.wpb + c.sl, target = targetActor(c);
        if (!target) {
          c.lines.push(F("AMUT.Act.thunderhead.Bolt", { dmg, wpb: c.wpb, sl: c.sl, yards: c.wpb }));
          return c.gm.push(F("AMUT.Act.thunderhead.BoltGM"));
        }
        const loc = await hitLoc();
        const ap = (target.system.status.armour?.[loc]?.layers ?? []).filter(l => !l.metal).reduce((t, l) => t + (Number(l.value) || 0), 0);
        await onActor(c, target, [{ damage: Math.max(1, dmg - ap), ignoreAP: true, loc }, { condition: "blinded" }],
          F("AMUT.Act.thunderhead.BoltHit", { dmg, wpb: c.wpb, sl: c.sl, target: nameOf(target), loc: locName(loc), ap }));
      } }] },
  telepathy: { uses: [
    { id: "project", test: WP, difficulty: "average", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.telepathy.Project", { yards: c.wp })) },
    { id: "pluck", test: WP, difficulty: "challenging", miscast: "minormis",
      opposed: async (o) => {
        if (o.win) return o.lines.push(F(o.diff >= 2 ? "AMUT.Act.telepathy.Unnoticed" : "AMUT.Act.telepathy.Noticed", { target: nameOf(o.target), sl: o.diff }));
        await onActor(o, o.actor, [{ effect: markerEffect(o, F("AMUT.Act.telepathy.Effect", { target: nameOf(o.target) }), 8, "hours",
          F("AMUT.Act.telepathy.EffectText", { target: nameOf(o.target) })) }], F("AMUT.Act.telepathy.Lost", { target: nameOf(o.target) }));
      },
      after: (c) => c.lines.push(F("AMUT.Act.telepathy.Pluck")) }] },
  lifeLeech: { test: WP, difficulty: "challenging", miscast: "minormis",
    success: async (c) => {
      const dmg = Math.max(0, c.sl) + (c.levels - 1);
      const target = targetActor(c);
      if (!target) {                                // an object: SL Armour Point reduction, healed in full
        await applyDirect(c.actor, [{ heal: dmg }]);
        return c.lines.push(F("AMUT.Act.lifeLeech.Object", { dmg }));
      }
      // As the system applies it: Toughness Bonus off, at least 1 Wound for a hit that does damage.
      const tb = Number(target.system.characteristics.t.bonus) || 0;
      const dealt = dmg > 0 ? Math.min(Number(target.system.status.wounds.value) || 0, Math.max(1, dmg - tb)) : 0;
      if (dmg > 0) await target.applyBasicDamage(dmg, { damageType: game.wfrp4e.config.DAMAGE_TYPE.IGNORE_AP, minimumOne: true });
      if (dealt) await applyDirect(c.actor, [{ heal: dealt }]);
      c.lines.push(F("AMUT.Act.lifeLeech.Creature", { dmg, dealt, target: target.prototypeToken?.name ?? target.name }));
      c.gm.push(F("AMUT.Act.lifeLeech.GM"));
    } },
  bloomblightTouch: { test: WP, difficulty: "challenging",
    success: async (c) => {
      const n = c.fel + c.sl, target = targetActor(c);
      const r = await roll("1d100"), days = await roll("1d10");
      const key = BLOOM_SYMPTOMS.find(([hi]) => r <= hi)[1], symptom = F(`AMUT.Act.bloomblightTouch.Symptom.${key}`);
      if (!target) {
        c.lines.push(F("AMUT.Act.bloomblightTouch.Heal", { n, fel: c.fel, sl: c.sl }));
        return c.gm.push(F("AMUT.Act.bloomblightTouch.GM", { r, symptom, days }));
      }
      const effect = symptomEffect(key, days, c.item.name);
      const fail = effect ? [{ effect }] : [];
      const failText = F("AMUT.Act.bloomblightTouch.FailText", { symptom, days });
      const ok = await onActor(c, target, [{ heal: n }, { test: END, difficulty: "challenging", title: c.item.name, failText, fail }],
        F("AMUT.Act.bloomblightTouch.Healed", { n, fel: c.fel, sl: c.sl, target: nameOf(target) }));
      if (ok) c.lines.push(F("AMUT.Act.bloomblightTouch.Test", { target: nameOf(target), symptom, days, r }));
      if (ok && !effect) c.gm.push(F("AMUT.Act.bloomblightTouch.NoSymptom", { symptom, days }));
    } },
  evilEye: { test: WP, difficulty: "challenging", opposed: async (o) => {
      if (!o.win) return onActor(o, o.actor, [{ condition: "stunned" }], F("AMUT.Act.evilEye.Lost", { actor: nameOf(o.actor) }));
      await onActor(o, o.target, [{ condition: "fatigued" }, { test: END, difficulty: "hard", title: o.item?.name,
        failText: F("AMUT.Act.evilEye.FailText"), fail: [{ condition: "prone" }] }], F("AMUT.Act.evilEye.Won", { target: nameOf(o.target) }));
    },
    after: (c) => { if (!c.targets.length) c.gm.push(F("AMUT.Act.evilEye.GM")); } },
  entrancement: { test: WP, difficulty: "challenging", opposed: async (o) => {
      if (!o.win) return o.lines.push(F("AMUT.Act.entrancement.Lost", { target: nameOf(o.target) }));
      const n = Math.max(1, o.wpb + o.diff);
      await onActor(o, o.target, [{ effect: markerEffect(o, F("AMUT.Act.entrancement.Effect", { actor: nameOf(o.actor) }), n, "hours",
        F("AMUT.Act.entrancement.EffectText", { actor: nameOf(o.actor) })) }],
        F("AMUT.Act.entrancement.Won", { target: nameOf(o.target), n, wpb: o.wpb, sl: o.diff }));
      if (o.critical) o.lines.push(F("AMUT.Act.entrancement.Critical", { target: nameOf(o.target) }));
      o.lines.push(F("AMUT.Act.entrancement.Max", { max: o.wpb }));
    },
    after: (c) => { if (!c.targets.length) c.gm.push(F("AMUT.Act.entrancement.GM", { wpb: c.wpb, max: c.wpb })); } },
  beastAlpha: { test: WP, difficulty: "challenging", opposed: async (o) => {
      o.lines.push(F(o.win ? "AMUT.Act.beastAlpha.Won" : "AMUT.Act.beastAlpha.Lost", { target: nameOf(o.target) }));
    },
    after: (c) => c.lines.push(F("AMUT.Act.beastAlpha.Rules")) },
  fleshcrafter: { uses: [
    { id: "cosmetic", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "challenging", success: (c) => c.gm.push(F("AMUT.Act.fleshcrafter.Cosmetic")) },
    { id: "drastic", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "difficult", success: (c) => c.gm.push(F("AMUT.Act.fleshcrafter.Drastic", { sl: Math.max(0, c.sl) })) },
    { id: "bone", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "hard", success: (c) => c.gm.push(F("AMUT.Act.fleshcrafter.Bone")) },
    { id: "bleeding", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "challenging",
      success: async (c) => {
        const target = targetActor(c) ?? c.actor, n = Math.max(0, c.sl);
        if (!n) return c.lines.push(F("AMUT.Act.fleshcrafter.NoSL"));
        await onActor(c, target, [{ removeCondition: "bleeding", n }], F("AMUT.Act.fleshcrafter.Bleeding", { n, target: nameOf(target) }));
      } }],
    fumble: (c) => c.gm.push(F("AMUT.Act.fleshcrafter.Fumble")) },
  chameleonSkin: { test: COOL, difficulty: "average",
    success: (c) => c.lines.push(F("AMUT.Act.chameleonSkin.Pass")), failure: (c) => c.lines.push(F("AMUT.Act.chameleonSkin.Fail")) },
  splittingHeadaches: { test: COOL, difficulty: "average",
    success: (c) => c.lines.push(F("AMUT.Act.splittingHeadaches.Pass")),
    failure: async (c) => { await c.actor.addCondition("stunned"); c.lines.push(F("AMUT.Act.splittingHeadaches.Fail")); } },
  possessed: { test: WP, difficulty: "average",
    prepare: (c) => { c.difficulty = worsen("average", c.levels - 1); },
    success: (c) => c.lines.push(F("AMUT.Act.possessed.Pass")),
    failure: (c) => {
      const unit = F(`AMUT.Act.possessed.Unit.${Math.min(3, c.levels)}`);
      c.lines.push(F("AMUT.Act.possessed.Fail", { n: Math.max(1, Math.abs(c.sl)), unit }));
    } },
  chosenOne: morning("chosenOne"), falseWizard: morning("falseWizard"), doomProphet: morning("doomProphet"),
  metamorphosis: morning("metamorphosis"), rebelliousMind: morning("rebelliousMind"), saintOfTheDamned: morning("saintOfTheDamned")
};

// Swarmform creature table (upper bound of the 1d100 range, key).
const SWARM_TYPES = [[13, "amphibian"], [26, "arthropod"], [39, "bird"], [49, "fish"], [62, "insect"], [75, "lizard"], [85, "mollusca"], [100, "rodent"]];
const BLOOM_SYMPTOMS = [[20, "buboes"], [40, "fever"], [60, "flux"], [80, "nausea"], [100, "pox"]];
// Werebeast: modifier to turn bestial (changing back is the opposite).
const WEREBEAST_MOD = { day: -20, small: -10, large: 10, full: 20 };

/* Running a power ------------------------------------------------------------ */

export async function activatePower(actor, item, key) {
  const power = POWERS[key];
  if (!actor || !item || !power) return;
  if (!actor.isOwner) return ui.notifications.error(F("AMUT.Act.NotOwner"));
  let spec = power;
  if (power.uses) {
    const id = await askUse(item.name, key, power.uses);
    spec = power.uses.find(u => u.id === id);
    if (!spec) return;
  }
  const levels = copiesOf(actor, item).length;
  if (spec.timed && powerEffects(actor, item, key).length) return ui.notifications.info(F("AMUT.Act.Active", { name: item.name }));
  const wp = ch(actor, "wp");
  const c = { actor, item, key, use: spec.id ?? null, levels, difficulty: spec.difficulty, modifier: 0, lines: [], gm: [],
    wp: Number(wp.value) || 0, wpb: Number(wp.bonus) || 0, tb: Number(ch(actor, "t").bonus) || 0, fel: Number(ch(actor, "fel").value) || 0 };
  c.targets = [...game.user.targets].map(t => t.actor).filter(Boolean);
  if (power.prepare && (await power.prepare(c)) === false) return;
  if (spec !== power && spec.prepare && (await spec.prepare(c)) === false) return;

  const title = ` - ${item.name}${spec.id ? `: ${F(`AMUT.Act.${key}.Use.${spec.id}`)}` : ""}`;
  const context = { fields: { difficulty: c.difficulty, ...(c.modifier ? { modifier: c.modifier } : {}) }, appendTitle: title, skipTargets: !spec.opposed };
  let test;
  try {
    test = spec.test.char ? await actor.setupCharacteristic(spec.test.char, context)
      : await actor.setupSkill(spec.test.skill.startsWith("NAME.") ? game.i18n.localize(spec.test.skill) : spec.test.skill, context);
  } catch (e) { return; }                    // dialog closed
  if (!test) return;
  await test.roll();
  c.test = test;
  c.sl = parseInt(test.result?.SL) || 0;
  c.fumble = test.isCriticalFumble === "fumble";
  const miscast = spec.miscast ?? power.miscast;
  if (c.fumble && miscast) await rollMiscast(actor, miscast);
  if (c.fumble) await (spec.fumble ?? power.fumble)?.(c);
  const handler = test.succeeded ? (spec.success ?? power.success) : (spec.failure ?? power.failure);
  if (spec.opposed && c.targets.length) {
    c.lines.push(F("AMUT.Act.Opposed", { target: c.targets.map(nameOf).join(", ") }));
    await test.message?.setFlag(MODULE_ID, "powerTest", { key, use: c.use, actorUuid: actor.uuid, itemUuid: item.uuid, wpb: c.wpb, wp: c.wp, levels: c.levels });
  }
  else if (!test.succeeded && !handler) c.lines.push(F("AMUT.Act.Failed"));
  await handler?.(c);
  await (spec.after ?? power.after)?.(c);
  await card(c, test);
}

/** Dimensional Instability: 8 hours of rest, the Difficulty goes back to Average. */
export async function resetPower(actor, item, key) {
  if (!actor || !item) return;
  await item.unsetFlag(MODULE_ID, `uses.${key}`);
  await ChatMessage.create({ content: `<p><strong>${esc(actor.name)}</strong>: ${esc(F("AMUT.Act.Rested", { name: item.name }))}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
}

async function rollMiscast(actor, table) {
  try {
    const html = await game.wfrp4e.tables.formatChatRoll(table);
    if (html) return ChatMessage.create({ content: html, speaker: ChatMessage.getSpeaker({ actor }) });
  } catch (e) { console.warn(`${MODULE_ID} | Miscast roll failed`, e); }
  return ChatMessage.create({ content: `<p>@Table[${table}]</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
}

async function card(c, test) {
  const result = test.succeeded ? F("AMUT.Act.Passed", { sl: test.result.SL, diff: diffLabel(c.difficulty) })
    : F("AMUT.Act.FailedTest", { sl: test.result.SL, diff: diffLabel(c.difficulty) });
  const use = c.use ? `: ${F(`AMUT.Act.${c.key}.Use.${c.use}`)}` : "";
  const content = `<div class="amut-power">
<p><strong>${esc(c.actor.prototypeToken?.name ?? c.actor.name)}</strong> &middot; ${esc(c.item.name)}${esc(use)}</p>
<p><em>${esc(result)}${c.fumble ? ` ${esc(F("AMUT.Act.Fumble"))}` : ""}${c.modifier ? ` (${c.modifier > 0 ? "+" : ""}${c.modifier})` : ""}</em></p>
${c.lines.map(l => `<p>${esc(l)}</p>`).join("")}
${c.gm.map(l => `<p><strong>${esc(F("AMUT.Act.GMNote"))}</strong> ${esc(l)}</p>`).join("")}</div>`;
  return ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: c.actor }), flags: { [MODULE_ID]: { power: c.key, use: c.use } } });
}

/* Dialogs ------------------------------------------------------------------------ */

const DialogV2 = () => foundry.applications.api.DialogV2;
const ok = () => game.i18n.localize("AMUT.Grant.Ok");

function askUse(title, key, uses) {
  const content = `<div style="display:flex;flex-direction:column;gap:4px">${uses.map((u, i) =>
    `<label><input type="radio" name="use" value="${u.id}" ${i ? "" : "checked"}> ${esc(F(`AMUT.Act.${key}.Use.${u.id}`))} (${esc(diffLabel(u.difficulty))}${u.opposed ? `, ${esc(F("AMUT.Act.OpposedShort"))}` : ""})</label>`).join("")}</div>`;
  return DialogV2().wait({ window: { title }, content, rejectClose: false,
    buttons: [{ action: "ok", label: ok(), default: true, callback: (e, b) => b.form.querySelector('input[name="use"]:checked')?.value ?? null },
      { action: "cancel", label: game.i18n.localize("Cancel"), callback: () => null }] });
}

function askNumber(title, text) {
  return DialogV2().wait({ window: { title }, content: `<p>${esc(text)}</p><input type="number" name="n" value="0" min="0" step="1">`, rejectClose: false,
    buttons: [{ action: "ok", label: ok(), default: true, callback: (e, b) => Math.max(0, parseInt(b.form.elements.n.value) || 0) },
      { action: "cancel", label: game.i18n.localize("Cancel"), callback: () => null }] });
}

function askWerebeast(title, dir, phase) {
  const radio = (name, value, cur, key) => `<label><input type="radio" name="${name}" value="${value}" ${value === cur ? "checked" : ""}> ${esc(F(key))}</label>`;
  const content = `<p>${esc(F("AMUT.Act.werebeast.AskDir"))}</p><div style="display:flex;gap:12px">
${radio("dir", "turn", dir, "AMUT.Act.werebeast.Turn")}${radio("dir", "back", dir, "AMUT.Act.werebeast.ChangeBack")}</div>
<p>${esc(F("AMUT.Act.werebeast.AskPhase"))}</p><div style="display:flex;flex-direction:column;gap:4px">
${Object.keys(WEREBEAST_MOD).map(p => radio("phase", p, phase, `AMUT.Act.werebeast.Phase.${p}`)).join("")}</div>`;
  return DialogV2().wait({ window: { title }, content, rejectClose: false,
    buttons: [{ action: "ok", label: ok(), default: true, callback: (e, b) => ({
      dir: b.form.querySelector('input[name="dir"]:checked')?.value ?? "turn", phase: b.form.querySelector('input[name="phase"]:checked')?.value ?? "day" }) },
      { action: "cancel", label: game.i18n.localize("Cancel"), callback: () => null }] });
}
