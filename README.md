# Probably Stolen Module Optimization — Mod Export

A fork of [hoydoy/probably-stolen-module-optimization](https://github.com/hoydoy/probably-stolen-module-optimization), the module grid optimizer for *Probably Stolen*. See [Credits](#credits) for whose work it builds on.

**Live site:** https://blo-om.github.io/Probably-Stolen-Module-Optimization-Mod-Export/

[![The optimizer filling eight machines' module grids at once — click to open the site](docs/demo.gif)](https://blo-om.github.io/Probably-Stolen-Module-Optimization-Mod-Export/)

## What this fork changes

- **Mod export.** Each machine card has an **Export** button, and the toolbar has **Export All**. They copy the machine layout together with its name, so the *Module Optimizer Import* MelonLoader mod can put the modules into the right machine in-game.
- **No leaderboard submissions.** Results are not sent to the original site's Supabase leaderboard, and the original site's analytics script is removed.
- **Smarter targets.** A target (Tar %) is a hard minimum that outranks card order. A machine whose stats are all targets reaches them with the weakest modules that suffice, leaving strong modules for machines that maximize, and a clean-up pass swaps out any module a weaker same-shaped one can replace.
- **Layout.** Machine cards show the machine's icon and short name in the header, stat cards toggle on/off with a click, and the page toolbar sits at the top.
- **Manual targets.** Every target can be typed in the unit shown on its card, alongside the existing breakpoint and day buttons. Invalid or unexportable values show an error instead of silently changing the goal.
- **Effect values.** Fresh Degrading modules include both effects when calculating their initial value and slider maximum, in slot order with integer rounding. Imported or manually entered remaining values are kept as current readings, so an already worn module is never refilled or multiplied twice. Negative Feedback absorption rounds the contribution before adding it to the module's own stats consistently across Bloom, hoydoy and Razboy's CPU/GPU evaluators.
- **Degradation protection.** Targets are checked at today's output and at the last snapshot each stat uses during the protected task, including node, receiver, mount and negative-feedback effects. Hydroponic, DNA and printer jobs use pre-use stats; Desequencer Performance uses post-use stats. Finishing degradation that cannot affect the task is safe, while a next-day drop still receives an amber reminder before another use. The card reports both relative and save-calendar drop days. Auto stats can fall. Protection uses Bloom and never silently lowers an explicit target.
- **Running task locks.** Importing an unfinished, explicitly working Hydroponic System, 3D Printer, DNA Manipulator or Cryptographic Desequencer automatically locks its layout against optimization, dragging, clearing, deletion and Store/Retrieve. Remaining work and degradation determine its estimated completion and required protection window. These are save snapshots: reimport after completion or cancellation to clear the automatic lock; manual locks remain independent.
- **Stable machine order.** Reimporting a save keeps each machine's order and settings by its game uid, even after it moves or its path is renumbered. Renamed downloads and day backups from the same save slot share the latest order. New machines go last.
- **Detailed percentages.** Every machine shows its separate Performance, Quality and Efficiency percentages, including ignored stats, with English and Chinese labels.
- **Safe warehouse removal.** Right-click an unused module or open its card menu to remove it from the optimizer, including modules imported from a save. Check its name, effects, stats and game uid, continue to the final confirmation, then tick the acknowledgement before deleting. Installed modules are protected; the game save is unchanged, and another save import restores imported items.
- **Warehouse stat correction.** The same menu can edit a module's current Performance, Quality and Efficiency percentages, for example after extra Turbocharger uses in the game. Enter the module's own current readings including its effects, excluding machine placement and neighbouring modules. Corrections retain the module's identity and are used by all solvers and degradation forecasts without applying its static effects twice. Values are not clamped to fresh-module caps. They persist in this browser; reimporting a save replaces them. Mod export still moves the original game modules by uid; legacy solution codes do not carry these local stat snapshots.
- **Build version.** The footer shows the release version and the deployed commit id; hover to see its UTC build time. Cached pages retain their own build identity, so an update can be checked without guessing.
- **Save day.** The toolbar shows the imported save's game day beside its name, read from `storeStation.value.dayCounter` and remembered across reloads. Older sessions show an unknown day until the save is imported again.
- **Run and target status.** The toolbar shows elapsed seconds and immediately reports how many explicit targets across all machines are met, including degradation protection. Auto optimization is reported separately. The no-improvement hint threshold is selectable (10, 20, 30, 60 or 90 seconds) and remembered; there is no extra warmup. When explicit targets exist, only target progress resets that timer. Changing the threshold or goals retains elapsed run time; stopping freezes it and a new run resets it.
- **Learning coverage.** Every unfinished Learning Algorithm module is counted across the whole page, with its current value, ceiling and machine or warehouse location. Placement only indicates an opportunity to learn when the game actually uses the machine; a Deal Maker does not trigger learning and is marked separately. The optimizer safely fills free cells with unfinished learners where they lower neither original targets nor Auto output; blocked or leftover modules remain visible. It does not invent future learning gains.

Degradation forecasts assume one active use each day, subtract one percentage point per Degrading effect/use down to zero, and do not credit future Learning Algorithm gains. For running progress jobs, each stat is protected through its final pre-use or post-use reading. Planned jobs can use this boundary when an explicit speed minimum bounds their duration; idle Auto-speed plans and other machines retain the conservative full-use endpoint. If the available modules cannot meet every target for that period, the card remains visibly unsafe; optimization does not guarantee a feasible solution exists.

Turbochargers can trigger extra machine uses within the same game day. Reimport the updated save or correct warehouse readings after using one; the website cannot detect unimported game actions.

## Machine breakpoints

**[BREAKPOINTS.md](BREAKPOINTS.md)**: every machine's breakpoints in one chart. It covers water grades, purity caps, ingot stages, aging days, keycard and growing days per plant or chip, harvest steps, melee condition and energy steps. It is generated from the optimizer's own rules (`npm run breakpoints` in `grid-optimizer`), so it always matches what the solver aims for.

## Credits

- **[hoydoy](https://github.com/hoydoy/probably-stolen-module-optimization)** made the original optimizer and site this fork starts from.
- **[Razboy20](https://github.com/Razboy20/probably-stolen-module-optimization)** inspired the core of the current solver. His fork's rewritten solver, an iterated local search over placements run on one Web Worker per core, is the approach this solver follows. The code here is a separate implementation.

The machine icons in `grid-optimizer/public/machines/` are original pixel art drawn for this site in the style of *Probably Stolen*'s machines, so players can recognise them. *Probably Stolen* is © Questing Goose Studio.

## Mod export format

**Making your own optimizer work with the mod?** See [MOD_COMPATIBILITY.md](MOD_COMPATIBILITY.md) for the full format, where every value comes from in the save, why module uids are required, a minimal encoder, and how to test.

```
PSMOD1:<base64url(UTF-8 JSON)>
```

```json
{
  "v": 2,
  "slot": 1,
  "save": "save_1",
  "machines": [
    {
      "name": "Inv. > Machine Bay (Expanded) 1 > Furnace 2",
      "code": "<solution code>",
      "modules": [ { "uid": 3585, "cells": [0, 1, 2, 8] } ]
    }
  ]
}
```

- `slot` / `save` identify the save that was imported (`saveSlotId` from the file, and its file name).
- `name` is the machine name shown on the card. For machines added with **Import Save (.es3)** that is the full path the save importer builds; the mod rebuilds the same names in-game to find the machine.
- `modules` lists every save module on the board by the game's own `uniqueId` (stored in the save and kept by the running game) with the board cells (`y * 7 + x`) it covers, so the mod moves exactly those items. Modules added from the catalog have no uid and are only in `code`.
- `code` is the unchanged solution code from the card.
- The string has no whitespace. Encoding is in `grid-optimizer/src/modExport.ts`.

## Development

```bash
cd grid-optimizer
npm ci
npm run dev
```

Pushing to `master` deploys to GitHub Pages through `.github/workflows/deploy.yml`.
