// ============================================================
// locales/en.js — English dictionary (package I, design/I18N.md).
// Creative adaptation (owner's directive §0.1): atmosphere, story
// and sense of adventure first — not a literal translation.
// Canonical names follow the approved glossary (I18N.md §3):
// erg, Frontier-64, Zarya-9, Kharid, Sons of the Sand, Red Flag,
// the Silencer, Helios Prime, Selenite-B, Brok-Thaal, Sabgir,
// Shardjaw / Skitter / Bloom / Sporehulk / Plasmer / Mend-Song…
// Schema must match locales/ru.js 1:1 (keys, types, {placeholders})
// — checked by scripts/sim_i18n.mjs.
// ============================================================

export default {
  meta: { code: 'en', label: 'English', htmlLang: 'en' },

  ui: {
    title: 'Alien Cosmic — an RTS of the war between corporation and hive',
    metaDesc: 'Alien Cosmic is a real-time strategy: Helios Industries mines crystals on alien worlds while the crystalborn Kharid defend their home. Campaign, defense missions, two playable factions, auto-modes.',
    versionBadge: 'version {v} · {date}',
    langLabel: 'Language',

    menu: {
      sub: 'A real-time strategy: colonists and natives wage war for the erg of Frontier-64',
      heroEyebrow: 'INBOUND SIGNAL · FRONTIER-64',
      heroTagline: 'Where the charts run out, the war begins.',
      heroDescription: 'Lead an expedition across an uncharted world. Choose your side, hold the line, and decide what survives the landing — in the campaign or a quick skirmish.',
      heroQuickCta: 'Quick Battle',
      heroQuickReady: 'Last sortie: {dims} · {side}. One click sends you straight in.',
      heroQuickChoose: 'No sortie is saved yet. Quick Battle will take you to map and faction selection.',
      heroScrollCue: 'SURVEY THE FRONTIER',
      heroVisualKicker: 'ORBITAL TELEMETRY',
      heroVisualTitle: 'SELENITE-B · SECTOR 04',
      heroVisualStatus: 'SIGNAL NOMINAL',
      heroBottomLine: 'UPLINK ESTABLISHED · FRONTIER-64',
      quickBattleEyebrow: 'DEPLOYMENT BAY',
      quickBattleTitle: 'Quick Battle',
      quickBattleSub: 'Choose a frontier and a side, then confirm your sortie. Your setup stays with you.',
      quickBattleChoiceHint: 'Six map profiles. Two sides. No faction is chosen for you.',
      quickBattleMapLabel: 'Map span · tiles',
      quickBattleFactionLabel: 'Choose your side',
      quickBattleRecommended: 'RECOMMENDED',
      quickBattleNeedFaction: 'Choose a side before you deploy',
      quickBattleFirstVisit: 'First sortie: 64×64 is the recommended field. Choose a side before deployment.',
      quickBattleSideNeeded: 'Choose Helios or the Kharid before the quick battle can deploy.',
      quickBattleReady: 'Ready to deploy: {dims} · {side}',
      quickBattleLastConfig: 'Last sortie restored: {dims} · {side}',
      quickBattleStart: 'DEPLOY · {dims} · {side}',
      quickBattleMapAria: '{name}, {dims} tile map',
      quickBattleFactionAria: 'Deploy as {side}',
      quickPresetNames: {
        compact: 'Outpost', standard: 'Frontier', large: 'Crossing',
        expanse: 'The Long March', wide: 'Open Front', tall: 'Deep Front',
      },
      campaignEyebrow: 'THE STORY SO FAR',
      campaignTitle: 'Campaign',
      campaignIntro: 'Fifteen missions across three acts in the struggle for Frontier-64.',
      campaignSub: 'Missions, briefings, and a story fought across three acts.',
      campaignStartFirst: 'Begin the campaign · mission {n}',
      campaignStartProgress: 'Campaign · mission {n}',
      campaignBrowse: 'Mission archive',
      universe: 'The Universe',
      universeEyebrow: 'CONTACT ARCHIVE',
      universeIntro: 'Dispatches from Helios and the Kharid: worlds, old signals, and the war that bound them together.',
      universeOpen: 'Open the lore archive',
      controls: 'Field controls',
      controlsEyebrow: 'FIELD INTERFACE',
      controlsIntro: 'Every order and shortcut, gathered in one compact field guide.',
      controlsSummary: 'Show orders and shortcuts',
      more: 'More',
      moreEyebrow: 'AUXILIARY SYSTEMS',
      moreTitle: 'Further intel',
      moreIntro: 'Future chapters and campaign progress controls.',
      footerNote: 'SINGLE-PLAYER STRATEGY · FRONTIER-64',
      backToTop: 'Back to top',
      season1: 'Season 1 · Campaign',
      season2: 'Season 2 · SOON',
      season2Toast: 'Season 2 — story missions. Coming soon.',
      codex: 'Lore',
      quickStart: 'Quick start — mission {n}',
      quickStartPlain: 'Quick start',
      reset: 'Reset progress',
      resetConfirm: 'Reset campaign progress? The lore archive will close and the Chronicle chapters will hide again.',
      facTeaserHuman: 'HELIOS — hover tech and plasma',
      facTeaserAlien: 'KHARID — crystal-born organics',
      help: [
        '<b>LMB</b> — select, drag a box · <b>double-click</b> — every matching unit on screen · <b>RMB</b> — move / mine / attack / repair',
        '<b>A + LMB</b> — attack-move: advance and engage everything en route · <b>wheel / two fingers</b> — pan the map · <b>Arrows / screen edge</b> — camera · <b>Space</b> — jump to base · <b>+ / −</b> — zoom · <b>V</b> — panel · <b>P</b> — pause (Esc releases/cancels)',
        '<b>Ctrl/Alt + 1…9</b> — assign a squad, <b>digit</b> — select, <b>press twice</b> — jump to it · <b>B</b> — build: all 8 structures (CC, home, barracks, turret, wall, bunker, factory, laboratory) · <b>S</b> — stop',
        '<b>.</b> — next idle worker · <b>,</b> — select the whole army · <b>Tab</b> — cycle fighters · <b>H</b> — jump to the last alarm · on a trackpad RMB is a two-finger tap or Ctrl+tap',
        '<b>Laboratory</b> — research: infantry weapons and armor, vehicle guns and plating · a rally point on a crystal puts new workers straight to mining',
        'Tech drones walk back to mining on their own after a build · without orders fighters engage enemies within sight range · nanites heal the nearest infantry and stop while healing · hover a button for the full briefing',
        'Mining: workers spread across the veins by themselves (optimum — 2 per crystal) · finished turret, barracks, factory and bunker can be upgraded: <b>R</b> — tier up, <b>X</b> — cancel',
      ],
    },

    topbar: {
      sound: 'Sound: on', soundOff: 'Sound: off',
      pause: 'Pause', resume: 'Resume',
      restart: 'Restart', exit: 'Exit',
    },

    panel: {
      pos: 'Panel', posTitle: 'Panel position: bottom → left → right → top',
      posState: 'Panel: {where}',
      posNames: { bottom: 'bottom', left: 'left', right: 'right', top: 'top' },
      hide: 'Hide', hideTitle: 'Hide panel (V)',
      show: 'Panel', showTitle: 'Show panel (V)',
    },

    loading: 'Loading…',
    pauseText: 'PAUSED',

    missionsScr: {
      h1: 'The Alien Cosmic Campaign',
      sub: '15 missions · 3 acts + "Chronicle Chapters" after the finale · Helios against the swarm and the Red Flag mutineers',
      skirmishBtn: 'Skirmish',
      back: '← Back',
      backToMissions: '← Missions',
      chapter: 'Chapter {n}',
      missionN: 'Mission {n}',
      locked: '■ locked',
      defenseTag: '◆ defense mode: enemy waves',
      for: 'Playing: ',
      objective: 'Objective: ',
      prepNote: ' · {prep} min to prepare, then {total} min of defense',
    },

    brief: { go: 'Engage!', title: 'Mission' },
    codexScr: { h1: 'Lore', universeTitle: 'The Universe', sub: 'The world of Frontier-64: erg, the swarm, the mutiny and three planets', back: '← Back' },

    skirmish: {
      h1: 'Skirmish',
      sub: 'Pick your side. The enemy will always be the opposite race.',
      size: 'Map size', shape: 'Shape',
      shapes: { square: 'Square', wide: 'Wide 3:2', tall: 'Tall 2:3' },
      humanCard: {
        title: 'HELIOS',
        sub: 'The corporation’s expeditionary corps',
        list: 'Rangers · Plasmers · Nanites<br>Skiffs · Bastions · Nova Mortars<br>Turrets · Bunkers · Laboratory',
      },
      alienCard: {
        title: 'KHARID',
        sub: 'Crystal-born natives',
        list: 'Shardjaws · Acid Spitters · Blooms<br>Skiters · Bruisers · Sporehulks<br>Mandibles · Cocoons · Evolution Node',
      },
      back: '← Back',
    },

    end: {
      win: 'Victory!', lose: 'Defeat',
      campaignDone: 'Campaign complete — the Kharid fields are free!',
      again: 'Play again', next: 'Next mission →',
      statsTime: 'Battle time', statsKills: 'Enemies destroyed', statsLosses: 'Losses',
    },

    hints: {
      buildMode: 'Click to place (serial mode: it stays on).<br>Wall/turret: drag LMB — a line with the price.<br>Arrows move the ghost, Enter places it.<br>RMB / ESC — cancel.',
      select: 'Select a unit with LMB or a drag-box.<br>RMB — move / mine / attack / repair.<br>RMB on a bunker — garrison it.',
      construction: 'The assigned worker raises it.',
      buildWip: ' — under construction',
      queueCancel: '{name} — click to cancel (minerals refunded)',
      queueEmpty: 'Queue is empty — pick a unit on the right',
      researchLeft: '{name} lv.{lvl} — {sec}s left',
      garrisonHint: 'Garrison: {n}/{cap} · RMB the bunker with infantry selected to move them in.',
      rallyHint: 'RMB on the ground — rally point for new units.',
      dmgLine: 'Damage {d} · range {r} · cooldown {cd}s',
      hpLine: 'Integrity {hp}/{max}',
      unitSub: '{desc} · damage {d} · cooldown {cd}s',
      ergTip: '<b>Erg {n}/{max}</b><br>Deposit: {sum}',
      wallCost: '{n} × {cost} = {total}',
      wallCostShort: '({n} skipped — short of minerals)',
      selectWorker: 'Select a {worker}',
    },

    states: {
      idle: 'Idle', move: 'Moving', attack: 'Engaging', attackMove: 'Clearing',
      gather: 'Mining', build: 'Building', repair: 'Repairing', garrison: 'To garrison', heal: 'Healing',
      blocked: 'Path blocked!', squad: ' · squad {n}', waiting: 'waiting', sec: '{n}s',
    },

    buildingState: {
      wip: 'Building — {p}%', underFire: 'Under fire!',
      researching: 'Researching: {name}', grading: 'Upgrading to Tier {to}',
      prodWait: 'Production halted (no supply)', prodExit: 'Launch bay blocked — unit is ready',
      producing: 'Producing: {name}',
      idleOrder: 'Awaiting orders — queue empty',
      garrison: 'Garrison: {n}/{c}',
      onPost: 'In position', active: 'Active',
    },

    process: {
      heading: 'STATION TELEMETRY',
      construction: 'Construction', research: 'Research', grade: 'Tier upgrade',
      production: 'Production', garrison: 'Garrison', standby: 'Standby',
      awaitingOrders: 'Awaiting orders', defense: 'Defense grid', onPost: 'On station',
      readyState: 'Systems', online: 'Structure operational',
      garrisonCount: 'Garrison {n}/{cap}',
      researchTitle: '{name} · level {lvl}',
      gradeTitle: '{name}: Tier {from} → {to}',
      progress: '{n}% complete', eta: 'Ready in {n}s',
      waitingSupply: 'Ready; waiting on supply', waitingExit: 'Ready; launch bay blocked',
      queueTitle: 'Queue · {n}/{cap}',
      refundShort: '↩ {n}', refundLabel: 'Refund: {n} minerals',
      queueCancelLabel: 'Cancel {name} — reclaim {n} minerals',
    },

    cmds: {
      shortageHuman: 'Helios short by {n} erg', shortageAlien: 'The brood needs {n} more facets',
      queueFull: 'Queue full', gameOver: 'Battle is over', unavailable: 'Unavailable right now',
      disabledLabel: '{label} — {reason}',
      cancel: 'Cancel', undo: 'Undo', back: 'Back', stop: 'Stop',
      build: 'Build',
      recon: 'Recon',
      reconTip: ['Send every scout into the unexplored fog', 'They skirt the enemy and report veins and contacts'],
      rally: 'Rally',
      rallyTip: ['Every idle unit heads for the rally point', 'Needs a rally point (RMB on a building)'],
      grade: 'Tier {r}',
      deploy: 'Deploy ×{n}',
      lockMark: ' · locked',
    },

    gradeTip: {
      dmg: 'Damage {d} · range {r}',
      rate: 'Training rate ×{r} · queue up to {q}',
      gar: 'Garrison up to {n} · HP ×{m}',
      opensAuto: 'Unlocks: {u} in the laboratory + the attack siren',
      opensCmds: 'Unlocks: Recon (T) and Rally (G) buttons',
      title: 'Tier {r}: {name}',
    },

    buildTip: {
      stats: 'HP {hp} · size {w}×{h} · build time {t}s',
      supply: 'Supply +{n}',
      trains: 'Trains: {list}',
      attack: 'Attack {d} · range {r}',
      garrison: 'Garrison up to {n} infantry',
      research: 'Researches army upgrades',
      requires: 'Requires: {name}',
    },

    unitTip: {
      line1: 'HP {hp} · damage {d} · range {r}',
      line2: 'Supply {s} · training {t}s',
      splash: 'Fragmentation splash',
      heal: 'Heals infantry: +{n} HP/s',
      vehicle: 'Vehicle: repaired by workers',
    },

    upgradeTip: {
      title: '{name} lv.{n}',
      time: 'Time: {t}s',
      global: 'Applies to the whole army at once',
    },

    objective: {
      prep: 'Preparation: {t} — build your defense',
      defense: 'Defense: {t} · waves repelled: {n}',
      stockpile: 'Gathered {n}/{m} {word}',
      evac: 'Evacuated {n}/{m}',
    },

    objectiveLabel: {
      key: 'Destroy: {name}',
      keyFallback: 'key target',
      stockpile: 'Gather {n} erg',
      evac: 'Evacuate {n} soldiers to the zone',
      fallback: 'Complete the objective',
    },
  },
  factions: {
    human: { title: 'HELIOS', sub: 'Human corporation: vehicles, turrets, tanks' },
    alien: { title: 'KHARID', sub: 'Crystal-born: the swarm, spikes, hive organics' },
  },

  units: {
    worker: {
      human: { name: 'Tech Drone', description: 'The base’s hands: mines erg, raises and repairs structures and vehicles; when idle it hurries off to patch damaged machines' },
      alien: { name: 'Gatherer', description: 'Nurse of the fields: gathers sleeping facets, raises nests, and tends wounded kin when idle' },
    },
    marine: {
      human: { name: 'Ranger', description: 'Assault trooper with a plasma carbine — the backbone of the Zarya-9 line; fits inside a bunker' },
      alien: { name: 'Shardjaw', description: 'A creeping thing with a crest of spikes: spits crystal darts; hides inside a cocoon' },
    },
    buggy: {
      human: { name: 'Skiff', description: 'Hover raider with twin impulse guns: strikes on the fly and pulls away at the edge of reach' },
      alien: { name: 'Skitter', description: 'A four-legged predator: stings and melts into the wastelands before the swarm finishes its song' },
    },
    tank: {
      human: { name: 'Bastion', description: 'Heavy hover platform: one fragmentation salvo covers a whole group' },
      alien: { name: 'Bruiser', description: 'A colossus with crystal horns: its spit bursts into a hail of shards' },
    },
    medic: {
      human: { name: 'Nanite', description: 'A swarm of nano-medics: patches up nearby infantry (7 HP/s); the scalpel is for self-defense only' },
      alien: { name: 'Bloom', description: 'Nursing spore: healing pollen mends kin (7 HP/s)' },
    },
    flamer: {
      human: { name: 'Plasmer', description: 'Flamer crew: burns groups point-blank; helpless at a distance' },
      alien: { name: 'Acid Spitter', description: 'Pot-bellied spitter: its acid spray eats through even carapaces' },
    },
    arty: {
      human: { name: 'Nova Mortar', description: 'Self-propelled mortar: rains shards across 12.5 tiles; keep it behind the line' },
      alien: { name: 'Sporehulk', description: 'Worm-mortar: hurls blasts across half the map; keep it behind the brood' },
    },
    scout: {
      human: { name: 'Pathfinder', description: 'Light hover with a spotter drone: sees 11 tiles out and outruns any pursuit. Unarmed — keep it out of the line' },
      alien: { name: 'Listener', description: 'A nimble little beast with a companion spore: senses enemies and facets 11 walks away. It cannot sting — do not drive it into battle' },
    },
  },

  buildings: {
    cc: {
      human: { name: 'Command Center', description: 'The outpost’s headquarters: trains drones, takes in erg, +10 supply' },
      alien: { name: 'Hiveheart', description: 'The hive’s heart: grows gatherers, takes in facets, +10 supply' },
    },
    depot: {
      human: { name: 'Home', description: 'Colonist habitat modules: +8 supply. Without homes the army stalls' },
      alien: { name: 'Storehouse', description: 'A living facet store: widens the hive, +8 supply' },
    },
    barracks: {
      human: { name: 'Barracks', description: 'The Zarya-9 training hall: rangers, plasmers, nanites. Queue up to 5' },
      alien: { name: 'Incubator', description: 'Brood-chamber: shardjaws, acid spitters and blooms hatch from the spawn. Queue up to 5' },
    },
    turret: {
      human: { name: 'Viper Turret', description: 'Automatic sentinel: the twin guns bite like two fangs. Range 150' },
      alien: { name: 'Mandibles', description: 'A watchful maw: spits spikes at every intruder. Range 150' },
    },
    wall: {
      human: { name: 'Wall Segment', description: 'Frontier plasteel: 900 HP holds back swarm and vehicles alike' },
      alien: { name: 'Chitin Wall', description: 'Living chitin: the hive’s wall, 900 HP' },
    },
    bunker: {
      human: { name: 'Bunker', description: 'Shelter: up to 4 infantry are invulnerable inside and fire on their own. RMB to move in' },
      alien: { name: 'Cocoon', description: 'Cocoon: 4 fighters invulnerable inside, stinging through the seams. RMB to move in' },
    },
    factory: {
      human: { name: 'Vehicle Factory', description: 'Workshop of the expeditionary corps: skiffs, bastions, Novas and pathfinders. Needs a barracks' },
      alien: { name: 'Brood Pit', description: 'The brood pit: skitters, bruisers, sporehulks and listeners crawl out to the song. Needs an incubator' },
    },
    lab: {
      human: { name: 'Laboratory', description: 'Field science: weapons, armor, guns and plating. Research it first' },
      alien: { name: 'Evolution Node', description: 'Where the swarm decides what it will become tomorrow. Research it first' },
    },
  },

  upgrades: {
    infAtk: {
      human: { name: 'Infantry Weapons', description: 'Calibrated barrels and fire mixes: +3 infantry damage per level' },
      alien: { name: 'Thorn Sharpening', description: 'Sharpened spikes and glands: +3 infantry damage per level' },
    },
    infArm: {
      human: { name: 'Infantry Armor', description: 'Composite plating of Zarya-9: −2 damage to infantry per level' },
      alien: { name: 'Carapace', description: 'The brood’s carapace: −2 damage to infantry per level' },
    },
    vehAtk: {
      human: { name: 'Vehicle Weapons', description: 'A longer barrel, a farther death: +5 vehicle damage per level' },
      alien: { name: 'Brood Jaws', description: 'The hive’s mightiest jaws: +5 damage to heavy creatures per level' },
    },
    vehArm: {
      human: { name: 'Vehicle Plating', description: 'Bolt-on armor: −3 damage to vehicles per level' },
      alien: { name: 'Chitin Carapace', description: 'Layered chitin: −3 damage to heavy creatures per level' },
    },
    autoRepair: {
      human: { name: 'Auto-Repair', description: 'Command Center Tier II protocol: idle techs repair the base on their own — buildings and vehicles, two per target; done, and they return to mining' },
      alien: { name: 'Mend-Song', description: 'The Tier II nest song: nurses mend nests and brood on their own, two per wound; mended, they return to the facets' },
    },
  },

  // Faction lines: the same meaning — a different voice (human drill
  // and engineering vs the brood’s song).
  messages: {
    noMinerals: { human: 'Not enough minerals', alien: 'The hive needs more facets' },
    queueFull: { human: 'Queue is full', alien: 'The brood is crowded' },
    labBusy: { human: 'The laboratory is already researching', alien: 'The node is already singing its evolution' },
    maxed: { human: 'Upgrade already at its limit', alien: 'The facet is honed to its limit' },
    unexplored: { human: 'The area is not scouted yet', alien: 'The swarm does not smell these lands' },
    requires: { human: 'Build first: ', alien: 'Grow first: ' },
    cantBuild: { human: 'Cannot build here', alien: 'It will not grow here' },
    underAttack: { human: 'We are under attack!', alien: 'The hive is under attack!' },
    rallyCrystal: { human: 'Rally at the crystal', alien: 'Rally at the facets' },
    rallyPoint: { human: 'Rally point', alien: 'Rally point' },
    builtDone: { human: 'Construction complete: ', alien: 'The nest has grown: ' },
    repairStop: { human: 'Repair halted: ', alien: 'Mending interrupted: ' },
    repairDone: { human: 'Repair complete: ', alien: 'Mended: ' },
    autoRepairWait: {
      human: 'Auto-repair awaits minerals — workers sent to mine',
      alien: 'The mending song awaits facets — gatherers went to the facets',
    },
    mined: { human: 'Minerals mined', alien: 'Facets gathered' },
    winKill: { human: 'Enemy wiped out! The Frontier holds.', alien: 'The foe is scattered! The hive sings victory.' },
    loseBase: { human: 'The base is lost. The signal has gone quiet.', alien: 'The nest is torn open. The song has broken off…' },
    loseEmbark: { human: 'No one to load — the evacuation has failed.', alien: 'No one to carry — the brood’s song has broken off…' },
    winNoBaseFort: { human: 'The citadel has fallen — the squad did its job!', alien: 'The fort has fallen — the squad did its job!' },
    winNoBaseNest: { human: 'The nest is torn open — the squad did its job!', alien: 'A strange nest torn open — the brood did its job!' },
    winDefense: { human: 'The shuttles have landed — the defense held!', alien: 'The wave broke against chitin. The fields held!' },
    winKey: { human: 'The key target is destroyed. The Frontier moves on.', alien: 'The strangers’ heart is torn out. The swarm sings victory.' },
    winStock: { human: 'Erg enough — the region is ours.', alien: 'Facets aplenty — the fields have fed the hive.' },
    winEvac: { human: 'Evacuation complete. Everyone aboard the shuttles — we are leaving.', alien: 'The brood is led into the deep. The song goes on.' },
    outsideZone: { human: 'You can only build in your own zone', alien: 'Only your own lands may be grown' },
    evacOne: { human: 'Evacuated', alien: 'Led to the swarm' },
    minedWord: { human: 'erg', alien: 'facets' },
    wave: { human: 'Assault group {n} is heading for the base!', alien: 'Wave {n} is coming out of the hive!' },
    needSupply: { human: 'A Home is needed — build one more', alien: 'A storehouse is needed — grow one more' },
    resDone: { human: 'Upgrade complete: ', alien: 'Evolution complete: ' },
    gradeDone: { human: 'Tier upgrade complete: ', alien: 'The facet is strengthened: ' },
    needCC2: { human: 'Requires Command Center Tier II', alien: 'Requires a Tier II nest' },
    noRally: { human: 'Set a rally point first', alien: 'Point out a rally point first' },
    reconDone: { human: 'The map is fully scouted', alien: 'The swarm has sniffed out every land' },
    contact: { human: 'Contact with the enemy!', alien: 'Strangers are near!' },
    veinFound: { human: 'Erg veins discovered!', alien: 'Sleeping facets found!' },
    noScouts: { human: 'No scouts — build them at the factory', alien: 'No listeners — grow them in the pit' },
    lostSquad: { human: 'The squad is dead — mission failed', alien: 'The brood has fallen — mission failed' },
    newObjective: { human: 'New objective: {goal}', alien: 'New objective: {goal}' },
    lvlWord: { human: ' lv. ', alien: ' lv. ' },
  },

  // Interface terms (glossary §3.4) — canonical words the strings above
  // are built from; kept in the dictionary for future lines and the sim.
  terms: {
    erg: 'erg', facets: 'facets', hp: 'HP', supply: 'Supply',
    tier: 'Tier', rallyPoint: 'rally point', rally: 'Rally', recon: 'Recon',
    cooldown: 'cooldown', range: 'range', sight: 'sight',
  },
  // The Lore archive: tabs keyed by id from lore.js (structure/unlockAfter
  // stays in code, text lives here). <b> is the only allowed body markup.
  codex: {
    locked: '??? — will open as the war unfolds',
    world: {
      tab: 'World', title: 'Frontier-64',
      body: [
        'The year is 2189. Humanity runs on erg — the energy of crystal fields. An erg crystal grows in only three places of the Sabgir sector. Whoever owns the fields feeds half the system.',
        'Frontier-64 — the sixty-fourth outpost on the edge of settled space: bases, quarries and silent watchtowers from Aktan-4 to its gray moon. Beyond them — only the swarm.',
        'Motto of the watchtowers: "The Frontier holds; the erg flows."',
      ],
    },
    helios: {
      tab: 'Helios', title: 'Helios Industries',
      body: [
        'A mining corporation with an army of its own: an expeditionary corps, hover vehicles, plasma, orbital ports. Sector command — the port of Helios Prime.',
        'Helios is engineers, miners and officers who honestly believed the Kharid were mindless fauna. Right up until the dunes rose and marched on their camps.',
        'Their tragedy is blindness. Their valor is the line: you do not abandon your own, even when the shuttles are late.',
      ],
    },
    kharid: {
      tab: 'Kharid', title: 'The Crystalborn',
      body: [
        'Natives of Brok-Thaal. A half-crystalline swarm: every creature is one facet of a single brood, bound by the brood-song. Translators mistook it for static for a long time.',
        'To the hive, crystals are not ore but sleeping kin. Every crystal lifted from a field is a stolen child. That is why their war is sacred: the swarm takes its children back.',
        'Yet the hive is not one: the Dusk nest was first to sell facets for machines and fuel — and went over to the Red Flag.',
      ],
    },
    flag: {
      tab: 'Mutiny', title: 'The Red Flag',
      body: [
        'A third of the Artemis garrison, risen in mutiny at the height of the war. They call themselves Sons of the Sand — children of Aktan. Everyone else calls them the Red Flag, after the banners on the captured watchtowers.',
        'Their commanders are former Helios officers: they know the drill books, the base schematics and the weak points of every turret.',
        'Their stake is the Silencer: a device that dampens the erg fields of the region. Without erg, both the corporation and the swarm fall.',
      ],
    },
    planets: {
      tab: 'Planets', title: 'Three Worlds',
      body: [
        '<b>Aktan-4</b> — Helios’s red planet: rusted deserts, salt seas, the Rudnik-7 quarry, the port of Helios Prime. It all began here — with the mine called Delta-2 falling silent.',
        '<b>Brok-Thaal</b> — the hive’s violet world: sacred crystal fields, the Lower and Upper Fields. Foreign boots here are blasphemy.',
        '<b>Selenite-B</b> — a gray moon: the Lazur crater, Outpost Rampart, the anchor of the orbital elevator, and the Eye of the Storm rift — the mutiny’s last den.',
      ],
    },
    war: {
      tab: 'Chronicle', title: 'A Chronicle of the War',
      items: [
        { group: 'Act I "Frontier"', title: 'Delta-2 Fell Silent', body: 'The nest was torn open. But at night the dunes were singing — and it was no static. The war for Frontier-64 began with the silence of one mine.' },
        { group: 'Act I "Frontier"', title: 'Night of Spikes', body: 'The shuttles left. The swarm drew back — to count its dead. It will return. The first night proved the swarm counts. Which means it remembers.' },
        { group: 'Act I "Frontier"', title: 'The Swarm Woke', body: 'The iron kind forgot the road to the fields. For a while: the quarry calls them. For the first time, the war is seen through the swarm’s eyes.' },
        { group: 'Act I "Frontier"', title: 'The Quarry Is Ours', body: 'The quarry is ours. But the swarm follows — the region is being evacuated. The erg flows again. The price of mining keeps climbing.' },
        { group: 'Act I "Frontier"', title: 'The Pass Held', body: 'The last transport is gone. The pass belongs to the swarm now — but the region lives. The evacuation is done. The war moves to Brok-Thaal.' },
        { group: 'Act II "Fire and Steel"', title: 'Blood of the Lower Fields', body: 'The ridge held. The brood licks its wounds — and listens to the south. The sacred fields stood — and they remember.' },
        { group: 'Act II "Fire and Steel"', title: 'Red Flags', body: 'The flags are torn down. But a mutiny is an idea, and ideas do not burn well. Now the enemy is also one of us: the war runs on two fronts.' },
        { group: 'Act II "Fire and Steel"', title: 'The Fort Has Fallen', body: 'The fort fell. In the safe — the Dusk nest’s invoices. Quietly. No one. The first thread to Dusk sits in the fort’s safe.' },
        { group: 'Act II "Fire and Steel"', title: 'There Was No Quiet Sector', body: 'The incubators burned. There was no squad. The sector was quiet. There was no operation. The invoices, though — the invoices were real.' },
        { group: 'Act II "Fire and Steel"', title: 'Rampart Stands', body: 'Rampart stands. The elevator grows. Let them try again. The elevator anchor survived: the build continues under fire.' },
        { group: 'Act III "Dominion"', title: 'Heart of the Hive', body: 'The fields are sacred. But the iron kind will return — they need the erg, not peace. The silence pact is void: the Upper Fields are a battlefield again.' },
        { group: 'Act III "Dominion"', title: 'Flint Falls Silent', body: 'Flint falls silent. The Silencer is not found. It is somewhere close. The mutiny’s capital has fallen. The Silencer has not.' },
        { group: 'Act III "Dominion"', title: 'Home Held', body: 'The port held. Home is whole. Now — to finish it. The counterstrike is broken. Only the finishing remains.' },
        { group: 'Act III "Dominion"', title: 'The Eye Closed', body: 'The Eye has closed. Humans and the swarm struck in the same direction. For the first time. The corridor through Rampart decided the war on the moon.' },
        { group: 'Act III "Dominion"', title: 'The Frontier Is Closed', body: 'The Silencer is dead. The Frontier is closed. Peace — for both races. Engineers and swarm look at each other without a gun-sight for the first time.' },
      ],
    },
    heroes: {
      tab: 'Heroes', title: 'Heroes and Places',
      items: [
        { title: 'Delta-2 Mine', body: 'It stopped answering; the first words of the survivors were "the dunes are alive".' },
        { title: 'Zarya-9 Camp', body: 'The night of spikes; the line at the Ash Gorge.' },
        { title: 'The Ash Pass', body: 'The only road to the sea; the evacuation of the region.' },
        { title: 'Artemis', body: 'A transfer warehouse; the birthplace of the mutiny.' },
        { title: 'Nail Fort', body: 'Entrenched defectors; the Novas’ first engagement.' },
        { title: 'The Dusk Nest', body: 'The swarm that sold itself for machines and fuel.' },
        { title: 'Outpost Rampart', body: 'An orbital elevator raised under fire.' },
        { title: 'Flint', body: 'Capital of the Sons of the Sand; the order read "total rout".' },
        { title: 'Helios Prime', body: 'Home. To defend the port is to defend everything.' },
        { title: 'Eye of the Storm', body: 'The mutiny’s last fort; the first joint strike of humans and swarm.' },
        { title: 'The Last Song', body: 'A fortress-nest on the fields of Sabgir where the Silencer is hidden. The war’s finale — and the beginning of peace.' },
      ],
    },
    arsenal: {
      tab: 'Arsenal', title: 'The Arsenal of War',
      items: [
        { group: 'Helios', title: 'Tech Drone', body: 'A repair hover, the base’s hands.' },
        { group: 'Helios', title: 'Ranger', body: 'Assault trooper, the backbone of the line.' },
        { group: 'Helios', title: 'Skiff', body: 'Raider of the flanks.' },
        { group: 'Helios', title: 'Bastion', body: 'A heavy fist.' },
        { group: 'Helios', title: 'Nanite', body: 'A swarm of medics.' },
        { group: 'Helios', title: 'Plasmer', body: 'A flamer crew.' },
        { group: 'Helios', title: 'Nova Mortar', body: 'Siege thunder.' },
        { group: 'Helios', title: 'Pathfinder', body: 'The base’s eyes: a light hover with a spotter drone.' },
        { group: 'Helios', title: 'Viper Turret', body: 'Automatic sentinel: fires in a pair, like a viper’s two fangs (the callsign came from the Zarya-9 gun crews).' },
        { group: 'Kharid', title: 'Gatherer', body: 'A crystal-bearer, nurse of the fields.' },
        { group: 'Kharid', title: 'Shardjaw', body: 'A creeping marksman.' },
        { group: 'Kharid', title: 'Skitter', body: 'A predator of raids.' },
        { group: 'Kharid', title: 'Bruiser', body: 'A colossus with horns.' },
        { group: 'Kharid', title: 'Bloom', body: 'A nursing spore turned field medic.' },
        { group: 'Kharid', title: 'Acid Spitter', body: 'A living flamethrower.' },
        { group: 'Kharid', title: 'Sporehulk', body: 'A worm-mortar.' },
        { group: 'Kharid', title: 'Listener', body: 'The swarm’s ears: a nimble little beast with a companion spore.' },
        { group: 'Kharid', title: 'Mandibles', body: 'A watchful maw.' },
        { group: 'Kharid', title: 'Cocoon', body: 'A living shelter: fighters inside are invulnerable and sting through the seams.' },
      ],
    },
  },
  // Campaign: content keyed by mission.id (never by array position!).
  // Mechanics (seed/maps/AI/objectives/bans) stay in js/missions.js.
  missions: {
    0: {
      act: 'Act I · Frontier', name: 'A Strange Shore',
      place: 'Aktan-4 — rusted desert by the Sabgir sea, the Delta mining region',
      brief: [
        'The year is 2189. Helios Industries mines erg crystals on Aktan-4, a red planet of rusted deserts and salt seas. The crystals feed half the system — for now…',
        'Yesterday the Delta-2 mine stopped answering. The survivors speak of living dunes: the crystalborn Kharid — natives no one ever counted as intelligent — have risen to defend their mineral fields.',
        'Command orders you to dig in: deploy the command center, get the mining going and tear down the nearest nest. Careful: the desert does not stay empty.',
      ],
      intro: 'New unit: the Ranger — your basic shooter. Raise a barracks and build up your force.',
      objective: 'Destroy the Kharid nests in the region',
    },
    1: {
      act: 'Act I · Frontier', name: 'Night of Spikes',
      place: 'Aktan-4, the Zarya-9 camp by the Ash Gorge',
      brief: [
        'The Kharid do not forgive trespassers. Reconnaissance intercepted a "brood-song" — that is what the translators call their signals: by nightfall the wastelands will rise and march on Zarya-9.',
        'You have until dusk: stack minerals, raise walls and turrets, dig in bunkers, bring up vehicles. Build your line across the pass between the rocks.',
        'Tonight the Kharid waves will come one after another, each stronger than the last. When the shuttles settle into the ring of lights — load 6 soldiers: only those standing inside the circle get out.',
      ],
      intro: 'A two-phase defense: survive the assault, then load 6 soldiers into the shuttle zone.',
      epilogue: 'The shuttles left. The swarm drew back — to count its dead. It will return.',
      objText: 'Hold out through the assault, then load 6 soldiers into the shuttle zone',
      phaseToast: 'The shuttles have landed — load 6 soldiers into the ring of lights!',
    },
    2: {
      act: 'Act I · Frontier', name: 'The Depths Awaken',
      place: 'Brok-Thaal — the hive’s violet wastelands, the sacred crystal fields',
      brief: [
        'The Kharid remember every facet pulled out of the ground: to the hive, minerals are not ore but sleeping kin. Helios machines are devouring the fields of Brok-Thaal — the brood’s third sacred place.',
        'The swarm has woken. Gatherers raise nests, shardjaws ready themselves, and skitters and bruisers crawl out of the brood pits.',
        'Lead the swarm onto the corporate camp: crush the Camp Heart — the iron kind’s command center. Hurry: their punitive corps arrives by the seventh minute.',
      ],
      intro: 'New structure: the Brood Pit — skitters and bruisers. The mission objective is the enemy camp.',
      epilogue: 'The iron kind forgot the road to the fields. For a while: the quarry calls them.',
      objName: 'Camp Heart',
      deadlineLabel: 'The Helios punitive corps',
    },
    3: {
      act: 'Act I · Frontier', name: 'Rudnik-7',
      place: 'Aktan-4, the Rudnik-7 plateau — the region’s main quarry',
      brief: [
        'We took the Rudnik-7 quarry — the heart of the region’s mining — but the swarm is right behind: the skitters that crawled from the brood pits were only the first wave.',
        'Command ordered everything squeezed out of the quarry: 2,500 erg — onto the evacuation shuttles. Until the cargo machines haul out the last of it, the quarry must hold.',
        'Skiffs strike with impulses on the fly — hovers mow down swarm infantry and pull away at the edge of reach. Hold on: behind the infantry come the fire-mix crews.',
      ],
      intro: 'Skiffs against a living wave: fast raiders mow infantry down on the fly.',
      epilogue: 'The quarry is ours. But the swarm follows — the region is being evacuated.',
    },
    4: {
      act: 'Act I · Frontier', name: 'The Ash Line',
      place: 'Aktan-4, the Ash Pass — the only road to the sea',
      brief: [
        'The brood is right behind us: nests rose at once, and the whole swarm is moving toward the Ash Pass — the only cargo road to the sea.',
        'Command has declared the region evacuated. Shuttles set down on the pad by the sea: hold a soldier inside the landing lights for three seconds — the transport will take him.',
        'The quarry we held last week paid for the shuttles in erg. Now carry out the ones who mined it: load eight — and the pass may be given to the swarm.',
      ],
      intro: 'Evacuation: 3 seconds inside the ring of lights and a soldier is aboard. Get 8 out.',
      epilogue: 'The last transport is gone. The pass belongs to the swarm now — but the region lives.',
    },
    5: {
      act: 'Act II · Fire and Steel', name: 'Blood of the Sacred Fields',
      place: 'Brok-Thaal, the Lower Fields — a facet of the sacred hunt',
      brief: [
        'The corporation has come to the Lower Fields — the place where the brood first saw light. Gatherers pray to the stone: Helios machines grind down even the dead facets.',
        'The hive answers: from everywhere the brood-song is heard, shardjaws march south. Let the iron kind learn what a holy war is. They bring siege guns — meet them with jaws, not carapaces.',
        'Advice: build within the sacred fields — beyond the ridge the hive’s will is weak. Repel the assault — and lead the swarm onto the attackers’ nest: burn it, and the waves will dry up.',
      ],
      intro: 'Defense of the sacred fields: it pays to build within the fields, survive the storm — then counterattack.',
      objective: 'Defense: hold the sacred fields (11 minutes of battle)',
      epilogue: 'The ridge held. The brood licks its wounds — and listens to the south.',
    },
    6: {
      act: 'Act II · Fire and Steel', name: 'Red Flag',
      place: 'Aktan-4, Artemis station — a corporate transfer warehouse',
      brief: [
        'The bad news does not come from outside. A third of the Artemis garrison raised red flags: the deserters call themselves Sons of the Sand and sell crystals and weapons to both sides — corporation and swarm alike.',
        'Their commanders are our own former officers. They know the drill books, the base schematics and the weak points of every turret.',
        'But the station must keep working: ship 2,000 erg on schedule while the Sons of the Sand raiders burn the caravans. Ours against ours — the one with the full warehouse wins.',
      ],
      intro: 'New unit: the Plasmer — one salvo burns out a group. The enemy is human now!',
      epilogue: 'The flags are torn down. But a mutiny is an idea, and ideas do not burn well.',
    },
    7: {
      act: 'Act II · Fire and Steel', name: 'The Steel Fist',
      place: 'Aktan-4, Nail Fort — a fortified camp of the mutineers',
      brief: [
        'The defectors — the very ones who raised the flags on Artemis — have dug in at Nail Fort: a ring of turrets, walls, warehouses of looted vehicles. Assaulting it with infantry is threshing sand.',
        'The engineering corps has finished trials: the Nova self-propelled mortar throws across twelve and a half tiles and blankets a whole pad in shards. But the fort has mortars of its own — guard your siege train.',
        'Keep the Novas behind, crack the ring from stand-off range and bring down the fort’s HQ. Expect a counterstrike by the eighth minute — the Red Flag does not give up Nail without a fight.',
      ],
      intro: 'New unit: the Nova Mortar — long-range siege artillery.',
      epilogue: 'The fort fell. In the safe — the Dusk nest’s invoices. Quietly. No one.',
      objName: 'Nail Fort HQ',
      deadlineLabel: 'Red Flag counterstrike',
    },
    8: {
      act: 'Act II · Fire and Steel', name: 'The Quiet Sector',
      place: 'Brok-Thaal, the outskirts of the Dusk nest — a quarantine zone',
      brief: [
        'Reconnaissance found what should not exist: the Dusk nest is trading with the Red Flag. The Kharid hand over crystals — the mutineers leave them machines and fuel.',
        'Command forbids a full-scale assault: the sector is too close to the sacred fields, and a scandal is the last thing we need. Only a small squad works here — no base, no noise.',
        'Your eight leave before dawn. The task: burn the incubators and every structure of the nest. If the squad dies — no one will ever hear of this mission.',
      ],
      intro: 'A stealth raid: there is NO base. A squad of rangers, plasmers and nanites — guard every one.',
      objective: 'Destroy every structure of the Dusk nest with a small squad',
    },
    9: {
      act: 'Act II · Fire and Steel', name: 'The Azure Rampart',
      place: 'Selenite-B, the Lazur crater — Outpost Rampart by the rift entrance',
      brief: [
        'Selenite-B — the gray moon over Aktan-4. Here, by the rift entrance, the corporation raises the anchor of an orbital elevator. The mutineers mean to burn it before assembly.',
        'Intercepts speak of heavy machines in the Red Flag camp: siege guns and plasma crews. Against them we have an answer — nanites and fortifications.',
        'Build your line by the crater and outlast it all: while Rampart stands, the elevator will keep rising.',
      ],
      intro: 'Nanites hold the line: they heal nearby infantry. Keep them behind your fighters.',
      objective: 'Defense: hold out until the anchor is assembled (14 minutes of battle)',
    },
    10: {
      act: 'Act III · Dominion', name: 'Heart of the Hive',
      place: 'Brok-Thaal, the Upper Fields — the heart of the sacred hunt',
      brief: [
        'The silence pact is over: Helios has moved on the Upper Fields — the heart of the hive. With them march iron assault columns, fire-mix crews and healers in white.',
        'The swarm answers the challenge. Blooms — nursing spores — are bred for war for the first time: they mend kin right in the firefight.',
        'Crush the HQ of the Helios assault base. Let the Upper Fields stay sacred.',
      ],
      intro: 'New to the Kharid: the Bloom — the swarm’s healer. The enemy now fields nanites and mortars!',
      objName: 'The Helios HQ',
      epilogue: 'The fields are sacred. But the iron kind will return — they need the erg, not peace.',
    },
    11: {
      act: 'Act III · Dominion', name: 'The Coup',
      place: 'Aktan-4, the warehouse city of Flint — the capital of the Red Flag',
      brief: [
        'An intercepted mutineer order names the Silencer: a device able to dim the erg fields of the whole region. Corporation and swarm alike would be left without crystals — and the Red Flag without rivals.',
        'The warehouse city of Flint is their capital: factories, laboratories, a garrison of veterans. Command gave the order that has not been given since the landing: total rout.',
        'Bring down Flint’s HQ — the capital’s command center. Hurry: the garrison veterans arrive by the eighth minute.',
      ],
      intro: 'The enemy builds laboratories and upgrades its army — keep pace: research first!',
      objName: 'Flint HQ',
      deadlineLabel: 'Flint’s veterans',
      epilogue: 'Flint falls silent. The Silencer is not found. It is somewhere close.',
    },
    12: {
      act: 'Act III · Dominion', name: 'Helios Prime',
      place: 'Aktan-4, the orbital port of Helios Prime — the corporation’s heart',
      brief: [
        'The Red Flag’s counterstrike fell where it all began: the port of Helios Prime. The waves come out of the mutineers’ citadel — a single spawn point — and their landing force is already on the launch fields.',
        'This is no field camp — this is our home. Hangars, laboratories, shipyards. None of it can be lost.',
        'You hold the fullest base of the whole campaign. Build, repair, research — and hold the wall to the last shuttle.',
      ],
      intro: 'The full arsenal: nanites, mortars, laboratory. Fifteen minutes of hell.',
      objective: 'Defense: hold out until the orbit unlocks (15 minutes of battle)',
    },
    13: {
      act: 'Act III · Dominion', name: 'Eye of the Storm',
      place: 'Selenite-B, the Eye of the Storm rift — the mutineers’ last fort',
      brief: [
        'The Red Flag is fleeing Aktan-4, but their last fort survived — on the gray moon, in the Eye of the Storm rift. From there they still dream of switching on the Silencer.',
        'The hive and Helios strike in the same direction for the first time. The humans opened a corridor to Selenite for the Kharid — the swarm goes in first. A large army would be spotted on approach and buried under artillery: only a small squad can pass.',
        'The port burned — now the Eye. With a small squad, no base: tear down the Eye of the Storm — the fort’s command node — and walk four soldiers out to the landing zone.',
      ],
      intro: 'A sabotage run without a base: tear down the Eye of the Storm and bring 4 soldiers out. Every loss is permanent.',
      epilogue: 'The Eye has closed. Humans and the swarm struck in the same direction. For the first time.',
      objName: 'Eye of the Storm',
      objText: 'Tear down the Eye of the Storm, then walk 4 soldiers out to the extraction zone',
      phaseToast: 'The Eye is destroyed — fall back to the landing zone!',
    },
    14: {
      act: 'Act III · Dominion', name: 'The Stellar Frontier',
      place: 'Brok-Thaal, the fields of Sabgir — the fortress-nest of the Last Song',
      brief: [
        'The finale waits where it all began. On the sacred fields of Sabgir, mutineers and the splinter brood raised a fortress-nest called the Last Song: a double ring of mandibles, brood pits, evolution nodes.',
        'The Silencer is hidden here. If it ever starts, the fields will die — and neither humans nor Kharid will have a place left under these stars.',
        'Command gave you everything: Novas, nanites, plasmers, laboratories. The corporation and the swarm are watching. Close the Frontier — and bring peace to both races.',
      ],
      intro: 'FINALE: an enemy at full strength — research, mortars, acid spitters. Tear the fortress down!',
      objName: 'The Last Song fortress',
      epilogue: 'The Silencer is dead. The Frontier is closed. Peace — for both races.',
    },
    16: {
      act: 'Chronicle Chapters', name: 'The Rust Caravan',
      place: 'Aktan-4, the Rudnik-7 quarry — the Delta workings',
      brief: [
        'Rudnik-7 is held — now squeeze it dry. Command counts it this way: every crystal is a seat on a shuttle, every shuttle is a settlement saved.',
        'The swarm is already coming: nests rose across the whole region, and the first packs will be here before the engineers finish their coffee. You have almost no army — only what you manage to build.',
        'Hold the workings with turrets, cut the packs apart with skiffs on the flanks, and load the erg: 2,500 — and the caravan leaves before the quarry drowns. You do not need to raze the nests: victory is counted in ore, not in demolition.',
      ],
      intro: 'A caravan of erg: mine 2,500 — the waves come from the first minutes. Turrets hold, skiffs cut.',
      epilogue: 'The caravan left. The shuttles are loaded — now to hold the pass.',
    },
    17: {
      act: 'Chronicle Chapters', name: 'The Quiet Facet',
      place: 'Brok-Thaal, the outskirts of the Dusk nest — the dead facets',
      brief: [
        'While the humans burned the incubators from outside (№8), the loyal facets burned the betrayal from within.',
        'The Dusk nest sold its sleeping kin for machines and fuel. Your brood is the ones who refused: no base, no hive-song — only claws and pollen.',
        'Burn the three storehouses of Dusk — and do not lose a single bloom: there is no one left to heal. Lose the bloom, and the brood is lost.',
      ],
      intro: 'A raid without a base: burn 3 storehouses. Lose the bloom = fail.',
      epilogue: 'The storehouses burn. Dusk will remember: facets are not for sale.',
      objName: 'Dusk storehouses',
      guardLose: 'The brood has fallen — the bloom is dead, no one is left to heal.',
    },
    18: {
      act: 'Chronicle Chapters', name: 'The Long Night',
      place: 'Selenite-B, the Rampart plateau — the elevator anchor',
      brief: [
        'Rampart, raised in the flames of №9, now shields the corridor for the swarm.',
        'The mutineers are coming to throw Rampart into the rift: hold the anchor until dawn. Build only on the plateau — down in the fog their patrols are already riding. There will be no barracks and no factories: no reinforcements are coming.',
        'At dawn the shuttles set down: load eight. What is not loaded — stays.',
      ],
      intro: 'Hold Rampart until dawn, then load 8 soldiers. No barracks, no factory.',
      epilogue: 'The corridor is open. The swarm has passed — now for the Eye of the Storm.',
      objText: 'Hold Rampart until dawn, then load 8 soldiers into the shuttle zone',
      phaseToast: 'Dawn has broken — the shuttles have landed! Load 8 soldiers into the ring of lights!',
    },
    19: {
      act: 'Chronicle Chapters', name: 'The Silencer Sleeps',
      place: 'Aktan-4, the sands beyond Flint — old workings',
      brief: [
        'The Red Flag’s leftovers slipped into the sands beyond Flint — and assembled a small Silencer there. Not the one that fell at the Last Song: weaker, but the fields will not survive even a weak one.',
        'Their garrison is thin — your pack will sweep it away. The clock is the true enemy: in ten minutes the device will start its song, and the song of the fields will be cut short.',
        'Lead the brood through the sands and tear the Silencer down before it wakes. Close the mutiny’s thread — for good.',
      ],
      intro: 'An assault against the clock: tear the Silencer down within 10:00. Time runs out = defeat.',
      epilogue: 'The war is over. But something still ticks in the sands.',
      objName: 'The Silencer',
      deadlineLabel: 'The Silencer has started its song',
    },
    skirmish: {
      name: 'Skirmish',
      place: 'Sector 64 — the contested lands of the Frontier',
      brief: [
        'Alarm on Frontier-64: a foreign detachment is deploying in the contested sector.',
        'Border service at its classic best: wreck their bases without losing your own. The Frontier holds; the erg flows.',
      ],
      objective: 'Destroy every enemy structure',
    },
  },
};



