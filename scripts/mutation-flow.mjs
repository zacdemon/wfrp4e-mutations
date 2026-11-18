/**
 * Antares | Mutant's Handbook - handbook Corruption -> mutation flow.
 *
 * Rules follow "The Mutant's Handbook" v1.1 (Anders Hellspong). Page refs are the printed pages.
 *
 * Hook points
 *  - TestWFRP.prototype.handleMutationResult  (failed Dissolution of Body and Mind test, system p183 / handbook p8)
 *  - game.wfrp4e.tables.formatChatRoll        (keys corruption, mutatephys, mutatemental: /table and @Table links)
 * Both use libWrapper when it is active and fall back to patching otherwise. With the world setting
 * "Use Mutant's Handbook rules" off, both pass straight through to the system.
 */
import { MutationMessages } from "./mutation-messages.mjs";

const MODULE_ID = "artantares-mutations";
const PACK_TABLES = `${MODULE_ID}.rolltables`;
const SOCKET = `module.${MODULE_ID}`;
const TEMPLATE_FLAG = "card";

const GODS = ["khorne", "nurgle", "slaanesh", "tzeentch"];
const GOD_PAGES = { khorne: 74, nurgle: 75, slaanesh: 75, tzeentch: 76 };
const SEVERITIES = ["trivial", "minor", "major"];
const TABLE_PAGES = {
  "trivial-physical": 14, "minor-physical": 15, "major-physical": 16,
  "trivial-mental": 17, "minor-mental": 17, "major-mental": 18
};
const SYSTEM_KEYS = ["corruption", "mutatephys", "mutatemental"];

// Sub-tables an item can point at with @Table[key]; rolled automatically and recorded on the item.
const VARIANT_KEYS = ["bestial-body", "unnatural-body", "protective-skin", "addiction", "fright", "tail",
  "corrupted-blood", "contagious-madness", "immunity", "crossbreed", "vulnerability", "wings"];

// Handbook species table (p8, repeated p14). Value = highest d100 result that is Physical.
const SPECIES_PHYSICAL = { dwarf: 5, elf: 0, halfling: 0, human: 50, gnome: 50, ogre: 10 };

// God-table footnote sub-rolls (p74-76). Each array entry is one die face; a face with several
// names is "X or Y" where the module has separate entries, and one of them is picked at random.
const GOD_FOOTNOTES = {
  khorne: {
    "bestial-body": [["Primate"], ["Bear"], ["Swine"], ["Bovine"], ["Canine"], ["Caprine"]],
    "protective-skin": [["Leathery Hide"], ["Leathery Hide"], ["Fur"], ["Fur"], ["Metal Plating"], ["Metal Plating"]],
    "unnatural-body": [["Daemonic"], ["Daemonic"], ["Mechanoid"], ["Mechanoid"], ["Metal"], ["Metal"]],
    "addiction": [["Destruction"], ["Destruction"], ["Drugs"], ["Drugs"], ["Pain"], ["Pain"]]
  },
  nurgle: {
    "bestial-body": [["Primate"], ["Bear"], ["Swine"], ["Bovine"], ["Cervid"], ["Caprine"], ["Horse or Camel"], ["Insect"], ["Pachyderm"], ["Spider"]],
    "unnatural-body": [["Daemonic"], ["Daemonic"], ["Fenbeast"], ["Fenbeast"], ["Undead"], ["Undead"]],
    "addiction": [["Devotion"], ["Devotion"], ["Gluttony"], ["Gluttony"], ["Service"], ["Service"]],
    "corrupted-blood": "misprint"
  },
  slaanesh: {
    "bestial-body": [["Amphibian"], ["Arthropods"], ["Fish"], ["Feline"], ["Lizard", "Snake"], ["Mollusks"]],
    "protective-skin": [["Rubbery Skin"], ["Rubbery Skin"], ["Scales"], ["Scales"], ["Carapace"], ["Carapace"]],
    "unnatural-body": [["Daemonic"], ["Daemonic"], ["Daemonic"], ["Metal"], ["Metal"], ["Metal"]],
    "addiction": [["Art"], ["Art"], ["Lust"], ["Lust"], ["Pain"], ["Pain"]]
  },
  tzeentch: {
    "bestial-body": [["Bat"], ["Bird"], ["Fish"], ["Insect"], ["Mollusks"], ["Spider"]],
    "unnatural-body": [["Daemonic"], ["Daemonic"], ["Daemonic"], ["Mechanoid"], ["Mechanoid"], ["Mechanoid"]],
    "addiction": [["Gambling"], ["Gambling"], ["Greed"], ["Greed"], ["Theft"], ["Theft"]]
  }
};

