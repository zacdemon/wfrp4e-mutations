/**
 * Grant specs for the Mutant's Handbook items (see scripts/mutation-grants.mjs for the format).
 * `node tools/grants.mjs` writes these into src/packs/items as a "<Mutation> (Grants)" effect.
 *
 * Keys are item names. PARTS are stored as flags.artantares-mutations.parts on the Bestial Body /
 * Unnatural Body variant items and read by Bestial/Unnatural Arms, Legs, Head and Body.
 * Fixed Characteristic, Movement and Wounds modifiers, situational test modifiers and switchable
 * effects live in tools/modifiers-data.mjs. Modifiers that are rolled, chosen or depend on a sub-table
 * result (ch(), half(), dlg() below) are entries here, so the grant run rolls or asks once and writes
 * the result into the mutation's "<Mutation> (Modifiers)" effect.
 */
import { dialogScriptData, critTakenScriptData, longArmsScripts } from "../scripts/modifier-scripts.mjs";

// wfrp4e-core item ids, taken from the links in the handbook items. The runtime checks the type
// and falls back to a name search (game.wfrp4e.utility.find) if a link is missing or wrong.
const CORE = {
  "Acute Sense": "9h82z72XGo9tfgQS", "Ambidextrous": "IFKWu98qmWpaSfUi", "Amphibious": "sJ3yX1kvzu2hgNq5",
  "Animal Affinity": "9fq6p9Q6H02LjaSi", "Animosity": "Q2MCUrG2HppMcvN0", "Arboreal": "rOV2s6PQBBrhpMOv",
  "Arcane Magic": "3O9clK7LGyuLTHPW", "Argumentative": "41JhsSNW1Ttza3JK", "Artistic": "2eq8Ejotk54AZYwX",
  "Attractive": "6l3jvIAvrKxt0lA9", "Belligerent": "GbDyBCu8ZjDp6dkj", "Beneath Notice": "5KP9sOoLSGvj9EXp",
  "Berserk Charge": "oRx92ByVNEBN6YkK", "Bite": "pLW9SVX0TVTYPiPv", "Blather": "77p3QRKgFWakkndF",
  "Bounce": "j6v78dnOOdCB6c3d", "Breath": "uqGxFOEqeurwkAO3", "Cat-tongued": "LzgxyMknSHjSkkeQ",
  "Chaos Magic": "hiU7vhBOVpVI8c7C", "Combat Aware": "0LdHytqyNmg2pcAX", "Combat Master": "NDetl9BhAQBVnHKf",
  "Commanding Presence": "x8g3U68oi8XzWiYr", "Constrictor": "KynNUYYKzTMeHrKl", "Contortionist": "TaYriYcJkFuIdBKp",
  "Corrosive Blood": "M5QSWOYt2Rbv2yxW", "Daemonic": "v3uzEthcq0JRar0J", "Dark Vision": "JQa5DLnTs2SEzRrc",
  "Detect Artefact": "g3y373FnWJEAxgEB", "Die Hard": "UsJ2uIOOtHA7JqD5", "Distracting": "MVI0lXcg6vvtooAF",
  "Doomed": "fn8QNQQ1S2rh12Us", "Fear": "pTorrE0l3VybAbtn", "Fearless": "8pVzgPkgWpTJvfhG",
  "Flee!": "jrFIFLhyOYwcyMUl", "Flight": "EO05HX7jql0g605A", "Frenzy": "hXcfygzujgyMN1uI",
  "Frightening": "mqo51ORnxijcqNNu", "Furious Assault": "BlHVzfs0Ow6IYEDw", "Hardy": "zImcTgEl2XNnbu5W",
  "Hatred": "E98mVLZgE8bX5vQW", "Horns": "BqPZn6q3VHn9HUrW", "Hungry": "xneBqGOs1QS7kfUr",
  "Immunity": "3wCtgMDNnu8MFmyk", "Immunity to Psychology": "IAWyzDfC286a9MPz", "Impassioned Zeal": "oGbDwnLOn3isPJpO",
  "Infected": "V0c3qBU1CMm8bmsW", "Infestation": "TBcdTlYSRH8Rd1x0", "Inspiring": "WCXnFSV4WOSmzzc4",
  "Iron Jaw": "UaDGF5MBFBwPq5YU", "Magical Sense": "6w30u0VPsAicrqb5", "Magical": "mDgEMOoJpi8DkRYb",
  "Master Orator": "ZWcTbeK8i9vKph2a", "Menacing": "0hn6UaKq8CoZP2zD", "Night Vision": "x0WMGwuQzReXcQrs",
  "Nose for Trouble": "AcnFuDKRemLI9ey7", "Orientation": "afREA9q7v4Scuozn", "Painless": "wMwSRDmgiF2IdCJr",
  "Pharmacist": "G4rPR0XGiYFUZWKi", "Prejudice": "klCJX0mNpXYH5AIx", "Public Speaker": "XU7D9CCmumuhqDUi",
  "Regenerate": "SfUUdOGjdYpr3KSR", "Relentless": "SgjJMBgc85aswvhm", "Resistance": "vMYEkrWj0ip6ZOdv",
  "Robust": "nWLsoWQBCjPRKxYx", "Savant": "580fwhKfOZJFxMID", "Scale Sheer Surfaces": "MGEPI4jNhymNIRVz",
  "Second Sight": "OEjUvJKi0xmBwbS2", "Sixth Sense": "mNoCuaVbFBflfO6X", "Size": "8slW8CJ2oVTxeQ6q",
  "Sprinter": "AwUUEwwf2Vt4ksCN", "Step Aside": "HpGjzrSR4tdogJtl", "Stride": "UmxGZRV0Lw3TZ0Kx",
  "Strider": "1dUizIgLBgn4jICC", "Strike Mighty Blow": "4MJJCiOKPkBByYwW", "Strong Back": "FF41XPboORgyDNsv",
  "Strong Legs": "CV9btQn09S9Fn8Jk", "Strong Swimmer": "4wnQc19allWlyOGe", "Stupid": "9GNpAqgsKzxZKJpp",
  "Sturdy": "qZ4cFy6z482ZONuA", "Super Numerate": "sBHarYXR2o7jD1VY", "Sure Shot": "phXzaUxl3mFqkmDq",
  "Surgery": "NP4EHyyh1yOLbsPU", "Swarm": "E2Es82TvBKa7CoDG", "Tentacles": "4xF7M6ylIiGntekh",
  "Tower of Memories": "V9N0LMnXf1WYseCL", "Tracker": "ClOlztW6hH8rslbp", "Tunnel Rat": "Z91GFaT6FhEwyESU",
  "Undead": "PFTD9gDvRWW9uh5g", "Venom": "gFkRm9wS65qe18Xv", "Wallcrawler": "KII1gWnxIZ8HzmU5",
  "Weapon": "AtpAudHA4ybXVlWM", "Web": "Bw6tQyzOhcl7aQ46", "Witch!": "qdMbxW09FUoYBzmB"
};
const cu = (n) => CORE[n] ? `Compendium.wfrp4e-core.items.Item.${CORE[n]}` : undefined;

