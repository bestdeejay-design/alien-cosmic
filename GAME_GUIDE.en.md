# The Stellar Frontier — the full handbook

Welcome to the Stellar Frontier — the edge of settled space where
corporate landing forces meet swarms of crystalborn natives. This
handbook covers the world of the game, faction dossiers, every unit
and structure, the mechanics, the campaign walkthrough and tactical
advice.

---

## Part I. The world and the story

### Timeline

The year is 2189. Humanity runs on erg — the energy of crystal fields.
The Delta-2 mine stopped answering: the survivors speak of "living
dunes". The war for Frontier-64 — the sixty-fourth outpost on the edge
of settled space — has begun.

> The full canon of the world — `LORE.en.md`; the short in-game digest —
> the Lore archive in the main menu.

### The planets

- **Aktan-4** — a red martian wasteland: rusted dunes, basalt ridges,
  salt lowlands and craters. Helios mines operate here, and the defense
  camp Zarya-9 stands here.
- **Brok-Thaal** — the Kharid's "third sacred place": the violet
  wastelands of the hive, glowing acid lakes and crystal growths. The
  mineral fields here are not ore but sleeping kin.
- **Selenite-B** — a gray moon: the Lazur crater, Outpost Rampart, the
  anchor of the orbital elevator and the Eye of the Storm rift.

### The factions

**HELIOS Industries** (humans)
A giant mining corporation with an army of its own. It stakes on
technology: concrete bunkers, automatic turrets, armored vehicles. The
weak spot — contract-worker crews and the greed of a board of directors
that never funds defense enough.

**The Kharid** (crystalborn)
A silicon-organic swarm for whom the erg crystals are sleeping members
of the brood. Every Kharid "structure" is a living organism: the hive
grows, the cocoon pulses, the brood pit kneads new creatures with its
tentacles. They have no engineers — they have evolution: fast skitters,
crystal spits and colossus bruisers.

### The attitude to minerals
Erg crystals are the only currency of the war on the frontier: humans
pay them for vehicles and ammunition, the Kharid "grow" new individuals
from them. Whoever controls the fields controls the war.

---

## Part II. Units

Both factions mirror each other: every role shares its stats and
differs in look and name. In the tables: HP, Damage — per shot, CD —
cooldown, Range — pixels (tile = 32), Speed, Sup — supply, Cost —
minerals, Time — training.

### 🛠 Tech Drone (Helios) / Gatherer (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 60 | 4 | 1.0s | point-blank | 92 | 1 | 50 | 12s |

The engine of the whole economy. Three skills:
- **Mining** — RMB a crystal: trips "crystal → command center", 8
  minerals each;
- **Building** — the `B` menu: raises all 8 structures;
- **Repair** — RMB a damaged building or vehicle: 26 HP/s on buildings,
  18 HP/s on vehicles, 1 mineral per 6 HP. Without minerals repair stops.

A worker in combat is a bad combatant: send it into a fight only when
there is nothing left to lose. It does not fight from a bunker —
infantry only.

### 🔫 Ranger (Helios) / Shardjaw (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 52 | 7 | 0.85s | 134 | 100 | 1 | 50 | 13s |

The main combatant. The ranger fires plasma impulses, the shardjaw —
crystal darts — the ballistics are the same. Without orders it seeks
enemies within sight (7 tiles) but past the "leash" (~13 tiles) it
returns to its post. **Fits in a bunker/cocoon** — up to 4 fighters,
invulnerable inside and firing on their own.

### 🚙 Skiff (Helios) / Skitter (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 85 | 8 | 0.45s | 132 | 158 | 2 | 100 | 16s |

A fast raider. Speed 158 — the nimblest unit in the game: raids on the
enemy economy, finishing off the wounded, mortar interception. Impulse
guns/spits are weaker than the ranger's per-shot, but the skiff has
almost twice the HP. Counts as a **vehicle** — repaired by workers.

### 🛡 Bastion (Helios) / Bruiser (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 260 | 36 | 2.4s | 200 | 62 | 3 | 180 | 28s |