const L = (key, data) => data ? game.i18n.format(`AMUT.${key}`, data) : game.i18n.localize(`AMUT.${key}`);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const setting = (key) => game.settings.get(MODULE_ID, key);
const stripHTML = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, "$1").replace(/\s+/g, " ").trim();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "useHandbook", {
    name: "AMUT.Settings.UseHandbook.Name", hint: "AMUT.Settings.UseHandbook.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "keepingItRandom", {
    name: "AMUT.Settings.KeepingItRandom.Name", hint: "AMUT.Settings.KeepingItRandom.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "letThemOff", {
    name: "AMUT.Settings.LetThemOff.Name", hint: "AMUT.Settings.LetThemOff.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "promptSource", {
    name: "AMUT.Settings.PromptSource.Name", hint: "AMUT.Settings.PromptSource.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "speciesFallback", {
    name: "AMUT.Settings.SpeciesFallback.Name", hint: "AMUT.Settings.SpeciesFallback.Hint",
    scope: "world", config: true, type: String, default: "human",
    choices: {
      human: "AMUT.Species.human", dwarf: "AMUT.Species.dwarf", elf: "AMUT.Species.elf",
      halfling: "AMUT.Species.halfling", gnome: "AMUT.Species.gnome", ogre: "AMUT.Species.ogre"
    }
  });
});

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

async function rollDice(formula) {
  const roll = await new Roll(formula).evaluate();
  if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true).catch(() => {});
  return roll;
}

let tableCache = null;
async function getTables() {
  if (tableCache) return tableCache;
  const pack = game.packs.get(PACK_TABLES);
  if (!pack) throw new Error(`${MODULE_ID} | compendium ${PACK_TABLES} not found`);
  tableCache = await pack.getDocuments();
  return tableCache;
}

async function findTable(key, column = "") {
  const tables = await getTables();
  return tables.find(t => t.getFlag("wfrp4e", "key") === key && (t.getFlag("wfrp4e", "column") ?? "") === (column ?? ""));
}

async function drawTable(table) {
  const roll = await rollDice(table.formula || "1d100");
  const result = table.getResultsForRoll(roll.total)[0];
  return { roll, result };
}

function resultLabel(result) {
  if (!result) return "";
  return result.name || stripHTML(result.description);
}

function shortLabel(label) {
  return String(label).replace(/^.* - /, "").split(/[:;,]/)[0].replace(/\s+/g, " ").trim().slice(0, 40);
}

function itemLinks(html) {
  const out = [];
  const re = /@UUID\[(Compendium\.artantares-mutations\.items\.Item\.[A-Za-z0-9]+)\]\{([^}]+)\}/g;
  for (const m of String(html ?? "").matchAll(re)) out.push({ uuid: m[1], name: m[2] });
  return out;
}

function mutationCounts(actor) {
  const counts = { physical: 0, mental: 0, total: 0 };
  for (const item of actor.items) {
    if (item.type !== "mutation") continue;
    if (item.getFlag(MODULE_ID, "variantOf")) continue; // variants count with their parent (p10)
    if (item.getFlag(MODULE_ID, "grantedBy")) continue;  // part of another mutation (Bestial Arms -> Protective Skin)
    const type = item.system?.mutationType?.value;
    if (type === "physical" || type === "mental") counts[type]++;
    counts.total++;
  }
  return counts;
}

function speciesKey(actor) {
  const raw = String(actor.system?.details?.species?.value ?? "");
  const label = game.wfrp4e?.config?.species?.[raw] ?? raw;
  const text = `${raw} ${label}`.toLowerCase();
  if (/dwar/.test(text)) return { key: "dwarf", fallback: false };
  if (/halfling/.test(text)) return { key: "halfling", fallback: false };
  if (/gnome/.test(text)) return { key: "gnome", fallback: false };
  if (/ogre/.test(text)) return { key: "ogre", fallback: false };
  if (/elf/.test(text)) return { key: "elf", fallback: false };
  if (/human|reiklander/.test(text)) return { key: "human", fallback: false };
  return { key: setting("speciesFallback") || "human", fallback: true };
}

function actorFromContext(options = {}) {
  if (options.messageId) {
    const msg = game.messages.get(options.messageId);
    const a = msg ? ChatMessage.getSpeakerActor(msg.speaker) : null;
    if (a) return a;
  }
  return canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
}

/* -------------------------------------------- */
/*  Flow                                        */
/* -------------------------------------------- */

/**
 * Run the handbook flow for an actor.
 * @param {Actor} actor
 * @param {object} opts
 * @param {boolean} [opts.applyCorruption=false] Reduce Corruption by TB/WPB (p8). True for the failed test.
 * @param {"physical"|"mental"|null} [opts.type] Force the type and skip the species roll.
 * @param {string|null} [opts.source] "normal", "necro" or a god key. Null = patron if any, else ask/normal.
 * @param {boolean} [opts.prompt=true] Allow the source dialog.
 */
