// ============================================================
// sim_wins.mjs — сценарии win/lose для движковых условий M0.
//
// W1 keyTarget: снос помеченной цели = победа со строкой winKey.
// W2 легаси: снос всей базы без новых механик = прежняя победа winKill.
// W3 stockpile: счётчик добычи реален, порог = победа winStock.
// W4 evacZone: N юнитов в зоне hold секунд = победа winEvac без потерь;
//    выход из зоны сбрасывает hold.
// W5 loseDeadline (мягкий): таймер = карательная волна, игра идёт.
// W6 loseDeadline (жёсткий): таймер = поражение с label-причиной.
// W7 buildZone: стройка игрока только внутри зон, ИИ не ограничен.
// W8 М6: волны обороны добирают медиков до лимита профиля.
// W14 rep1: двухфазная оборона — таймер, затем эвакуация 6 (некого грузить = поражение).
// W15 rep5: зона стройки священные поля, мортиры, оборонная победа, контратака текстом.
// W16 rep13: диверсия noBase — «Око», затем отход 4 выживших.
//
// Запуск: node scripts/sim_wins.mjs
// ============================================================
import './harness.mjs';
import { el, endStatsHTML } from './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }

await import('../js/game.js');
const missionsMod = await import('../js/missions.js');
const ui = await import('../js/ui.js');
const U = await import('../js/units.js');
const B = await import('../js/buildings.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

// Тестовая миссия поверх минимального каркаса (id:-1 — прогресс не трогаем).
function testMission(over = {}) {
  return {
    id: -1, faction: 'human',
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } },
    ai: {}, defense: null,
    objective: 'Тестовая цель',
    ...over,
  };
}
function ticks(n) { for (let i = 0; i < n; i++) game.tick(); }
function paint() { game.render(1); ui.update(game); ui.drawMinimap(game); }
function killAll(st, side) {
  for (const e of [...st.units, ...st.buildings]) {
    if (e.side === side && !e.dead) U.damageEntity(st, e, 1e9, null);
  }
}
function endReason() { return el('end-reason').textContent; }

// ---------- W1: ключевая цель ----------
try {
  game.startMission(testMission({ objective: { kind: 'key', type: 'cc', name: 'Сердце' } }));
  ticks(5);
  const st = game.state;
  assert(!st.gameOver, 'победа до сноса цели');
  assert(st.keyTotal === 1, 'ключевая цель не одна: ' + st.keyTotal);
  paint(); // ромб-маркер + точка минимапа — без ошибок
  const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc');
  U.damageEntity(st, cc, 1e9, null);
  ticks(5);
  assert(st.gameOver === 'win', 'нет победы после сноса цели');
  assert(/Ключевая цель уничтожена/.test(endReason()), 'чужая победная строка: ' + endReason());
  assert(!/NaN|undefined/.test(endStatsHTML()), 'битый финал');
  pass('W1 keyTarget: снос цели = победа winKey, финал чистый');
} catch (e) { fail('W1 keyTarget', e); }

// ---------- W2: легаси-путь не тронут ----------
try {
  game.startMission(testMission());
  ticks(5);
  killAll(game.state, 'enemy');
  ticks(5);
  assert(game.state.gameOver === 'win', 'легаси-победа сломана');
  assert(/Противник уничтожен/.test(endReason()), 'чужая строка: ' + endReason());
  pass('W2 legacy: снос всей базы = прежняя победа winKill');
} catch (e) { fail('W2 legacy', e); }