Heavy artillery. Range 200 and the biggest damage in the game after
mortars, plus **fragmentation**: the shell bursts, catching every enemy
within ~46 px (60% damage). One bastion grinds down infantry crowds; it
is slow — cover it with skiffs or infantry. A vehicle, repaired by
tech drones.

### ⚕ Nanite (Helios) / Bloom (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 60 | 2 | 1.0s | point-blank | 104 | 1 | 75 | 16s |

The guardian angel of infantry. Without orders it finds the nearest
wounded non-vehicle (worker or fighter) within sight and heals at
**7 HP/s** — for free. Plus signs above the fighter show the healing.
Weak in combat (a 2-damage scalpel) — keep it behind the front line:
2-3 nanites make a ranger squad nearly immortal.

### 🔥 Plasmer (Helios) / Acid Spitter (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 75 | 14 | 0.9s | 74 | 90 | 1 | 75 | 15s |

Anti-infantry against the swarm. The plasma/acid salvo hits **by area**:
a spray of radius ~36 px deals 70% damage to everyone caught.
Point-blank it shreds shardjaw crowds (15+ damage/s by area), but the
short reach makes it vulnerable to turrets and mortars — cover with
rangers.

### 🎯 Nova Mortar (Helios) / Sporehulk (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 160 | 48 | 3.4s | 400 | 48 | 3 | 220 | 34s |

The siege gun of the campaign. Range 400 — **12.5 tiles**, beyond any
unit's sight: fire on scouted targets, keeping a scout ahead. Shards of
radius ~62 px blanket whole waves; every shot shakes the screen. Slow
(48) and helpless up close — cover is mandatory: skiffs in front,
infantry beside. A vehicle, repaired by tech drones.

### 🔭 Pathfinder (Helios) / Listener (Kharid)

| HP | Damage | CD | Range | Speed | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|
| 50 | 0 | — | — | 185 | 1 | 60 | 12s |

The base's eyes. The fastest (185) and sharpest-sighted (sight 11)
unit: a light hover with a spotter drone for humans, a nimble little
beast with a companion spore for the swarm. Completely unarmed — it
never joins a fight and skirts enemies. Built at the factory (from
mission №3). The CC Tier III "Recon" button (`T`) sends every pathfinder
into unexplored fog: they report found veins and enemy contacts.
A vehicle — repaired by workers.

### Research bonuses
Every unit's damage grows with the "Weapons/Guns" research (+3 infantry,
+5 vehicles per level), and incoming damage is cut by "Armor/Plating"
(−2 infantry, −3 vehicles per level). A ranger with Weapons-3 hits for
16 — more than double the base. Details — in "Upgrades".

---

## Part III. Structures

Building: select a worker → `B` → type (`Q W E R T Y U I`) → click the
map. A structure grows from 15% → 100% HP under the worker's "welding";
RMB an unfinished build returns the worker to it. RMB a finished
building — a rally point for new units. Up to 5 workers per site (the
nearest); the rest scatter to other unfinished builds; build mode is
serial (exit — RMB/Esc).
Walls and turrets draw in a line: hold LMB and drag — the preview shows
the price. Without a mouse: arrows move the ghost, Enter places it.

| Building (Helios / Kharid) | Size | HP | Cost | Time | Supply | Notes |
|---|---|---|---|---|---|---|
| **Command Center / Hiveheart** | 4×3 | 1500 | 400 | 30s | +10 | Trains workers; drops off minerals; losing all buildings = defeat |
| **Home / Storehouse** | 2×2 | 500 | 100 | 14s | +8 | The only supply source after the start |
| **Barracks / Incubator** | 3×2 | 1000 | 150 | 20s | — | Trains infantry: rangers, plasmers, nanites; unlocks Factory and Laboratory |
| **Viper Turret / Mandibles** | 1×1 | 380 | 100 | 12s | — | Auto-fire: damage 8, CD 0.65s, range 150, sight 9. Place at chokepoints |
| **Wall Segment / Chitin Wall** | 1×1 | 900 | 30 | 5s | — | A cheap path blocker; 900 HP for 30 minerals — the best HP-per-cost |
| **Bunker / Cocoon** | 2×2 | 1100 | 120 | 16s | — | Garrison 4 infantry: invulnerable inside, firing out. RMB the bunker to load, `F` to unload |
| **Vehicle Factory / Brood Pit** | 3×3 | 1300 | 250 | 35s | — | Trains skiffs, bastions, Novas and pathfinders. **Needs a barracks** |
| **Laboratory / Evolution Node** | 3×3 | 900 | 200 | 32s | — | Researches upgrades (one at a time). **Needs a barracks** |

