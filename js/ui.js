// ============================================================
// ui.js — интерфейс: главное меню (кампания / быстрый бой),
// выбор миссии с брифингами, выбор фракции, верхняя панель
// ресурсов и цели, панель команд, миникарта, тосты, экран финала.
// Весь UI — DOM поверх canvas; иконки команд рисуются кодом.
// ============================================================
import {
  TILE, UNITS, BUILDINGS, UPGRADES, WORLD_W, WORLD_H, MAP_W, MAP_H, SUPPLY_MAX, COLORS,
  fname, fdesc,
} from './config.js';
import { MISSIONS, loadProgress } from './missions.js';

const $ = (id) => document.getElementById(id);

const FACTIONS = {
  human: { title: 'ГЕЛИОС', sub: 'Корпорация людей: техника, турели, танки', cls: 'fac-human' },
  alien: { title: 'КХАРИД', sub: 'Кристаллорождённые: рой, шипы, органика улья', cls: 'fac-alien' },
};

// ------------------------------------------------------------
// Иконки команд: маленькие canvas 26×26, рисуются один раз.
// ------------------------------------------------------------
const iconCache = {};
function icon(type) {
  if (iconCache[type]) return iconCache[type];
  const c = document.createElement('canvas');
  c.width = 26; c.height = 26;
  const g = c.getContext('2d');
  g.translate(13, 13);
  const teal = '#57d3c3', green = '#67c98a', amber = '#f3c579', steel = '#8fb5b3';
  const purple = '#a78bdb';
  switch (type) {
    case 'worker':
      g.fillStyle = teal; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = amber; g.fillRect(-9, -2, 4, 8);
      g.fillStyle = '#d9fff0'; g.beginPath(); g.arc(2, 0, 3, 0, Math.PI * 2); g.fill();
      break;
    case 'marine':
      g.fillStyle = teal; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#16262b'; g.fillRect(2, -1, 11, 3);
      g.fillStyle = '#d9fff0'; g.beginPath(); g.arc(1, 0, 3, 0, Math.PI * 2); g.fill();
      break;
    case 'buggy':
      g.fillStyle = '#0d2129'; g.fillRect(-9, -7, 5, 5); g.fillRect(4, -7, 5, 5);
      g.fillRect(-9, 2, 5, 5); g.fillRect(4, 2, 5, 5);
      g.fillStyle = teal; g.beginPath();
      g.moveTo(-7, -4); g.lineTo(8, -2); g.lineTo(8, 2); g.lineTo(-7, 4); g.closePath(); g.fill();
      break;
    case 'tank':
      g.fillStyle = '#0d2129'; g.fillRect(-10, -8, 20, 5); g.fillRect(-10, 3, 20, 5);
      g.fillStyle = teal; g.fillRect(-8, -4, 15, 8);
      g.fillStyle = '#16262b'; g.fillRect(4, -1.5, 12, 3);
      break;
    case 'cc':
      g.fillStyle = steel; g.fillRect(-10, -8, 20, 15);
      g.strokeStyle = teal; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, 0, 6, 4.5, 0, 0, Math.PI * 2); g.stroke();
      break;
    case 'barracks':
      g.fillStyle = steel; g.fillRect(-10, -7, 20, 14);
      g.fillStyle = '#0b1b24'; g.fillRect(-4, 0, 8, 7);
      g.fillStyle = teal; g.fillRect(-10, -7, 20, 3);
      break;
    case 'depot':
      g.fillStyle = steel; g.fillRect(-10, -5, 20, 11);
      g.fillStyle = teal; g.fillRect(-10, -5, 20, 3);
      g.fillStyle = '#0b1b24';
      g.beginPath(); g.moveTo(-4, 0); g.lineTo(1, 3); g.lineTo(-4, 6); g.closePath(); g.fill();
      break;
    case 'turret':
      g.fillStyle = steel; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#16262b'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(9, -6); g.stroke();
      break;
    case 'wall':
      g.fillStyle = steel; g.fillRect(-10, -5, 20, 11);
      g.strokeStyle = '#2c4a52'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-10, 0); g.lineTo(10, 0); g.stroke();
      g.beginPath(); g.moveTo(-3, -5); g.lineTo(-3, 5); g.moveTo(4, -5); g.lineTo(4, 5); g.stroke();
      break;
    case 'bunker':
      g.fillStyle = steel; g.fillRect(-10, -7, 20, 14);
      g.fillStyle = '#0b1b24'; g.fillRect(-7, -2, 14, 4);
      g.fillStyle = teal; g.fillRect(-10, -7, 20, 3);
      break;
    case 'factory':
      g.fillStyle = steel; g.fillRect(-10, -4, 20, 12);
      g.fillStyle = '#0b1b24'; g.fillRect(-4, 0, 8, 8);
      g.fillStyle = '#2c4a52'; g.fillRect(-8, -10, 4, 7);
      break;
    case 'medic':
      g.fillStyle = '#d9fff0'; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff806e'; g.fillRect(-1.5, -4, 3, 12); g.fillRect(-6, 0.5, 12, 3);
      g.fillStyle = '#16262b'; g.fillRect(6, 0, 8, 3);
      break;
    case 'flamer':
      g.fillStyle = teal; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff806e'; g.fillRect(-9, -4, 5, 8);
      g.fillStyle = '#f3c579'; g.fillRect(4, 0, 11, 4);
      g.fillStyle = '#f3c579'; g.beginPath(); g.arc(15, 2, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'arty':
      g.fillStyle = '#0d2129'; g.fillRect(-9, -8, 18, 4); g.fillRect(-9, 4, 18, 4);
      g.fillStyle = teal; g.fillRect(-7, -4, 14, 8);
      g.fillStyle = '#16262b'; g.fillRect(0, -1.5, 15, 3);
      break;
    case 'lab':
      g.fillStyle = steel; g.fillRect(-10, -2, 20, 12);
      g.fillStyle = '#2c4a52'; g.beginPath(); g.arc(-3, -2, 7, Math.PI, 0); g.fill();
      g.strokeStyle = teal; g.lineWidth = 2;
      g.beginPath(); g.arc(6, -6, 4, Math.PI * 0.2, Math.PI); g.stroke();
      break;
    case 'u_infAtk':
      g.strokeStyle = '#ff806e'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-6, 6); g.lineTo(6, -6); g.stroke();
      g.strokeStyle = amber; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-4, 1); g.lineTo(-1, 4); g.moveTo(-6, 8); g.lineTo(-8, 6); g.stroke();
      break;
    case 'u_infArm':
      g.strokeStyle = teal; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(7, -5); g.lineTo(7, 2);
      g.quadraticCurveTo(7, 7, 0, 9); g.quadraticCurveTo(-7, 7, -7, 2);
      g.lineTo(-7, -5); g.closePath(); g.stroke();
      g.fillStyle = teal; g.fillRect(-1.5, -4, 3, 8); g.fillRect(-4, -1.5, 8, 3);
      break;
    case 'u_vehAtk':
      g.fillStyle = '#16262b'; g.fillRect(-3, -9, 6, 13);
      g.fillStyle = amber; g.fillRect(-5, 2, 10, 6);
      g.fillStyle = '#f3c579'; g.beginPath(); g.arc(0, -9, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'u_vehArm':
      g.strokeStyle = steel; g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 - Math.PI / 2;
        const px2 = Math.cos(a) * 8, py2 = Math.sin(a) * 8;
        if (i === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
      }
      g.closePath(); g.stroke();
      g.fillStyle = steel; g.fillRect(-1.5, -5, 3, 10); g.fillRect(-5, -1.5, 10, 3);
      break;
    case 'build':
      g.fillStyle = steel; g.fillRect(-9, -8, 10, 8);           // боёк молота
      g.fillStyle = amber; g.fillRect(-2, -4, 12, 4);          // ручка
      g.fillStyle = teal; g.fillRect(-11, 4, 22, 4);            // «фундамент»
      break;
    case 'stop':
      g.strokeStyle = '#ff806e'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-7, -7); g.lineTo(7, 7); g.moveTo(7, -7); g.lineTo(-7, 7); g.stroke();
      break;
    case 'exit':
      g.strokeStyle = amber; g.lineWidth = 2.5;
      g.strokeRect(-9, -8, 12, 16);
      g.beginPath(); g.moveTo(-1, 0); g.lineTo(9, 0); g.stroke();
      g.beginPath(); g.moveTo(5, -4); g.lineTo(9, 0); g.lineTo(5, 4); g.stroke();
      break;
    case 'repair':
      g.strokeStyle = '#67c98a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-7, 7); g.lineTo(2, -2); g.stroke();
      g.fillStyle = '#67c98a';
      g.fillRect(2, -8, 8, 8);
      break;
    // ===== Иконки кхарид (органика) =====
    case 'a_worker':
      g.strokeStyle = purple; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-6, 2); g.lineTo(-9, 8); g.moveTo(0, 3); g.lineTo(0, 9); g.moveTo(6, 2); g.lineTo(9, 8); g.stroke();
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, -2, 7, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b7f0c8'; g.beginPath(); g.arc(4, -2, 2.5, 0, Math.PI * 2); g.fill();
      break;
    case 'a_marine':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 2, 8, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9ff5b8';
      g.beginPath(); g.moveTo(-5, -2); g.lineTo(-3, -9); g.lineTo(-1, -2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(0, -2); g.lineTo(2, -9); g.lineTo(4, -2); g.closePath(); g.fill();
      g.fillStyle = '#eafff0'; g.beginPath(); g.arc(7, 2, 2.2, 0, Math.PI * 2); g.fill();
      break;
    case 'a_buggy':
      g.strokeStyle = purple; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-4, -3); g.lineTo(-9, -8); g.moveTo(-4, 3); g.lineTo(-9, 8);
      g.moveTo(4, -3); g.lineTo(9, -8); g.moveTo(4, 3); g.lineTo(9, 8); g.stroke();
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9ff5b8'; g.beginPath(); g.arc(7, 0, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'a_tank':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 0, 10, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b7f0c8';
      g.beginPath(); g.moveTo(-2, -6); g.lineTo(2, -11); g.lineTo(6, -5); g.closePath(); g.fill();
      g.fillStyle = '#eafff0'; g.beginPath(); g.arc(8, 0, 3, 0, Math.PI * 2); g.fill();
      break;
    case 'a_cc':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 2, 10, 7, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#9ff5b8'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, 1, 5, 3.4, 0, 0, Math.PI * 2); g.stroke();
      break;
    case 'a_barracks':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 3, 9, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b7f0c8';
      g.beginPath(); g.arc(-4, 0, 2.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(2, -2, 2.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(5, 2, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'a_depot':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 2, 8, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b7f0c8'; g.beginPath(); g.arc(3, 0, 3, 0, Math.PI * 2); g.fill();
      break;
    case 'a_turret':
      g.fillStyle = purple; g.beginPath(); g.arc(0, 2, 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3a4a40'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(1, 0); g.lineTo(9, -5); g.moveTo(1, 2); g.lineTo(9, 5); g.stroke();
      break;
    case 'a_wall':
      g.fillStyle = purple; g.fillRect(-9, -6, 18, 12);
      g.strokeStyle = '#9ff5b8'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-6, 5); g.lineTo(0, -5); g.lineTo(6, 5); g.stroke();
      break;
    case 'a_bunker':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 0, 9, 8, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#9ff5b8'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(0, 0, 5, 3.6, 0.5, 0, Math.PI * 2); g.stroke();
      break;
    case 'a_factory':
      g.fillStyle = '#2a2140'; g.beginPath(); g.ellipse(0, 2, 10, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b7f0c8';
      g.beginPath(); g.arc(-4, 0, 2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(3, -1, 2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, 4, 2, 0, Math.PI * 2); g.fill();
      break;
    case 'a_medic':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 2, 8, 6.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#9ff5b8'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -3); g.lineTo(0, -10); g.stroke();
      g.fillStyle = '#b7f0c8'; g.beginPath(); g.arc(0, -11, 2.8, 0, Math.PI * 2); g.fill();
      break;
    case 'a_flamer':
      g.fillStyle = purple; g.beginPath(); g.ellipse(-1, 2, 9, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f3c579'; g.fillRect(6, 0, 9, 4);
      g.fillStyle = '#f3c579'; g.beginPath(); g.arc(15, 2, 2.2, 0, Math.PI * 2); g.fill();
      break;
    case 'a_arty':
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 2, 10, 7.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2a2140'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-3, -4); g.lineTo(-11, -11); g.stroke();
      g.fillStyle = '#b7f0c8'; g.beginPath(); g.arc(-11, -12, 2.8, 0, Math.PI * 2); g.fill();
      break;
    case 'a_lab':
      g.fillStyle = '#2a2140'; g.beginPath(); g.ellipse(0, 4, 10, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b7f0c8';
      g.beginPath(); g.moveTo(-5, 2); g.lineTo(-2, -6); g.lineTo(1, 2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(2, 2); g.lineTo(5, -4); g.lineTo(8, 2); g.closePath(); g.fill();
      break;
  }
  iconCache[type] = c;
  return c;
}
// Содержимое canvas нельзя «расшарить» между узлами DOM — копируем.
function iconEl(type) {
  const src = icon(type);
  const c = document.createElement('canvas');
  c.width = 26; c.height = 26;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

let els = null;        // кэш DOM-элементов
let dyn = null;        // динамические ссылки для апдейтов без перестройки
let sig = '';          // «подпись» текущей панели
let pendingMission = null; // миссия, выбранная в брифинге
let pendingNext = null;    // следующая миссия после победы

export function initUI(game) {
  els = {
    canvas: $('game-canvas'),
    minimap: $('minimap'),
    minerals: $('res-minerals'),
    supply: $('res-supply'),
    time: $('res-time'),
    objective: $('res-objective'),
    sound: $('btn-sound'),
    pause: $('btn-pause'),
    restart: $('btn-restart'),
    selInfo: $('sel-info'),
    cmdGrid: $('cmd-grid'),
    toasts: $('toasts'),
    overlay: $('overlay'),
    missionOverlay: $('mission-overlay'),
    missionList: $('mission-list'),
    briefOverlay: $('brief-overlay'),
    briefBadge: $('brief-badge'),
    briefTitle: $('brief-title'),
    briefPlace: $('brief-place'),
    briefText: $('brief-text'),
    briefObjective: $('brief-objective'),
    skirmishOverlay: $('skirmish-overlay'),
    endOverlay: $('end-overlay'),
    endTitle: $('end-title'),
    endReason: $('end-reason'),
    endStats: $('end-stats'),
    pauseOverlay: $('pause-overlay'),
    startBtn: $('btn-start'),
    againBtn: $('btn-again'),
  };

  // Главное меню.
  $('btn-campaign').addEventListener('click', () => showMissions(game));
  $('btn-skirmish').addEventListener('click', () => {
    els.overlay.classList.add('hidden');
    els.skirmishOverlay.classList.remove('hidden');
  });
  $('btn-missions-back').addEventListener('click', () => {
    els.missionOverlay.classList.add('hidden');
    els.overlay.classList.remove('hidden');
  });
  $('btn-skirmish-back').addEventListener('click', () => {
    els.skirmishOverlay.classList.add('hidden');
    els.overlay.classList.remove('hidden');
  });
  // Выбор фракции в быстром бою.
  for (const fac of ['human', 'alien']) {
    $(fac === 'human' ? 'btn-skirmish-human' : 'btn-skirmish-alien')
      .addEventListener('click', () => {
        els.skirmishOverlay.classList.add('hidden');
        game.startSkirmish(fac);
      });
  }
  // Брифинг: «В бой!».
  $('btn-brief-go').addEventListener('click', () => {
    if (pendingMission) game.startMission(pendingMission);
  });
  $('btn-brief-back').addEventListener('click', () => {
    els.briefOverlay.classList.add('hidden');
    els.missionOverlay.classList.remove('hidden');
  });

  // Стартовая кнопка на фоне меню (старое поведение): запускаем первую миссию.
  els.startBtn.addEventListener('click', () => game.startMission(MISSIONS[loadProgress()]));
  els.againBtn.addEventListener('click', () => {
    els.endOverlay.classList.add('hidden');
    if (pendingNext) { showBrief(game, pendingNext); pendingNext = null; }
    else game.restart();
  });
  els.restart.addEventListener('click', () => game.restart());
  els.pause.addEventListener('click', () => game.togglePause());
  els.sound.addEventListener('click', () => game.toggleSound());

  // Миникарта: ЛКМ — прыжок/перетаскивание камеры, ПКМ — приказ.
  const mm = els.minimap;
  const mmWorld = (e) => {
    const r = mm.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * WORLD_W,
      y: ((e.clientY - r.top) / r.height) * WORLD_H,
    };
  };
  mm.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const w = mmWorld(e);
    if (e.button === 0) game.hooks.centerCamera(w.x, w.y);
    else if (e.button === 2) game.hooks.issueRMB(w.x, w.y);
  });
  mm.addEventListener('mousemove', (e) => {
    if (e.buttons & 1) { const w = mmWorld(e); game.hooks.centerCamera(w.x, w.y); }
  });
  mm.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ------------------------------------------------------------
// Меню: список миссий кампании с брифингами и замками.
// ------------------------------------------------------------
export function showMissions(game) {
  els.overlay.classList.add('hidden');
  els.missionOverlay.classList.remove('hidden');
  const unlocked = loadProgress();
  els.missionList.innerHTML = '';
  let lastAct = null;
  MISSIONS.forEach((m) => {
    // Заголовок акта перед первой миссией акта.
    if (m.act !== lastAct) {
      lastAct = m.act;
      const head = document.createElement('div');
      head.className = 'act-head';
      head.textContent = m.act;
      els.missionList.appendChild(head);
    }
    const card = document.createElement('button');
    card.className = 'mission-card' + (m.id > unlocked ? ' locked' : '');
    const fac = FACTIONS[m.faction];
    card.innerHTML =
      `<div class="mc-top"><span class="badge ${fac.cls}">${fac.title}</span>` +
      `<span class="mc-num">Миссия ${m.id + 1}</span>` +
      (m.id > unlocked ? '<span class="mc-lock">🔒 закрыто</span>' : '') + '</div>' +
      `<div class="mc-name">${m.name}</div>` +
      `<div class="mc-place">${m.place}</div>` +
      `<div class="mc-obj">${m.objective}</div>` +
      (m.intro ? `<div class="mc-intro">${m.intro}</div>` : '') +
      (m.defense ? '<div class="mc-def">🛡 режим обороны: волны врага</div>' : '');
    if (m.id <= unlocked) {
      card.addEventListener('click', () => {
        els.missionOverlay.classList.add('hidden');
        showBrief(game, m);
      });
    } else {
      card.disabled = true;
    }
    els.missionList.appendChild(card);
  });
}

export function showBrief(game, m) {
  pendingMission = m;
  const fac = FACTIONS[m.faction];
  els.briefBadge.textContent = 'За: ' + fac.title;
  els.briefBadge.className = 'badge ' + fac.cls;
  els.briefTitle.textContent = m.name;
  els.briefPlace.textContent = m.place;
  els.briefText.innerHTML = m.brief.map((p) => `<p>${p}</p>`).join('') +
    (m.intro ? `<p class="brief-intro">${m.intro}</p>` : '');
  els.briefObjective.textContent = 'Цель: ' + m.objective +
    (m.defense ? ` · подготовка ${Math.round(m.defense.prep / 60)} мин, затем ${Math.round(m.defense.total / 60)} мин обороны` : '');
  els.briefOverlay.classList.remove('hidden');
}

export function hideStart() { els.overlay.classList.add('hidden'); }
export function hideMissions() { if (els.missionOverlay) els.missionOverlay.classList.add('hidden'); }
export function hideBrief() { if (els.briefOverlay) els.briefOverlay.classList.add('hidden'); }
export function hideEnd() { els.endOverlay.classList.add('hidden'); }

export function toast(msg, kind = 'info') {
  if (!els) return;
  const now = performance.now();
  if (toast.last && toast.last.msg === msg && now - toast.last.t < 1600) return; // анти-спам
  toast.last = { msg, t: now };
  const div = document.createElement('div');
  div.className = 'toast' + (kind === 'error' ? ' err' : '');
  div.textContent = msg;
  els.toasts.appendChild(div);
  while (els.toasts.children.length > 3) els.toasts.firstChild.remove();
  setTimeout(() => div.remove(), 2600);
}

export function setObjective(text) {
  if (els && els.objective) els.objective.textContent = text;
}

export function showEnd(win, stats, opts = {}) {
  els.endTitle.textContent = win ? 'Победа!' : 'Поражение';
  els.endTitle.className = win ? 'win' : 'lose';
  els.endReason.textContent = opts.reason || '';
  if (opts.campaignDone) els.endReason.textContent = 'Кампания пройдена — поля кхарид свободны!';
  const mm = String(Math.floor(stats.time / 60)).padStart(2, '0');
  const ss = String(Math.floor(stats.time % 60)).padStart(2, '0');
  els.endStats.innerHTML =
    `<div class="row"><span>Время боя</span><b>${mm}:${ss}</b></div>` +
    `<div class="row"><span>Уничтожено врагов</span><b>${stats.kills}</b></div>` +
    `<div class="row"><span>Потери</span><b>${stats.losses}</b></div>` +
    `<div class="row"><span>Добыто минералов</span><b>${stats.mined}</b></div>`;
  pendingNext = opts.next || null;
  els.againBtn.textContent = opts.next ? 'Следующая миссия →' : 'Играть снова';
  els.endOverlay.classList.remove('hidden');
}

// Сброс кэша панели при новой партии — заставит её перестроиться.
export function resetPanel() { sig = ''; dyn = null; }
export function setPausedUI(p) {
  els.pauseOverlay.classList.toggle('hidden', !p);
  els.pause.textContent = p ? 'Продолжить' : 'Пауза';
}
export function setSoundUI(muted) { els.sound.textContent = muted ? 'Звук: выкл' : 'Звук: вкл'; }

// Клавиатурные хоткеи панели: нажимаем «виртуальную кнопку».
export function handleHotkey(code) {
  if (!dyn) return false;
  const btn = dyn.cmds.find((c) => c.code === code);
  if (btn) { btn.el.click(); return true; }
  return false;
}

// ------------------------------------------------------------
// Панель команд: перестраивается только при смене «подписи»
// (состав выделения, меню стройки, очередь) — иначе апдейт полосок.
// ------------------------------------------------------------
export function update(game) {
  const st = game.state;
  if (!st || !els) return;

  // Верхняя панель.
  els.minerals.textContent = Math.floor(st.minerals.player);
  const sup = st.supply.player;
  els.supply.textContent = `${sup.used}/${sup.cap}`;
  els.supply.classList.toggle('blocked', sup.used >= sup.cap);
  const mm = String(Math.floor(st.time / 60)).padStart(2, '0');
  const ss = String(Math.floor(st.time % 60)).padStart(2, '0');
  els.time.textContent = `${mm}:${ss}`;
  els.canvas.style.cursor = st.placing ? 'crosshair' : 'default';

  // Подпись панели: состав выделения + очередь/исследование выбранного здания —
  // иначе «Очередь пуста» приклеивается после добавления первого юнита.
  const sel = st.selection.filter((e) => !e.dead);
  const firstB = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;
  const newSig = sel.map((e) => e.id + (e.done === false ? 'c' : '')).join(',') +
    '|' + (st.buildMenu ? 'B' : '') + (st.placing ? 'P' + st.placing.type : '') +
    '|' + (firstB ? 'Q' + firstB.queue.length + (firstB.res ? 'R' + firstB.res.key : '') : '');
  if (newSig !== sig) {
    sig = newSig;
    rebuildPanel(game, sel);
  }
  refreshDynamic(game, sel);
}

function rebuildPanel(game, sel) {
  const st = game.state;
  dyn = { cmds: [] };
  els.cmdGrid.innerHTML = '';
  els.selInfo.innerHTML = '';

  // Режим размещения здания.
  if (st.placing) {
    els.selInfo.innerHTML = '<div class="hint">Клик по карте — поставить здание.<br>ПКМ / ESC — отмена.</div>';
    return;
  }
  if (!sel.length) {
    els.selInfo.innerHTML = '<div class="hint">Выделите юнита ЛКМ или рамкой.<br>ПКМ — идти / добывать / атаковать / ремонтировать.<br>ПКМ по бункеру — занять его.</div>';
    return;
  }

  const first = sel[0];

  // --- Выделено здание ---
  if (first.kind === 'building') {
    const b = first;
    const box = document.createElement('div');
    box.className = 'sel-box';
    const name = document.createElement('div');
    name.className = 'sel-name';
    name.textContent = fname(b.cfg, b.faction) + (b.done ? '' : ' — строится');
    box.appendChild(name);
    const hp = bar(b.hp / b.maxHp);
    box.appendChild(hp.el);
    if (!b.done) {
      const p = bar(b.progress);
      p.fill.classList.add('amber');
      box.appendChild(p.el);
      dyn.progFill = p.fill;
      const hint = document.createElement('div');
      hint.className = 'small';
      hint.textContent = 'Стройку ведёт назначенный рабочий.';
      box.appendChild(hint);
    } else {
      // Описание здания — теперь подписано ВСЕГДА.
      const desc = document.createElement('div');
      desc.className = 'small';
      desc.textContent = fdesc(b.cfg, b.faction);
      box.appendChild(desc);

      // Очередь производства — видна всегда у производящих зданий:
      // и когда она есть (чипы + таймер), и когда пуста.
      if (b.cfg.produces) {
        const q = document.createElement('div');
        q.className = 'queue';
        if (b.queue.length) {
          b.queue.forEach((item, i) => {
            const chip = document.createElement('button');
            chip.className = 'chip';
            chip.title = fname(UNITS[item.type], b.faction) + ' — клик: отмена (возврат минералов)';
            chip.appendChild(iconEl(b.faction === 'alien' ? 'a_' + item.type : item.type));
            if (i === 0) {
              const pr = document.createElement('div');
              pr.className = 'chip-progress';
              chip.appendChild(pr);
              dyn.chipFill = pr;
              const tm = document.createElement('span');
              tm.className = 'chip-time';
              chip.appendChild(tm);
              dyn.timerEl = tm;
            }
            chip.addEventListener('click', () => game.hooks.cancelQueue(b, i));
            q.appendChild(chip);
          });
        } else {
          const empty = document.createElement('div');
          empty.className = 'queue-empty';
          empty.textContent = 'Очередь пуста — выберите юнита справа';
          q.appendChild(empty);
        }
        box.appendChild(q);
      }

      // Исследование (лаборатория): прогресс и остаток времени.
      if (b.res) {
        const up = UPGRADES[b.res.key];
        const rl = document.createElement('div');
        rl.className = 'res-line';
        const t1 = document.createElement('div');
        t1.textContent = fname(up, b.faction) + ' ур.' + b.res.lvl + ' — осталось ' + Math.ceil(b.res.t) + 'с';
        rl.appendChild(t1);
        const rp = bar(1 - b.res.t / b.res.total);
        rp.fill.classList.add('amber');
        rl.appendChild(rp.el);
        dyn.resFill = rp.fill;
        box.appendChild(rl);
      }

      if (b.cfg.garrisonCap) {
        const hint = document.createElement('div');
        hint.className = 'small';
        hint.textContent = 'Гарнизон: ' + b.garrison.length + '/' + b.cfg.garrisonCap +
          ' · ПКМ бункера при выделенной пехоте — занять.';
        box.appendChild(hint);
      }
      if (b.cfg.attack) {
        const s = document.createElement('div');
        s.className = 'small';
        s.textContent = `Урон ${b.cfg.dmg} · дальность ${b.cfg.range} · перезарядка ${b.cfg.cooldown}с`;
        box.appendChild(s);
      }
      if (b.cfg.produces && !b.queue.length) {
        const hint = document.createElement('div');
        hint.className = 'small';
        hint.textContent = 'ПКМ по земле — точка сбора новых юнитов.';
        box.appendChild(hint);
      }
    }
    els.selInfo.appendChild(box);
    infoStats(box, b);
  } else {
    // --- Выделены юниты ---
    const counts = {};
    for (const u of sel) counts[u.type] = (counts[u.type] || 0) + 1;
    const box = document.createElement('div');
    box.className = 'sel-box';
    const name = document.createElement('div');
    name.className = 'sel-name';
    const parts = Object.entries(counts).map(([t, n]) => fname(UNITS[t], first.faction) + ' ×' + n);
    name.textContent = parts.join(', ');
    box.appendChild(name);
    const hp = bar(first.hp / first.maxHp);
    box.appendChild(hp.el);
    dyn.hpFill = hp.fill;
    const sub = document.createElement('div');
    sub.className = 'small';
    sub.textContent = `${fdesc(first.cfg, first.faction)} · урон ${first.cfg.dmg} · перезарядка ${first.cfg.cooldown}с`;
    box.appendChild(sub);
    els.selInfo.appendChild(box);
  }

  // --- Кнопки команд (от игры — контекстный список) ---
  // Меню стройки — 8 кнопок: в компактной сетке 2×4 они гарантированно
  // помещаются в панель (обычные ряды по 82px обрезали всё ниже второго).
  els.cmdGrid.classList.toggle('compact', !!st.buildMenu && !st.placing);
  const cmds = game.getCommands();
  for (const c of cmds) {
    const btn = document.createElement('button');
    btn.className = 'cmd';
    btn.dataset.code = c.code;
    btn.appendChild(iconEl(c.icon));
    const label = document.createElement('span');
    label.className = 'cmd-label';
    label.textContent = c.label;
    btn.appendChild(label);
    if (c.cost) {
      const cost = document.createElement('span');
      cost.className = 'cmd-cost';
      cost.textContent = c.cost;
      btn.appendChild(cost);
    }
    const key = document.createElement('kbd');
    key.textContent = c.code.replace('Key', '');
    btn.appendChild(key);
    btn.addEventListener('click', () => c.on());
    // Подсказка при наведении: полное описание юнита/здания/улучшения.
    if (c.tip) {
      btn.addEventListener('mouseenter', () => showTip(c.tip, btn));
      btn.addEventListener('mouseleave', hideTip);
      btn.addEventListener('click', hideTip);
    }
    els.cmdGrid.appendChild(btn);
    dyn.cmds.push({ code: c.code, el: btn, cmd: c });
  }
}

// ------------------------------------------------------------
// Тултип кнопки панели: имя, цена, описание и статы.
// ------------------------------------------------------------
let tipEl = null;
function showTip(tip, btn) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'cmd-tip';
    document.body.appendChild(tipEl);
  }
  const rows = (tip.lines || []).map((l) => `<div class="tip-row">${l}</div>`).join('');
  tipEl.innerHTML = `<div class="tip-title">${tip.title}<span class="tip-cost">${tip.cost || ''}</span></div>` +
    (tip.desc ? `<div class="tip-desc">${tip.desc}</div>` : '') + rows;
  tipEl.classList.add('show');
  const r = btn.getBoundingClientRect();
  tipEl.style.left = Math.max(8, Math.min(window.innerWidth - 320, r.left + r.width / 2 - 150)) + 'px';
  const h = tipEl.offsetHeight || 120;
  tipEl.style.top = Math.max(8, r.top - h - 8) + 'px';
}
function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

function refreshDynamic(game, sel) {
  if (!dyn) return;
  const st = game.state;
  // Доступность кнопок (минералы).
  for (const c of dyn.cmds) {
    if (c.cmd.enabled) c.el.classList.toggle('disabled', !c.cmd.enabled());
  }
  // Полоски HP / прогресса / таймер очереди / прогресс исследования.
  const first = sel[0];
  if (first) {
    if (dyn.hpFill) dyn.hpFill.style.width = Math.max(0, (first.hp / first.maxHp) * 100) + '%';
    if (dyn.progFill) dyn.progFill.style.width = Math.min(100, first.progress * 100) + '%';
    if (dyn.chipFill && first.kind === 'building' && first.queue.length) {
      const q = first.queue[0];
      dyn.chipFill.style.width = ((1 - q.t / q.total) * 100) + '%';
      if (dyn.timerEl) dyn.timerEl.textContent = q.hold ? 'ждёт' : Math.ceil(q.t) + 'с';
    }
    if (dyn.resFill && first.kind === 'building' && first.res) {
      dyn.resFill.style.width = ((1 - first.res.t / first.res.total) * 100) + '%';
    }
  }
}

function bar(frac) {
  const el = document.createElement('div');
  el.className = 'bar';
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.width = Math.max(0, Math.min(100, frac * 100)) + '%';
  el.appendChild(fill);
  return { el, fill };
}

function infoStats(box, b) {
  const s = document.createElement('div');
  s.className = 'small';
  s.textContent = `Прочность ${Math.ceil(b.hp)}/${b.maxHp}`;
  box.appendChild(s);
}

// ------------------------------------------------------------
// Миникарта: террейн-кэш + точки сущностей + туман + рамка камеры.
// ------------------------------------------------------------
export function drawMinimap(game) {
  const st = game.state;
  if (!st || !els) return;
  const g = els.minimap.getContext('2d');
  const S = els.minimap.width; // 176
  const k = S / WORLD_W;
  g.imageSmoothingEnabled = false;
  g.drawImage(st.map.miniCanvas, 0, 0, S, S);

  // Кристаллы (только разведанные).
  for (const c of st.map.crystals) {
    if (c.amount <= 0 || !st.fog.tileExplored(c.tx, c.ty)) continue;
    g.fillStyle = COLORS.mineral;
    g.fillRect(c.tx * TILE * k, c.ty * TILE * k, 3, 3);
  }
  // Здания.
  for (const b of st.buildings) {
    if (b.dead) continue;
    if (b.side === 'enemy' && !b.spotted) continue;
    g.fillStyle = b.side === 'player' ? '#76e3d7' : '#ff806e';
    g.fillRect(b.tx * TILE * k, b.ty * TILE * k, Math.max(4, b.w * TILE * k), Math.max(3, b.h * TILE * k));
  }
  // Юниты (враги — только видимые).
  for (const u of st.units) {
    if (u.dead || u.garrison) continue;
    if (u.side === 'enemy' && !u.visible) continue;
    g.fillStyle = u.side === 'player' ? '#c5fff1' : '#ffd0b5';
    g.fillRect(u.x * k - 1.5, u.y * k - 1.5, 3, 3);
  }
  // Туман войны.
  if (st.fog.dirty) st.fog.paint();
  g.imageSmoothingEnabled = false;
  g.drawImage(st.fog.canvas, 0, 0, MAP_W, MAP_H, 0, 0, S, S);
  // Рамка обзора камеры.
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  g.strokeRect(st.camera.x * k, st.camera.y * k, game.cssW * k, game.cssH * k);
  // Пинги тревоги.
  for (const p of st.pings) {
    const a = 1 - p.t / 2.5;
    g.strokeStyle = `rgba(255,128,110,${a})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.x * k, p.y * k, 4 + p.t * 10, 0, Math.PI * 2);
    g.stroke();
  }
}