// ---------- W3: добыча ----------
try {
  game.startMission(testMission({ objective: { kind: 'stockpile', amount: 500 } }));
  ticks(600); // 20 игровых секунд реальной добычи
  const st = game.state;
  assert(st.stats.mined > 0, 'добыча не идёт, счётчик мёртв');
  assert(!st.gameOver, 'преждевременная победа');
  const honest = Math.floor(st.stats.mined);
  assert(/Собрано/.test(game.objectiveText()), 'нет прогресса в цели: ' + game.objectiveText());
  st.stats.mined = 499;
  ticks(2);
  assert(!st.gameOver, 'победа до порога');
  st.stats.mined = 500;
  ticks(2);
  assert(st.gameOver === 'win', 'нет победы на пороге');
  assert(/Эрга достаточно/.test(endReason()), 'чужая строка: ' + endReason());
  pass(`W3 stockpile: честно добыто ${honest}, порог 500 = победа winStock`);
} catch (e) { fail('W3 stockpile', e); }

// ---------- W4: эвакуация ----------
try {
  game.startMission(testMission({
    noBase: true,
    squad: [['marine', 4]],
    ai: { workerTarget: 0, maxMarines: 0 },
    objective: { kind: 'evac', x: 8, y: 48, r: 4, need: 3, hold: 2 },
  }));
  const st = game.state;
  const squad = st.units.filter((u) => u.side === 'player');
  assert(squad.length === 4, 'отряд не 4: ' + squad.length);
  // Трое встают в зону (8.5, 48.5 в тайлах → пиксели), четвёртый ждёт снаружи.
  for (let i = 0; i < 3; i++) {
    squad[i].x = (8.5 + i * 0.3) * 32; squad[i].y = 48.5 * 32;
    squad[i].prevX = squad[i].x; squad[i].prevY = squad[i].y;
  }
  squad[3].x = 20 * 32; squad[3].y = 20 * 32;
  squad[3].prevX = squad[3].x; squad[3].prevY = squad[3].y;
  ticks(90); // 3 секунды при hold 2
  assert(st.evacuated === 3, 'погружено не 3: ' + st.evacuated);
  assert(st.gameOver === 'win', 'нет победы эвакуацией');
  assert(st.stats.losses === 0, 'погружённые записаны в потери: ' + st.stats.losses);
  assert(/Эвакуация завершена/.test(endReason()), 'чужая строка: ' + endReason());
  pass('W4 evac: 3 погружены за hold, победа winEvac, потерь 0');
} catch (e) { fail('W4 evac', e); }

// ---------- W4b: выход из зоны сбрасывает hold ----------
try {
  game.startMission(testMission({
    noBase: true,
    squad: [['marine', 2]],
    ai: { workerTarget: 0, maxMarines: 0 },
    objective: { kind: 'evac', x: 8, y: 48, r: 4, need: 2, hold: 3 },
  }));
  const st = game.state;
  const squad = st.units.filter((u) => u.side === 'player');
  for (const u of squad) { u.x = 8.5 * 32; u.y = 48.5 * 32; u.prevX = u.x; u.prevY = u.y; }
  ticks(60); // 2 секунды из 3 — почти погрузились
  assert(st.evacuated === 0, 'погружение раньше hold');
  squad[0].x = 30 * 32; squad[0].y = 30 * 32; // один вышел
  ticks(120);
  assert(!st.gameOver, 'победа после выхода из зоны');
  assert(st.evacuated <= 1, 'hold не сброшен у вышедшего');
  pass('W4b evac: выход из зоны сбрасывает hold, победы нет');
} catch (e) { fail('W4b evac-hold', e); }

// ---------- W5: мягкий дедлайн = волна ----------
try {
  game.startMission(testMission({
    objective: 'Держитесь',
    loseDeadline: { at: 5, label: 'Карательная волна', hard: false },
  }));
  assert(/Карательная волна/.test(game.objectiveText()), 'таймер не виден: ' + game.objectiveText());
  const before = game.state.units.filter((u) => u.side === 'enemy').length;
  ticks(200); // >5 секунд
  const st = game.state;
  assert(st.deadlineFired, 'дедлайн не сработал');
  assert(!st.gameOver, 'мягкий дедлайн завершил игру');
  const after = st.units.filter((u) => u.side === 'enemy').length;
  assert(after > before, `волна не пришла: ${before} → ${after}`);
  pass(`W5 deadline: таймер виден, волна пришла (${before} → ${after}), игра идёт`);
} catch (e) { fail('W5 deadline-soft', e); }