### Building grades (F.2)
A finished turret, barracks, factory or bunker (and their mirrors) can
be upgraded to **Tier II** and **Tier III** with the **"Tier" (KeyR)**
button — the building keeps working while upgrading. Grades show as
chevrons: II — steel, III — gold. Cancel — **KeyX** or the "Undo"
button (minerals refunded).
- **Turret / Mandibles**: 8→10→12 damage, range 150→165→180.
- **Barracks / factory (+ mirrors)**: training rate ×1.25→×1.5, queue 5→7→9.
- **Bunker / cocoon**: garrison 4→6→8, HP ×1.25→×1.5.
Cost: Tier II — 60% of the building's cost, 30s; Tier III — 100%, 45s.
Grades are mirrored — the Kharid fortify their nests the same way.

### The classic defensive node
A wall "pocket" in front of the chokepoint: 2 bunkers in the depth, 2
turrets on the flanks, 2 rows of walls in front. Infantry in bunkers is
invulnerable, turrets finish vehicles, a bastion behind reaches with
shards. A tech drone behind the walls patches everything.

## Part III-bis. Upgrades (the Laboratory)

The laboratory runs 4 upgrade lines, each up to 3 levels. Bonuses apply
to the whole army at once, including units trained after the research.
The laboratory runs one research at a time; the "Undo" button refunds
the minerals.

| Line | Effect per level | Costs by level | Time |
|---|---|---|---|
| **Infantry Weapons** (Thorn Sharpening) | +3 infantry damage | 100 / 175 / 250 | 40 / 55 / 70s |
| **Infantry Armor** (Carapace) | −2 infantry damage taken | 100 / 175 / 250 | 40 / 55 / 70s |
| **Vehicle Weapons** (Brood Jaws) | +5 vehicle damage | 100 / 175 / 250 | 45 / 60 / 75s |
| **Vehicle Plating** (Chitin Carapace) | −3 vehicle damage taken | 100 / 175 / 250 | 45 / 60 / 75s |

An example of the effect: a ranger (damage 7) with Weapons-3 hits for
16 — a 2.3× growth. Armor-3 keeps a ranger alive against skiff guns
(8 → 2). A full line costs 525 minerals; infantry lines take 2:45,
vehicle lines 3:00. The laboratory opens with mission №12 — plan it
once it unlocks. **The AI in late missions researches too** — keep pace,
or its army will get noticeably tougher.

---

## Part IV. Mechanics

### The economy
- Start: 150 minerals, 4 workers, a command center (supply 10).
- The production queue holds 5 units; cancelling a slot refunds minerals.
- A unit is "ready" but stuck at the supply cap → build a Home.
- The supply ceiling — 200.
- Crystals are grouped into **deposits**: workers spread across veins by
  themselves — the optimum is **2 per crystal**, a third joins only when
  no free vein is left, a fourth — never. The first worker goes to the
  clicked crystal on a manual order, the rest spread. Hover a crystal —
  the tooltip shows the vein's remainder and the deposit's total; mined
  veins pale on the minimap.

### Combat
- Auto-engagement: fighters without orders attack enemies within sight
  range, but no farther than the "leash" from their post.
- Projectiles home in; the mortar shell flies slower and hits by area.
- A building's death releases the bunker garrison outside.
- Alarm: an attack on your holdings — a toast and a pulsing minimap
  ping (no more than once per 8 seconds).

### Fog of war
Three states: **black** — unexplored; **dimmed** — explored but not
currently visible (enemy buildings are remembered as "ghosts");
**clear** — visible. You can build only on explored ground.