const T = (n, o = {}) => ({ t: "talent", n, u: cu(n), ...o });
const R = (n, o = {}) => ({ t: "trait", n, u: cu(n), ...o });
const P = (n, o = {}) => ({ t: "psychology", n, u: cu(n), ...o });
const S = (n, adv, o = {}) => ({ t: "skill", n, adv, ...o });
const M = (n, o = {}) => ({ t: "mutation", n, ...o });           // uuid filled in by tools/grants.mjs
const A = (n, ap, o = {}) => ({ t: "armour", n, ap, ...o });
const bump = (n, d = 1) => ({ t: "bump", n, d });
const size = (step, at) => ({ t: "size", step, u: cu("Size"), ...(at ? { at } : {}) });
const choose = (text, ...of) => ({ choose: text, of });
const chooseN = (n, text, ...of) => ({ choose: text, of, n });
const roll = (formula, text, ...res) => ({ roll: formula, text, res });
const note = (text) => ({ note: text });
const variant = (tbl, key, map) => ({ variant: map, tbl, key });
const body = (part, tbl, key) => ({ body: part, tbl, key });
// Modifiers: ch("ag", 10) / ch("ag", "-1d10") / ch("move", 1) / ch("wounds", -1); half("bs"); dlg(label, mod, when, active)
const ch = (k, v, o = {}) => ({ t: "mod", k, v, ...o });
const half = (k) => ({ t: "mod", k, half: true });
const dlg = (label, mod, when, active, opts) => ({ t: "dialog", d: dialogScriptData(label, mod, when, active, opts) });
const scr = (d) => ({ t: "dialog", d });                          // any script, added to the Modifiers effect
const stat = (k, v, o = {}) => ({ t: "status", k, v, ...o });    // Fortune/Fate/Resilience/Resolve +v now
const INFIGHTING = `args.actor?.statuses?.has("infighting")`;
// "Roll on the Hit Locations table" (WFRP p159): head 01-09 gets `head`, everything else `other`.
const hitloc = (text, head, other = null) => roll("1d100", text,
  [1, 9, head, "Head"], [10, 24, other, "Left Arm"], [25, 44, other, "Right Arm"], [45, 79, other, "Body"],
  [80, 89, other, "Left Leg"], [90, 100, other, "Right Leg"]);

const venom = () => R("Venom", { s: "Average" });
const PS = (v) => M("Protective Skin", { v, tbl: "Protective Skin" });
const wings = (v) => M("Wings", { v, tbl: "Wings" });
const tail = (v) => M("Tail", { v, tbl: "Tail" });
const imm = (s) => R("Immunity", { s });

const GROUPS = ["Academics", "Wizards", "Bretonnians", "Burghers", "Merchants", "Clergy", "Dwarfs", "Elves", "Estalians",
  "Cathayans", "Arabyans", "Ogres", "Gnomes", "Halflings", "Goblins", "Beastmen", "Humans", "Imperials", "Kislevites",
  "Law Enforcement", "Nobles", "Norscans", "Peasants", "Tileans", "Wastelanders"];
const SUSPECTS = ["Academics", "Agitators", "Burghers", "Enemies of Men", "Cult of Sigmar", "Law Enforcement", "Nobles",
  "Peasants", "Rogues", "Tax Collectors", "Undead", "Witches", "Wizards", "Witchhunters"];
const askGroup = "Target group (handbook table on the mutation, or the GM's choice)";

// Unbelievable Tumour: per 30 lb, +1 Wound and a 1d10 roll.
const tumourRoll = () => roll("1d10", "Tumour", [1, 3, ch("move", -1), "-1 Movement"], [4, 6, ch("ag", -10), "-10 Agility"], [7, 10, ch("fel", -10), "-10 Fellowship"]);
const tumour = (n) => [ch("wounds", n), ...Array.from({ length: n }, tumourRoll)];

// Additional Extremities: limb type x amount.
const limbs = (mk) => [1, 2, 3, 4].map(n => mk(n));
const amount = (mk) => roll("1d10", "Amount", [1, 3, mk(1), "One"], [4, 6, mk(2), "Two"], [7, 8, mk(3), "Three"], [9, 10, mk(4), "Four"]);

