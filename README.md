# wfrp4e-mutations
WFRP4E module for Foundry based on the Mutation's Handbook by Anders Hellspong

## Unreleased: handbook mutation flow
- New world setting **Use Mutant's Handbook rules** (on by default). A failed Dissolution of Body and Mind test (and `/table corruption`, `mutatephys`, `mutatemental` or their `@Table` links) runs the handbook flow instead of the system's: species type roll (p8), Corruption loss of TB or WPB (p8), severity roll with +10 per mutation up to +40 (p9), source choice, the module's compendium tables (no world import needed) with "roll on the next table" and sub-tables followed automatically, and a result card where the GM adds the mutation or the player spends 1 Resilience to avoid it (p9). Chosen of Chaos lets the GM pick the patron (p74). A Chaos Spawn warning goes to the GM when the limits on p10 are passed. Turn the setting off for stock system behaviour.
- Optional rules as settings, off by default: **Keeping it Random** and **Let them off with a warning!** (p9). Also: ask for the mutation source, and the species used for species the handbook table doesn't list.
- The Generate Mutation macro is now a DialogV2 dialog that runs the same flow. The old world-script entry point `game.wfrp4eMutationRoll(actor, source)` still works.
- Uses libWrapper when it is active; otherwise patches the system directly.
- **Granted items** (world setting *Add the Talents, Traits, items and rolled modifiers a mutation grants*, on by default). 127 mutations carry an effect that adds what their text grants when the mutation lands on an actor: wfrp4e-core Talents (one more level each time, p10), Creature Traits with their damage or rating, Psychology with a prompted target, Skill advances, natural armour on the right hit locations, and linked mutations (Bestial Arms (Bat) adds Protective Skin (Leathery Hide) and Razor-sharp Claws, and so on). The in-text rolls (Fangs, Long Spines, Possessed, Malign Sorcerer...) are rolled, choices ("X or Y", "pick one", "pick two") are prompted, and sub-table results the flow recorded (Protective Skin, Wings, Tail, Corrupted Blood, Immunity, Bestial/Unnatural Body) are used; without one you can roll or pick. Repeats follow the book (Horns, Fangs and Corrosive Vomit +1 Damage; Irrational Contempt goes Prejudice, Animosity, Hatred). A GM-only card lists what was rolled and added. Deleting the mutation removes everything it added and undoes skill advances and raised ratings. The specs live in `tools/grants-data.mjs`; `node tools/grants.mjs` writes them into the item sources.
- **Characteristic, Movement, Wounds and test modifiers**, using the system's own effect machinery. Each mutation with modifiers carries a *<Mutation> (Modifiers)* effect: Characteristic and Movement changes are ActiveEffect changes (`system.characteristics.X.modifier`, `system.details.move.value`), Wounds are added by a `woundCalc` script after the size formula, and situational test modifiers are roll-dialog options (pre-ticked where they always apply, such as Bizarre Colouration's -10 Stealth; offered where they depend on the scene, such as Midnight Skin's +20 Stealth in darkness). Rolled values (Brain Rot -1d10 Intelligence, Twisted Body -2d10 Agility...) are rolled once when the mutation is added and stored as plain numbers on the effect; hit-location results (Itching Rash, Running Sores, Unhealing Wound: -10 Fellowship on the head), Bestial/Unnatural body parts, Monstrous Growth / Pitiful Stature size steps, and "X or Y" picks are applied the same way. "While X" modifiers (Lunacy's Morrslieb phases, Painseeker, Oracle, -10 Fellowship for the rest of the scene) are separate effects on the item, switched off until you need them. Each copy has its own effect, so repeats stack (p10); Characteristics never drop below 0 and Wounds never below 1. Deleting the mutation removes its effects. Fixed values live in `tools/modifiers-data.mjs` (with the list of what stays by hand); `npm run effects` rewrites both effect sets.
- **Fortune and Fate, rolls made against the mutant, and Criticals.** Fortune, Fate, Resilience and Resolve are pools the sheet spends, so they are changed by one-off updates (with a chat line), never by ActiveEffect changes: Time Warp adds 1 Fortune when it lands (taken back if deleted) and Power Item Obsession and Time Warp carry a *New session: refresh Fortune* button (Fortune = Fate + mutation bonuses). Power Item Obsession has *Power item not on me: -1 Fortune* / *Power item back* buttons; the Lunacy full-Morrslieb and Oracle effects show a *+1 Fortune* button once switched on. Buttons appear on the mutation's effect in the actor's Effects tab. Modifiers to other people's rolls use the system's targeter dialog scripts (the mechanism core Prone and Magic Resistance-style effects use): when someone targets the mutant, the option appears in *their* roll dialog: Alien Mind -30 to Intuition (pre-ticked) and to Willpower/casting attempts to read the mind (offered), Skinwalker -20 to Perception/Intuition for observers with Second Sight (offered), long arms (Elongated Limbs) +20 to melee attacks, pre-ticked when the attacker is in-fighting. Savagery adds +10 to the Critical link of its attacks (and to wound Criticals under Up in Arms Criticals); a long neck adds +20 to head wound Criticals under Up in Arms Criticals. Also: Hideous Appearance caps Fellowship at 0, Regeneration has a *Critical Wound regenerated: -1 Fellowship* button, Shapeshifter offers its -10-per-Wound-lost Endurance option.

## v3.0.0
Update to Foundry v14

## v2.1.0
Update folder structure

## v2.0.0
Verified Compatibility with v13

## v1.1.0
Publish release with back compatibility with v12

## v1.0.2
Corrected mismatched internal items references
 
## v1.0.1
Added credits inthe Journal

## v1.0
The module includes:
- 87 Mental Mutations, 137 Physical Mutations, including 22 Bestial Body and 7 Unnatural Body Mutations 
- RollTables for general, chaos-god-specific and necromantic Corruption 
- A Macro to generate mutations for a specified Actor, including randomized chat messages
