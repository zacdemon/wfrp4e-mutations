import { powerItemButtons, oracleButton, oracleEndButton, frightButton, lunacyButton, regenerationButton, critRollScriptData, critDealtScriptData, POWER_BUTTONS, powerButton, powerRestButton } from "../scripts/modifier-scripts.mjs";

/**
 * Fixed modifiers for the Mutant's Handbook items. `node tools/modifiers.mjs` writes them into
 * src/packs/items as a "<Mutation> (Modifiers)" effect (see scripts/modifier-scripts.mjs).
 *
 *   c(k, n)                      ActiveEffect change: characteristic k (ws..fel) or "move" +n
 *   wounds(n)                    +n max Wounds (woundCalc script)
 *   half(k)                      halve characteristic k or "move", rounded up
 *   test(label, mod, when, on)   dialog option (situational test modifier); on = ticked by default
 *   toggle(label, [c(...)...])   a separate effect on the item, switched off, for "while X" modifiers
 *   cap(k, n)                    characteristic k can never be higher than n
 *   targ(label, mod, when, on)   option in the dialog of whoever targets the mutant (when/on: the
 *                                attacker's test)
 *   script(scriptData)           any other script (buttons on the effect, Critical modifiers)
 *   flag({...})                  extra flags on the effect (Lunacy phase keys)
 *
 * Modifiers that are rolled (1d10), chosen, or depend on a rolled sub-result (hit location, body
 * part, size step) are in tools/grants-data.mjs instead. Each copy of a mutation carries its own
 * effect, so repeated mutations add their modifiers again (p10).
 */

const c = (k, v) => ({ c: k, v });
const wounds = (v) => ({ wounds: v });
const half = (k) => ({ half: k });
const test = (label, mod, when = {}, on = false) => ({ test: { label, mod, when, on } });
const toggle = (label, list) => ({ toggle: label, list });
const cap = (k, v) => ({ cap: k, v });
// targ(): an option in the dialog of whoever targets the mutant (system "targeter" dialog scripts)
const targ = (label, mod, when = {}, on = false) => ({ test: { label, mod, when, on, targeter: true } });
const script = (d) => ({ script: d });
const flag = (f) => ({ flag: f });                               // extra flags on the effect

const FEL = { chars: ["fel"] };
const ANY = { any: true };
const STEALTH = { skills: ["Stealth"] };
const m = (n) => ({ modifier: n });
const scene = (what) => toggle(`${what}: -10 Fellowship (rest of the scene)`, [c("fel", -10)]);