### Squads and camera
- `Ctrl/Shift/Alt + 1…9` — assign a squad, `1…9` — select,
  **double-tap a digit** — jump the camera to the squad.
- Camera: arrows, **mouse wheel / two fingers on a trackpad**, holding
  the **middle mouse button** ("grab the map and drag"), the screen edge
  (only inside the play area — UI panels are dead zones),
  click/drag on the minimap. **Space** — an instant jump to base.
  RMB the minimap — an order from any point. **+ / −** — zoom
  0.5–2.0 anchored under the cursor (the wheel pans, as before).
- Keys without a mouse: `.` — next idle worker (with camera),
  `,` — select the whole army, `Tab` — cycle fighters one by one
  (with camera), `H` — jump to the last alarm ("we are under attack").

### Playing on a MacBook without a mouse (trackpad + keyboard)
- A **two-finger tap** or `Ctrl+tap` is RMB: orders work as usual.
  Box selection — tap + one-finger drag.
- Camera panning — **two-finger scroll**; the middle button is not needed.
- Assign squads via `Alt+digit`: macOS takes `Ctrl+digit` for Spaces
  and `Cmd+digit` for browser tabs. Select — digits, jump —
  a double tap of the digit.
- Keep your left hand on the keyboard: production and building —
  `Q/W/E/R/B`, stop — `S`, attack-move — `A + tap`, pause — `P`. The
  full "find a worker → build → return to the fight" cycle works
  without a mouse: `.`, `B`, building key, tap the spot, `,` — and you
  are back with the army.
- The command panel can be moved: bottom / left / right / top (the
  "Panel" button on the panel itself) and hidden with `V` — the choice
  is remembered. Building statuses are visible right in the world:
  production (icon + progress), research, the bunker garrison count.

### Routes and orders
- A selected unit draws its route dashed and the target as a flag: you
  see the squad skirt rocks, lakes and buildings.
- Routes account for the hull size: heavy vehicles keep away from walls
  and never scrape corners. Formation slots are verified against the
  map — a squad never receives orders "into a wall".
- If a target is unreachable (a unit is walled in), it calmly stops and
  a red "!" appears above it. Clear the rubble or give a new order —
  the unit wakes up at once.
- In a crowd units yield to each other: the mover holds course, the
  stander steps aside; in a narrow pass the column queues instead of
  pushing forever.

### Defense mode (the "Night of Spikes" mission)
1. **3:00 of preparation** — a timer in the top bar. Dig, build the
   defense node, stack vehicles.
2. **Waves** — every ~65 seconds a wave leaves the hive: 4, 5, 6… up to
   16 creatures, every third wave reinforced with skitters. A minimap
   ping shows the direction.
3. **10 minutes of defense** — survive until the evacuation shuttles.
   Victory also counts if you raze the hive earlier.

### Campaign progress
Unlocked missions are saved in the browser (localStorage). A victory
opens the next mission; the finale screen offers to jump to it at once.

---

## Part V. The "Stellar Frontier" campaign

The campaign is **15 missions in three acts**. The arc is classic, by
the book of StarCraft and WarCraft 2: every new unit is introduced by
a mission built around it, and every new enemy appears with a story event.

**Three powers:**
- **HELIOS Industries** — the human corporation: vehicles, turrets, concrete;
- **THE KHARID** — the crystalborn swarm: hive organics, spikes, evolution;
- **The Red Flag** — mutineer defectors from the corporation itself
  (missions 7+): the human race with a full arsenal — nanites, plasmers,
  mortars and laboratories. They sold crystals to both sides until they
  assembled the Silencer — a device able to dim the erg fields.

### Act I "Frontier" — the landing and the first wounds

| № | Mission | Side | Gist |
|---|---|---|---|
| 1 | A Strange Shore | Helios | Tutorial: economy, barracks, the first nest assault |
| 2 | Night of Spikes | Helios | 10 minutes of defense: turrets, walls, bunkers |
| 3 | The Depths Awaken | KHARID | Playing the swarm: storming the corporate camp |
| 4 | Rudnik-7 | Helios | Skiff debut: pocket warfare against incubators |
| 5 | The Ash Line | Helios | Evacuation: carry 8 soldiers out by shuttle |