export const GRANTS = {
  "Additional Extremities": { grants: [roll("1d10", "Limbs",
    [1, 4, amount(n => [T("Furious Assault", { x: n }), note(`+${n} extra arm(s): +1 Furious Assault level each.`)]), "Arms"],
    [5, 7, amount(n => [T("Sturdy", { x: n }), Math.floor(n / 2) ? ch("move", Math.floor(n / 2)) : null, note(`+${n} extra leg(s): +1 Sturdy level each; +1 Movement per pair.`)]), "Legs"],
    [8, 10, amount(n => R("Tentacles", { d: 3, l: `${n}` })), "Tentacles"])] },
  "Additional Head": { grants: [T("Ambidextrous"), ch("i", "1d10"), ch("int", "1d10")] },
  "Additional Sensory Organs": { grants: [note("An eye in the back may grant Combat Aware if the GM is feeling generous (add by hand).")] },
  "Aethyric Leak": { grants: [T("Witch!")] },
  "Alluring Shape": { grants: [T("Attractive"), ch("fel", "1d10")] },
  "Androgynous": { grants: [T("Attractive")] },
  "Aquatic Adaptation": { grants: [R("Amphibious")] },
  "Bachtrachian Suckers": { grants: [R("Wallcrawler")] },
  "Barrel Chest": { grants: [S("Consume Alcohol", 10)] },
  "Bestial Arms": { grants: [body("arms", "Bestial Body", "bestial-body")] },
  "Bestial Body": { grants: [body("all", "Bestial Body", "bestial-body")] },
  "Bestial Head": { grants: [body("head", "Bestial Body", "bestial-body")] },
  "Bestial Legs": { grants: [body("legs", "Bestial Body", "bestial-body")] },
  "Beweaponed Extremities": { grants: [roll("1d10", "Weapon",
    [1, 5, R("Weapon", { l: "Sword", q: ["damaging"] }), "Sword, Damaging"],
    [6, 7, R("Weapon", { l: "Axe", q: ["hack"] }), "Axe, Hack"],
    [8, 9, R("Weapon", { l: "Mace", q: ["pummel"] }), "Mace, Pummel"],
    [10, 10, R("Weapon", { l: "Flail", q: ["distract", "wrap"] }), "Flail, Distract and Wrap"]),
    roll("1d10", "Arms", [1, 8, null, "One"], [9, 10, note("Both arms: no hands left, Dexterity drops to 0 (by hand)."), "Both"])] },
  "Bizarre Denial": { grants: [T("Argumentative")] },
  "Blissful Ignorance": { grants: [T("Fearless", { s: "Everything" })] },
  "Blood Lust": { grants: [R("Belligerent")] },
  "Brain Rot": { grants: [ch("int", "-1d10")] },
  "Bloodsucker": { grants: [roll("1d10", "Bloodsucker", [1, 8, M("Fangs"), "Fangs"], [9, 10, M("Piercing Tongue"), "Piercing Tongue"])] },
  "Burning Body": { grants: [imm("Fire")] },
  "Centauroid": { grants: [R("Stride")] },
  "Chosen One": { grants: [T("Blather")] },
  "Chthonian Crawler": { grants: [M("Dark Vision"), T("Tunnel Rat"), T("Scale Sheer Surfaces")] },
  "Cold-Blooded": { grants: [R("Cold-blooded"), note("Vulnerability (Cold): double damage from cold (no item; apply by hand).")] },
  "Consuming Rage": { levels: [[T("Frenzy")], [P("Hatred", { ask: askGroup, opts: GROUPS })]] },
  "Cyclopean Horror": { grants: [roll("1d10", "Eye", [1, 5, half("bs"), "Eyes merge: halve BS"], [6, 10, note("A head-sized eye grows on the body: roll Hit Location for where (custom armour there; 20% of hits there strike the eye with Damaging)."), "Extra eye"])] },
  "Corrosive Vomit": { levels: [[R("Vomit")], [bump("Vomit")]] },
  "Corrupted Blood": { grants: [variant("Corrupted Blood", "corrupted-blood", {
    "Green Ooze": [R("Corrosive Blood")], "Mercury": [], "Molten Metal": [R("Corrosive Blood")],
    "Mucus": [S("Endurance", 10)], "Oil": [], "Sap": [], "Tar": [], "Venom": [venom()] })] },
  "Crawling Skin": { grants: [R("Distracting")] },
  "Dark Fate": { grants: [T("Doomed")] },
  "Dark Vision": { grants: [R("Dark Vision")] },
  "Distended Digits": { grants: [ch("dex", "1d10")] },
  "Doom Prophet": { grants: [T("Impassioned Zeal")] },
  "Enlarged Sensory Organ": { grants: [roll("1d100", "Organ",
    [1, 25, T("Acute Sense", { s: "Sight" }), "Eyes"], [26, 50, T("Acute Sense", { s: "Hearing" }), "Ears"],
    [51, 75, T("Acute Sense", { s: "Smell" }), "Nose"], [76, 100, T("Acute Sense", { s: "Taste" }), "Mouth"])] },
  "Elongated Limbs": { grants: [roll("1d10", "Limb",
    [1, 4, [...longArmsScripts().map(scr),
      dlg("Elongated Limbs (target): in-fighting against long arms +20", { modifier: 20 }, { attack: "melee" }, INFIGHTING, { targeter: true })], "Arms"],
    [5, 9, ch("move", 1), "Legs"],
    [10, 10, scr(critTakenScriptData("Elongated Limbs: Critical hits to the Head +20 (Up in Arms Criticals)", 20, "head")), "Neck"]),
    roll("1d10", "Elastic", [1, 8, null, "-"], [9, 10, note("Elastic: retract to hide it, or extend 1-2 yards (about 3 yards reach)."), "Elastic"])] },
  "Ensnaring Tongue": { grants: [R("Tongue Attack", { d: 0 })] },
  "Ethereal": { grants: [R("Ethereal", { off: true }), note("Ethereal is added switched off: enable it while the power is active.")] },
  "Extra Joints": { grants: [ch("ag", "1d10")] },
  "Eyestalks": { grants: [T("Combat Aware")] },
  "Facial Symmetry": { grants: [ch("fel", "1d10")] },
  "False Wizard": { grants: [T("Blather")] },
  "Fangs": { levels: [[R("Bite", { d: 3 }), roll("1d10", "Fangs", [1, 7, null, "-"], [8, 9, venom(), "Venom (Average)"], [10, 10, M("Bloodsucker"), "Bloodsucker"])], [bump("Bite")]] },
  "Fate of Glory": { grants: [T("Fearless", { s: "Everything" })] },
  "Fixation": { grants: [T("Savant", { ask: "Lore related to your Target" })] },
  "Fleshcrafter": { grants: [S("Trade (Fleshcrafter)", 0)] },
  "Foul Touch": { grants: [R("Infected")] },
  "Freakish Quickness": { grants: [T("Relentless")] },
  "Fright": { grants: [T("Flee!"), note("Flee! only applies when fleeing from the source of your fright.")] },
  "Frostbite": { grants: [imm("Cold")] },
  "Gnawer": { grants: [R("Bite", { d: 1 })] },
  "Gut Worm": { grants: [R("Hungry")] },
  "Hateful Impulses": { levels: [[P("Animosity", { ask: askGroup, opts: GROUPS })], [P("Hatred", { ask: askGroup, opts: GROUPS }), note("Upgrade: remove the old Animosity by hand if it is the same target.")]] },
  // +1 Fortune the way the Luck Talent gives it (a Luck level, counted by session Fortune resets),
  // plus the point now unless core's Luck already adds it with its own script.
  "Time Warp": { grants: [T("Luck"), stat("fortune", 1, { unless: "Luck" })] },
  "Hideous Appearance": { grants: [R("Terror", { s: "1", max: true })] },
  "Hollow Bones": { grants: [ch("ag", "1d10"), S("Athletics", "1d10")] },
  "Hopper": { grants: [R("Bounce")] },
  "Hump": { grants: [S("Endurance", 10)] },
  "Hunchback": { grants: [ch("ag", "-1d10")] },
  "Horns": { levels: [[R("Horns", { d: 3 })], [bump("Horns")]] },
  "Horrible Stench": { grants: [R("Distracting")] },
  "Horrid Feeler": { grants: [R("Tentacles", { d: 3 }), T("Acute Sense", { s: "Touch" })] },
  "Hubris": { grants: [T("Commanding Presence")] },
  "Hulking Brute": { grants: [T("Hardy")] },
  "Hungering Maw": { grants: [R("Bite", { d: 5 }), R("Hungry")] },
  "Immunity & Vulnerability": { grants: [variant("Immunity", "immunity", {
    "Disease": [imm("Disease")], "Cold": [imm("Cold")], "Fire": [imm("Fire")], "Lightning": [imm("Lightning")],
    "Magic": [imm("Magic")], "Poison": [imm("Poison")] }), note("The Vulnerability result has no item; apply it by hand.")] },
  "Imminent Precognition": { grants: [T("Combat Aware")] },
  "Infernal Furnace": { grants: [R("Breath", { l: "Fire" }), imm("Fire"), imm("Cold")] },
  "Inhuman Beauty": { grants: [T("Attractive")] },
  "Insect Eyes": { grants: [T("Combat Aware")] },
  "Itching Rash": { grants: [hitloc("Rash", ch("fel", -10))] },
  "Irrational Contempt": { levels: [
    [P("Prejudice", { ask: askGroup, opts: GROUPS })],
    [choose("Irrational Contempt again", P("Animosity", { ask: askGroup, opts: GROUPS, label: "Upgrade to Animosity" }), P("Prejudice", { ask: askGroup, opts: GROUPS, label: "Another Prejudice target" }))],
    [choose("Irrational Contempt again", P("Hatred", { ask: askGroup, opts: GROUPS, label: "Upgrade to Hatred" }), P("Prejudice", { ask: askGroup, opts: GROUPS, label: "Another Prejudice target" }))]] },
  "Levitation": { grants: [R("Flight", { s: "30", off: true }), note("Flight is added switched off: enable it while levitating (rating = 30 x levels in Levitation).")] },
  "Lolling Tongue": { grants: [ch("fel", "-1d10")] },
  "Long Spines": { levels: [
    [R("Horns", { d: 1, l: "Spines" }), roll("1d10", "Spines", [1, 8, null, "-"], [9, 9, note("Retractable spines."), "Retractable"], [10, 10, venom(), "Venomous"])],
    [choose("Long Spines again", { note: "Retractable spines.", label: "Retractable" }, { ...venom(), label: "Venom (Average)" }, { ...bump("Horns"), label: "+1 Damage" })]] },
  "Magic Numbers": { grants: [T("Super Numerate")] },
  "Magnetic Presence": { levels: [[T("Inspiring", { x: 3 }), T("Public Speaker", { x: 3 }), T("Master Orator")], [T("Inspiring"), T("Public Speaker"), T("Master Orator")]] },
  "Malign Sorcerer": { grants: [{ patron: {
      nurgle: [T("Chaos Magic", { s: "Nurgle" })], slaanesh: [T("Chaos Magic", { s: "Slaanesh" })], tzeentch: [T("Chaos Magic", { s: "Tzeentch" })],
      khorne: [note("Khorne's Chosen cannot gain Malign Sorcerer.")] },
    else: [roll("1d100", "Lore",
      [1, 16, T("Arcane Magic", { s: "Daemonology" }), "Daemonology"], [17, 32, T("Arcane Magic", { s: "Necromancy" }), "Necromancy"],
      [33, 48, T("Arcane Magic", { s: "Witchcraft" }), "Witchcraft"], [49, 64, T("Chaos Magic", { s: "Nurgle" }), "Nurgle"],
      [65, 80, T("Chaos Magic", { s: "Slaanesh" }), "Slaanesh"], [81, 100, T("Chaos Magic", { s: "Tzeentch" }), "Tzeentch"])] }] },
  "Mark of Chaos": { grants: [hitloc("Mark")] },
  "Massive Intellect": { grants: [ch("ag", "-1d10"), roll("1d10", "Head", [1, 9, note("Head doubles in size: Arms or Body hit locations that roll doubles strike the Head."), "Doubled"],
    [10, 10, note("Skull cracked open: hits to the Head gain Damaging even through a helmet; an unhelmed called shot is a Critical Wound."), "Cracked"])] },
  "Metamorphosis": { grants: [choose("Metamorphosis", T("Artistic"), T("Pharmacist"), T("Surgery"))] },
  "Miasma of Terror": { grants: [R("Terror", { s: "1", max: true })] },
  "Monstrous Growth": { grants: [size(1, {
    avg: [ch("move", 1), ch("s", 10), ch("t", 10)],
    lrg: [ch("move", 2), ch("s", 15), ch("t", 15), ch("ag", -5)],
    enor: [R("Stride"), ch("s", 10), ch("t", 5), ch("ag", -10), A("Monstrous Hide", 1)],
    mnst: [ch("move", 2), ch("s", 20), ch("t", 10), ch("ag", -10), A("Monstrous Hide", 1)] }),
    note("Wounds follow the new Size automatically.")] },
  "Nihilistic Numbness": { grants: [T("Fearless", { s: "All" }), R("Painless")] },
  "Oracle": { grants: [S("Augury", 10, { c: "int", ref: "Winds of Magic p44" })] },
  "Organic Crystal": { grants: [T("Magical Sense"), T("Detect Artefact")] },
  "Overgrown Arm": { grants: [T("Strike Mighty Blow"), note("Strike Mighty Blow only applies to attacks with the overgrown arm.")] },
  "Petrifying Gaze": { grants: [R("Petrifying Gaze")] },
  "Piercing Tongue": { grants: [roll("1d10", "Piercing Tongue", [1, 8, null, "-"], [9, 10, venom(), "Venom (Average)"])] },
  "Pin Head": { grants: [R("Stupid")] },
  "Pincer Claw": { grants: [R("Weapon", { d: 4, l: "Pincer Claw" }), R("Constrictor"), { ...PS("Carapace"), locs: ["rArm"] },
    note("Protective Skin (Carapace) covers the clawed arm only (set to the right arm; edit the armour item if it is the left).")] },
  "Painful Boils": { grants: [ch("ag", "-1d10"), ch("t", "-1d10")] },
  "Pitiful Stature": { grants: [size(-1, {
    enor: [ch("move", -2), ch("s", -20), ch("t", -10), ch("ag", 10), note("-1 Armour: lower any natural armour by hand.")],
    lrg: [ch("s", -10), ch("t", -5), ch("ag", 10), note("-1 Armour and lose Stride: by hand.")],
    avg: [ch("move", -2), ch("s", -15), ch("t", -15), ch("ag", 5)],
    sml: [ch("move", -1), ch("s", -10), ch("t", -10)],
    ltl: [ch("s", -5), ch("t", -5)],
    tiny: [ch("move", -1), ch("s", -5), ch("t", -5)] }),
    note("Wounds follow the new Size automatically.")] },
  "Possessed": { grants: [roll("1d100", "Possessed",
    [1, 25, T("Menacing"), "Khorne"], [26, 50, T("Resistance", { s: "Disease" }), "Nurgle"],
    [51, 75, T("Attractive"), "Slaanesh"], [76, 100, T("Cat-tongued"), "Tzeentch"])] },
  "Prince of Nothing": { grants: [T("Commanding Presence")] },
  "Protective Skin": { grants: [variant("Protective Skin", "protective-skin", {
    "Leathery Hide": [A("Protective Skin (Leathery Hide)", 1, { q: ["flexible"] })],
    "Fur": [A("Protective Skin (Fur)", 1, { q: ["flexible"], text: "Immune to Exposure (Cold), double effects from Exposure (Heat)." })],
    "Feathers": [A("Protective Skin (Feathers)", 1, { q: ["flexible"] })],
    "Rubbery": [A("Protective Skin (Rubbery Skin)", 1, { q: ["flexible"] })],
    "Bark": [A("Protective Skin (Bark)", 1)],
    "Scales": [A("Protective Skin (Scales)", 2, { q: ["flexible"] })],
    "Carapace": [A("Protective Skin (Carapace)", 2, { q: ["impenetrable"], f: ["weakpoints"] })],
    "Metal Plating": [A("Protective Skin (Metal Plating)", 3, { q: ["impenetrable"], f: ["weakpoints"], text: "-10 Stealth." }),
      dlg("Metal Plating: Stealth -10", { modifier: -10 }, { skills: ["Stealth"] }, true)],
    "Arcane Runes": [A("Protective Skin (Arcane Runes)", 2, { text: "Only against non-magical attacks; non-magical weapons gain Undamaging against you." })] })] },
  "Quantum Bulge": { grants: [T("Orientation")] },
  "Rebellious Mind": { grants: [T("Impassioned Zeal")] },
  "Regeneration": { grants: [R("Regenerate"), roll("1d10", "Regeneration", [1, 9, null, "-"], [10, 10, R("Die Hard"), "Die Hard"])] },
  "Running Sores": { grants: [hitloc("Sores", ch("fel", -10))] },
  "Rotting Flesh": { grants: [R("Infected"), R("Infestation")] },
  "Saint of the Damned": { grants: [choose("Saint of the Damned", T("Attractive"), T("Cat-tongued"))] },
  "Savage Grace": { grants: [T("Combat Master"), T("Relentless")] },
  "Savage Mind": { grants: [T("Animal Affinity")] },
  "Scrying Touch": { grants: [S("Psychometry", 10, { c: "int", ref: "Winds of Magic p47" })] },
  "Sensory Loss": { grants: [roll("1d10", "Sense",
    [1, 2, note("Hearing: remove Acute Sense (Hearing) and add 1d10 permanent Deafened by hand."), "Hearing"],
    [3, 4, note("Sight: remove Acute Sense (Sight) and add 1d10 permanent Blinded by hand."), "Sight"],
    [5, 6, note("Smell: remove Acute Sense (Smell) by hand."), "Smell"],
    [7, 8, note("Taste: remove Acute Sense (Taste) by hand."), "Taste"],
    [9, 10, [R("Painless"), ch("ws", "-1d10"), ch("dex", "-2d10"), note("Touch: remove Acute Sense (Touch) by hand.")], "Touch"])] },
  "Slimy": { grants: [T("Contortionist")] },
  "Sniffing Stalker": { grants: [T("Acute Sense", { s: "Smell" }), S("Track", 10), R("Tracker")] },
  "Soft-hearted": { grants: [T("Impassioned Zeal")] },
  "Spiderkin": { grants: [R("Wallcrawler"), R("Web"), note("Web rating T, range SB x3; Wallcrawler movement 5.")] },
  "Split Torso": { grants: [R("Terror", { s: "1", max: true })] },
  "Suspicious Mind": { levels: [[P("Prejudice", { ask: "Target of your suspicion", opts: SUSPECTS }), T("Nose for Trouble"), note("You also gain Fear 1 towards your Target (no item).")], [P("Prejudice", { ask: "Additional Target of your suspicion", opts: SUSPECTS })]] },
  "Swarmform": { grants: [R("Swarm", { off: true }), note("Swarm is added switched off: enable it while in swarmform.")] },
  "Tail": { grants: [variant("Tail", "tail", {
    "Balanced": [], "Mace": [R("Weapon", { d: 3, l: "Mace Tail", q: ["pummel"] })], "Prehensile": [],
    "Saurian": [R("Tail Attack", { d: 2 })], "Scorpion": [R("Weapon", { d: 3, l: "Scorpion Stinger", q: ["impale"] }), venom()] })] },
  "The Big Joke": { grants: [T("Fearless", { s: "All" })] },
  "Third Eye": { grants: [T("Sure Shot")] },
  "Thorns": { grants: [roll("1d10", "Thorns", [1, 7, null, "-"], [8, 10, venom(), "Poisonous"])] },
  "Twisted Body": { grants: [ch("ag", "-2d10"), ch("t", "-1d10")] },
  "Touched": { grants: [choose("Touched", T("Second Sight"), T("Sixth Sense"))] },
  "Unbelievable Tumour": { grants: [hitloc("Tumour"), roll("1d10", "Weight (1d10 x 10 lb; +1 Wound and a roll per 30 lb)",
    [1, 2, note("Under 30 lb: no further effect."), "10-20 lb"],
    [3, 5, tumour(1), "30-50 lb"], [6, 8, tumour(2), "60-80 lb"], [9, 10, tumour(3), "90-100 lb"])] },
  "Unending Malice": { grants: [T("Frightening")] },
  "Unnatural Arms": { grants: [body("arms", "Unnatural Body", "unnatural-body")] },
  "Unnatural Body": { grants: [body("all", "Unnatural Body", "unnatural-body")] },
  "Unnatural Head": { grants: [body("head", "Unnatural Body", "unnatural-body")] },
  "Unnatural Legs": { grants: [body("legs", "Unnatural Body", "unnatural-body")] },
  "Unhealing Wound": { grants: [hitloc("Wound", ch("fel", -10))] },
  "Unseen Presence": { grants: [T("Beneath Notice")] },
  "Warp Spasm": { grants: [T("Frenzy"), T("Berserk Charge"), T("Contortionist"), R("Painless", { off: true }), R("Fear", { s: "1", off: true }),
    note("Painless and Fear 1 are added switched off: enable them during a Warp Spasm.")] },
  "Wings": { levels: [[variant("Wings", "wings", {
    "Small": [T("Strong Legs")], "Medium": [R("Flight", { s: "30" })], "Large": [R("Flight", { s: "60" })], "Huge": [R("Flight", { s: "120" })] })],
    [note("Your wings grow by one degree: raise the Flight rating by hand (Small > Medium 30 > Large 60 > Huge 120).")]] }
};