export async function runMutationFlow(actor, { applyCorruption = false, type = null, source = null, prompt = true } = {}) {
  if (!actor) return ui.notifications.warn(L("Warn.NoActor"));
  if (applyCorruption && !actor.isOwner) return ui.notifications.warn(L("Warn.NotOwner", { name: actor.name }));

  const steps = [];
  const patron = actor.getFlag(MODULE_ID, "patron");
  const state = { actorUuid: actor.uuid, actorName: actor.name, steps, candidates: [], notes: [], status: "pending" };

  // Chosen of Chaos: the patron's table, no species or severity roll (p74).
  const godSource = GODS.includes(source) ? source : (!source && patron ? patron : null);
  if (godSource) {
    if (patron && godSource === patron) steps.push({ label: L("Step.Patron"), value: `${L(`God.${patron}`)} (p74)` });
    else steps.push({ label: L("Step.Source"), value: `${L(`God.${godSource}`)} (p${GOD_PAGES[godSource]})` });
    await rollGodTable(state, godSource);
    if (applyCorruption) {
      // Type is only known once the item is rolled; use the first candidate's type.
      const t = state.candidates[0]?.type;
      if (t) await loseCorruption(actor, t, steps);
    }
    return postCard(state, actor, { flavour: godSource });
  }

  // 2. Species roll (p8/p14).
  let mtype = type;
  if (!mtype) {
    const { key, fallback } = speciesKey(actor);
    const threshold = SPECIES_PHYSICAL[key];
    const speciesName = L(`Species.${key}`) + (fallback ? ` (${L("Step.Fallback")})` : "");
    if (threshold === 0) {
      mtype = "mental";
      steps.push({ label: L("Step.Species"), value: `${speciesName}: ${L("Step.AlwaysMental")} (p8)` });
    }
    else {
      const roll = await rollDice("1d100");
      mtype = roll.total <= threshold ? "physical" : "mental";
      steps.push({ label: L("Step.Species"), value: `${speciesName}: ${roll.total} → ${L(`Type.${mtype}`)} (p8)` });
    }
  }
  else steps.push({ label: L("Step.Type"), value: L(`Type.${mtype}`) });
  state.type = mtype;

  // 3. Corruption loss: TB physical, WPB mental, kept even if Resilience is spent (p8-9).
  if (applyCorruption) await loseCorruption(actor, mtype, steps);

  // 4. Severity (p9).
  const counts = mutationCounts(actor);
  let severity;
  if (setting("letThemOff") && mtype === "physical" && counts.physical === 0) {
    severity = "trivial";
    steps.push({ label: L("Step.Severity"), value: `${L("Severity.trivial")}: ${L("Step.LetThemOff")} (p9)` });
  }
  else if (setting("keepingItRandom")) {
    const roll = await rollDice("1d100");
    severity = roll.total <= 33 ? "trivial" : roll.total <= 66 ? "minor" : roll.total <= 99 ? "major" : "chosen";
    steps.push({ label: L("Step.Severity"), value: `${roll.total} → ${L(`Severity.${severity}`)} (${L("Step.KeepingItRandom")}, p9)` });
  }
  else {
    const bonus = Math.min(counts.total * 10, 40);
    const roll = await rollDice("1d100");
    const total = roll.total + bonus;
    severity = total <= 60 ? "trivial" : total <= 100 ? "minor" : total <= 130 ? "major" : "chosen";
    steps.push({ label: L("Step.Severity"), value: `${roll.total} + ${bonus} = ${total} → ${L(`Severity.${severity}`)} (p9)` });
  }

  if (severity === "chosen") return postChosen(state, actor);

  // 5. Source.
  let src = source;
  if (!src) src = (prompt && setting("promptSource")) ? await promptSource(actor, mtype, severity) : "normal";
  if (!src) {
    steps.push({ label: L("Step.Source"), value: L("Step.Cancelled") });
    state.status = "cancelled";
    return postCard(state, actor);
  }
  if (GODS.includes(src)) {
    steps.push({ label: L("Step.Source"), value: `${L(`God.${src}`)} (p${GOD_PAGES[src]})` });
    await rollGodTable(state, src);
    return postCard(state, actor, { flavour: src });
  }
  const necro = src === "necro";
  if (necro) steps.push({ label: L("Step.Source"), value: L("Source.necro") });

  // 6-7. Draw from the compendium tables, following "roll on the next table" (p14-18).
  let column = `${severity}-${mtype}${necro ? "-necro" : ""}`;
  for (let guard = 0; guard < 5; guard++) {
    const table = await findTable("mutation", column);
    if (!table) { state.notes.push(L("Warn.NoTable", { column })); break; }
    const { roll, result } = await drawTable(table);
    const page = TABLE_PAGES[column] ? `, p${TABLE_PAGES[column]}` : "";
    steps.push({ label: table.name, value: `${roll.total}: ${esc(resultLabel(result))}${page}`, raw: true });
    severity = column.split("-")[0];
    const desc = result?.description ?? "";
    const next = desc.match(/data-table="mutation"\s+data-column="([a-z-]+)"/);
    if (next) { column = next[1]; continue; }
    if (/#chosen-of-chaos/.test(desc)) return postChosen(state, actor);
    await addCandidates(state, result, { severity, table: table.name });
    break;
  }
  state.severity = severity;
  return postCard(state, actor, { flavour: mtype, severity });
}

async function loseCorruption(actor, type, steps) {
  const bonus = type === "physical" ? actor.system.characteristics.t.bonus : actor.system.characteristics.wp.bonus;
  const current = Number(actor.system.status.corruption.value) || 0;
  const value = Math.max(0, current - bonus);
  // skipCorruption stops the system's corruption check from looping (same as the stock handler).
  await actor.update({ "system.status.corruption.value": value }, { skipCorruption: true });
  steps.push({
    label: L("Step.Corruption"),
    value: L("Step.CorruptionLoss", { bonus, char: type === "physical" ? "TB" : "WPB", from: current, to: value }) + " (p8)"
  });
}

async function rollGodTable(state, god) {
  const table = await findTable("mutation", god);
  if (!table) { state.notes.push(L("Warn.NoTable", { column: god })); return; }
  const { roll, result } = await drawTable(table);
  state.steps.push({ label: table.name, value: `${roll.total}: ${esc(resultLabel(result))}, p${GOD_PAGES[god]}`, raw: true });
  state.source = god;
  await addCandidates(state, result, { severity: null, table: table.name, god });
}

async function addCandidates(state, result, { severity, table, god = null }) {
  if (!result) return;
  let links = [];
  if (result.documentUuid) links = [{ uuid: result.documentUuid, name: result.name }];
  else links = itemLinks(result.description);
  if (links.length > 1) state.notes.push(L("Note.ChooseOne"));
  for (const link of links) {
    const doc = await fromUuid(link.uuid);
    if (!doc) { state.notes.push(L("Warn.Missing", { name: link.name })); continue; }
    const cand = {
      uuid: doc.uuid, name: doc.name, img: doc.img,
      type: doc.system?.mutationType?.value ?? "",
      severity: severity ?? doc.getFlag(MODULE_ID, "severity") ?? "",
      table, variants: [], notes: []
    };
    await rollVariants(cand, doc, god);
    state.candidates.push(cand);
  }
}

async function rollVariants(cand, doc, god) {
  const desc = doc.system?.description?.value ?? "";
  if (god && doc.name === "Mark of Chaos") cand.notes.push(L("Note.MarkOfChaos", { god: L(`God.${god}`), page: GOD_PAGES[god] }));
  const keys = [...new Set([...desc.matchAll(/@Table\[([a-z-]+)\]/g)].map(m => m[1]).filter(k => VARIANT_KEYS.includes(k)))];
  if (!keys.length) return;
  const both = keys.length === 2 && keys.includes("immunity") && keys.includes("vulnerability");
  if (keys.length > 1 && !both) { cand.notes.push(L("Note.ManualSubtable")); return; }
  for (const key of keys) {
    const table = await findTable(key, "");
    if (!table) { cand.notes.push(L("Warn.NoTable", { column: key })); continue; }
    const foot = god ? GOD_FOOTNOTES[god]?.[key] : null;
    if (foot === "misprint") { cand.notes.push(L("Note.NurgleMisprint")); continue; }
    if (Array.isArray(foot)) {
      const roll = await rollDice(`1d${foot.length}`);
      const name = pick(foot[roll.total - 1]);
      const result = table.results.find(r => shortLabel(resultLabel(r)).toLowerCase().startsWith(name.toLowerCase()));
      if (result) {
        cand.variants.push(variantFrom(table, result, `1d${foot.length}: ${roll.total} (${L(`God.${god}`)} p${GOD_PAGES[god]})`));
        continue;
      }
      cand.notes.push(L("Note.FootnoteMiss", { name }));
    }
    const { roll, result } = await drawTable(table);
    if (result) cand.variants.push(variantFrom(table, result, `${table.formula}: ${roll.total}`));
  }
}

function variantFrom(table, result, rollText) {
  return {
    table: table.name, label: shortLabel(resultLabel(result)), full: resultLabel(result),
    uuid: result.documentUuid ?? null, text: result.documentUuid ? "" : (result.description ?? ""), roll: rollText
  };
}

async function promptSource(actor, type, severity) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const content = `<p>${L("Dialog.SourceIntro", { name: esc(actor.name), severity: L(`Severity.${severity}`), type: L(`Type.${type}`) })}</p>
    <div class="form-group"><label>${L("Dialog.Source")}</label>
    <select name="source">
      <option value="normal" selected>${L("Source.normal")}</option>
      <option value="necro">${L("Source.necro")}</option>
      ${GODS.map(g => `<option value="${g}">${L(`God.${g}`)}</option>`).join("")}
    </select></div>`;
  return DialogV2.wait({
    window: { title: L("Dialog.SourceTitle") }, content, rejectClose: false,
    buttons: [
      { action: "ok", label: L("Dialog.Roll"), default: true, callback: (event, button) => button.form.elements.source.value },
      { action: "cancel", label: L("Dialog.Cancel"), callback: () => null }
    ]
  });
}