### Act II "Fire and Steel" — the third power

| № | Mission | Side | Gist |
|---|---|---|---|
| 6 | Blood of the Sacred Fields | KHARID | Defending the swarm's shrines from the corporation |
| 7 | Red Flag | Helios | Mutineer and plasmer debut |
| 8 | The Steel Fist | Helios | Mortar debut: storming a fort with a turret ring |
| 9 | The Quiet Sector | Helios | **Stealth raid without a base**: 8 fighters against the nest |
| 10 | The Azure Rampart | Helios | 14 minutes of defense on Selenite against enemy mortars |

### Act III "Dominion" — the Silencer

| № | Mission | Side | Gist |
|---|---|---|---|
| 11 | Heart of the Hive | KHARID | Blooms against the full Helios arsenal |
| 12 | The Coup | Helios | Storming the Red Flag capital with laboratories |
| 13 | Helios Prime | Helios | 15 minutes of defense: waves from the enemy citadel |
| 14 | Eye of the Storm | KHARID | The swarm erases the mutiny's last fort on the moon |
| 15 | The Stellar Frontier | Helios | FINALE: the "Last Song" fortress-nest |

### Key mission write-ups

**Mission 1 — "A Strange Shore" (Helios, Aktan-4).**
A training landing. The enemy is passive: small rare waves, no vehicles.
Plan: 4 workers on crystals → 6th and 7th workers → Home → Barracks →
6-8 rangers → push on reconnaissance. Do not forget the second Home
before the second squad.

**Mission 2 — "Night of Spikes" (Helios, defense).**
Classic "defend the base". The order of preparation (3:00):
1. Two Homes at once (or production stalls).
2. A wall "comb" by the wide approach to the base.
3. A bunker behind the walls + rangers inside; turrets on the flanks.
4. A barracks on infantry flow; the queue never stalls.
5. 1-2 workers on repair duty at the node (RMB the walls after every wave).

**Mission 3 — "The Depths Awaken" (Kharid, Brok-Thaal).**
You play the swarm: Gatherers mine crystals, the Incubator grows
Shardjaws, the Brood Pit — Skitters and Bruisers. The enemy is fully
deployed. Tactics: a mass of Shardjaws + 2-3 Bruisers; the Bruisers'
fragmentation spits tear concrete nodes from 190 away.

**Mission 8 — "The Steel Fist" (Helios, the Nova Mortar debut).**
Nail Fort is covered by 6 turrets and walls. Infantry dies on approach.
Crack the ring with mortars from 400 (skiff recon ahead!), the turrets
swap in the shards, and only then bring in the infantry. Every Nova
shot shakes the ground — that is normal.

**Mission 9 — "The Quiet Sector" (Helios, stealth raid).**
There is NO base: 4 rangers, 2 plasmers, 2 nanites — all you have.
Losing the squad loses the mission. Survival rules: medics heal without
orders (keep them behind), plasmers — against packs, rangers — the
shield. The Dusk nest's turrets hit at 150 — bait enemies onto
yourselves and burn them in groups. The goal is every structure of the
nest; the waves from there are rare and small — hurry slowly.

**Mission 15 — "The Stellar Frontier" (the finale).**
A fortress-nest with a double ring of mandibles, brood pits and
evolution nodes. The enemy researches every line — build your
Laboratory early and keep pace. The finale composition: 3 Nova Mortars +
a bastion shield + 8 rangers + 2 nanites + 2 plasmers. First burn the
mandibles with shards, then crack the perimeter with the bastion, then
the army. The peace of both races depends on you.

### Skirmish
Pick a faction — the opposite one becomes the enemy. A full AI: economy,
barracks with mixed infantry (medics, plasmers), vehicles up to Nova
Mortars, a laboratory with research, repairs, waves up to 18 units. The
map and biome are random. Size (48/64/80/96) and shape (square / wide
3:2 / tall 2:3) are chosen before the battle; non-standard dimensions
are shown at once.

### Seasons (G.6)
The main screen is the season picker: **Season 1** (the current
campaign: missions and skirmish) and **Season 2** — a "SOON" stub. The
Lore archive sits on the main screen outside the seasons. Campaign
progress is shared, saves unchanged.