export const MODS = {
  "Aberrant Agility": [c("ag", 10), c("fel", -5)],
  "Aethyric Leak": [c("int", -5), c("i", -5)],
  "Albino": [c("fel", -10)],
  "Alien Mind": [c("fel", -20), test("Alien Mind: resist mind-influencing magic and abilities +20", m(20), { chars: ["wp"] }),
    targ("Alien Mind (target): reading their emotions, thoughts or motives -30", m(-30), { skills: ["Intuition"] }, true),
    targ("Alien Mind (target): reading their mind with magic or telepathy -30", m(-30), { chars: ["wp"], cast: true })],
  "Anti-magic Aura": [c("i", -10), c("int", -10), c("wp", -10)],
  "Barrel Chest": [c("t", 10), c("ag", -10), c("fel", -5)],
  "Beast Alpha": [test("Beast Alpha: command a domestic (Broken) animal +20", m(20), { chars: ["wp"] }),
    test("Beast Alpha: command a monster -20", m(-20), { chars: ["wp"] })],
  "Beset by Tragedy": [scene("Bawling")],
  "Bestial Head": [c("fel", -20)],
  "Bizarre Colouration": [test("Bizarre Colouration: Stealth -10", m(-10), STEALTH, true)],
  "Blob": [half("move"), c("ag", -20), c("t", 10)],
  "Brain Rot": [c("fel", -5)],
  "Broken Mind": [c("int", -20), c("i", -20)],
  "Bulging Eyes": [c("fel", -10)],
  "Cadaverously Thin": [c("ag", 5), c("t", -5), c("fel", -5)],
  "Centauroid": [c("move", 2), c("t", 10), c("ag", -10)],
  "Chameleon Skin": [test("Chameleon Skin: blending in +20 Stealth", m(20), STEALTH)],
  "Chthonian Crawler": [test("Chthonian Crawler: armed fighting -20", m(-20), { weapon: "melee" }, true)],
  "Clubfoot": [c("move", -1), c("ag", -5), c("fel", -5)],
  "Cold-Blooded": [c("fel", -10)],
  "Contagious Madness": [c("int", -10)],
  "Corrosive Vomit": [test("Corrosive Vomit: Stealth -10", m(-10), STEALTH, true)],
  "Crawling Skin": [c("fel", -30)],
  "Distended Digits": [c("fel", -5)],
  "Enlarged Sensory Organ": [c("fel", -5)],
  "Entrancement": [test("Entrancement: social Test with someone you entranced +20", m(20), FEL),
    test("Entrancement: Stealth near sentient beings -20", m(-20), STEALTH, true)],
  "Excessive Vanity": [scene("Vanity strikes")],
  "False Tongue": [scene("Caught lying")],
  "Featureless Face": [c("fel", -30)],
  "Forgetful Mind": [c("i", -5), scene("Zoned out")],
  "Freakish Quickness": [c("i", 10)],
  "Glowing Skin": [test("Glowing Skin: visibility-based Stealth -20", m(-20), STEALTH, true)],
  "Grossly Corpulent": [wounds(1), c("s", 5), c("t", 5), c("move", -1), c("fel", -5)],
  "Grotesque Skin": [c("fel", -20)],
  "Hairless": [c("fel", -5)],
  "Hideous Appearance": [cap("fel", 0)],
  "Hopper": [c("move", -2)],
  "Horrible Stench": [c("fel", -10)],
  "Hubris": [test("Hubris: social Test to take the spotlight, claim glory or deflect criticism +10", m(10), FEL),
    test("Hubris: helping someone else to glory, or appearing humble -10", m(-10), ANY)],
  "Hulking Brute": [c("s", 10), c("t", 10), c("ag", -10), c("int", -10)],
  "Hunchback": [c("move", -1), c("fel", -5)],
  "Hungering Maw": [test("Hungering Maw: dealing with Ogres +20", m(20), FEL)],
  "Imminent Precognition": [c("i", 10), c("fel", -10)],
  "Inhuman Beauty": [c("fel", 10)],
  "Insect Eyes": [c("fel", -20)],
  "Lolling Tongue": [test("Lolling Tongue: speaking -10", m(-10), { skills: ["Language"] }, true)],
  "Lunacy": [script(lunacyButton()),
    toggle("Morrslieb absent", [c("i", -10), c("wp", -10), flag({ phase: "absent" })]),
    toggle("Morrslieb small", [c("i", -5), c("wp", -5), flag({ phase: "small" })]),
    toggle("Morrslieb large", [c("i", 5), c("wp", 5), flag({ phase: "large" })]),
    toggle("Morrslieb full (+1 Fortune)", [c("i", 10), c("wp", 10), flag({ phase: "full" })])],
  "Magnetic Presence": [c("fel", 10), test("Magnetic Presence: Stealth near sentient beings -30", m(-30), STEALTH, true)],
  "Mark of Chaos": [test("Mark of Chaos: showing it to a Chaos worshipper +5", m(5), FEL),
    test("Mark of Chaos: showing it to a worshipper of the same God +10", m(10), FEL)],
  "Massive Intellect": [c("int", 20), c("i", 10)],
  "Metallic Skeleton": [c("t", 10)],
  "Midnight Skin": [test("Midnight Skin: in shadows and darkness +20 Stealth", m(20), STEALTH)],
  "Morbidity": [c("fel", -10)],
  "Nervous Jitters": [c("i", 5), c("bs", -5), c("dex", -5)],
  "Nihilistic Numbness": [c("fel", -10)],
  "Fright": [script(frightButton())],
  "Oracle": [script(oracleButton()), toggle("Sensing the future (+10 Initiative)", [c("i", 10), script(oracleEndButton())])],
  "Organic Crystal": [test("Organic Crystal: opposing an incoming spell -10", m(-10), { chars: ["wp"], skills: ["Dodge"] })],
  "Overgrown Arm": [c("s", 10), c("dex", -10), c("ag", -5)],
  "Painseeker": [toggle("Wounded or wounding (1d10 Rounds)", [c("s", 5), c("t", 5), c("wp", 5)])],
  "Power Item Obsession": powerItemButtons().map(script),
  "Prehensile Feet": [c("move", -1), test("Prehensile Feet: Climb, add Agility Bonus to SL", { slFrom: "ag" }, { skills: ["Climb"] }, true)],
  "Quantum Bulge": [c("fel", -5)],
  "Regeneration": [script(regenerationButton())],
  "Regression": [test("Regression: pushing through a challenge or failure -10", m(-10), { chars: ["wp"] })],
  "Savage Grace": [c("ws", 5), c("ag", 10), test("Savage Grace: blending in among people -10", m(-10), STEALTH)],
  "Savagery": [c("ws", 5), c("bs", -5), script(critRollScriptData("Savagery: +10 to Critical Wounds you inflict", 10)),
    script(critDealtScriptData("Savagery: +10 to Critical Wounds from damage you deal (Up in Arms Criticals)", 10))],
  "Shapeshifter": [test("Shapeshifter: keeping your shape when Wounded (-10 per Wound lost)",
    { expr: "args.fields.modifier -= 10 * Math.max(0, (Number(this.actor.system.status.wounds.max) || 0) - (Number(this.actor.system.status.wounds.value) || 0));" }, { skills: ["Endurance"] })],
  "Skinwalker": [targ("Skinwalker (target): seeing through their stolen form with Second Sight -20", m(-20), { skills: ["Perception", "Intuition"] })],
  "Skin Pouch": [test("Skin Pouch: hiding the pouch from a search +20", m(20), STEALTH)],
  "Skinned Alive": [c("fel", -20)],
  "Slimy": [c("fel", -10), test("Slimy: escaping a Grapple +20", m(20), { chars: ["s"] })],
  "Soft-hearted": [test("Soft-hearted: hurting or exploiting someone -10", m(-10), ANY),
    test("Soft-hearted: helping or showing kindness +10", m(10), ANY)],
  "Soul Destruction": [c("wp", -20)],
  "Spilled Guts": [c("fel", -5)],
  "Split Torso": [c("ag", -10)],
  "Tantalising Aura": [test("Tantalising Aura: Stealth near sentient beings -20", m(-20), STEALTH, true)],
  "Telepathy": [test("Telepathy: plundering memories -30", m(-30), { chars: ["wp"] })],
  "The Big Joke": [c("fel", -10)],
  "Third Eye": [c("bs", 10)],
  "Ticks": [c("i", -10)],
  "Twisted Body": [c("move", -1)],
  "Unending Malice": [test("Unending Malice: hurting or exploiting someone +10", m(10), ANY),
    test("Unending Malice: helping or showing kindness -10", m(-10), ANY)],
  "Unhealing Wound": [wounds(-1)],
  "Unnatural Head": [c("fel", -20)],
  "Urgent Profanity": [c("fel", -10)],
  "Vestigial Twin": [c("ag", -10)]
};