/* -------------------------------------------- */
/*  Cards                                       */
/* -------------------------------------------- */

async function postChosen(state, actor) {
  state.kind = "chosen";
  state.steps.push({ label: L("Step.Result"), value: `${L("Severity.chosen")} (p9, p74)` });
  return postCard(state, actor, { flavour: "chosen" });
}

function flavourLine(flavour, severity) {
  const pool = [...(MutationMessages[flavour] ?? []), ...(severity ? MutationMessages[severity] ?? [] : [])];
  return pool.length ? pick(pool) : "";
}

async function renderCardHTML(state) {
  const steps = state.steps.map(s => `<li><strong>${esc(s.label)}:</strong> ${s.raw ? s.value : esc(s.value)}</li>`).join("");
  let body = "";
  if (state.kind === "chosen") {
    body = `<p>${L("Card.ChosenText")}</p>`;
    if (state.status === "pending")
      body += `<div class="amut-buttons amut-gm">${GODS.map(g => `<button type="button" data-amut-action="patron" data-god="${g}">${L(`God.${g}`)}</button>`).join("")}
        <button type="button" data-amut-action="retire">${L("Card.Retire")}</button></div>`;
  }
  else {
    body = state.candidates.map((c, i) => {
      const variants = c.variants.map(v => `<li>${esc(v.table)} (${esc(v.roll)}): ${v.uuid ? `@UUID[${v.uuid}]{${esc(v.full)}}` : esc(stripHTML(v.text) || v.full)}</li>`).join("");
      const notes = c.notes.map(n => `<li><em>${esc(n)}</em></li>`).join("");
      const meta = [c.severity && L(`Severity.${c.severity}`), c.type && L(`Type.${c.type}`)].filter(Boolean).join(" ");
      const button = state.status === "pending" ? `<button type="button" data-amut-action="apply" data-index="${i}">${L("Card.Apply")}</button>` : "";
      return `<div class="amut-candidate"><p><img src="${esc(c.img)}" width="24" height="24" style="vertical-align:middle;border:none"> @UUID[${c.uuid}]{${esc(c.name)}} <span>(${esc(meta)})</span></p>
        ${variants || notes ? `<ul>${variants}${notes}</ul>` : ""}${button}</div>`;
    }).join("");
    if (state.status === "pending" && state.candidates.length)
      body += `<div class="amut-buttons"><button type="button" data-amut-action="resist">${L("Card.Resist")}</button>
        <button type="button" data-amut-action="discard">${L("Card.Discard")}</button></div>`;
  }
  const notes = state.notes.length ? `<ul>${state.notes.map(n => `<li><em>${esc(n)}</em></li>`).join("")}</ul>` : "";
  const status = state.status !== "pending" ? `<p class="amut-status"><strong>${esc(state.statusText ?? L(`Status.${state.status}`))}</strong></p>` : "";
  const html = `<div class="amut-card">
    <h3>${L("Card.Title")}</h3>
    ${state.flavour ? `<p><em>${esc(state.flavour)}</em></p>` : ""}
    <p><strong>${esc(state.actorName)}</strong></p>
    <ul class="amut-steps">${steps}</ul>${notes}${body}${status}</div>`;
  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  return TE.enrichHTML(html);
}

