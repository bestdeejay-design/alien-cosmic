# Upgrades — four army lines and the command protocol

Frontier field science: weapons, armor, guns and plating. The
Laboratory / Evolution Node runs 4 army lines, each up to 3 levels.
The fifth button is the single-level Auto-Repair protocol, unlocked
by CC Tier II. Bonuses apply to the whole army at once, including
units trained after the research. One research at a time; "Undo" (`X`)
refunds the minerals.

![Laboratory](img/todo-lab.md)

| Line (Helios / Kharid) | Effect per level | Costs (1/2/3) | Time (1/2/3) |
|---|---|---|---|
| Infantry Weapons / Thorn Sharpening | +3 infantry damage | 100 / 175 / 250 | 40 / 55 / 70s |
| Infantry Armor / Carapace | −2 damage taken by infantry | 100 / 175 / 250 | 40 / 55 / 70s |
| Vehicle Weapons / Brood Jaws | +5 vehicle damage | 100 / 175 / 250 | 45 / 60 / 75s |
| Vehicle Plating / Chitin Carapace | −3 damage taken by vehicles | 100 / 175 / 250 | 45 / 60 / 75s |

A full army line costs 525 minerals; infantry lines take 165s (~2:45),
vehicle lines 180s (3:00). Lab keys: `Q/W/E/R`; `T` — Auto-Repair
after CC Tier II.

## How the bonuses read

- **Attack** adds to base damage: a ranger (7) with Weapons-3 hits
  for 16 — 2.3× stronger.
- **Armor** is subtracted from incoming damage, minimum 1: a skiff (8)
  hits an Armor-3 ranger for 2. Blood always flows.
- Infantry is everything non-vehicle (workers and medics included);
  vehicles — skiffs, bastions, mortars.
- With turret grades the sum is additive (damage 12 + Weapons-3 = 27).

## Auto-Repair / Mend-Song (H)

A single-level research: 150 minerals, 60s. Before CC Tier II the `T`
button sits in the lab under a lock; after Tier II it becomes available.
Idle workers automatically repair finished buildings and vehicles
within 15 tiles (480px) of any living CC: idle first, then miners,
two per target at most. Repair costs minerals (1 per 6 HP); units
ordered to move, attack, build or garrison are not pulled away.
After the repair workers return to their vein.

## Who researches

The player — in their own laboratory (from mission №12; in skirmish —
from the start). The AI in late missions researches the 4 army lines
per profile; the new Auto-Repair protocol is not researched by the AI,
and it never gains the CC grade.
