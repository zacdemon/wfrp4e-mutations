# wfrp4e-mutations
WFRP4E module for Foundry based on the Mutation's Handbook by Anders Hellspong

## Unreleased: handbook mutation flow
- New world setting **Use Mutant's Handbook rules** (on by default). A failed Dissolution of Body and Mind test (and `/table corruption`, `mutatephys`, `mutatemental` or their `@Table` links) runs the handbook flow instead of the system's: species type roll (p8), Corruption loss of TB or WPB (p8), severity roll with +10 per mutation up to +40 (p9), source choice, the module's compendium tables (no world import needed) with "roll on the next table" and sub-tables followed automatically, and a result card where the GM adds the mutation or the player spends 1 Resilience to avoid it (p9). Chosen of Chaos lets the GM pick the patron (p74). A Chaos Spawn warning goes to the GM when the limits on p10 are passed. Turn the setting off for stock system behaviour.
- Optional rules as settings, off by default: **Keeping it Random** and **Let them off with a warning!** (p9). Also: ask for the mutation source, and the species used for species the handbook table doesn't list.
- The Generate Mutation macro is now a DialogV2 dialog that runs the same flow. The old world-script entry point `game.wfrp4eMutationRoll(actor, source)` still works.
- Uses libWrapper when it is active; otherwise patches the system directly.

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