// Bestial / Unnatural Body parts. Armour and Protective Skin cover only the part's hit locations.
export const PARTS = {
  "Bestial Body - Amphibian": {
    arms: [R("Amphibious"), M("Bachtrachian Suckers"), PS("Rubbery"), ch("dex", -10)],
    body: [M("Cold-Blooded"), PS("Rubbery")],
    legs: [R("Amphibious"), M("Hopper"), PS("Rubbery")],
    head: [PS("Rubbery")] },
  "Bestial Body - Arthropods": {
    arms: [M("Pincer Claw"), PS("Carapace")], body: [M("Cold-Blooded"), PS("Carapace")],
    legs: [PS("Carapace"), ch("move", -1)], head: [PS("Carapace"), M("Eyestalks")] },
  "Bestial Body - Bat": {
    arms: [PS("Leathery Hide"), M("Razor-sharp Claws")], body: [PS("Leathery Hide"), wings("Medium")],
    legs: [PS("Leathery Hide"), ch("move", -2)], head: [R("Dark Vision", { l: "Sonar" }), M("Fangs"), PS("Leathery Hide")] },
  "Bestial Body - Bear": {
    arms: [M("Razor-sharp Claws"), PS("Fur"), ch("s", 15), ch("dex", -10)], body: [T("Hardy"), PS("Fur"), ch("t", 10)],
    legs: [PS("Fur"), T("Sturdy")], head: [R("Bite", { d: 5 }), PS("Fur")] },
  "Bestial Body - Bird": {
    arms: [PS("Feathers")], body: [M("Hollow Bones"), PS("Feathers"), wings("Medium")],
    legs: [M("Razor-sharp Claws"), PS("Feathers")],
    head: [choose("Bird head", T("Acute Sense", { s: "Sight" }), T("Night Vision")), R("Bite", { d: 1, l: "Beak" }), PS("Feathers")] },
  "Bestial Body - Bovine": {
    arms: [PS("Leathery Hide"), ch("s", 10), ch("dex", -5)], body: [PS("Leathery Hide"), T("Strong Back"), ch("t", 10)],
    legs: [PS("Leathery Hide"), T("Sturdy"), choose("Bovine legs", ch("move", 1), M("Centauroid"))],
    head: [R("Horns", { d: 2 }), T("Iron Jaw"), PS("Leathery Hide")] },
  "Bestial Body - Canine": {
    arms: [PS("Fur")], body: [PS("Fur"), S("Endurance", 10)],
    legs: [PS("Fur"), T("Strider", { s: "Woodlands" })], head: [R("Bite", { d: 3 }), PS("Fur"), M("Sniffing Stalker")] },
  "Bestial Body - Caprine": {
    arms: [PS("Fur")], body: [PS("Fur"), T("Hardy")],
    legs: [PS("Fur"), T("Strider", { s: "Rocky" }), ch("move", 1)], head: [R("Horns", { d: 1 }), T("Iron Jaw"), PS("Fur")] },
  "Bestial Body - Cervid": {
    arms: [PS("Leathery Hide")], body: [PS("Leathery Hide"), S("Endurance", 10)],
    legs: [PS("Leathery Hide"), T("Strider", { s: "Woodlands" }), choose("Cervid legs", ch("move", 1), M("Centauroid"))],
    head: [M("Horns"), T("Iron Jaw"), PS("Leathery Hide")] },
  "Bestial Body - Feline": {
    arms: [M("Razor-sharp Claws"), PS("Fur")], body: [PS("Fur"), tail("Balanced"), ch("ag", 10)],
    legs: [PS("Fur"), T("Strong Legs")], head: [R("Bite", { d: 3 }), T("Night Vision"), PS("Fur"), R("Tracker")] },
  "Bestial Body - Fish": {
    arms: [R("Amphibious"), PS("Scales")], body: [M("Cold-Blooded"), PS("Scales")],
    legs: [R("Amphibious"), PS("Scales"), choose("Fish legs", ch("move", -1), { note: "Fish tail: Movement 1 on land and 8 in water (by hand).", label: "Fish tail" })],
    head: [R("Bite", { d: 3 }), M("Aquatic Adaptation"), PS("Scales")] },
  "Bestial Body - Horse or Camel": {
    arms: [PS("Leathery Hide")], body: [choose("Horse or Camel body", M("Hump"), T("Strong Back")), PS("Leathery Hide"), ch("t", 10)],
    legs: [PS("Leathery Hide"), T("Sturdy"), choose("Horse or Camel legs", ch("move", 1), M("Centauroid"))],
    head: [T("Iron Jaw"), PS("Leathery Hide")] },
  "Bestial Body - Insect": {
    arms: [PS("Carapace"), R("Wallcrawler")], body: [M("Cold-Blooded"), PS("Carapace"), choose("Insect body", tail("Scorpion"), wings("Medium"))],
    legs: [PS("Carapace"), R("Wallcrawler"), choose("Insect legs", T("Strong Legs"), M("Centauroid"))],
    head: [M("Insect Eyes"), PS("Carapace"), choose("Insect head", R("Bite", { d: 3 }), [R("Bite", { d: 1 }), venom()])] },
  "Bestial Body - Lizard": {
    arms: [PS("Scales"), choose("Lizard arms", R("Wallcrawler"), T("Strong Swimmer"))], body: [M("Cold-Blooded"), PS("Scales"), tail("Saurian")],
    legs: [PS("Scales"), choose("Lizard legs (1)", R("Wallcrawler"), T("Strong Swimmer")), choose("Lizard legs (2)", T("Strong Legs"), M("Centauroid"))],
    head: [R("Bite", { d: 3 }), PS("Scales")] },
  "Bestial Body - Mollusks": {
    arms: [PS("Rubbery"), R("Tentacles", { d: 3 }), ch("dex", -20)], body: [M("Cold-Blooded"), PS("Rubbery"), T("Contortionist"), ch("ag", 10)],
    legs: [PS("Rubbery"), choose("Mollusk legs", [R("Tentacles", { d: 3 }), ch("move", -2)], M("Blob"))],
    head: [R("Bite", { d: 2, l: "Beak" }), PS("Rubbery"), M("Aquatic Adaptation")] },
  "Bestial Body - Mustelidae": {
    arms: [M("Razor-sharp Claws"), PS("Fur")], body: [T("Contortionist"), ch("ag", 10)],
    legs: [PS("Fur"), T("Step Aside")], head: [R("Bite", { d: 2 }), ch("i", 10)] },
  "Bestial Body - Pachyderm": {
    arms: [PS("Leathery Hide"), ch("s", 15)], body: [PS("Leathery Hide"), T("Robust"), T("Strong Back")],
    legs: [PS("Leathery Hide"), T("Sturdy"), choose("Pachyderm legs", ch("move", 1), M("Centauroid"))],
    head: [choose("Pachyderm head", R("Horns", { d: 3, l: "Tusks" }), R("Bite", { d: 5 })), PS("Leathery Hide")] },
  "Bestial Body - Primate": {
    arms: [R("Arboreal"), PS("Fur"), ch("s", 10)], body: [PS("Fur"), choose("Primate body", ch("t", 10), [ch("ag", 10), tail("Prehensile")])],
    legs: [M("Prehensile Feet"), PS("Fur")], head: [R("Bite", { d: 2 }), PS("Fur")] },
  "Bestial Body - Rodent": {
    arms: [PS("Fur")], body: [T("Contortionist"), ch("ag", 10)],
    legs: [choose("Rodent legs", R("Bounce"), T("Step Aside")), PS("Fur")],
    head: [choose("Rodent head", T("Acute Sense", { s: "Hearing" }), T("Acute Sense", { s: "Smell" })), M("Gnawer"), ch("i", 10)] },
  "Bestial Body - Snake": {
    arms: [PS("Scales")], body: [M("Cold-Blooded"), PS("Scales"), T("Contortionist"), ch("ag", 10)],
    legs: [PS("Scales"), choose("Snake legs", { note: "Legs stay (Protective Skin only).", label: "Keep legs" }, [T("Contortionist"), ch("ag", 5),
      dlg("No legs: Climb -20", { modifier: -20 }, { skills: ["Climb"] }, true),
      dlg("No legs: jumping -20", { modifier: -20 }, { skills: ["Athletics"] }, false), note("No legs: you slither instead of walking.")])],
    head: [R("Bite", { d: 2 }), venom(), PS("Scales")] },
  "Bestial Body - Spider": {
    arms: [PS("Carapace"), R("Wallcrawler")], body: [M("Cold-Blooded"), PS("Carapace"), M("Spiderkin")],
    legs: [PS("Carapace"), T("Strong Legs"), R("Wallcrawler")], head: [R("Bite", { d: 1 }), venom(), M("Insect Eyes"), PS("Carapace")] },
  "Bestial Body - Swine": {
    arms: [PS("Leathery Hide")], body: [PS("Leathery Hide"), T("Hardy")],
    legs: [PS("Leathery Hide"), T("Strider", { s: "Woodlands" }), choose("Swine legs", ch("move", 1), M("Centauroid"))],
    head: [R("Horns", { d: 2, l: "Tusks" }), PS("Leathery Hide"), M("Sniffing Stalker")] },

  "Unnatural Body - Crystal": {   // "per arm" / "per leg" counts two of each
    arms: [R("Magical"), R("Painless"), imm("Fire"), A("Crystal Body", 4), ch("ag", -5), ch("t", 5), ch("wounds", -2)],
    legs: [R("Magical"), R("Painless"), imm("Fire"), A("Crystal Body", 4), ch("ag", -5), ch("t", 5), ch("wounds", -2)],
    body: [R("Magical"), R("Painless"), imm("Fire"), A("Crystal Body", 4), ch("t", 10), ch("ag", -5), ch("wounds", -2)],
    head: [R("Magical"), R("Painless"), imm("Fire"), A("Crystal Body", 4), ch("i", -5), ch("wounds", -1)] },
  "Unnatural Body - Daemonic": {
    arms: [R("Magical"), R("Daemonic", { s: "10", max: true }), choose("Daemonic arms", A("Daemonic Hide", 1, { label: "+1 AP" }), M("Razor-sharp Claws"), ch("s", 10))],
    legs: [R("Magical"), R("Daemonic", { s: "10", max: true }), choose("Daemonic legs", T("Strong Legs"), ch("move", 1), T("Sturdy"))],
    body: [R("Magical"), R("Daemonic", { s: "9", max: true }), R("Fear", { s: "2", max: true }), ch("t", 10)],
    head: [R("Magical"), R("Daemonic", { s: "10", max: true }), R("Fear", { s: "1", max: true }), choose("Daemonic head", T("Night Vision"), M("Fangs"), M("Horns"))] },
  "Unnatural Body - Fenbeast": {
    arms: [R("Magical"), R("Infected"), R("Regenerate")], legs: [R("Magical"), R("Regenerate"), T("Strider", { s: "Swamp" })],
    body: [R("Magical"), R("Infected"), R("Regenerate"), R("Die Hard"), ch("t", 10)], head: [R("Magical"), R("Infected"), R("Regenerate"), M("Dark Vision")] },
  "Unnatural Body - Mechanoid": {
    arms: [R("Magical"), A("Mechanoid Plating", 3), choose("Mechanoid arms", { ...ch("s", 10), label: "+5 Strength per arm (+10)" }, T("Strike Mighty Blow"))],
    legs: [R("Magical"), A("Mechanoid Plating", 3), roll("1d10", "Mechanoid legs",
      [1, 5, [T("Strong Legs"), T("Sprinter")], "Piston Legs"], [6, 7, [R("Stride"), ch("move", 4), note("Wheels: Movement 1 on stairs (by hand).")], "Wheels"],
      [8, 8, note("Hover: levitate up to 2 yards."), "Hover"], [9, 10, [R("Stride"), ch("move", 2)], "Tracks"])],
    body: [R("Magical"), A("Mechanoid Plating", 3), ch("s", 10), ch("t", 20), ch("ag", -10)],
    head: [R("Magical"), A("Mechanoid Plating", 3), ch("wp", 10), chooseN(2, "Mechanoid head: pick two", T("Iron Jaw"), R("Bite", { d: 3 }), M("Dark Vision"), T("Acute Sense", { s: "Sight" }), T("Super Numerate"), T("Tower of Memories"))] },
  "Unnatural Body - Metal": {   // "-5 Agility per arm/leg": two of each
    arms: [R("Magical"), R("Painless"), imm("Fire"), imm("Cold"), A("Metal Body", 3), ch("s", 5), ch("ag", -10)],
    legs: [R("Magical"), R("Painless"), imm("Fire"), imm("Cold"), A("Metal Body", 3), ch("s", 5), ch("ag", -10)],
    body: [R("Magical"), R("Painless"), imm("Fire"), imm("Cold"), A("Metal Body", 3), ch("t", 30)],
    head: [R("Magical"), R("Painless"), imm("Fire"), imm("Cold"), A("Metal Body", 3), ch("i", -10)] },
  "Unnatural Body - Rock": {
    arms: [R("Magical"), R("Painless"), A("Rock Body", 2), ch("s", 5), ch("ag", -10)], legs: [R("Magical"), R("Painless"), A("Rock Body", 2), ch("s", 5), ch("ag", -10)],
    body: [R("Magical"), R("Painless"), A("Rock Body", 2), ch("t", 20)], head: [R("Magical"), R("Painless"), A("Rock Body", 2), ch("i", -5)] },
  "Unnatural Body - Undead": {
    arms: [R("Magical"), R("Painless"), R("Die Hard")], legs: [R("Magical"), R("Painless"), R("Die Hard")],
    body: [R("Magical"), R("Painless"), R("Die Hard"), R("Undead"), R("Fear", { s: "2", max: true })],
    head: [R("Magical"), R("Painless"), M("Dark Vision"), R("Die Hard"), R("Fear", { s: "1", max: true }), R("Immunity to Psychology")] }
};