// ---------- W6: жёсткий дедлайн = поражение ----------
try {
  game.startMission(testMission({
    objective: 'Успейте',
    loseDeadline: { at: 5, label: 'Глушитель включён — поля мертвы', hard: true },
  }));
  ticks(200);
  const st = game.state;
  assert(st.gameOver === 'lose', 'нет поражения по дедлайну');
  assert(/Глушитель/.test(endReason()), 'причина не из label: ' + endReason());
  pass('W6 deadline: жёсткий таймер = поражение с label-причиной');
} catch (e) { fail('W6 deadline-hard', e); }

// ---------- W7: зона стройки ----------
try {
  game.startMission(testMission({ buildZone: [{ x: 4, y: 44, w: 12, h: 12 }] }));
  const st = game.state;
  st.minerals.player = 99999;
  st.minerals.enemy = 99999;
  assert(B.zoneAllows(st, 5, 45, 2, 2), 'внутри зоны запрещено');
  assert(!B.zoneAllows(st, 30, 30, 2, 2), 'вне зоны разрешено');
  assert(!B.zoneAllows(st, 3, 44, 2, 2), 'торчащий футпринт разрешён');
  const inside = B.placeBuildingCmd(st, 'player', 'depot', 5, 45, []);
  assert(inside, 'постройка внутри зоны отклонена');
  const outside = B.placeBuildingCmd(st, 'player', 'depot', 30, 30, []);
  assert(!outside, 'постройка вне зоны принята');
  const foe = B.placeBuildingCmd(st, 'enemy', 'depot', 40, 10, []);
  assert(foe, 'ИИ ограничили зоной игрока');
  st.placing = { type: 'turret', tx: 30, ty: 30 }; // призрак вне зоны
  paint(); // граница зоны + красный призрак — без ошибок
  st.placing = null;
  pass('W7 buildZone: игрок внутри/вне, ИИ свободен, рендер без ошибок');
} catch (e) { fail('W7 buildZone', e); }

// ---------- W8: медики в волнах обороны (М6) ----------
try {
  game.startMission(testMission({
    defense: { prep: 1, every: 1000, start: 2, grow: 0, max: 2, total: 9999, nests: 0 },
    ai: { medics: 3 },
  }));
  ticks(120); // первая волна (чётная, №0) уже ушла
  const medics = game.state.units.filter((u) => u.side === 'enemy' && u.type === 'medic' && !u.dead);
  const marines = game.state.units.filter((u) => u.side === 'enemy' && u.type === 'marine' && !u.dead);
  assert(marines.length >= 2, 'волна не пришла');
  assert(medics.length >= 1 && medics.length <= 3, 'медиков не по профилю: ' + medics.length);
  pass(`W8 medics: волна с медиками (${medics.length} при лимите 3)`);
} catch (e) { fail('W8 medics', e); }

// ---------- W9: №3 «Рудник-7» — реальная ЭКОНОМИКА ----------
try {
  game.startMission(missionsMod.MISSIONS[3]);
  ticks(5);
  assert(!game.state.gameOver, 'преждевременный финал');
  assert(/Собрано 0\/2500/.test(game.objectiveText()), 'нет счётчика: ' + game.objectiveText());
  game.state.stats.mined = 2499;
  ticks(2);
  assert(!game.state.gameOver, 'победа до порога');
  game.state.stats.mined = 2500;
  ticks(2);
  assert(game.state.gameOver === 'win', 'нет победы на 2500');
  assert(/Эрга достаточно/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Карьер наш/.test(el('end-epilogue').textContent), 'эпилога нет на экране победы');
  game.startMission(missionsMod.MISSIONS[3]);
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при сносе базы');
  pass('W9 rep3: 2500 = победа + эпилог, снос базы = поражение');
} catch (e) { fail('W9 rep3-economy', e); }

