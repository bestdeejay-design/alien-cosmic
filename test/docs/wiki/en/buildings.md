# Buildings — eight structures

There are 8 building types in code (the wiki kickoff said "9" — the
ninth was never found, see the report; these are all that exist).
Building: worker → `B` → type key → click. A half-built structure
stands at 15% HP and grows under the worker's "welding"; up to 5
nearest workers per site, the rest head for other unfinished builds.
RMB a finished building — rally point.

![A Helios base](img/todo-base-human.md)

| Building (Helios / Kharid) | Size | HP | Cost | Time | Sup | Sight |
|---|---|---|---|---|---|---|
| Command Center / Hiveheart | 4×3 | 1500 | 400 | 30s | +10 | 9 |
| Home / Storehouse | 2×2 | 500 | 100 | 14s | +8 | 5 |
| Barracks / Incubator | 3×2 | 1000 | 150 | 20s | — | 6 |
| Viper Turret / Mandibles | 1×1 | 380 | 100 | 12s | — | 9 |
| Wall Segment / Chitin Wall | 1×1 | 900 | 30 | 5s | — | 2 |
| Bunker / Cocoon | 2×2 | 1100 | 120 | 16s | — | 8 |
| Vehicle Factory / Brood Pit | 3×3 | 1300 | 250 | 35s | — | 7 |
| Laboratory / Evolution Node | 3×3 | 900 | 200 | 32s | — | 6 |

## Command Center / Hiveheart

The outpost's headquarters: trains drones, takes in erg, +10 supply.
The hive's heart: grows gatherers, takes in facets. Workers deliver
minerals here (8 per trip). Losing every building is defeat even with
an army alive. Open from the start. Build key `Q`.

In H the HQ gains tier keys with no HP or sight bonuses: Tier II costs
240 and takes 30s, Tier III — 400 and 45s. Tier II unlocks the
Auto-Repair research in the lab and turns on the base attack siren;
Tier III adds the `T` "Recon" and `G` "Rally" commands. Any living CC
of the required tier unlocks the ability.

[Screenshot H — CC grade (awaiting capture)](img/todo-h-cc-grade.md)

## Home / Storehouse

Colonist habitat modules: +8 supply. Without homes the army stalls.
The swarm's living facet store. The only supply source after the
start; the hard ceiling is 200. Open from the start. Key `W`.

## Barracks / Incubator

The Zarya-9 training hall: rangers, plasmers, nanites. Queue up to 5.
The swarm's brood-chamber: shardjaws, acid spitters and blooms hatch
from the spawn. Unlocks the Factory and the Laboratory (neither can be
built without it). From mission №1. Key `E`. Production: `Q/W/E`.

## Viper Turret / Mandibles

Automatic sentinel: the twin guns bite like two fangs. The swarm's
watchful maw: spits spikes at every intruder.

| HP | Damage | CD | Range | Sight | Cost | Time |
|---|---|---|---|---|---|---|
| 380 | 8 | 0.65s | 150 | 9 | 100 | 12s |

Fires by itself, with no orders and no supply. Place it at chokepoints;
it can be drawn in a line together with walls (LMB-drag). From mission
№2. Key `R`. Can be graded (see below).

## Wall Segment / Chitin Wall

Frontier plasteel: 900 HP holds back swarm and vehicles alike. The
hive's living chitin. The best HP-per-mineral in the game (30 minerals)
— a cheap path blocker. Draws in a line: hold LMB and drag, the preview
shows the price. From mission №2. Key `Y`.

## Bunker / Cocoon

Shelter: up to 4 infantry are invulnerable inside and fire on their
own. RMB to move in. The swarm's cocoon: 4 fighters stinging through
the seams.

Garrison — infantry only (workers and vehicles stay outside). Load:
RMB the bunker with infantry selected; unload: `F` ("Deploy"). Garrison
return fire range — 140. Losing the bunker throws the survivors out.
From mission №2. Key `T`. Can be graded.

## Vehicle Factory / Brood Pit

Workshop of the expeditionary corps: skiffs, bastions, Novas and
pathfinders. Needs a barracks. The brood pit: skitters, bruisers,
sporehulks and listeners crawl out to the song. Needs an incubator.
Queue up to 5. From mission №3 (with the units). Key `U`. Production:
`Q/W/E/T` (T — the scout); grade — `R`. Can be graded.

## Laboratory / Evolution Node

Field science: weapons, armor, guns and plating. Research it first.
Where the swarm decides what it will become tomorrow. Needs a
barracks/incubator. One research at a time; cancelling refunds the
minerals. From mission №12. Key `I`. Research: `Q/W/E/R/T` (T —
Auto-Repair, available after CC Tier II).
Details — in [Upgrades](upgrades.md).

## Building grades (Tier II/III)

A finished turret, barracks, factory or bunker (and their mirrors) can
be upgraded with the "Tier" button (`R`) — the building keeps working
while upgrading. The marks: chevrons above the roof — II steel, III
gold — plus an outline. Cancel — `X` (minerals refunded). The swarm
(AI) never grades.

| Building | Tier II (60% cost, 30s) | Tier III (100% cost, 45s) |
|---|---|---|
| Turret / Mandibles (100) | 60: damage 10, range 165 | 100: damage 12, range 180 |
| Barracks / Incubator (150) | 90: rate ×1.25, queue 7 | 150: rate ×1.5, queue 9 |
| Factory / Brood Pit (250) | 150: rate ×1.25, queue 7 | 250: rate ×1.5, queue 9 |
| Bunker / Cocoon (120) | 72: garrison 6, HP ×1.25 | 120: garrison 8, HP ×1.5 |
| CC / Hiveheart (400) | 240: Auto-Repair + base siren | 400: "Recon" + "Rally" |

The CC is a tier key: HP and sight do not change. Home, wall and
laboratory cannot be graded. Turret bonuses stack additively with
research — no multiplicative stacking.