async function postCard(state, actor, { flavour, severity } = {}) {
  state.kind ??= "result";
  if (state.kind === "result" && !state.candidates.length && state.status === "pending") state.status = "empty";
  state.flavour = flavour ? flavourLine(flavour, severity) : "";
  const content = await renderCardHTML(state);
  const chatData = game.wfrp4e.utility.chatDataSetup(content);
  chatData.speaker = ChatMessage.getSpeaker({ actor });
  chatData.flags = { [MODULE_ID]: { [TEMPLATE_FLAG]: state } };
  return ChatMessage.create(chatData);
}

async function updateCard(message, state) {
  const content = await renderCardHTML(state);
  return message.update({ content, [`flags.${MODULE_ID}.${TEMPLATE_FLAG}`]: state });
}

/* -------------------------------------------- */
/*  Card actions                                */
/* -------------------------------------------- */

async function onCardAction(message, action, dataset) {
  const state = foundry.utils.deepClone(message.getFlag(MODULE_ID, TEMPLATE_FLAG));
  if (!state || state.status !== "pending") return;
  const actor = await fromUuid(state.actorUuid);
  if (!actor) return ui.notifications.warn(L("Warn.NoActor"));

  if (action === "resist") {
    if (!(game.user.isGM || actor.isOwner)) return;
    if (!message.canUserModify(game.user, "update")) {
      if (!game.users.activeGM) return ui.notifications.warn(L("Warn.NoGM"));
      return game.socket.emit(SOCKET, { action: "resist", messageId: message.id, userId: game.user.id });
    }
    return resist(message, state, actor, game.user);
  }
  if (action === "apply") {
    // Players may add a mutation to an actor they own; the GM to any.
    if (!(game.user.isGM || actor.isOwner)) return ui.notifications.error(L("Warn.NoPermissionAdd", { name: actor.name }));
    const cand = state.candidates[Number(dataset.index)];
    if (!cand) return;
    // Created by the clicking user, so the grant scripts (onCreate) and their choice dialogs run for them.
    const item = await applyCandidate(actor, cand, state);
    if (!item) return;
    await markCard(message, state, { status: "applied", name: item.name });
    await checkSpawn(actor);
    return;
  }
  if (!game.user.isGM) return ui.notifications.error(L("Warn.NoPermission"));

  if (action === "discard") {
    state.status = "discarded";
    state.statusText = L("Status.discardedBy", { user: game.user.name });
    await updateCard(message, state);
  }
  else if (action === "patron") {
    const god = dataset.god;
    if (!GODS.includes(god)) return;
    await actor.setFlag(MODULE_ID, "patron", god);
    state.status = "patron";
    state.statusText = L("Status.patronSet", { god: L(`God.${god}`) });
    await updateCard(message, state);
    // Roll the patron's table for this mutation; it goes through the normal confirm / Resilience card.
    await runMutationFlow(actor, { source: god, prompt: false });
  }
  else if (action === "retire") {
    state.status = "retired";
    await updateCard(message, state);
  }
}