// Test-activated powers: an "Activate X" button on the mutation's Modifiers effect (first copy only).
for (const [key, [name]] of Object.entries(POWER_BUTTONS)) {
  MODS[name] = [...(MODS[name] ?? []), script(powerButton(key))];
  if (key === "dimensionalInstability") MODS[name].push(script(powerRestButton(key)));
}

// Mutations with modifiers in the text that are left to the GM, and why (shown in the README).
export const MANUAL = {
  "Atrophy": "what a withered part costs depends on the part (GM call)",
  "Blissful Ignorance": "always last in Initiative order is a combat-tracker rule, not a value",
  "Bodysnatcher Drone": "-2d10 Willpower falls on the drone's victim, and the drone is its own creature",
  "Chimeran Curse": "you take the physical Characteristics of another creature",
  "Crossbreed": "Characteristics move a share of the way to another species' table",
  "Ecstatic Milk": "the bonuses go to whoever drinks the milk, for 4 hours",
  "Elongated Limbs": "the neck's +20 to head Criticals is automatic only for wound Criticals with Up in Arms Criticals on (attack-roll Criticals and core-rules wound Criticals: add it in the Critical prompt)",
  "Fleshcrafter": "trades Characteristic points per SL as the GM rules",
  "Magic Numbers": "Initiative drops to 0 only in the situations the GM picks",
  "Pitiful Stature": "the -1 Armour steps (Monstrous to Large) are by hand; Characteristics and Movement are automated",
  "Symbiotic Twins": "the twin is a separate actor",
  "Temporal Instability": "Activate Temporal Instability rolls the Test and the ageing 1d10 (age +1 on a 10); the extra Move and Action are turn economy",
  "Turnskin": "you take Beastman base Characteristics",
  "Vestigial Twin": "the twin's own profile (your -10 Agility is automated)",
  "Werebeast": "Activate Werebeast applies the Morrslieb modifier to the transformation Test; the Bestial Body attributes of the form are by hand",
  "Alien Mind": "the Cool Test (or Stunned) for telepaths who connect to you is the GM's call",
  "Lunacy": "press Activate Lunacy at nightfall or when Morrslieb changes; the module does not track the moon",
  "Oracle": "press End Oracle when the scene ends (the system has no scene duration)",
  "Painseeker": "switch on the effect when it triggers; it does not stack",
  "Savagery": "+10 is automatic on attack-roll Criticals and, with Up in Arms Criticals, on wound Criticals; with core-rules wound Criticals add it in the Critical prompt",
  "Skinwalker": "the -20 is offered (unticked) to observers who target you; without Second Sight they are simply fooled (GM)",
  "Shapeshifter": "the Endurance option is offered unticked (only while Wounded in an assumed shape); fooling observers without Second Sight is the GM's call"
};