// ---------- W10: №4 «Пепельная линия» — реальная ЭВАКУАЦИЯ ----------
try {
  game.startMission(missionsMod.MISSIONS[4]);
  const st = game.state;
  assert(!game.mission.defense, 'таймер обороны остался');
  assert(/Эвакуировано 0\/8/.test(game.objectiveText()), 'нет счётчика: ' + game.objectiveText());
  paint(); // круг зоны + счётчик — без ошибок
  // Восьмерых в зону шаттлов (52.5, 10.5): 4 своих рабочих + 4 рейнджера.
  const crew = st.units.filter((u) => u.side === 'player' && !u.dead);
  for (let i = crew.length; i < 8; i++) crew.push(U.spawnUnit(st, 'player', 'marine', 8.5 * 32, 9.5 * 32));
  crew.forEach((u, i) => {
    u.x = (52.5 + (i % 4) * 0.5) * 32; u.y = (10.5 + ((i / 4) | 0) * 0.5) * 32;
    u.prevX = u.x; u.prevY = u.y;
    u.order = { kind: 'idle' }; u.moving = false; // стоять в кругу, не разбредаться
  });
  ticks(120); // 4 секунды при hold 3
  assert(st.evacuated === 8, 'погружено не 8: ' + st.evacuated);
  assert(st.gameOver === 'win', 'нет победы эвакуацией');
  assert(/Эвакуация завершена/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Последний транспорт/.test(el('end-epilogue').textContent), 'эпилога нет');
  game.startMission(missionsMod.MISSIONS[4]);
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при сносе базы');
  assert(el('end-epilogue').textContent === '', 'эпилог показан на поражении');
  pass('W10 rep4: 8 погружены = победа + эпилог, снос = поражение без эпилога');
} catch (e) { fail('W10 rep4-evac', e); }

// ---------- W11: №2 «Пробуждение недр» — реальная ОСАДА ----------
try {
  game.startMission(missionsMod.MISSIONS[2]);
  ticks(5);
  const st = game.state;
  assert(/Уничтожьте: Сердце лагеря/.test(game.objectiveText()), 'нет цели: ' + game.objectiveText());
  assert(/Карательный корпус/.test(game.objectiveText()), 'нет таймера: ' + game.objectiveText());
  assert(st.keyTotal === 1, 'ключевых целей не 1: ' + st.keyTotal);
  paint(); // ромб над Сердцем + точка минимапа — без ошибок
  const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc');
  U.damageEntity(st, cc, 1e9, null);
  ticks(5);
  assert(st.gameOver === 'win', 'нет победы после сноса Сердца');
  assert(/Сердце чужаков вырвано/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Железные забыли/.test(el('end-epilogue').textContent), 'эпилога нет');
  // Мягкий дедлайн: волна пришла, игра идёт.
  game.startMission(missionsMod.MISSIONS[2]);
  game.state.time = 419;
  const before = game.state.units.filter((u) => u.side === 'enemy').length;
  ticks(60);
  assert(game.state.deadlineFired, 'дедлайн не сработал');
  assert(!game.state.gameOver, 'мягкий дедлайн завершил игру');
  assert(game.state.units.filter((u) => u.side === 'enemy').length > before, 'волны нет');
  // Поражение: снос своей базы.
  game.startMission(missionsMod.MISSIONS[2]);
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при сносе гнезда');
  pass('W11 rep2: Сердце = победа + эпилог, дедлайн = волна, снос = поражение');
} catch (e) { fail('W11 rep2-siege', e); }

// ---------- W12: №6 «Красный флаг» — реальная ЭКОНОМИКА ----------
try {
  game.startMission(missionsMod.MISSIONS[6]);
  ticks(5);
  assert(/Собрано 0\/2000/.test(game.objectiveText()), 'нет счётчика: ' + game.objectiveText());
  game.state.stats.mined = 1999;
  ticks(2);
  assert(!game.state.gameOver, 'победа до порога');
  game.state.stats.mined = 2000;
  ticks(2);
  assert(game.state.gameOver === 'win', 'нет победы на 2000');
  assert(/Эрга достаточно/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Флаги сорваны/.test(el('end-epilogue').textContent), 'эпилога нет');
  game.startMission(missionsMod.MISSIONS[6]);
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при сносе базы');
  pass('W12 rep6: 2000 = победа + эпилог, снос базы = поражение');
} catch (e) { fail('W12 rep6-economy', e); }