### Base comfort (G.1–G.4)
A build chain: finished a build — the worker walks to the nearest free
unfinished one instead of scattering to mine. Repairs distribute: RMB —
2 techs per target (vehicles and buildings near the click), the surplus
keeps mining. Rally points get a ring instead of a stack; oncoming
columns part along their right sides. The zoom spans 0.5–2.0; the
camera keeps the target in the visible area in every panel position.

### The HQ (H: CC Tier II/III)
The command center upgrades to Tier II (240, 30s) and Tier III (400,
45s) — tier keys with no stat change: they unlock abilities. Tier II
unlocks the laboratory research "Auto-Repair" (150, 60s): idle techs
repair buildings and vehicles within 15 tiles of the CC, two per
target; done — back to mining. Tier II also enables the siren: an
attack near the base (15 tiles from the CC) sounds different from a
skirmish in the field. Tier III gives two buttons: "Recon" (T) — every
pathfinder spreads into the fog, skirts enemies and reports veins and
contacts; "Rally" (G) — every unit without orders heads for the rally
point. Techs hold their ground during alarms — do not panic.

## Part VI. Tactical advice

1. **Supply is never the bottleneck.** A Home costs 100 and builds in
   14s. Place it 2-3 units before you hit the cap.
2. **Walls are the cheapest HP in the game.** 30 minerals for 900 HP:
   even a single section in a chokepoint saves a whole squad.
3. **Turrets + a bunker beat a mob.** Static defense never gets
   distracted, never "chases the enemy" and needs no supply.
4. **The Bastion hits by area** — keep your infantry off the line of
   fire, behind its back.
5. **Repair is cheaper than replacement.** A Bastion for 180 minerals
   is worth fully repairing for ≈43 (260 HP / 6 HP per mineral) rather
   than building a new one; keep a worker with the vehicle group.
6. **Recon decides.** One skiff circling the map in the first 2 minutes
   shows the enemy composition and the wave directions.
7. **Focus fire.** RMB on a specific target beats "attack everyone":
   turrets and vehicles first, infantry later.
8. **Do not lose the command center.** It drops off minerals and makes
   workers; losing every building is defeat even with an army alive.
9. **Medics pay off instantly.** For 75 minerals they "regenerate"
   infantry for free; in long fights 2 medics equal a steady inflow of
   new fighters.
10. **The Nova Mortar is the key to forts.** Range 400 cracks turrets
    without losses; always carry a pathfinder with it and cover against
    raids.
11. **Upgrades are cheaper than an army.** The "Weapons" line for 525
    minerals adds more damage than a squad of ten rangers — and needs
    no supply.
12. **Hover a button — read the briefing.** Every unit, building and
    upgrade is labeled: the tooltip shows the price, stats and role.

---

## Part VII. Technical notes

- Pure JS (ES modules), Canvas 2D, Web Audio. No build step,
  dependencies or network.
- A fixed 30 Hz logic step + render interpolation — the battle is the
  same on any monitor.
- Pathfinding — A* on 8-direction tiles with corner-cutting forbidden
  and path smoothing.
- All balance numbers — in `js/config.js`; missions and AI profiles —
  in `js/missions.js`; all visible text — in `locales/ru.js` /
  `locales/en.js` (package I).
- The map is seed-deterministic: one mission always produces the same terrain.
- Screen shake, damage smoke, debris and healing — procedural effects
  on top of Canvas 2D; sprites are drawn in code, there are no atlases.
- Checks: `scripts/check.mjs` (statics + nested sims), `scripts/smoke.mjs`
  (a smoke pass of the real game.js in headless stubs),
  `scripts/audit_move.mjs` (movement and formation audit),
  `scripts/sim_*.mjs` — 12 regression sets (building, codex, mining,
  grades, HQ, movement, panel, repair, shells, traffic, UX, wins),
  plus — since package I — `scripts/sim_i18n.mjs` (locale completeness).
- Full regression: `node scripts/check.mjs` + all `sim_*` + `smoke` +
  `audit_move`.
