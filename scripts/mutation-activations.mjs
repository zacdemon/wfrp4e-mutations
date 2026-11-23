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
 * roll against the targeted token through the system's opposed Test; the winner is only known once
 * the defender rolls, so their outcome is a GM note.
 */
const MODULE_ID = "artantares-mutations";
const SOCKET = `module.${MODULE_ID}`;
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

/* Targets the user cannot update: the active GM applies it ----------------- */

async function onTarget(ctx, target, action, data) {
  if (!target) return false;
  if (target.isOwner) { await TARGET_ACTIONS[action](target, data); return true; }
  if (!game.users.activeGM) { ctx.gm.push(F("AMUT.Act.NoGM")); return false; }
  game.socket.emit(SOCKET, { action: "powerTarget", op: action, targetUuid: target.uuid, actorUuid: ctx.actor.uuid, data, userId: game.user.id });
  return true;
}
const TARGET_ACTIONS = {
  heal: async (actor, { n }) => {
    const w = actor.system.status.wounds;
    await actor.update({ "system.status.wounds.value": Math.min(Number(w.max) || 0, (Number(w.value) || 0) + n) });
  },
  removeCondition: async (actor, { id, n }) => { if (actor.hasCondition(id)) await actor.removeCondition(id, n); }
};
Hooks.once("ready", () => {
  game.socket.on(SOCKET, async (msg) => {
    if (msg?.action !== "powerTarget" || !game.users.activeGM?.isSelf || !TARGET_ACTIONS[msg.op]) return;
    const user = game.users.get(msg.userId);
    const source = await fromUuid(msg.actorUuid).catch(() => null);
    if (!user || !source?.testUserPermission(user, "OWNER")) return;   // only for a power of a character the player owns
    const target = await fromUuid(msg.targetUuid).catch(() => null);
    if (target) await TARGET_ACTIONS[msg.op](target.actor ?? target, msg.data ?? {});
  });
});

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
      success: (c) => c.lines.push(F("AMUT.Act.pyrokinesis.Ignite", { yards: c.wp })) },
    { id: "blast", test: WP, difficulty: "challenging", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.pyrokinesis.Blast", { dmg: c.wpb + c.sl, wpb: c.wpb, sl: c.sl, yards: c.wpb })) }] },
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
    { id: "shock", test: WP, difficulty: "challenging", opposed: true, miscast: "minormis",
      after: (c) => c.gm.push(F("AMUT.Act.thunderhead.Shock")) },
    { id: "bolt", test: WP, difficulty: "challenging", miscast: "minormis",
      success: (c) => {
        c.lines.push(F("AMUT.Act.thunderhead.Bolt", { dmg: c.wpb + c.sl, wpb: c.wpb, sl: c.sl, yards: c.wpb }));
        c.gm.push(F("AMUT.Act.thunderhead.BoltGM"));
      } }] },
  telepathy: { uses: [
    { id: "project", test: WP, difficulty: "average", miscast: "minormis",
      success: (c) => c.lines.push(F("AMUT.Act.telepathy.Project", { yards: c.wp })) },
    { id: "pluck", test: WP, difficulty: "challenging", opposed: true, miscast: "minormis",
      after: (c) => c.gm.push(F("AMUT.Act.telepathy.Pluck")) }] },
  lifeLeech: { test: WP, difficulty: "challenging", miscast: "minormis",
    success: async (c) => {
      const dmg = Math.max(0, c.sl) + (c.levels - 1);
      const target = targetActor(c);
      if (!target) {                                // an object: SL Armour Point reduction, healed in full
        await TARGET_ACTIONS.heal(c.actor, { n: dmg });
        return c.lines.push(F("AMUT.Act.lifeLeech.Object", { dmg }));
      }
      // As the system applies it: Toughness Bonus off, at least 1 Wound for a hit that does damage.
      const tb = Number(target.system.characteristics.t.bonus) || 0;
      const dealt = dmg > 0 ? Math.min(Number(target.system.status.wounds.value) || 0, Math.max(1, dmg - tb)) : 0;
      if (dmg > 0) await target.applyBasicDamage(dmg, { damageType: game.wfrp4e.config.DAMAGE_TYPE.IGNORE_AP, minimumOne: true });
      await TARGET_ACTIONS.heal(c.actor, { n: dealt });
      c.lines.push(F("AMUT.Act.lifeLeech.Creature", { dmg, dealt, target: target.prototypeToken?.name ?? target.name }));
      c.gm.push(F("AMUT.Act.lifeLeech.GM"));
    } },
  bloomblightTouch: { test: WP, difficulty: "challenging",
    success: async (c) => {
      const n = c.fel + c.sl, target = targetActor(c);
      const r = await roll("1d100"), days = await roll("1d10");
      const symptom = F(`AMUT.Act.bloomblightTouch.Symptom.${BLOOM_SYMPTOMS.find(([hi]) => r <= hi)[1]}`);
      if (await onTarget(c, target, "heal", { n })) c.lines.push(F("AMUT.Act.bloomblightTouch.Healed", { n, fel: c.fel, sl: c.sl, target: target.prototypeToken?.name ?? target.name }));
      else c.lines.push(F("AMUT.Act.bloomblightTouch.Heal", { n, fel: c.fel, sl: c.sl }));
      c.gm.push(F("AMUT.Act.bloomblightTouch.GM", { r, symptom, days }));
    } },
  evilEye: { test: WP, difficulty: "challenging", opposed: true,
    after: (c) => c.gm.push(F("AMUT.Act.evilEye.GM")) },
  entrancement: { test: WP, difficulty: "challenging", opposed: true,
    after: (c) => c.gm.push(F("AMUT.Act.entrancement.GM", { wpb: c.wpb, max: c.wpb })) },
  beastAlpha: { test: WP, difficulty: "challenging", opposed: true,
    after: (c) => c.gm.push(F("AMUT.Act.beastAlpha.GM")) },
  fleshcrafter: { uses: [
    { id: "cosmetic", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "challenging", success: (c) => c.gm.push(F("AMUT.Act.fleshcrafter.Cosmetic")) },
    { id: "drastic", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "difficult", success: (c) => c.gm.push(F("AMUT.Act.fleshcrafter.Drastic", { sl: Math.max(0, c.sl) })) },
    { id: "bone", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "hard", success: (c) => c.gm.push(F("AMUT.Act.fleshcrafter.Bone")) },
    { id: "bleeding", test: { skill: "Trade (Fleshcrafter)" }, difficulty: "challenging",
      success: async (c) => {
        const target = targetActor(c) ?? c.actor, n = Math.max(0, c.sl), name = target.prototypeToken?.name ?? target.name;
        if (!n) return c.lines.push(F("AMUT.Act.fleshcrafter.NoSL"));
        if (await onTarget(c, target, "removeCondition", { id: "bleeding", n })) c.lines.push(F("AMUT.Act.fleshcrafter.Bleeding", { n, target: name }));
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
  if (spec.opposed && c.targets.length) c.lines.push(F("AMUT.Act.Opposed"));
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