// ---------- W13: №7 «Стальной кулак» — реальная ОСАДА ----------
try {
  game.startMission(missionsMod.MISSIONS[7]);
  ticks(5);
  const st = game.state;
  assert(/Уничтожьте: Штаб форта/.test(game.objectiveText()), 'нет цели: ' + game.objectiveText());
  assert(/Контрудар/.test(game.objectiveText()), 'нет таймера: ' + game.objectiveText());
  assert(st.keyTotal === 1, 'ключевых целей не 1: ' + st.keyTotal);
  paint();
  const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc');
  U.damageEntity(st, cc, 1e9, null);
  ticks(5);
  assert(st.gameOver === 'win', 'нет победы после сноса штаба');
  assert(/Ключевая цель уничтожена/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Форт пал/.test(el('end-epilogue').textContent), 'эпилога нет');
  game.startMission(missionsMod.MISSIONS[7]);
  game.state.time = 479;
  const before = game.state.units.filter((u) => u.side === 'enemy').length;
  ticks(60);
  assert(game.state.deadlineFired, 'дедлайн не сработал');
  assert(!game.state.gameOver, 'мягкий дедлайн завершил игру');
  assert(game.state.units.filter((u) => u.side === 'enemy').length > before, 'волны нет');
  game.startMission(missionsMod.MISSIONS[7]);
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при сносе базы');
  pass('W13 rep7: штаб = победа + эпилог, дедлайн = волна, снос = поражение');
} catch (e) { fail('W13 rep7-siege', e); }


// ---------- W14: №1 «Ночь штырей» — двухфазная Об→Эв ----------
try {
  game.startMission(missionsMod.MISSIONS[1]);
  ticks(5);
  let st = game.state;
  assert(/Подготовка/.test(game.objectiveText()), 'фаза 1 без таймера: ' + game.objectiveText());
  // Фаза 1: стоянка в зоне не грузит (погрузка только после таймера).
  const early = U.spawnUnit(st, 'player', 'marine', 16.5 * 32, 8.5 * 32);
  early.order = { kind: 'idle' }; early.moving = false;
  ticks(120);
  assert(st.evacuated === 0, 'погрузка в фазе 1: ' + st.evacuated);
  assert(!st.gameOver, 'игра кончилась в фазе 1');
  // Рубеж таймера: победы обороной нет, HUD переключается на счётчик.
  st.time = 180 + 600;
  ticks(5);
  assert(!st.gameOver, 'истекший таймер дал победу обороной');
  assert(st.phase2, 'флаг фазы 2 не встал');
  assert(/Эвакуировано 0\/6/.test(game.objectiveText()), 'нет счётчика фазы 2: ' + game.objectiveText());
  paint(); // круг зоны + счётчик — без ошибок
  // Шестерых в круг огней (16.5, 8.5): 4 рабочих + 2 рейнджера.
  const crew = st.units.filter((u) => u.side === 'player' && !u.dead && u.cfg && !u.cfg.canMine);
  while (crew.length < 2) crew.push(U.spawnUnit(st, 'player', 'marine', 16.5 * 32, 8.5 * 32));
  const gang = [...st.units.filter((u) => u.side === 'player' && !u.dead && u.cfg && u.cfg.canMine), ...crew].slice(0, 6);
  assert(gang.length === 6, 'не набрать 6: ' + gang.length);
  gang.forEach((u, i) => {
    u.x = (16.5 + (i % 3) * 0.5) * 32; u.y = (8.5 + ((i / 3) | 0) * 0.5) * 32;
    u.prevX = u.x; u.prevY = u.y;
    u.order = { kind: 'idle' }; u.moving = false;
  });
  ticks(120);
  assert(st.evacuated === 6, 'погружено не 6: ' + st.evacuated);
  assert(st.gameOver === 'win', 'нет победы эвакуацией');
  assert(/Эвакуация завершена/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Шаттлы ушли/.test(el('end-epilogue').textContent), 'эпилога нет');
  // Фаза 2: грузить некого и взять неоткуда — поражение «Некого грузить».
  game.startMission(missionsMod.MISSIONS[1]);
  game.state.time = 180 + 600;
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при срыве погрузки');
  assert(/Некого грузить/.test(endReason()), 'чужая причина: ' + endReason());
  assert(el('end-epilogue').textContent === '', 'эпилог показан на поражении');
  pass('W14 rep1: таймер→счётчик, 6 погружены = победа + эпилог, срыв = поражение');
} catch (e) { fail('W14 rep1-twophase', e); }