/** Mark the card resolved: directly if this user may edit the message, otherwise through the active GM. */
async function markCard(message, state, { status, name }) {
  if (message.canUserModify(game.user, "update")) {
    state.status = status;
    state.statusText = L("Status.appliedName", { name, user: game.user.name });
    return updateCard(message, state);
  }
  if (!game.users.activeGM) return ui.notifications.warn(L("Warn.NoGMCard"));
  game.socket.emit(SOCKET, { action: "applied", messageId: message.id, userId: game.user.id, name });
}

async function resist(message, state, actor, user) {
  const value = Number(actor.system.status?.resilience?.value) || 0;
  if (value < 1) {
    if (user.isSelf) ui.notifications.warn(L("Warn.NoResilience", { name: actor.name }));
    return;
  }
  await actor.update({ "system.status.resilience.value": value - 1 });
  state.status = "resisted";
  state.statusText = L("Status.resistedBy", { name: actor.name, from: value, to: value - 1 });
  await updateCard(message, state);
}

async function applyCandidate(actor, cand, state) {
  const doc = await fromUuid(cand.uuid);
  if (!doc) { ui.notifications.error(L("Warn.Missing", { name: cand.name })); return null; }
  const data = doc.toObject();
  delete data._id;
  data._stats = { ...(data._stats ?? {}), compendiumSource: doc.uuid };
  if (cand.variants.length) {
    data.name = `${doc.name} (${cand.variants.map(v => v.label).join(", ")})`;
    const lines = cand.variants.map(v => `<p><strong>${esc(v.table)} (${esc(v.roll)}):</strong> ${v.uuid ? `@UUID[${v.uuid}]{${esc(v.full)}}` : v.text}</p>`).join("");
    data.system.description.value = `${lines}<hr>${data.system.description.value ?? ""}`;
  }
  if (cand.notes.length) data.system.description.value = `${cand.notes.map(n => `<p><em>${esc(n)}</em></p>`).join("")}${data.system.description.value ?? ""}`;
  const flags = data.flags[MODULE_ID] ?? {};
  data.flags[MODULE_ID] = {
    ...flags,
    severity: cand.severity || flags.severity,
    rolledOn: cand.table,
    source: state.source ?? (cand.table?.includes("Necromantic") ? "necro" : "normal"),
    variants: cand.variants.map(v => ({ table: v.table, label: v.full, uuid: v.uuid }))
  };
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  return item;
}

