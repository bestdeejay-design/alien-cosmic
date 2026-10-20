# Mechanics — how the war works

## Mining erg

Start: 150 minerals, 4 workers, a command center (supply 10). A worker
runs trips "crystal → nearest CC": 8 minerals per trip, 1.8s mining
cycle. Veins are grouped into deposits; hovering shows the vein's
remainder and the deposit's total, and mined-out veins pale on the
minimap.

Distribution is automatic: the optimum is **2 per crystal**, a third
joins only when no free veins are left, a fourth — never. On a manual
order the first worker goes to the clicked crystal, the rest spread
across the neighbors. A drained vein disappears; when a deposit runs
out the workers move on by themselves.

![Mining](img/todo-mining.md)

## Supply

Supply: CC +10, home +8, hard ceiling 200. Cost: infantry and workers
1 each, skiff 2, bastion and mortar 3. A "ready" unit that hits the
ceiling waits — build a home. The training queue holds 5 (grades: 7/9);
cancelling a slot refunds the minerals.

## Building and rally points

A half-built structure stands at 15% HP; up to 5 nearest workers per
site. Finished a build — the worker walks to the nearest free
unfinished one by itself (a build chain) instead of scattering: no
sites left — back to mining. RMB an unfinished structure sends the
workers back to it.

RMB your own finished building sets a rally point; a rally point on a
crystal turns new workers into miners immediately. New units arrive
not in a stack but in a ring around the point (rally spread).

## Repair

RMB your damaged own unit: buildings — 26 HP/s, vehicles — 18 HP/s,
1 mineral per 6 HP. Without minerals repair stalls (a toast, at most
once per 6s). When done the worker returns to mining by itself.

Distribution: several techs + a click — **2 per target** (vehicles and
buildings near the click within 256px), the surplus keeps mining. A
single target is also capped at 2. An idle worker patches damaged
vehicles nearby by itself; buildings are left alone without orders —
their repair is the player's call (minerals).

## Combat

- Fighters without orders engage enemies within sight range, but no
  farther than the "leash" (~13 tiles) from their post — then return.
- A move order is sacred: a moving unit does not get distracted (for
  fighting en route there is attack-move, `A + LMB`).
- Projectiles home in; the mortar shell flies slower than a bullet
  (380 vs 540) and hits by area. A mortar shot shakes the screen.
- Shards: bastion 46 (60%), plasmer 36 (70%), mortar 62 (65%).
- Armor cuts damage, minimum 1 — blood always flows.
- Alarm: damage to your forces — one shared toast and a minimap ping
  (no more than once per 8s). A strike within 15 tiles of your CC
  Tier II+ sounds the siren; in the field and below Tier II — a soft
  ping. `H` — jump to the last alarm.
- A selected unit draws its route dashed and the target as a flag.
  A walled-in unit stands calm with a red "!" — clear the rubble.
- In a crowd the mover holds course, the stander yields; oncoming
  columns part along their right sides; a column queues in a jam.

## HQ: auto-repair, recon and rally (H)

The CC upgrades to Tier II (240/30s) and Tier III (400/45s) with no
stat bonuses. Tier II unlocks the laboratory Auto-Repair (150/60s):
idle workers repair buildings and vehicles, two per target, within 15
tiles of a living CC; idle first, then miners. Repair costs minerals,
move/attack/build orders are not interrupted, and the worker returns
to mining after the fix.

From mission №3 the factory trains the Pathfinder/Listener for 60
minerals and 12s: 50 HP, speed 185, sight 11, damage 0. The CC Tier III
`T` sends such scouts into unexplored spots. Within sight they flee
visible threats, newly spotted veins ping once, and enemy contact
raises a toast and a ping (10s cooldown). The scout does not attack,
is not counted in the combat army and takes no combat orders.

CC Tier III `G` — "Rally": only units without orders walk in a ring to
the CC's rally point. Without a point — an error toast, nobody moves.
Working, fighting, building, healing and garrisoned squads are untouched.

[Screenshot H — siren at the base (awaiting capture)](img/todo-h-alarm.md)

## Fog of war

Three states: black — unexplored; dimmed — explored but not currently
visible; clear — visible. Enemy buildings are remembered ("ghosts"),
units only in direct line of sight. You can build only on explored
ground. Crystals are visible only when explored — on the map and on
the minimap alike.

## Minimap

176 pixels for the whole map: terrain, explored crystals (brightness by
remainder), own and spotted enemy forces, an amber diamond on the key
target, the visible-area frame, red alarm and wave pings. LMB — jump
the camera (with drag — steer), RMB — an order from any point.

![Minimap](img/todo-minimap.md)

## Building grades

Turret, barracks, factory, bunker — up to Tier II/III with `R` (chevrons
II steel, III gold). Prices — 60%/30s and 100%/45s of the cost. The
swarm never grades. Details — in [Buildings](buildings.md).

## Zoom and skirmish maps

Zoom `+ / −` (and keys): 0.5–2.0 anchored under the cursor. At the
minimum a tile is 16 pixels: the view covers even 96×96 in full.

Skirmish: size 48/64/80/96 × shape (square / wide 3:2 / tall 2:3).
Non-standard dimensions: 48→32, 64→42, 80→54, 96→64; the numbers show
in the config before the start. The base scales with height. The map
gets a random seed, the biome a random pick of three (rust wastes /
nest / moon). Victory — destroy every enemy structure.

## Seasons

The main screen: **Season 1** (the campaign: missions and skirmish),
**Season 2** — a "SOON" stub (click — a toast), the Lore archive —
outside the seasons. Campaign progress is shared, stored in the
browser; a victory opens the next mission.

## The enemy AI

Lives by the mission profile: keeps workers (`workerTarget`), builds
infantry up to a cap, sends waves (first `firstWave`, growth
`waveGrowth`, ceiling `waveMax`, pause from `minWaveInterval`), raises
a second barracks on a timer, turrets — up to `maxTurrets`, with
`factory` — vehicles (mortars before bastions), medics/plasmers — up
to their caps. It can repair (`repair`) and research (`research`) —
in late missions. It repairs with one worker when HP sags below 60%/55%.

Defense missions: preparation (`prep`), waves every `every` seconds of
size `start + grow × N` up to `max`, victory — survive to `total`:

| Mission | Prep | Waves | Size | Fight until |
|---|---|---|---|---|
| №2 Night of Spikes | 3:00 | every 65s | 4+1 → 16 | 10:00 |
| №6 Blood of the Sacred Fields | 3:20 | every 60s | 4+1 → 16 | 11:00 |
| №10 The Azure Rampart | 4:00 | every 50s | 6+2 → 22 | 14:00 |
| №13 Helios Prime | 5:00 | every 45s | 6+2 → 26 | 15:00 |
| Chapter "The Long Night" | 2:30 | every 60s | 4+1 → 14 | 8:00 |

Every third wave is reinforced with a pair of fast units; later waves
diversify by profile (plasmers — every second, mortars — every fifth,
medics up to the cap). A ping shows the wave's direction.

Deadline sticks: №3 — a punitive corps at 7:00 (soft), №8 — a
counterstrike at 8:00, №12 — veterans at 7:30, the chapter "The
Silencer Sleeps" — a hard 10:00 (time out — defeat).
