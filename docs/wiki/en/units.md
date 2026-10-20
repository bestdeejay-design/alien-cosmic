# Units — eight roles of two factions

Mirror tech trees: shared stats, unique look and voice. H adds the
unarmed Helios scout and its Kharid mirror. Columns: HP, Damage —
per shot, CD — cooldown, Range — in pixels (tile = 32), Speed,
Sight — tiles, Sup — supply, Cost — minerals, Time — training.

## Tech Drone / Gatherer

![Tech Drone](img/todo-unit-worker.md)

The base's hands: mines erg, raises and repairs structures and
vehicles; when idle it hurries off to patch damaged machines. The
swarm calls it the nurse of the fields: gathers sleeping facets,
raises nests.

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 60 | 4 | 1.0s | 26 | 92 | 7 | 1 | 50 | 12s |

Trained by: Command Center / Hiveheart. Open from the start. Does it
all: mining (RMB a crystal), building (menu `B`, all 8 structures),
repair (26 HP/s on buildings, 18 HP/s on vehicles, 1 mineral per 6 HP).
Only desperation sends it into battle; bunkers are infantry-only.

## Ranger / Shardjaw

![Ranger](img/todo-unit-marine.md)

Assault trooper with a plasma carbine — the backbone of the Zarya-9
line. The swarm fields a creeping thing with a crest of spikes: it
spits crystal darts. Ballistics are identical.

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 52 | 7 | 0.85s | 134 | 100 | 7 | 1 | 50 | 13s |

Trained by: Barracks / Incubator. Open from mission №1. Without orders
it seeks enemies within sight range, but past the "leash" (~13 tiles)
it turns back. Fits in a bunker/cocoon (up to 4): invulnerable inside
and firing on its own.

## Skiff / Skitter

![Skiff](img/todo-unit-buggy.md)

Hover raider with twin impulse guns: strikes on the fly and pulls away
at the edge of reach. The swarm's four-legged predator: stings and
melts into the wastelands before the swarm finishes its song.

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 85 | 8 | 0.45s | 132 | 158 | 8 | 2 | 100 | 16s |

Trained by: Vehicle Factory / Brood Pit. Open from mission №3. The
nimblest unit in the game (speed 158): economy raids, finishing off,
mortar interception. A vehicle — repaired by workers, not healed by
medics.

## Bastion / Bruiser

![Bastion](img/todo-unit-tank.md)

Heavy hover platform: one fragmentation salvo covers a whole group.
The swarm's colossus with crystal horns: its spit bursts into a hail
of shards.

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 260 | 36 | 2.4s | 200 | 62 | 9 | 3 | 180 | 28s |

Trained by: Vehicle Factory / Brood Pit. Open from mission №3. Shards:
radius 46, 60% damage to everyone caught. One bastion grinds down
infantry crowds; it is slow — cover it. A vehicle, repaired by workers.

## Nanite / Bloom

![Nanite](img/todo-unit-medic.md)

A swarm of nano-medics: patches up nearby infantry (7 HP/s); the
scalpel is for self-defense only. The swarm's nursing spore: healing
pollen mends kin (7 HP/s).

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 60 | 2 | 1.0s | 26 | 104 | 7 | 1 | 75 | 16s |

Trained by: Barracks / Incubator. Open from mission №9 (the swarm gets
it in №11). Without orders it finds a wounded non-vehicle within sight
and heals for free — point-blank, standing beside. Does not heal
vehicles (workers repair those). Weak in a fight — keep behind the line.

## Plasmer / Acid Spitter

![Plasmer](img/todo-unit-flamer.md)

Flamer crew: burns groups point-blank; helpless at a distance. The
swarm's pot-bellied spitter: its acid spray eats through even carapaces.

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 75 | 14 | 0.9s | 74 | 90 | 7 | 1 | 75 | 15s |

Trained by: Barracks / Incubator. Open from mission №7. Area spray:
radius 36, 70% damage to everyone caught. Terror of point-blank crowds;
the short reach (74) means rangers must cover it from turrets and mortars.

## Nova Mortar / Sporehulk

![Nova Mortar](img/todo-unit-arty.md)

Self-propelled mortar: rains shards across 12.5 tiles (400) by area;
keep it behind the line. The swarm's worm-mortar: hurls blasts across
half the map; keep it behind the brood.

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 160 | 48 | 3.4s | 400 | 48 | 10 | 3 | 220 | 34s |

Trained by: Vehicle Factory / Brood Pit. Open from mission №8. Range
400 — beyond its own sight (10 tiles): fire on scouted targets. Shards:
radius 62, 65% damage. The shell flies slower than a bullet and shakes
the screen. A vehicle, repaired by workers.

## Pathfinder / Listener

An unarmed scout: a light hover with a spotter drone for Helios, a
nimble little beast with a companion spore for the Kharid. Sees 11
tiles, speed 185 — faster than a skiff; on spotting an enemy it tries
to fall back 6 tiles. Not counted in the combat army, does not accept
attack orders. Factory / brood pit, open from mission №3, cost 60,
training 12s.

| HP | Damage | CD | Range | Speed | Sight | Sup | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| 50 | 0 | — | — | 185 | 11 | 1 | 60 | 12s |

The CC Tier III "Recon" button (`T`) sends the unarmed machines into
unexplored fog. They report new deposits and visible enemies; that is
reconnaissance, not an attack.

[Screenshot H — Pathfinder in the field (awaiting capture)](img/todo-h-scout.md)

## Who trains whom (summary)

| Building | Units |
|---|---|
| Command Center / Hiveheart | Tech Drone / Gatherer |
| Barracks / Incubator | Ranger, Plasmer, Nanite / mirrors |
| Vehicle Factory / Brood Pit | Skiff, Bastion, Nova Mortar, Pathfinder / mirrors |

The training queue holds 5 (barracks/factory grades: 7/9). Damage and
armor bonuses — in [Upgrades](upgrades.md): +3/+5 attack, −2/−3 damage.