// ---------- W15: №5 «Кровь священных полей» — зона + мортиры + Н1 ----------
try {
  game.startMission(missionsMod.MISSIONS[5]);
  ticks(5);
  const st = game.state;
  assert(game.mission.ai.arty === 2, 'мортиры не выданы');
  assert(game.mission.defense.nests === 1, 'гнёзд не 1');
  assert(/Подготовка/.test(game.objectiveText()), 'нет таймера обороны: ' + game.objectiveText());
  assert(/священных полей/.test(game.mission.brief[2]), 'контратака не легализована');
  st.minerals.player = 99999;
  st.minerals.enemy = 99999;
  // ЦК — внутри священных полей; ищем свободные 2×2 внутри и вне зоны.
  assert(B.zoneAllows(st, 8, 9, 4, 3), 'ЦК вне зоны');
  let inside = null, outside = null;
  for (let ty = 2; ty < 54 && (!inside || !outside); ty += 1) {
    for (let tx = 2; tx < 54 && (!inside || !outside); tx += 1) {
      if (!B.canPlace(st.map, tx, ty, 2, 2)) continue;
      if (B.zoneAllows(st, tx, ty, 2, 2)) inside = inside || [tx, ty];
      else outside = outside || [tx, ty];
    }
  }
  assert(inside, 'нет свободного места внутри зоны');
  assert(outside, 'нет свободного места вне зоны');
  const okIn = B.placeBuildingCmd(st, 'player', 'depot', inside[0], inside[1], []);
  assert(okIn, 'постройка внутри зоны отклонена');
  const noOut = B.placeBuildingCmd(st, 'player', 'depot', outside[0], outside[1], []);
  assert(!noOut, 'постройка вне зоны принята');
  const foe = B.placeBuildingCmd(st, 'enemy', 'depot', outside[0], outside[1], []);
  assert(foe, 'ИИ ограничили зоной игрока');
  st.placing = { type: 'turret', tx: outside[0], ty: outside[1] }; // призрак вне зоны
  paint(); // граница зоны + красный призрак — без ошибок
  st.placing = null;
  // Победа — оборонная, по таймеру.
  st.time = 200 + 660;
  ticks(5);
  assert(st.gameOver === 'win', 'нет победы по таймеру обороны');
  assert(/Волна разбилась о хитин/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Хребет удержан/.test(el('end-epilogue').textContent), 'эпилога нет');
  game.startMission(missionsMod.MISSIONS[5]);
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при сносе базы');
  assert(el('end-epilogue').textContent === '', 'эпилог показан на поражении');
  pass('W15 rep5: зона держит, ИИ свободен, таймер = победа + эпилог, снос = поражение');
} catch (e) { fail('W15 rep5-zone', e); }