async function checkSpawn(actor) {
  const counts = mutationCounts(actor);
  const tb = actor.system.characteristics.t.bonus;
  const wpb = actor.system.characteristics.wp.bonus;
  const over = [];
  if (counts.physical > tb) over.push(L("Spawn.Physical", { n: counts.physical, tb }));
  if (counts.mental > wpb) over.push(L("Spawn.Mental", { n: counts.mental, wpb }));
  if (!over.length) return;
  const text = L("Spawn.Warning", { name: actor.name });
  ui.notifications.warn(text);
  return ChatMessage.create({
    content: `<h3>${L("Spawn.Title")}</h3><p>${esc(text)}</p><ul>${over.map(o => `<li>${esc(o)}</li>`).join("")}</ul><p>(p10)</p>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: ChatMessage.getSpeaker({ actor })
  });
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!message.getFlag(MODULE_ID, TEMPLATE_FLAG)) return;
  const state = message.getFlag(MODULE_ID, TEMPLATE_FLAG);
  // Cards posted by older builds marked Add / Discard GM-only; those buttons are now shown to everyone.
  html.querySelectorAll('[data-amut-action="apply"].amut-gm, [data-amut-action="discard"].amut-gm').forEach(el => el.classList.remove("amut-gm"));
  if (!game.user.isGM) html.querySelectorAll(".amut-gm").forEach(el => el.remove());
  const actor = fromUuidSync(state.actorUuid);
  if (!game.user.isGM && !actor?.isOwner) html.querySelectorAll('[data-amut-action="resist"]').forEach(el => el.remove());
  html.querySelectorAll("[data-amut-action]").forEach(el => el.addEventListener("click", async (event) => {
    event.preventDefault();
    const btn = event.currentTarget;
    btn.disabled = true;
    try { await onCardAction(message, btn.dataset.amutAction, btn.dataset); }
    catch (err) { console.error(`${MODULE_ID} |`, err); ui.notifications.error(err.message); }
    finally { btn.disabled = false; }
  }));
});

/* -------------------------------------------- */
/*  Generate Mutation dialog (macro)            */
/* -------------------------------------------- */

export async function openGenerateDialog() {
  const DialogV2 = foundry.applications.api.DialogV2;
  const actors = game.actors.filter(a => a.isOwner && ["character", "npc", "creature"].includes(a.type));
  if (!actors.length) return ui.notifications.warn(L("Warn.NoActors"));
  const preset = actorFromContext()?.id;
  const folders = game.folders.filter(f => f.type === "Actor");
  const actorOptions = (folderId) => actors.filter(a => folderId === "all" || a.folder?.id === folderId)
    .map(a => `<option value="${a.id}" ${a.id === preset ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const content = `
    <div class="form-group"><label>${L("Dialog.Folder")}</label><select name="folder">
      <option value="all">${L("Dialog.AllActors")}</option>
      ${folders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></div>
    <div class="form-group"><label>${L("Dialog.Actor")}</label><select name="actor">${actorOptions("all")}</select></div>
    <div class="form-group"><label>${L("Dialog.Source")}</label><select name="source">
      <option value="">${L("Source.auto")}</option>
      <option value="normal">${L("Source.normal")}</option>
      <option value="necro">${L("Source.necro")}</option>
      ${GODS.map(g => `<option value="${g}">${L(`God.${g}`)}</option>`).join("")}</select></div>
    <div class="form-group"><label>${L("Dialog.Type")}</label><select name="type">
      <option value="">${L("Type.species")}</option>
      <option value="physical">${L("Type.physical")}</option>
      <option value="mental">${L("Type.mental")}</option></select></div>
    <div class="form-group"><label>${L("Dialog.ApplyCorruption")}</label><input type="checkbox" name="applyCorruption"></div>`;
  const result = await DialogV2.wait({
    window: { title: L("Dialog.GenerateTitle") }, content, rejectClose: false,
    render: (event, dialog) => {
      const root = dialog.element ?? event?.target?.element;
      const folder = root?.querySelector('select[name="folder"]');
      const actor = root?.querySelector('select[name="actor"]');
      folder?.addEventListener("change", () => { actor.innerHTML = actorOptions(folder.value); });
    },
    buttons: [
      {
        action: "roll", label: L("Dialog.Roll"), default: true,
        callback: (event, button) => {
          const f = button.form.elements;
          return { actorId: f.actor.value, source: f.source.value || null, type: f.type.value || null, applyCorruption: f.applyCorruption.checked };
        }
      },
      { action: "cancel", label: L("Dialog.Cancel"), callback: () => null }
    ]
  });
  if (!result?.actorId) return;
  const actor = game.actors.get(result.actorId);
  return runMutationFlow(actor, { source: result.source, type: result.type, applyCorruption: result.applyCorruption });
}

/* -------------------------------------------- */
/*  Wrappers                                    */
/* -------------------------------------------- */

function handleMutationResultWrapper(wrapped, ...args) {
  if (!setting("useHandbook") || !this.failed) return wrapped(...args);
  if (this.context?.reroll || this.context?.fortuneUsedAddSL) {
    // The first (failed) roll already ran the flow; don't run it twice on a reroll / +SL.
    ChatMessage.create({
      content: `<p>${L("Warn.Rerolled", { name: esc(this.actor?.name) })}</p>`,
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id)
    });
    return;
  }
  const actor = this.actor;
  // Don't hold up the test card while dialogs are open.
  Promise.resolve().then(() => runMutationFlow(actor, { applyCorruption: true }))
    .catch(err => { console.error(`${MODULE_ID} |`, err); ui.notifications.error(err.message); });
}

async function formatChatRollWrapper(wrapped, table, options = {}, column = null, ...rest) {
  const key = typeof table === "string" ? table.toLowerCase() : table;
  if (!setting("useHandbook") || !SYSTEM_KEYS.includes(key)) return wrapped(table, options, column, ...rest);
  const actor = actorFromContext(options);
  const source = GODS.includes(column) ? column : null;
  const type = key === "mutatephys" ? "physical" : key === "mutatemental" ? "mental" : null;
  if (!actor) openGenerateDialog();
  else runMutationFlow(actor, { type, source }).catch(err => { console.error(`${MODULE_ID} |`, err); ui.notifications.error(err.message); });
  return options.returnObject ? { result: "" } : null;
}

let originalHandleMutation = null;
let originalFormatChatRoll = null;

Hooks.once("setup", () => {
  const useLib = game.modules.get("lib-wrapper")?.active && globalThis.libWrapper;
  const TestWFRP = game.wfrp4e?.rolls?.TestWFRP;
  if (!TestWFRP?.prototype?.handleMutationResult) console.warn(`${MODULE_ID} | TestWFRP.handleMutationResult not found; handbook test hook disabled.`);
  else if (useLib) globalThis.libWrapper.register(MODULE_ID, "game.wfrp4e.rolls.TestWFRP.prototype.handleMutationResult", handleMutationResultWrapper, "MIXED");
  else {
    originalHandleMutation = TestWFRP.prototype.handleMutationResult;
    TestWFRP.prototype.handleMutationResult = function (...args) {
      return handleMutationResultWrapper.call(this, originalHandleMutation.bind(this), ...args);
    };
  }

  const tables = game.wfrp4e?.tables;
  if (!tables?.formatChatRoll) console.warn(`${MODULE_ID} | game.wfrp4e.tables.formatChatRoll not found; table hook disabled.`);
  else if (useLib) globalThis.libWrapper.register(MODULE_ID, "game.wfrp4e.tables.formatChatRoll", formatChatRollWrapper, "MIXED");
  else {
    originalFormatChatRoll = tables.formatChatRoll;
    tables.formatChatRoll = function (...args) {
      return formatChatRollWrapper(originalFormatChatRoll.bind(this), ...args);
    };
  }

  const api = { runMutationFlow, openGenerateDialog, mutationCounts, checkSpawn, findTable, speciesKey };
  const mod = game.modules.get(MODULE_ID);
  mod.api = Object.assign(mod.api ?? {}, api); // mutation-grants.mjs adds grant/revert at init
  // Back-compat with the old world-script entry point (actor, "all"|"necromancy"|god).
  game.wfrp4eMutationRoll = (actor, source) => runMutationFlow(actor, {
    source: source === "necromancy" ? "necro" : GODS.includes(source) ? source : "normal"
  });
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, async (data) => {
    if (!["resist", "applied"].includes(data?.action) || !game.users.activeGM?.isSelf) return;
    const message = game.messages.get(data.messageId);
    const user = game.users.get(data.userId);
    const state = foundry.utils.deepClone(message?.getFlag(MODULE_ID, TEMPLATE_FLAG));
    if (!state || state.status !== "pending" || !user) return;
    const actor = await fromUuid(state.actorUuid);
    if (!actor?.testUserPermission(user, "OWNER")) return;
    if (data.action === "resist") return resist(message, state, actor, user);
    // A player added the mutation to their own actor; the GM marks the card (the player cannot edit it).
    state.status = "applied";
    state.statusText = L("Status.appliedName", { name: String(data.name ?? ""), user: user.name });
    await updateCard(message, state);
  });
});