// ---------- W16: №13 «Око бури» — диверсия noBase: key → evac ----------
try {
  game.startMission(missionsMod.MISSIONS[13]);
  ticks(5);
  const st = game.state;
  assert(st.noBase, 'база не отключена');
  // Форт к моменту диверсии уже построен (иначе снос «Ока» — это снос
  // вообще всех зданий врага и честная победа запасным путём).
  function fortify(s) {
    s.minerals.enemy = 99999;
    const e = s.map.bases.enemy.cc;
    let done = false;
    for (let dy = -6; dy <= 6 && !done; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        if (B.canPlace(s.map, e.x + dx, e.y + dy, 3, 2)) {
          B.placeBuildingCmd(s, 'enemy', 'barracks', e.x + dx, e.y + dy, []);
          done = true;
          break;
        }
      }
    }
    assert(done, 'форт не встал');
  }
  fortify(st);
  const squad = st.units.filter((u) => u.side === 'player' && !u.dead);
  assert(squad.length === 8, 'отряд не 8: ' + squad.length);
  assert(/Снесите Око бури/.test(game.objectiveText()), 'нет цели: ' + game.objectiveText());
  assert(st.keyTotal === 1, 'ключевых целей не 1: ' + st.keyTotal);
  paint(); // ромб-маркер «Ока» + точка минимапа — без ошибок
  // Снос «Ока» — не победа, а переключение на отход.
  const eye = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
  U.damageEntity(st, eye, 1e9, null);
  ticks(5);
  assert(!st.gameOver, 'снос «Ока» сразу победил');
  assert(st.win.kind === 'evac', 'цель не переключилась на отход');
  assert(/Эвакуировано 0\/4/.test(game.objectiveText()), 'нет счётчика отхода: ' + game.objectiveText());
  paint(); // круг зоны отхода — без ошибок
  // Четверых в зону высадки (8.5, 48.5), остальных — подальше
  // (часть отряда спавнится внутри круга зоны, их отводим).
  squad.filter((u) => !u.dead).forEach((u, i) => {
    if (i < 4) {
      u.x = (8.5 + (i % 2) * 0.5) * 32; u.y = (48.5 + ((i / 2) | 0) * 0.5) * 32;
    } else {
      u.x = (30 + i) * 32; u.y = 30 * 32;
    }
    u.prevX = u.x; u.prevY = u.y;
    u.order = { kind: 'idle' }; u.moving = false;
  });
  ticks(120);
  assert(st.evacuated === 4, 'отошло не 4: ' + st.evacuated);
  assert(st.gameOver === 'win', 'нет победы отходом');
  assert(/Выводок уведён/.test(endReason()), 'чужая строка: ' + endReason());
  assert(/Око закрылось/.test(el('end-epilogue').textContent), 'эпилога нет');
  // Фаза 2: выживших меньше need и взять неоткуда — поражение.
  game.startMission(missionsMod.MISSIONS[13]);
  ticks(5);
  const st2 = game.state;
  fortify(st2);
  const eye2 = st2.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
  U.damageEntity(st2, eye2, 1e9, null);
  ticks(5);
  for (const u of st2.units.filter((u) => u.side === 'player' && !u.dead).slice(0, 5)) {
    U.damageEntity(st2, u, 1e9, null);
  }
  ticks(5);
  assert(st2.gameOver === 'lose', 'нет поражения при недоборе отхода');
  assert(/Грузить некого/.test(endReason()), 'чужая причина: ' + endReason());
  assert(el('end-epilogue').textContent === '', 'эпилог показан на поражении');
  // Фаза 1: гибель всего отряда — поражение стелса.
  game.startMission(missionsMod.MISSIONS[13]);
  ticks(5);
  killAll(game.state, 'player');
  ticks(5);
  assert(game.state.gameOver === 'lose', 'нет поражения при гибели отряда');
  assert(/Отряд погиб/.test(endReason()), 'чужая причина: ' + endReason());
  pass('W16 rep13: «Око»→отход, 4 отошли = победа + эпилог, недобор/гибель = поражения');
} catch (e) { fail('W16 rep13-raid', e); }

console.log(failures.length ? `\nИТОГ SIM_WINS: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_WINS: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
