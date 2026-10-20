// ============================================================
// ui.js — интерфейс: главное меню (кампания / быстрый бой),
// выбор миссии с брифингами, выбор фракции, верхняя панель
// ресурсов и цели, панель команд, миникарта, тосты, экран финала.
// Весь UI — DOM поверх canvas; иконки команд рисуются кодом.
// ============================================================
import {
  TILE, UNITS, BUILDINGS, UPGRADES, GRADES, GRADE_ROMAN, gradeQueue, gradeGar,
  WORLD_W, WORLD_H, SUPPLY_MAX, COLORS, fname, fdesc,
} from './config.js';
import { MISSIONS, loadProgress, resetProgress, objectiveLabel, missionText } from './missions.js';
import { CODEX, codexTabLabel, codexEntryParts } from './lore.js';
import { t, message, fmtNum, setRich, getLocale, setLocale, SUPPORTED_LOCALES, applyStaticDOM } from './i18n.js';
import { crystalAt } from './units.js'; // F.1: тултип кристалла

const $ = (id) => document.getElementById(id);

// cls — только классы оформления; подписи фракций — в локали
// (factions.<side>.title/sub) — I: язык не пришивается к коду.
const FACTIONS = {
  human: { cls: 'fac-human' },
  alien: { cls: 'fac-alien' },
};
const facTitle = (f) => t('factions.' + f + '.title');

const QUICK_BATTLE_PRESETS = Object.freeze([
  Object.freeze({ id: 'square-48', w: 48, h: 48, nameKey: 'ui.menu.quickPresetNames.compact' }),
  Object.freeze({ id: 'square-64', w: 64, h: 64, nameKey: 'ui.menu.quickPresetNames.standard' }),
  Object.freeze({ id: 'square-80', w: 80, h: 80, nameKey: 'ui.menu.quickPresetNames.large' }),
  Object.freeze({ id: 'square-96', w: 96, h: 96, nameKey: 'ui.menu.quickPresetNames.expanse' }),
  Object.freeze({ id: 'wide-96x64', w: 96, h: 64, nameKey: 'ui.menu.quickPresetNames.wide' }),
  Object.freeze({ id: 'tall-64x96', w: 64, h: 96, nameKey: 'ui.menu.quickPresetNames.tall' }),
]);

const QUICK_BATTLE_DEFAULT = 'square-64';
const QUICK_BATTLE_STORAGE_KEY = 'terranrts.quickBattle';
let quickBattleSelection = { presetId: QUICK_BATTLE_DEFAULT, faction: null };
let quickBattleLastSaved = null;

function quickBattlePresetDims(presetId) {
  const preset = QUICK_BATTLE_PRESETS.find((item) => item.id === presetId)
    || QUICK_BATTLE_PRESETS.find((item) => item.id === QUICK_BATTLE_DEFAULT);
  return { w: preset.w, h: preset.h };
}

function parseQuickBattleConfig(raw) {
  const fallback = { presetId: QUICK_BATTLE_DEFAULT, faction: null, isSaved: false };
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    if (Object.keys(value).some((key) => key !== 'presetId' && key !== 'faction')) return fallback;
    if (!QUICK_BATTLE_PRESETS.some((item) => item.id === value.presetId)) return fallback;
    if (value.faction !== 'human' && value.faction !== 'alien') return fallback;
    return { presetId: value.presetId, faction: value.faction, isSaved: true };
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------
// Command icons: small canvases, drawn once.
// ------------------------------------------------------------
const iconCache = {};
export function icon(type) {
  if (iconCache[type]) return iconCache[type];
  const c = document.createElement('canvas');
  c.width = 26; c.height = 26;
  const g = c.getContext('2d');
  g.translate(13, 13);
  // Палитра иконок = токены рас: люди — сталь/бирюза/янтарь,
  // кхарид — фиолет плоти/зелень слизи/бледная кость.
  const teal = '#57d3c3', green = '#67c98a', amber = '#f3c579', steel = '#8fb5b3';
  const dark = '#16262b', white = '#d9fff0';
  const purple = '#a78bdb', flesh = '#2a2140', slime = '#9ff5b8', bone = '#eafff0';
  const red = '#ff6e5f';
  // Правило силуэтов: у каждого юнита своя геометрия тела + один яркий
  // признак; у зданий — своя крыша/проём. Путаться не должны даже мельком.
  switch (type) {
    // ===== Люди: техника =====
    case 'worker':
      // Дрон-ромб с янтарным контейнером.
      g.fillStyle = teal;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(7, 0); g.lineTo(0, 8); g.lineTo(-7, 0); g.closePath(); g.fill();
      g.fillStyle = white; g.beginPath(); g.arc(0, -1, 2.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = amber; g.fillRect(-8, 2, 6, 6);
      g.strokeStyle = dark; g.lineWidth = 1; g.strokeRect(-8, 2, 6, 6);
      break;
    case 'marine':
      // Круглый шлем с визором + длинная винтовка.
      g.fillStyle = teal; g.beginPath(); g.arc(-2, 1, 6.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = dark; g.fillRect(-8, -1, 11, 3);
      g.fillStyle = white; g.fillRect(-6, -1, 3, 3);
      g.fillStyle = dark; g.fillRect(3, 0, 10, 2.6);
      g.fillStyle = amber; g.fillRect(11, 0, 2.4, 2.6);
      break;
    case 'buggy':
      // Стрела-ховер: 4 катка + кабина-капля.
      g.fillStyle = dark; g.fillRect(-9, -7, 5, 5); g.fillRect(4, -7, 5, 5);
      g.fillRect(-9, 2, 5, 5); g.fillRect(4, 2, 5, 5);
      g.fillStyle = teal;
      g.beginPath(); g.moveTo(-7, -4); g.lineTo(9, 0); g.lineTo(-7, 4); g.closePath(); g.fill();
      g.fillStyle = white; g.beginPath(); g.arc(-1, 0, 2.2, 0, Math.PI * 2); g.fill();
      break;
    case 'tank':
      // Траки + корпус + горизонтальная пушка с дульным тормозом.
      g.fillStyle = dark; g.fillRect(-10, -8, 20, 5); g.fillRect(-10, 3, 20, 5);
      g.fillStyle = teal; g.fillRect(-8, -4, 15, 8);
      g.fillStyle = white; g.beginPath(); g.arc(-4, 0, 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = dark; g.fillRect(4, -1.5, 10, 3);
      g.fillStyle = amber; g.fillRect(12, -2.5, 3, 5);
      break;
    case 'medic':
      // Белый круг с красным крестом в бирюзовом ободе.
      g.fillStyle = white; g.beginPath(); g.arc(0, 1, 7.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = teal; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 1, 7.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = red; g.fillRect(-1.8, -5, 3.6, 12); g.fillRect(-6, -0.8, 12, 3.6);
      break;
    case 'flamer':
      // Круг + баллон слева + сопло и капля пламени справа.
      g.fillStyle = teal; g.beginPath(); g.arc(-2, 1, 6.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = dark; g.fillRect(-11, -3, 5, 8);
      g.fillStyle = amber; g.fillRect(3, 0, 8, 3.4);
      g.fillStyle = amber;
      g.beginPath(); g.moveTo(12, -3); g.quadraticCurveTo(16, 1, 12, 5); g.quadraticCurveTo(13.5, 1, 12, -3); g.fill();
      break;
    case 'arty':
      // Траки + задранный вверх ствол + снаряд на конце.
      g.fillStyle = dark; g.fillRect(-9, 2, 18, 6);
      g.fillStyle = teal; g.fillRect(-7, -3, 13, 6);
      g.strokeStyle = dark; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, -3); g.lineTo(9, -11); g.stroke();
      g.fillStyle = amber; g.beginPath(); g.arc(9, -11, 2.6, 0, Math.PI * 2); g.fill();
      break;
    case 'scout': // H.3: клин-ховер, глаз-кабина, дрон-точка с лучом.
      g.fillStyle = teal;
      g.beginPath(); g.moveTo(9, 0); g.lineTo(-7, -6); g.lineTo(-4, 0); g.lineTo(-7, 6); g.closePath(); g.fill();
      g.fillStyle = white; g.beginPath(); g.arc(1, 0, 2.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = white; g.lineWidth = 1;
      g.beginPath(); g.moveTo(1, 0); g.lineTo(-6, -8); g.stroke();
      g.fillStyle = amber; g.beginPath(); g.arc(-6, -8, 1.8, 0, Math.PI * 2); g.fill();
      break;
    // ===== Люди: здания (своя крыша/проём у каждого) =====
    case 'cc':
      g.fillStyle = steel; g.fillRect(-10, -6, 20, 13);
      g.fillStyle = dark; g.fillRect(-10, 5, 20, 2);
      g.strokeStyle = teal; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, 0, 6, 4.5, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = red; g.beginPath(); g.arc(0, -9, 2.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = dark; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -7); g.lineTo(0, -6); g.stroke();
      break;
    case 'depot':
      // Домик со скатной крышей и тёплым окном.
      g.fillStyle = steel;
      g.beginPath(); g.moveTo(-10, 0); g.lineTo(0, -9); g.lineTo(10, 0); g.closePath(); g.fill();
      g.fillStyle = '#6e7f7d'; g.fillRect(-8, 0, 16, 7);
      g.fillStyle = amber; g.fillRect(2, 1.5, 5, 4);
      g.fillStyle = dark; g.fillRect(-6, 1, 4, 6);
      break;
    case 'barracks':
      // Высокий корпус: ворота + шеврон + янтарная полоса.
      g.fillStyle = steel; g.fillRect(-9, -8, 18, 15);
      g.fillStyle = dark; g.fillRect(-4, 0, 8, 7);
      g.strokeStyle = amber; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-5, -3); g.lineTo(0, -6); g.lineTo(5, -3); g.stroke();
      g.fillStyle = teal; g.fillRect(-9, -8, 18, 2.4);
      break;
    case 'turret':
      // Шестигранник + СПАРЕННАЯ пушка-клыки (как «Гадюка» в игре).
      g.fillStyle = steel;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + Math.PI / 6;
        const px2 = Math.cos(a) * 7.5, py2 = 2 + Math.sin(a) * 7.5;
        if (i === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
      }
      g.closePath(); g.fill();
      g.strokeStyle = dark; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -1); g.lineTo(10, -7); g.moveTo(0, 3); g.lineTo(10, -3); g.stroke();
      break;
    case 'wall':
      g.fillStyle = steel; g.fillRect(-10, -5, 20, 11);
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-10, -5, 20, 2);
      g.strokeStyle = '#2c4a52'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-10, 1); g.lineTo(10, 1); g.stroke();
      g.beginPath(); g.moveTo(-3, -5); g.lineTo(-3, 6); g.moveTo(4, -5); g.lineTo(4, 6); g.stroke();
      g.strokeStyle = amber; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(-4, 4.5); g.lineTo(0, 1.5); g.lineTo(4, 4.5); g.stroke();
      break;
    case 'bunker':
      // Низкий дот: длинная бойница + ряд мешков сверху.
      g.fillStyle = steel; g.fillRect(-10, -3, 20, 10);
      g.fillStyle = dark; g.fillRect(-8, 1, 16, 3.4);
      g.fillStyle = '#a08c62';
      g.beginPath(); g.arc(-6, -4, 2.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, -4, 2.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(6, -4, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'factory':
      // Цех + высокая труба + горн.
      g.fillStyle = steel; g.fillRect(-10, -1, 20, 9);
      g.fillStyle = teal; g.fillRect(-10, -1, 20, 2.4);
      g.fillStyle = '#2c4a52'; g.fillRect(3, -11, 5, 11);
      g.fillStyle = amber; g.fillRect(-7, 2.5, 7, 4);
      break;
    case 'lab':
      // Светлый корпус + купол + тарелка + чан.
      g.fillStyle = '#cfd6dc'; g.fillRect(-10, 0, 20, 8);
      g.fillStyle = teal; g.beginPath(); g.arc(-4, 0, 6, Math.PI, 0); g.fill();
      g.strokeStyle = dark; g.lineWidth = 1.6;
      g.beginPath(); g.arc(6, -4, 4.6, Math.PI * 0.9, Math.PI * 1.9); g.stroke();
      g.fillStyle = green; g.fillRect(-9, 2, 3, 4);
      break;
    // ===== Улучшения и приказы (были хороши — не трогаем) =====
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
      g.fillStyle = dark; g.fillRect(-3, -9, 6, 13);
      g.fillStyle = amber; g.fillRect(-5, 2, 10, 6);
      g.fillStyle = amber; g.beginPath(); g.arc(0, -9, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'u_vehArm':
      g.strokeStyle = steel; g.lineWidth = 2;
      g.beginPath();
      for (let i2 = 0; i2 < 6; i2++) {
        const a = i2 * Math.PI / 3 - Math.PI / 2;
        const px3 = Math.cos(a) * 8, py3 = Math.sin(a) * 8;
        if (i2 === 0) g.moveTo(px3, py3); else g.lineTo(px3, py3);
      }
      g.closePath(); g.stroke();
      g.fillStyle = steel; g.fillRect(-1.5, -5, 3, 10); g.fillRect(-5, -1.5, 10, 3);
      break;
    case 'u_autoRepair': // H.1: ключ в круговой стрелке.
      g.strokeStyle = green; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-5, 5); g.lineTo(1, -1); g.stroke();
      g.fillStyle = green; g.fillRect(1, -7, 6, 6);
      g.strokeStyle = steel; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 9, Math.PI * 0.3, Math.PI * 1.7); g.stroke();
      g.beginPath(); g.moveTo(9, -3); g.lineTo(11, 3); g.lineTo(5, 1); g.stroke();
      break;
    case 'build':
      g.fillStyle = steel; g.fillRect(-9, -8, 10, 8);
      g.fillStyle = amber; g.fillRect(-2, -4, 12, 4);
      g.fillStyle = teal; g.fillRect(-11, 4, 22, 4);
      break;
    case 'grade': // F.2: двойной шеврон вверх
      g.strokeStyle = '#ffd27f'; g.lineWidth = 2.5; g.lineJoin = 'round';
      for (const oy of [-3, 3]) {
        g.beginPath();
        g.moveTo(-7, 2 + oy); g.lineTo(0, -4 + oy); g.lineTo(7, 2 + oy);
        g.stroke();
      }
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
      g.strokeStyle = green; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-7, 7); g.lineTo(2, -2); g.stroke();
      g.fillStyle = green;
      g.fillRect(2, -8, 8, 8);
      break;
    case 'recon': // H.3: радар — круг, развёртка, точка контакта.
      g.strokeStyle = teal; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(0, 0); g.lineTo(6, -6); g.stroke();
      g.fillStyle = red; g.beginPath(); g.arc(-4, 3, 2, 0, Math.PI * 2); g.fill();
      break;
    case 'rally': // H.4: флажок сбора на мачте.
      g.strokeStyle = dark; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-4, 9); g.lineTo(-4, -9); g.stroke();
      g.fillStyle = amber;
      g.beginPath(); g.moveTo(-4, -9); g.lineTo(8, -5); g.lineTo(-4, -1); g.closePath(); g.fill();
      break;
    // ===== Кхарид: органика (своя геометрия у каждого) =====
    case 'a_worker':
      // Маленький жук на ножках — самый мелкий силуэт.
      g.strokeStyle = purple; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-4, 2); g.lineTo(-7, 8); g.moveTo(0, 3); g.lineTo(0, 9); g.moveTo(4, 2); g.lineTo(7, 8); g.stroke();
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, -2, 5.5, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = slime; g.beginPath(); g.arc(3, -2, 2.2, 0, Math.PI * 2); g.fill();
      break;
    case 'a_marine':
      // Шипастый боец: 3 шипа + глаз.
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 3, 7.5, 5.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = slime;
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(-4, -8); g.lineTo(-2, 0); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-1, -1); g.lineTo(1, -10); g.lineTo(3, -1); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(4, 0); g.lineTo(6, -7); g.lineTo(8, 0); g.closePath(); g.fill();
      g.fillStyle = bone; g.beginPath(); g.arc(5, 3, 2.2, 0, Math.PI * 2); g.fill();
      break;
    case 'a_buggy':
      // Гончая: низкая, 4 ноги, глаз спереди.
      g.strokeStyle = purple; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-4, -1); g.lineTo(-9, -7); g.moveTo(-4, 3); g.lineTo(-9, 8);
      g.moveTo(4, -1); g.lineTo(9, -6); g.moveTo(4, 3); g.lineTo(9, 7); g.stroke();
      g.fillStyle = purple; g.beginPath(); g.ellipse(-1, 1, 7, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = slime; g.beginPath(); g.arc(6, 0, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'a_tank':
      // Громила: самый крупный + рог + челюсть.
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 1, 10, 7.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = bone;
      g.beginPath(); g.moveTo(-3, -5); g.lineTo(1, -12); g.lineTo(5, -5); g.closePath(); g.fill();
      g.strokeStyle = flesh; g.lineWidth = 2;
      g.beginPath(); g.moveTo(2, 5); g.lineTo(9, 3); g.stroke();
      g.fillStyle = bone; g.beginPath(); g.arc(7, 0, 2.6, 0, Math.PI * 2); g.fill();
      break;
    case 'a_medic':
      // Цветень: тело + высокий стебель с большим бутоном.
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 4, 6.5, 5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = slime; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -7); g.stroke();
      g.fillStyle = slime; g.beginPath(); g.arc(0, -9.5, 3.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = bone; g.beginPath(); g.arc(0, -9.5, 1.3, 0, Math.PI * 2); g.fill();
      break;
    case 'a_flamer':
      // Кислотник: тело + янтарное сопло + капля.
      g.fillStyle = purple; g.beginPath(); g.ellipse(-2, 2, 8, 6.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = amber; g.fillRect(4, 0, 7, 4);
      g.fillStyle = amber;
      g.beginPath(); g.moveTo(12, -2); g.quadraticCurveTo(15.5, 2, 12, 6); g.quadraticCurveTo(13, 2, 12, -2); g.fill();
      break;
    case 'a_arty':
      // Спогром: тело + мортира вверх + спора на конце.
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 3, 9, 6.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = flesh; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-2, -2); g.lineTo(-8, -9); g.stroke();
      g.fillStyle = slime; g.beginPath(); g.arc(-8, -10, 3, 0, Math.PI * 2); g.fill();
      break;
    case 'a_scout': // H.3: юркое тело, уши-локаторы, спора-спутник.
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 2, 8, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = flesh;
      g.beginPath(); g.moveTo(1, -2); g.lineTo(3, -9); g.lineTo(5, -2); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-4, -2); g.lineTo(-2, -9); g.lineTo(0, -2); g.closePath(); g.fill();
      g.fillStyle = slime;
      g.beginPath(); g.arc(3, -9, 1.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(-2, -9, 1.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(-8, -6, 1.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = bone; g.beginPath(); g.arc(5, 1, 1.4, 0, Math.PI * 2); g.fill();
      break;
    case 'a_cc':
      // Улей: курган + КРАСНОЕ сердце (уникальный признак штаба).
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 2, 10, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = red; g.beginPath(); g.arc(0, 2, 3.2, 0, Math.PI * 2); g.fill();
      g.fillStyle = bone; g.beginPath(); g.arc(-1, 1, 1.1, 0, Math.PI * 2); g.fill();
      g.strokeStyle = slime; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(0, 2, 7.5, 5, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      break;
    case 'a_depot':
      // Мешок с ядром + сателлит.
      g.fillStyle = purple; g.beginPath(); g.ellipse(-1, 2, 7, 6.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = slime; g.beginPath(); g.arc(0, 1, 2.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = purple; g.beginPath(); g.arc(8, -3, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = bone; g.beginPath(); g.arc(8, -3, 1.1, 0, Math.PI * 2); g.fill();
      break;
    case 'a_barracks':
      // Яма с тремя яйцами + зубцы венца.
      g.fillStyle = flesh; g.beginPath(); g.ellipse(0, 3, 9.5, 6, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = purple; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, 3, 9.5, 6, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = slime;
      g.beginPath(); g.arc(-4, 1, 2.2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(2, -1, 2.2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(5, 3, 2.2, 0, Math.PI * 2); g.fill();
      break;
    case 'a_turret':
      // Жвала: клешня-V + светящаяся глотка.
      g.fillStyle = purple; g.beginPath(); g.arc(0, 3, 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = flesh; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(0, 1); g.lineTo(9, -6); g.moveTo(0, 4); g.lineTo(9, 8); g.stroke();
      g.fillStyle = slime; g.beginPath(); g.arc(2, 2.5, 2.4, 0, Math.PI * 2); g.fill();
      break;
    case 'a_wall':
      // Хитин: шеврон + шипики сверху.
      g.fillStyle = purple; g.fillRect(-9, -4, 18, 11);
      g.strokeStyle = slime; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(-6, 5); g.lineTo(0, -3); g.lineTo(6, 5); g.stroke();
      g.fillStyle = bone;
      g.beginPath(); g.moveTo(-6, -4); g.lineTo(-4.5, -8); g.lineTo(-3, -4); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(3, -4); g.lineTo(4.5, -8); g.lineTo(6, -4); g.closePath(); g.fill();
      break;
    case 'a_bunker':
      // Кокон: плетение + два глаза гарнизона.
      g.fillStyle = purple; g.beginPath(); g.ellipse(0, 1, 9, 7.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = bone; g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(0, 1, 6, 4.5, 0.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = slime;
      g.beginPath(); g.arc(-2.5, 1, 1.8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(2.5, 1, 1.8, 0, Math.PI * 2); g.fill();
      break;
    case 'a_factory':
      // Яма выводка: тёмный провал + кладка + светящийся обод.
      g.fillStyle = flesh; g.beginPath(); g.ellipse(0, 2, 10, 7, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = slime; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(0, 2, 10, 7, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = bone;
      g.beginPath(); g.arc(-4, 0, 2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(3, -1, 2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, 4, 2, 0, Math.PI * 2); g.fill();
      break;
    case 'a_lab':
      // Узел: курган + шпили + спора наверху.
      g.fillStyle = flesh; g.beginPath(); g.ellipse(0, 5, 10, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = purple;
      g.beginPath(); g.moveTo(-6, 3); g.lineTo(-2, -7); g.lineTo(2, 3); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(2, 3); g.lineTo(5, -4); g.lineTo(8, 3); g.closePath(); g.fill();
      g.fillStyle = slime; g.beginPath(); g.arc(-2, -8.5, 2.2, 0, Math.PI * 2); g.fill();
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
// П2: портрет здания в панели — та же иконка, крупнее.
function portraitEl(type) {
  const src = icon(type);
  const c = document.createElement('canvas');
  c.width = 52; c.height = 52;
  c.className = 'portrait';
  c.getContext('2d').drawImage(src, 0, 0, 52, 52);
  return c;
}

let els = null;        // кэш DOM-элементов
let dyn = null;        // динамические ссылки для апдейтов без перестройки
let sig = '';          // «подпись» текущей панели
let pendingMission = null; // Миссия, выбранная в брифинге.
let pendingNext = null;    // Следующая миссия после победы.

function quickBattleDimsLabel(presetId) {
  const dims = quickBattlePresetDims(presetId);
  return `${dims.w}×${dims.h}`;
}

function safeStoredQuickBattleConfig() {
  try { return parseQuickBattleConfig(localStorage.getItem(QUICK_BATTLE_STORAGE_KEY)); }
  catch { return parseQuickBattleConfig(null); }
}

export function restoreQuickBattleConfig() {
  const stored = safeStoredQuickBattleConfig();
  quickBattleSelection = { presetId: stored.presetId, faction: stored.faction };
  quickBattleLastSaved = stored.isSaved
    ? { presetId: stored.presetId, faction: stored.faction }
    : null;
  renderQuickBattleMenu();
  return { ...stored };
}

function saveQuickBattleConfig() {
  const value = { presetId: quickBattleSelection.presetId, faction: quickBattleSelection.faction };
  try {
    localStorage.setItem(QUICK_BATTLE_STORAGE_KEY, JSON.stringify(value));
    quickBattleLastSaved = value;
  } catch {
    quickBattleLastSaved = null;
  }
}

function renderQuickBattleMenu() {
  if (!els) return;
  const dims = quickBattleDimsLabel(quickBattleSelection.presetId);
  const selectedPreset = QUICK_BATTLE_PRESETS.find((item) => item.id === quickBattleSelection.presetId);
  for (const preset of QUICK_BATTLE_PRESETS) {
    const button = $('quick-preset-' + preset.id);
    if (!button) continue;
    const selected = preset.id === quickBattleSelection.presetId;
    const name = t(preset.nameKey);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', t('ui.menu.quickBattleMapAria', {
      name,
      dims: `${preset.w}×${preset.h}`,
    }));
  }
  for (const faction of ['human', 'alien']) {
    const button = $('quick-faction-' + faction);
    if (!button) continue;
    const selected = faction === quickBattleSelection.faction;
    const side = t(`ui.skirmish.${faction}Card.title`);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', t('ui.menu.quickBattleFactionAria', { side }));
  }

  const launch = els.quickBattleStart;
  const status = els.quickBattleStatus;
  if (!launch || !status || !selectedPreset) return;
  if (quickBattleSelection.faction) {
    const side = facTitle(quickBattleSelection.faction);
    const caption = t('ui.menu.quickBattleStart', { dims, side });
    launch.textContent = caption;
    launch.setAttribute('aria-label', caption);
    launch.setAttribute('aria-disabled', 'false');
    launch.classList.remove('is-disabled');
    const isLast = quickBattleLastSaved
      && quickBattleLastSaved.presetId === quickBattleSelection.presetId
      && quickBattleLastSaved.faction === quickBattleSelection.faction;
    status.textContent = isLast
      ? t('ui.menu.quickBattleLastConfig', { dims, side })
      : t('ui.menu.quickBattleReady', { dims, side });
  } else {
    const prompt = t('ui.menu.quickBattleNeedFaction');
    launch.textContent = prompt;
    launch.setAttribute('aria-label', prompt);
    launch.setAttribute('aria-disabled', 'true');
    launch.classList.add('is-disabled');
    status.textContent = t('ui.menu.quickBattleFirstVisit', { dims });
  }
  launch.setAttribute('aria-describedby', 'quick-battle-status');
}

function updateCampaignStartLabel() {
  if (!els || !els.startBtn) return;
  const progress = loadProgress();
  const nextMission = progress + 1;
  const key = progress === 0 ? 'ui.menu.campaignStartFirst' : 'ui.menu.campaignStartProgress';
  const label = t(key, { n: nextMission });
  els.startBtn.textContent = label;
  els.startBtn.setAttribute('aria-label', label);
}

function initQuickBattleMenu(game) {
  for (const preset of QUICK_BATTLE_PRESETS) {
    $('quick-preset-' + preset.id).addEventListener('click', () => {
      quickBattleSelection.presetId = preset.id;
      renderQuickBattleMenu();
    });
  }
  for (const faction of ['human', 'alien']) {
    $('quick-faction-' + faction).addEventListener('click', () => {
      quickBattleSelection.faction = faction;
      renderQuickBattleMenu();
    });
  }
  els.quickBattleStart.addEventListener('click', () => {
    if (!quickBattleSelection.faction) {
      els.quickBattleStatus.textContent = t('ui.menu.quickBattleSideNeeded');
      return;
    }
    saveQuickBattleConfig();
    game.startSkirmish(quickBattleSelection.faction, quickBattlePresetDims(quickBattleSelection.presetId));
  });
  restoreQuickBattleConfig();
}

export function initUI(game) {
  uiGame = game; // I: ручка для refreshLocale (перерисовка при смене языка)
  els = {
    canvas: $('game-canvas'),
    minimap: $('minimap'),
    minerals: $('res-minerals'),
    supply: $('res-supply'),
    supplyDot: $('res-supply-dot'),
    time: $('res-time'),
    objective: $('res-objective'),
    sound: $('btn-sound'),
    pause: $('btn-pause'),
    restart: $('btn-restart'),
    exit: $('btn-exit'),
    panelPosBtn: $('panel-pos'),
    panelHideBtn: $('panel-hide'),
    panelShow: $('panel-show'),
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
    quickBattleStart: $('btn-quick-battle-start'),
    quickBattleStatus: $('quick-battle-status'),
    endOverlay: $('end-overlay'),
    endTitle: $('end-title'),
    endReason: $('end-reason'),
    endStats: $('end-stats'),
    endEpilogue: $('end-epilogue'),
    codexOverlay: $('codex-overlay'),
    codexTabs: $('codex-tabs'),
    codexBody: $('codex-body'),
    pauseOverlay: $('pause-overlay'),
    startBtn: $('btn-start'),
    againBtn: $('btn-again'),
    versionBadge: $('ver-badge'),
  };

  // Main menu: quick battle is the primary path; campaign remains separate.
  initQuickBattleMenu(game);
  $('btn-season1').addEventListener('click', () => showMissions(game));
  $('btn-season2').addEventListener('click', () => toast(t('ui.menu.season2Toast')));
  $('btn-missions-back').addEventListener('click', () => {
    els.missionOverlay.classList.add('hidden');
    els.overlay.classList.remove('hidden');
  });
  $('btn-codex').addEventListener('click', () => {
    els.overlay.classList.add('hidden');
    showCodex();
    els.codexOverlay.classList.remove('hidden');
  });
  $('btn-codex-back').addEventListener('click', () => {
    els.codexOverlay.classList.add('hidden');
    els.overlay.classList.remove('hidden');
  });
  // Брифинг: «В бой!».
  $('btn-brief-go').addEventListener('click', () => {
    if (pendingMission) game.startMission(pendingMission);
  });
  $('btn-brief-back').addEventListener('click', () => {
    els.briefOverlay.classList.add('hidden');
    els.missionOverlay.classList.remove('hidden');
  });

  updateCampaignStartLabel();
  els.startBtn.addEventListener('click', () => game.startMission(MISSIONS[loadProgress()]));
  // Reset stays behind the secondary More disclosure.
  $('btn-reset').addEventListener('click', () => {
    if (!confirm(t('ui.menu.resetConfirm'))) return;
    resetProgress();
    updateCampaignStartLabel();
    game.sound.click();
  });
  els.againBtn.addEventListener('click', () => {
    els.endOverlay.classList.add('hidden');
    if (pendingNext) { showBrief(game, pendingNext); pendingNext = null; }
    else game.restart();
  });
  els.restart.addEventListener('click', () => game.restart());
  els.exit.addEventListener('click', () => game.toMenu());
  els.panelPosBtn.addEventListener('click', () => { cyclePanelPos(); game.resize(); game.sound.click(); });
  els.panelHideBtn.addEventListener('click', () => { setPanelHidden(true); game.resize(); game.sound.click(); });
  els.panelShow.addEventListener('click', () => { setPanelHidden(false); game.resize(); game.sound.click(); });
  applyPanelPrefs();
  els.pause.addEventListener('click', () => game.togglePause());
  els.sound.addEventListener('click', () => game.toggleSound());

  // I: переключатель языка на главном экране — только локали из
  // реестра SUPPORTED_LOCALES (безопасные коды, не из localStorage).
  const langSel = $('lang-select');
  if (langSel) {
    for (const entry of Object.values(SUPPORTED_LOCALES)) {
      const o = document.createElement('option');
      o.value = entry.code;
      o.textContent = entry.label;
      langSel.appendChild(o);
    }
    langSel.value = getLocale();
    langSel.addEventListener('change', () => setLocale(langSel.value));
  }

  // Миникарта: ЛКМ — прыжок/перетаскивание камеры, ПКМ — приказ.
  const mm = els.minimap;
  const mmWorld = (e) => {
    const r = mm.getBoundingClientRect();
    // C/П7: масштаб миникарты — от размера карты (фолбэк 64 до старта).
    const mp = (game.state && game.state.map) || { pxW: WORLD_W, pxH: WORLD_H };
    // G.6: обратное преобразование letterbox-превью (minimapView):
    // CSS-px → bitmap канваса → мир, с клампом в границы карты.
    const view = minimapView(mp);
    const bx = (e.clientX - r.left) * (view.S / r.width);
    const by = (e.clientY - r.top) * (view.S / r.height);
    return {
      x: Math.max(0, Math.min(mp.pxW, (bx - view.ox) / view.k)),
      y: Math.max(0, Math.min(mp.pxH, (by - view.oy) / view.k)),
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
  els.missionList.innerHTML = ''; // очистка (переводы в карточки идут через DOM)
  let lastAct = null;
  // П8: бонусные главы видны только после финала (победа №14 → прогресс 15).
  // Разблокировка — по порядку массива (id бонусных идут с разрывом).
  MISSIONS.forEach((m, idx) => {
    if (m.bonus && unlocked <= 14) return;
    // Заголовок акта перед первой миссией акта (текст — из локали).
    const act = missionText(m, 'act');
    if (act !== lastAct) {
      lastAct = act;
      const head = document.createElement('div');
      head.className = 'act-head';
      head.textContent = act;
      els.missionList.appendChild(head);
    }
    // Карточка собирается через DOM (никаких innerHTML с переводом).
    const card = document.createElement('button');
    card.className = 'mission-card' + (idx > unlocked ? ' locked' : '');
    const top = document.createElement('div');
    top.className = 'mc-top';
    const badge = document.createElement('span');
    badge.className = 'badge ' + FACTIONS[m.faction].cls;
    badge.textContent = facTitle(m.faction);
    top.appendChild(badge);
    const num = document.createElement('span');
    num.className = 'mc-num';
    num.textContent = m.bonus
      ? t('ui.missionsScr.chapter', { n: idx - 14 })
      : t('ui.missionsScr.missionN', { n: m.id + 1 });
    top.appendChild(num);
    if (idx > unlocked) {
      const lock = document.createElement('span');
      lock.className = 'mc-lock';
      lock.textContent = t('ui.missionsScr.locked');
      top.appendChild(lock);
    }
    card.appendChild(top);
    const addLine = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      setRich(d, text);
      card.appendChild(d);
      return d;
    };
    addLine('mc-name', missionText(m, 'name'));
    addLine('mc-place', missionText(m, 'place'));
    addLine('mc-obj', objectiveLabel(m));
    const intro = missionText(m, 'intro');
    if (intro) addLine('mc-intro', intro);
    if (m.defense) addLine('mc-def', t('ui.missionsScr.defenseTag'));
    if (idx <= unlocked) {
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
  els.briefBadge.textContent = t('ui.missionsScr.for') + facTitle(m.faction);
  els.briefBadge.className = 'badge ' + FACTIONS[m.faction].cls;
  els.briefTitle.textContent = missionText(m, 'name');
  els.briefPlace.textContent = missionText(m, 'place');
  // Бриф — абзацы через DOM (setRich: разрешены только <b>/<br>).
  els.briefText.textContent = '';
  for (const p of missionText(m, 'brief')) {
    const pe = document.createElement('p');
    setRich(pe, p);
    els.briefText.appendChild(pe);
  }
  const intro = missionText(m, 'intro');
  if (intro) {
    const ie = document.createElement('p');
    ie.className = 'brief-intro';
    setRich(ie, intro);
    els.briefText.appendChild(ie);
  }
  let objLine = t('ui.missionsScr.objective') + objectiveLabel(m);
  if (m.defense) {
    objLine += t('ui.missionsScr.prepNote', {
      prep: Math.round(m.defense.prep / 60),
      total: Math.round(m.defense.total / 60),
    });
  }
  els.briefObjective.textContent = objLine;
  els.briefOverlay.classList.remove('hidden');
}

// Части кодекса → безопасный DOM (setRich: только <b>/<br> в переводах).
function renderCodexParts(container, entry, progress) {
  container.textContent = '';
  for (const p of codexEntryParts(entry, progress)) {
    if (p.type === 'h2' || p.type === 'h3') {
      const h = document.createElement(p.type);
      h.textContent = p.text;
      container.appendChild(h);
    } else if (p.type === 'locked') {
      const el = document.createElement('p');
      el.className = 'codex-locked';
      el.textContent = p.text;
      container.appendChild(el);
    } else if (p.type === 'item') {
      const el = document.createElement('p');
      const b = document.createElement('b');
      b.textContent = p.title;
      el.appendChild(b);
      el.appendChild(document.createTextNode(' — '));
      const span = document.createElement('span');
      setRich(span, p.body);
      el.appendChild(span);
      container.appendChild(el);
    } else if (p.type === 'para') {
      const el = document.createElement('p');
      setRich(el, p.text);
      container.appendChild(el);
    }
  }
}

// Кодекс: вкладки из CODEX (lore.js), тело — абзацы вкладки.
export function showCodex() {
  els.codexTabs.textContent = '';
  const progress = loadProgress(); // П8: кодекс читает только прогресс кампании
  const render = (entry) => {
    renderCodexParts(els.codexBody, entry, progress);
    for (const b of els.codexTabs.children) {
      b.classList.toggle('active', b.dataset.id === entry.id);
    }
  };
  for (const entry of CODEX) {
    const b = document.createElement('button');
    b.className = 'codex-tab';
    b.dataset.id = entry.id;
    b.textContent = codexTabLabel(entry);
    b.addEventListener('click', () => render(entry));
    els.codexTabs.appendChild(b);
  }
  render(CODEX[0]);
}

export function hideStart() { if (els) els.overlay.classList.add('hidden'); }
export function showStart() {
  if (!els) return;
  updateCampaignStartLabel();
  renderQuickBattleMenu();
  els.overlay.classList.remove('hidden');
}

// I: бейдж версии (правило V) — текст приходит из game.js с параметрами локали.
export function setVersionBadge(text) {
  if (els && els.versionBadge) els.versionBadge.textContent = text;
}

// ------------------------------------------------------------
// Пакет E.1: положение командной панели + режим «скрыть».
// Низ (как было) / слева / справа / верх; выбор в localStorage.
// Инсеты — константы по CSS (190px высота, 236px ширина боковых).
// ------------------------------------------------------------
const PANEL_KEY = 'terranrts.panel';
const PANEL_POS = ['bottom', 'left', 'right', 'top'];
let panelPos = 'bottom', panelHidden = false;

export function getPanelPos() { return panelPos; }
export function isPanelHidden() { return panelHidden; }
export function getPanelInsets() {
  if (panelHidden) return { top: 0, bottom: 0, left: 0, right: 0 };
  // E.1 → G.6: инсеты — из реального размера панели, а не из зашитых
  // 236/190: панель-top растёт по содержимому (height:auto) и на коротких
  // экранах выше 190 — раньше она наезжала на карту, зона экрана на
  // миникарте врала, а краевой скролл срабатывал над панелью. Меряем
  // ПРАВИЛЬНОЕ измерение для каждой позиции: боковые — ширину (offsetWidth),
  // верх/низ — высоту (offsetHeight) — предупреждение E.1 про «во весь
  // экран» касалось только чужого измерения. Нет метрик (меню, fake DOM
  // симов) — старые зашитые значения как фолбэк.
  const p = typeof document !== 'undefined' ? document.getElementById('bottom-panel') : null;
  const w = (p && p.offsetWidth) || 0;
  const h = (p && p.offsetHeight) || 0;
  if (panelPos === 'left') return { top: 0, bottom: 0, left: w || 236, right: 0 };
  if (panelPos === 'right') return { top: 0, bottom: 0, left: 0, right: w || 236 };
  if (panelPos === 'top') return { top: h || 190, bottom: 0, left: 0, right: 0 };
  return { top: 0, bottom: h || 190, left: 0, right: 0 };
}
function savePanelPrefs() {
  try { localStorage.setItem(PANEL_KEY, JSON.stringify({ pos: panelPos, hidden: panelHidden })); }
  catch (e) { /* приватный режим — не запоминаем */ }
}
function applyPanelClass() {
  const cl = document.body.classList;
  cl.remove('panel-left', 'panel-right', 'panel-top', 'panel-hidden');
  if (panelPos !== 'bottom') cl.add('panel-' + panelPos);
  if (panelHidden) cl.add('panel-hidden');
  if (els && els.panelPosBtn) els.panelPosBtn.textContent = t('ui.panel.posState', { where: t('ui.panel.posNames.' + panelPos) });
  if (els && els.panelShow) els.panelShow.textContent = t('ui.panel.show');
}
export function applyPanelPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PANEL_KEY) || '{}');
    if (PANEL_POS.includes(p.pos)) panelPos = p.pos;
    panelHidden = !!p.hidden;
  } catch (e) { /* битый JSON — дефолты */ }
  applyPanelClass();
}
export function setPanelPos(pos) {
  if (!PANEL_POS.includes(pos)) return;
  panelPos = pos;
  savePanelPrefs();
  applyPanelClass();
}
export function cyclePanelPos() {
  setPanelPos(PANEL_POS[(PANEL_POS.indexOf(panelPos) + 1) % PANEL_POS.length]);
}
export function setPanelHidden(h) {
  panelHidden = !!h;
  savePanelPrefs();
  applyPanelClass();
}
export function togglePanel() { setPanelHidden(!panelHidden); }
export function hideMissions() { if (els.missionOverlay) els.missionOverlay.classList.add('hidden'); }
export function hideBrief() { if (els.briefOverlay) els.briefOverlay.classList.add('hidden'); }
export function hideEnd() { els.endOverlay.classList.add('hidden'); }

export function toast(msg, kind = 'info') {
  if (!els) return;
  const now = performance.now();
  if (toast.last && toast.last.msg === msg && now - toast.last.t < 1600) return; // анти-спам
  toast.last = { msg, t: now };
  const div = document.createElement('div');
  div.className = 'toast' + (kind === 'error' ? ' err' : kind === 'warn' ? ' warn' : '');
  div.textContent = msg;
  els.toasts.appendChild(div);
  while (els.toasts.children.length > 3) els.toasts.firstChild.remove();
  setTimeout(() => div.classList.add('hide'), 2250);
  setTimeout(() => div.remove(), 2600);
}

export function setObjective(text) {
  if (els && els.objective) els.objective.textContent = text;
}

// Прошедшее время боя — округление вниз (в отличие от fmtTime обратных
// отсчётов в game.js, где округление вверх, чтобы «03:00» держалось до конца).
function fmtElapsed(sec) {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function showEnd(win, stats, opts = {}) {
  els.endTitle.textContent = win ? t('ui.end.win') : t('ui.end.lose');
  els.endTitle.className = win ? 'win' : 'lose';
  els.endReason.textContent = opts.reason || '';
  els.endEpilogue.textContent = win ? (opts.epilogue || '') : '';
  if (opts.campaignDone) els.endReason.textContent = t('ui.end.campaignDone');
  // Статистика — через DOM (переведённые подписи из локали).
  els.endStats.innerHTML = ''; // очистка (строки далее — через DOM)
  const row = (label, val) => {
    const d = document.createElement('div');
    d.className = 'row';
    const s = document.createElement('span');
    s.textContent = label;
    const b = document.createElement('b');
    b.textContent = val;
    d.appendChild(s);
    d.appendChild(b);
    els.endStats.appendChild(d);
  };
  row(t('ui.end.statsTime'), fmtElapsed(stats.time));
  row(t('ui.end.statsKills'), stats.kills);
  row(t('ui.end.statsLosses'), stats.losses);
  row(message('mined', opts.faction), stats.mined);
  pendingNext = opts.next || null;
  els.againBtn.textContent = opts.next ? t('ui.end.next') : t('ui.end.again');
  els.endOverlay.classList.remove('hidden');
}

// Сброс кэша панели при новой партии — заставит её перестроиться.
export function resetPanel() { sig = ''; dyn = null; }
export function setPausedUI(p) {
  els.pauseOverlay.classList.toggle('hidden', !p);
  els.pause.textContent = p ? t('ui.topbar.resume') : t('ui.topbar.pause');
}
export function setSoundUI(muted) { els.sound.textContent = muted ? t('ui.topbar.soundOff') : t('ui.topbar.sound'); }

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
  const supRatio = sup.cap ? sup.used / sup.cap : 0;
  els.supplyDot.classList.toggle('warn', supRatio >= 0.85 && sup.used < sup.cap);
  els.supplyDot.classList.toggle('crit', sup.used >= sup.cap);
  els.time.textContent = fmtElapsed(st.time);
  els.canvas.style.cursor = st.placing ? 'crosshair' : 'default';

  // Подпись панели: состав выделения + очередь/исследование/грейд выбранного
  // здания — иначе «Очередь пуста» приклеивается после добавления первого юнита.
  const sel = st.selection.filter((e) => !e.dead);
  const firstB = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;
  const newSig = sel.map((e) => e.id + (e.done === false ? 'c' : '')).join(',') +
    '|' + (st.buildMenu ? 'B' : '') + (st.placing ? 'P' + st.placing.type : '') +
    '|' + (firstB ? 'Q' + firstB.queue.map((item) => item.type).join(',') +
      (firstB.res ? 'R' + firstB.res.key : '') +
      'G' + (firstB.gradeUp ? firstB.gradeUp.to : '') + 'L' + (firstB.level || 1) : '');
  if (newSig !== sig) {
    sig = newSig;
    rebuildPanel(game, sel);
  }
  refreshDynamic(game, sel);
}

function rebuildPanel(game, sel) {
  const st = game.state;
  const previousDyn = dyn;
  const selectedBuilding = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;
  const sameBuilding = selectedBuilding && previousDyn && previousDyn.processBuildingId === selectedBuilding.id;
  dyn = {
    cmds: [], queueButtons: [],
    processBuildingId: selectedBuilding ? selectedBuilding.id : null,
    processIdentity: sameBuilding ? previousDyn.processIdentity : null,
    processReadySuppressed: sameBuilding ? previousDyn.processReadySuppressed : false,
  };
  els.cmdGrid.innerHTML = '';
  els.selInfo.innerHTML = '';

  // Режим размещения здания.
  if (st.placing) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    setRich(hint, t('ui.hints.buildMode'));
    els.selInfo.appendChild(hint);
    return;
  }
  if (!sel.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    setRich(hint, t('ui.hints.select'));
    els.selInfo.appendChild(hint);
    return;
  }

  const first = sel[0];

  // --- Выделено здание ---
  if (first.kind === 'building') {
    const b = first;
    const box = document.createElement('div');
    box.className = 'sel-box building-card';
    box.appendChild(portraitEl(b.faction === 'alien' ? 'a_' + b.type : b.type));
    const name = document.createElement('div');
    name.className = 'sel-name';
    name.textContent = fname(b.cfg, b.faction) + (b.done ? '' : t('ui.hints.buildWip'));
    box.appendChild(name);
    const status = statusLine('', '');
    dyn.buildingLed = status.led;
    dyn.buildingText = status.text;
    box.appendChild(status.el);
    const hp = bar(b.hp / b.maxHp);
    box.appendChild(hp.el);
    dyn.hpFill = hp.fill;

    if (b.done) {
      const desc = document.createElement('div');
      desc.className = 'small sel-desc';
      desc.textContent = fdesc(b.cfg, b.faction);
      box.appendChild(desc);
    }

    // Одна карточка отражает текущий процесс или честное состояние покоя.
    box.appendChild(buildProcessCard());

    // Очередь остаётся доступной прямо в инспекторе; возврат виден до клика.
    if (b.done && b.cfg.produces) {
      const queuePanel = document.createElement('div');
      queuePanel.className = 'queue-panel';
      const queueHead = document.createElement('div');
      queueHead.className = 'queue-head';
      queueHead.textContent = t('ui.process.queueTitle', {
        n: fmtNum(b.queue.length), cap: fmtNum(gradeQueue(b.type, b.level || 1)),
      });
      queuePanel.appendChild(queueHead);
      const queue = document.createElement('div');
      queue.className = 'queue';
      if (b.queue.length) {
        b.queue.forEach((item, i) => queue.appendChild(buildQueueButton(game, b, item, i)));
      } else {
        const empty = document.createElement('div');
        empty.className = 'queue-empty';
        empty.textContent = t('ui.hints.queueEmpty');
        queue.appendChild(empty);
      }
      queuePanel.appendChild(queue);
      box.appendChild(queuePanel);
    }

    if (b.done && b.cfg.garrisonCap) {
      const hint = document.createElement('div');
      hint.className = 'small';
      hint.textContent = t('ui.hints.garrisonHint', {
        n: b.garrison.length, cap: gradeGar(b.type, b.level || 1, b.cfg.garrisonCap),
      });
      box.appendChild(hint);
      dyn.garrisonHint = hint;
    }
    if (b.cfg.attack) {
      const s = document.createElement('div');
      s.className = 'small';
      s.textContent = t('ui.hints.dmgLine', { d: b.cfg.dmg, r: b.cfg.range, cd: b.cfg.cooldown });
      box.appendChild(s);
    }
    if (b.done && b.cfg.produces && !b.queue.length) {
      const hint = document.createElement('div');
      hint.className = 'small';
      hint.textContent = t('ui.hints.rallyHint');
      box.appendChild(hint);
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
    const usl = statusLine('idle', '');
    box.appendChild(usl.el);
    dyn.unitLed = usl.led; dyn.unitText = usl.text;
    const sub = document.createElement('div');
    sub.className = 'small';
    sub.textContent = t('ui.hints.unitSub', { desc: fdesc(first.cfg, first.faction), d: first.cfg.dmg, cd: first.cfg.cooldown });
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
    btn.setAttribute('aria-describedby', 'cmd-tip');
    btn.appendChild(iconEl(c.icon));
    const label = document.createElement('span');
    label.className = 'cmd-label';
    label.textContent = c.label;
    btn.appendChild(label);

    const refund = refundForCommand(c, selectedBuilding);
    const shownCost = c.cost ? fmtNum(c.cost) : (refund !== null
      ? t('ui.process.refundShort', { n: fmtNum(refund) }) : '');
    if (shownCost) {
      const cost = document.createElement('span');
      cost.className = refund !== null ? 'cmd-cost cmd-refund' : 'cmd-cost';
      cost.textContent = shownCost;
      btn.appendChild(cost);
    }
    const key = document.createElement('kbd');
    key.textContent = c.code.replace('Key', '');
    btn.appendChild(key);

    const entry = { code: c.code, el: btn, cmd: c, refund, tip: commandTooltip(c, refund) };
    btn.addEventListener('click', () => {
      const state = commandAvailability(c, game, selectedBuilding);
      if (state.disabled) {
        blockedFeedback(btn);
        showTip(entry.tip, btn, state.reason);
        return;
      }
      if (refund !== null) suppressReadiness();
      c.on();
      hideTip();
    });
    const tipHandler = () => showCommandTip(entry, game, selectedBuilding);
    btn.addEventListener('mouseenter', tipHandler);
    btn.addEventListener('focus', tipHandler);
    btn.addEventListener('pointerdown', (event) => {
      if (event && event.pointerType === 'touch') tipHandler();
    });
    btn.addEventListener('mouseleave', () => {
      if (!document.activeElement || document.activeElement !== btn) hideTip();
    });
    btn.addEventListener('blur', hideTip);
    els.cmdGrid.appendChild(btn);
    dyn.cmds.push(entry);
  }
}

function setAttr(el, name, value) {
  const text = String(value);
  if (el.getAttribute && el.getAttribute(name) === text) return;
  if (el.setAttribute) el.setAttribute(name, text);
  else el[name] = text;
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function percentOf(value) { return Math.round(clamp01(value) * 100); }

function progressOf(remaining, total) {
  const left = Number(remaining), full = Number(total);
  return Number.isFinite(left) && Number.isFinite(full) && full > 0
    ? clamp01(1 - left / full) : null;
}

function etaOf(remaining) {
  const left = Number(remaining);
  return Number.isFinite(left) && left > 0
    ? t('ui.process.eta', { n: fmtNum(Math.ceil(left)) }) : '';
}

function buildingProcessModel(b) {
  const buildingName = fname(b.cfg, b.faction);
  if (!b.done) {
    const progress = clamp01(b.progress);
    return {
      kind: 'construction', identity: 'construction', tone: 'amber',
      phase: t('ui.process.construction'), title: buildingName,
      progress, eta: '', meta: t('ui.process.progress', { n: fmtNum(percentOf(progress)) }), waiting: false,
    };
  }
  if (b.res) {
    const upgrade = UPGRADES[b.res.key];
    const progress = progressOf(b.res.t, b.res.total);
    return {
      kind: 'research', identity: 'research:' + b.res.key, tone: 'amber',
      phase: t('ui.process.research'),
      title: t('ui.process.researchTitle', { name: fname(upgrade, b.faction), lvl: fmtNum(b.res.lvl) }),
      progress, eta: etaOf(b.res.t),
      meta: progress === null ? '' : t('ui.process.progress', { n: fmtNum(percentOf(progress)) }), waiting: false,
    };
  }
  if (b.gradeUp) {
    const to = Number(b.gradeUp.to) || 2;
    const progress = progressOf(b.gradeUp.t, b.gradeUp.total);
    return {
      kind: 'grade', identity: 'grade:' + to, tone: 'amber',
      phase: t('ui.process.grade'),
      title: t('ui.process.gradeTitle', {
        name: buildingName, from: GRADE_ROMAN[to - 1] || '', to: GRADE_ROMAN[to] || '',
      }),
      progress, eta: etaOf(b.gradeUp.t),
      meta: progress === null ? '' : t('ui.process.progress', { n: fmtNum(percentOf(progress)) }), waiting: false,
    };
  }
  if (b.queue && b.queue.length) {
    const item = b.queue[0];
    const unit = UNITS[item.type];
    const remaining = Number(item.t);
    const progress = progressOf(item.t, item.total);
    const held = !!item.hold;
    const waitingExit = !held && Number.isFinite(remaining) && remaining <= 0;
    return {
      kind: 'production', identity: 'production:' + item.type, tone: 'cyan',
      phase: t('ui.process.production'), title: fname(unit, b.faction), progress,
      eta: held || waitingExit ? '' : etaOf(item.t),
      meta: held ? t('ui.process.waitingSupply') : waitingExit ? t('ui.process.waitingExit')
        : progress === null ? '' : t('ui.process.progress', { n: fmtNum(percentOf(progress)) }),
      waiting: held || waitingExit,
    };
  }
  if (b.cfg.garrisonCap) {
    const cap = gradeGar(b.type, b.level || 1, b.cfg.garrisonCap);
    return {
      kind: 'garrison', identity: null, tone: 'cyan',
      phase: t('ui.process.garrison'),
      title: t('ui.process.garrisonCount', { n: fmtNum((b.garrison || []).length), cap: fmtNum(cap) }),
      progress: null, eta: '', meta: '', waiting: false,
    };
  }
  if (b.cfg.produces) {
    return {
      kind: 'idle', identity: null, tone: 'cyan',
      phase: t('ui.process.standby'), title: t('ui.process.awaitingOrders'),
      progress: null, eta: '', meta: '', waiting: false,
    };
  }
  if (b.cfg.attack) {
    return {
      kind: 'post', identity: null, tone: 'cyan',
      phase: t('ui.process.defense'), title: t('ui.process.onPost'),
      progress: null, eta: '', meta: '', waiting: false,
    };
  }
  return {
    kind: 'idle', identity: null, tone: 'cyan',
    phase: t('ui.process.readyState'), title: t('ui.process.online'),
    progress: null, eta: '', meta: '', waiting: false,
  };
}

function buildProcessCard() {
  const card = document.createElement('div');
  card.className = 'process-card';
  const head = document.createElement('div');
  head.className = 'process-head';
  const left = document.createElement('div');
  left.className = 'process-head-copy';
  const kicker = document.createElement('div');
  kicker.className = 'process-kicker';
  kicker.textContent = t('ui.process.heading');
  left.appendChild(kicker);
  const phase = document.createElement('div');
  phase.className = 'process-phase';
  left.appendChild(phase);
  const eta = document.createElement('div');
  eta.className = 'process-eta';
  head.appendChild(left);
  head.appendChild(eta);
  card.appendChild(head);
  const title = document.createElement('div');
  title.className = 'process-title';
  card.appendChild(title);
  const track = document.createElement('div');
  track.className = 'process-track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('div');
  fill.className = 'process-fill';
  track.appendChild(fill);
  card.appendChild(track);
  const meta = document.createElement('div');
  meta.className = 'process-meta';
  card.appendChild(meta);
  dyn.processCard = card;
  dyn.processPhase = phase;
  dyn.processTitle = title;
  dyn.processEta = eta;
  dyn.processTrack = track;
  dyn.processFill = fill;
  dyn.processMeta = meta;
  return card;
}

function refundForCommand(command, building) {
  if (!building || command.code !== 'KeyX') return null;
  if (building.gradeUp) {
    const grade = GRADES[building.type] && GRADES[building.type][building.gradeUp.to];
    return grade ? grade.cost : null;
  }
  if (building.res) {
    const upgrade = UPGRADES[building.res.key];
    return upgrade ? upgrade.costs[building.res.lvl - 1] : null;
  }
  return null;
}

function producedUnitForCommand(command, building) {
  if (!building || !building.cfg.produces) return null;
  let key = String(command.icon || '');
  if (key.startsWith('a_')) key = key.slice(2);
  const produces = Array.isArray(building.cfg.produces) ? building.cfg.produces : [building.cfg.produces];
  return UNITS[key] && produces.includes(key) ? key : null;
}

function commandAvailability(command, game, building) {
  const st = game.state;
  const faction = st.factions.player;
  if (st.gameOver) return { disabled: true, reason: t('ui.cmds.gameOver') };

  const unitType = producedUnitForCommand(command, building);
  if (unitType && building.queue.length >= gradeQueue(building.type, building.level || 1)) {
    return { disabled: true, reason: t('ui.cmds.queueFull') };
  }

  const lines = command.tip && Array.isArray(command.tip.lines) ? command.tip.lines : [];
  const gradeLock = message('needCC2', faction);
  if (lines.includes(gradeLock)) return { disabled: true, reason: gradeLock };

  if (building && building.cfg.research && building.res && String(command.icon || '').startsWith('u_')) {
    return { disabled: true, reason: message('labBusy', faction) };
  }

  if (command.enabled && !command.enabled()) {
    const cost = Number(command.cost);
    const minerals = Number(st.minerals.player) || 0;
    if (Number.isFinite(cost) && cost > minerals) {
      const missing = fmtNum(Math.ceil(cost - minerals));
      const key = faction === 'alien' ? 'shortageAlien' : 'shortageHuman';
      return { disabled: true, reason: t('ui.cmds.' + key, { n: missing }) };
    }
    return { disabled: true, reason: t('ui.cmds.unavailable') };
  }
  return { disabled: false, reason: '' };
}

function commandTooltip(command, refund) {
  const source = command.tip || {};
  const lines = Array.isArray(source.lines) ? source.lines.slice() : (source.lines ? [source.lines] : []);
  if (refund !== null) {
    const line = t('ui.process.refundLabel', { n: fmtNum(refund) });
    if (!lines.includes(line)) lines.push(line);
  }
  return {
    title: source.title || command.label,
    cost: source.cost !== undefined ? source.cost : (refund !== null
      ? t('ui.process.refundShort', { n: fmtNum(refund) }) : ''),
    desc: source.desc || '', lines,
  };
}

function showCommandTip(entry, game, building) {
  const state = commandAvailability(entry.cmd, game, building);
  showTip(entry.tip, entry.el, state.disabled ? state.reason : '');
}

function buildQueueButton(game, building, item, index) {
  const unit = UNITS[item.type];
  const name = fname(unit, building.faction);
  const refund = unit.cost;
  const refundShort = t('ui.process.refundShort', { n: fmtNum(refund) });
  const refundLine = t('ui.process.refundLabel', { n: fmtNum(refund) });
  const label = t('ui.process.queueCancelLabel', { name, n: fmtNum(refund) });
  const tip = { title: name, cost: refundShort, lines: [refundLine] };
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.title = label;
  chip.setAttribute('aria-label', label);
  chip.setAttribute('aria-describedby', 'cmd-tip');
  chip.appendChild(iconEl(building.faction === 'alien' ? 'a_' + item.type : item.type));
  const refundEl = document.createElement('span');
  refundEl.className = 'chip-refund';
  refundEl.textContent = refundShort;
  chip.appendChild(refundEl);

  let progress = null, timer = null;
  if (index === 0 && buildingProcessModel(building).kind !== 'production') {
    progress = document.createElement('div');
    progress.className = 'chip-progress';
    chip.appendChild(progress);
    timer = document.createElement('span');
    timer.className = 'chip-time';
    chip.appendChild(timer);
  }
  const entry = { el: chip, item, index, label, tip, progress, timer };
  const show = () => showTip(tip, chip, game.state.gameOver ? t('ui.cmds.gameOver') : '');
  chip.addEventListener('mouseenter', show);
  chip.addEventListener('focus', show);
  chip.addEventListener('pointerdown', (event) => {
    if (event && event.pointerType === 'touch') show();
  });
  chip.addEventListener('mouseleave', () => {
    if (!document.activeElement || document.activeElement !== chip) hideTip();
  });
  chip.addEventListener('blur', hideTip);
  chip.addEventListener('click', () => {
    if (game.state.gameOver) {
      blockedFeedback(chip);
      showTip(tip, chip, t('ui.cmds.gameOver'));
      return;
    }
    suppressReadiness();
    game.hooks.cancelQueue(building, index);
    hideTip();
  });
  dyn.queueButtons.push(entry);
  return chip;
}

function blockedFeedback(button) {
  button.classList.remove('blocked-feedback');
  // Restart a single short animation when the same unavailable command is tapped twice.
  void button.offsetWidth;
  button.classList.add('blocked-feedback');
  clearTimeout(button._blockedFeedbackTimer);
  button._blockedFeedbackTimer = setTimeout(() => button.classList.remove('blocked-feedback'), 280);
}

function suppressReadiness() {
  if (dyn) dyn.processReadySuppressed = true;
}

// ------------------------------------------------------------
// Тултип кнопки панели: имя, цена, описание и статы.
// ------------------------------------------------------------
let tipEl = null;
// Б1: ленивое создание #cmd-tip — общее для кнопочных тултипов и кристалла.
function ensureTipEl() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'cmd-tip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
function showTip(tip, btn, reason = '') {
  ensureTipEl();
  // Переведённые строки — только через DOM (никаких innerHTML).
  tipEl.textContent = '';
  const title = document.createElement('div');
  title.className = 'tip-title';
  title.appendChild(document.createTextNode(tip.title || ''));
  const cost = document.createElement('span');
  cost.className = 'tip-cost';
  cost.textContent = typeof tip.cost === 'number' ? fmtNum(tip.cost) : (tip.cost || '');
  title.appendChild(cost);
  tipEl.appendChild(title);
  if (tip.desc) {
    const desc = document.createElement('div');
    desc.className = 'tip-desc';
    setRich(desc, tip.desc);
    tipEl.appendChild(desc);
  }
  const lines = Array.isArray(tip.lines) ? tip.lines : (tip.lines ? [tip.lines] : []);
  for (const l of lines) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    setRich(row, l);
    tipEl.appendChild(row);
  }
  if (reason && !lines.includes(reason)) {
    const row = document.createElement('div');
    row.className = 'tip-row tip-reason';
    setRich(row, reason);
    tipEl.appendChild(row);
  }
  tipEl.setAttribute('aria-hidden', 'false');
  tipEl.classList.add('show');
  if (!btn || !btn.getBoundingClientRect) return;
  const rect = btn.getBoundingClientRect();
  const vw = Math.max(240, Number(window.innerWidth) || 320);
  const vh = Math.max(160, Number(window.innerHeight) || 240);
  const width = Math.min(tipEl.offsetWidth || 300, vw - 16);
  const left = Math.max(8, Math.min(vw - width - 8, rect.left + rect.width / 2 - width / 2));
  const height = tipEl.offsetHeight || 120;
  const above = rect.top - height - 8;
  const below = rect.bottom + 8;
  const top = above >= 8 ? above : Math.max(8, Math.min(vh - height - 8, below));
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}
function hideTip() {
  if (!tipEl) return;
  tipEl.classList.remove('show');
  tipEl.setAttribute('aria-hidden', 'true');
}

// F.1: тултип в точке экрана (для остатков кристалла) — безопасно: setRich.
function tipAt(text, x, y) {
  ensureTipEl(); // Б1: работает и до первого наведения на кнопку
  setRich(tipEl, text);
  setAttr(tipEl, 'aria-hidden', 'false');
  tipEl.classList.add('show');
  const vw = Math.max(240, Number(window.innerWidth) || 320);
  const vh = Math.max(160, Number(window.innerHeight) || 240);
  const width = Math.min(tipEl.offsetWidth || 300, vw - 16);
  const height = tipEl.offsetHeight || 120;
  tipEl.style.left = Math.max(8, Math.min(vw - width - 8, x + 14)) + 'px';
  tipEl.style.top = Math.max(8, Math.min(vh - height - 8, y - 10)) + 'px';
}

// F.1: яркость точки миникарты по доле остатка (0.25 пустой → 1.0 полный).
export function mineralDotAlpha(c) {
  return c.max > 0 ? 0.25 + 0.75 * (c.amount / c.max) : 0.25;
}

// F.1: остатки кристалла под курсором + сумма месторождения.
export function updateCrystalTip(game, wx, wy) {
  const st = game.state;
  if (!st || st.over || !st.map) return; // Б1: у Game нет els — старый гард гасил всё
  const c = crystalAt(st, wx, wy);
  if (!c || c.amount <= 0) { hideTip(); return; }
  let sum = 0;
  for (const k of st.map.crystals) {
    if (k.amount > 0 && k.fieldId === c.fieldId && k.fieldId !== 0) sum += k.amount;
  }
  if (!sum) sum = c.amount;
  const mx = (game.mouse && game.mouse.x) || 0, my = (game.mouse && game.mouse.y) || 0;
  tipAt(t('ui.hints.ergTip', { n: c.amount, max: c.max, sum }), mx, my);
}

function refreshDynamic(game, sel) {
  if (!dyn) return;
  const st = game.state;
  const first = sel[0];
  const selectedBuilding = sel.length === 1 && first.kind === 'building' ? first : null;

  for (const entry of dyn.cmds) {
    const state = commandAvailability(entry.cmd, game, selectedBuilding);
    entry.el.classList.toggle('disabled', state.disabled);
    setAttr(entry.el, 'aria-disabled', state.disabled ? 'true' : 'false');
    setAttr(entry.el, 'aria-label', state.reason
      ? t('ui.cmds.disabledLabel', { label: entry.cmd.label, reason: state.reason }) : entry.cmd.label);
    entry.disabledReason = state.reason;
  }
  for (const entry of dyn.queueButtons) {
    const disabled = !!st.gameOver;
    entry.el.classList.toggle('disabled', disabled);
    setAttr(entry.el, 'aria-disabled', disabled ? 'true' : 'false');
    setAttr(entry.el, 'aria-label', disabled
      ? t('ui.cmds.disabledLabel', { label: entry.label, reason: t('ui.cmds.gameOver') }) : entry.label);
    if (entry.progress && selectedBuilding) {
      const item = selectedBuilding.queue[entry.index];
      if (item) {
        const frac = progressOf(item.t, item.total);
        entry.progress.style.width = (frac === null ? 0 : percentOf(frac)) + '%';
      }
    }
    if (entry.timer && selectedBuilding) {
      const item = selectedBuilding.queue[entry.index];
      if (item) {
        const waiting = !!item.hold || !(Number(item.t) > 0);
        entry.timer.textContent = waiting ? t('ui.states.waiting')
          : t('ui.states.sec', { n: fmtNum(Math.ceil(item.t)) });
        entry.timer.classList.toggle('hold', waiting);
      }
    }
  }

  if (!first) return;
  if (dyn.hpFill) {
    const f = Math.max(0, first.hp / first.maxHp);
    dyn.hpFill.style.width = (f * 100) + '%';
    dyn.hpFill.classList.toggle('warn', f <= 0.55 && f > 0.28);
    dyn.hpFill.classList.toggle('crit', f <= 0.28);
  }
  if (first.kind === 'building') {
    const status = buildingStatus(first);
    if (dyn.buildingLed) dyn.buildingLed.className = 'led ' + status.led;
    if (dyn.buildingText && dyn.buildingText.textContent !== status.text) dyn.buildingText.textContent = status.text;
    if (dyn.hpStats) dyn.hpStats.textContent = t('ui.hints.hpLine', { hp: Math.ceil(first.hp), max: first.maxHp });
    if (dyn.garrisonHint && first.cfg.garrisonCap) {
      dyn.garrisonHint.textContent = t('ui.hints.garrisonHint', {
        n: first.garrison.length, cap: gradeGar(first.type, first.level || 1, first.cfg.garrisonCap),
      });
    }
    if (dyn.processCard) updateProcessCard(first);
  }

  // Статус приказа юнита — живой, каждый кадр (приказы меняются часто).
  if (dyn.unitText && first.kind === 'unit') {
    const ORDL = {
      idle: ['idle', 'ui.states.idle'], move: ['work', 'ui.states.move'],
      attack: ['err', 'ui.states.attack'], attackMove: ['err', 'ui.states.attackMove'],
      gather: ['warn', 'ui.states.gather'], build: ['warn', 'ui.states.build'],
      repair: ['ok', 'ui.states.repair'], garrison: ['work', 'ui.states.garrison'],
      heal: ['ok', 'ui.states.heal'],
    };
    let led, text;
    if (first.idleReason === 'unreachable') {
      led = 'err blink'; text = t('ui.states.blocked');
    } else {
      const order = (first.order && ORDL[first.order.kind]) || ORDL.idle;
      led = order[0]; text = t(order[1]);
      if (sel.length > 1) text += t('ui.states.squad', { n: sel.length });
    }
    dyn.unitLed.className = 'led ' + led;
    if (dyn.unitText.textContent !== text) dyn.unitText.textContent = text;
  }
}

function updateProcessCard(building) {
  const model = buildingProcessModel(building);
  const previous = dyn.processIdentity;
  const becameReady = !!previous && !model.identity;
  if (becameReady && !dyn.processReadySuppressed) pulseReady(dyn.processCard);
  dyn.processReadySuppressed = false;
  dyn.processIdentity = model.identity;

  dyn.processCard.dataset.kind = model.kind;
  dyn.processCard.classList.toggle('waiting', model.waiting);
  dyn.processCard.classList.toggle('under-fire', building.flashT > 0);
  dyn.processPhase.textContent = model.phase;
  dyn.processTitle.textContent = model.title;
  dyn.processEta.textContent = model.eta;
  dyn.processMeta.textContent = model.meta;
  const hasProgress = model.progress !== null;
  dyn.processTrack.style.display = hasProgress ? '' : 'none';
  setAttr(dyn.processTrack, 'aria-hidden', hasProgress ? 'false' : 'true');
  if (hasProgress) {
    const percent = percentOf(model.progress);
    dyn.processFill.style.width = percent + '%';
    dyn.processFill.className = 'process-fill ' + model.tone;
    setAttr(dyn.processTrack, 'aria-valuenow', percent);
    setAttr(dyn.processTrack, 'aria-valuetext', model.meta || model.eta);
  }
}

function pulseReady(card) {
  if (!card) return;
  card.classList.remove('ready-pulse');
  void card.offsetWidth;
  card.classList.add('ready-pulse');
  clearTimeout(dyn.readyTimer);
  dyn.readyTimer = setTimeout(() => card.classList.remove('ready-pulse'), 300);
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

// Строка статуса со светодиодом (язык состояний ДС).
function statusLine(led, text) {
  const d = document.createElement('div');
  d.className = 'status-line';
  const l = document.createElement('span');
  l.className = 'led ' + led;
  d.appendChild(l);
  const t = document.createElement('span');
  t.textContent = text;
  d.appendChild(t);
  return { el: d, led: l, text: t };
}

// Состояние здания обновляется без перестройки карточки.
function buildingStatus(b) {
  if (!b.done) return { led: 'warn blink', text: t('ui.buildingState.wip', { p: percentOf(b.progress) }) };
  if (b.flashT > 0) return { led: 'err blink', text: t('ui.buildingState.underFire') };
  if (b.res) return { led: 'work', text: t('ui.buildingState.researching', { name: fname(UPGRADES[b.res.key], b.faction) }) };
  if (b.gradeUp) return { led: 'work', text: t('ui.buildingState.grading', { to: GRADE_ROMAN[b.gradeUp.to] || '' }) };
  if (b.queue && b.queue.length) {
    if (b.queue[0].hold) return { led: 'warn', text: t('ui.buildingState.prodWait') };
    if (!(Number(b.queue[0].t) > 0)) return { led: 'warn', text: t('ui.buildingState.prodExit') };
    return { led: 'ok', text: t('ui.buildingState.producing', { name: fname(UNITS[b.queue[0].type], b.faction) }) };
  }
  if (b.cfg.garrisonCap) {
    const count = (b.garrison || []).length;
    const cap = gradeGar(b.type, b.level || 1, b.cfg.garrisonCap);
    return { led: count ? 'ok' : 'work', text: t('ui.buildingState.garrison', { n: count, c: cap }) };
  }
  if (b.cfg.produces) return { led: 'warn', text: t('ui.buildingState.idleOrder') };
  if (b.cfg.attack) return { led: 'ok', text: t('ui.buildingState.onPost') };
  return { led: 'work', text: t('ui.buildingState.active') };
}

function infoStats(box, b) {
  const s = document.createElement('div');
  s.className = 'small hp-stats';
  s.textContent = t('ui.hints.hpLine', { hp: Math.ceil(b.hp), max: b.maxHp });
  box.appendChild(s);
  dyn.hpStats = s;
}

// ------------------------------------------------------------
// I: смена языка без перезагрузки — перерисовываем статические
// экраны и открытые оверлеи; состояние партии не трогаем
// (динамические строки панели/тостов перечитываются из t() сами).
// ------------------------------------------------------------
let uiGame = null; // ручка для refreshLocale (ставится в initUI)
export function refreshLocale() {
  if (!els) return;
  applyStaticDOM(); // Маркеры index.html (меню, экраны, кнопки).
  updateCampaignStartLabel();
  renderQuickBattleMenu();
  if (uiGame) {
    setPausedUI(!!uiGame.paused);
    if (uiGame.sound) setSoundUI(!!uiGame.sound.muted);
    applyPanelClass();
    resetPanel(); // панель команд пересоберётся на следующем кадре
    if (!els.missionOverlay.classList.contains('hidden')) showMissions(uiGame);
    if (!els.briefOverlay.classList.contains('hidden') && pendingMission) showBrief(uiGame, pendingMission);
    if (!els.codexOverlay.classList.contains('hidden')) showCodex();
  }
}

// ------------------------------------------------------------
// Миникарта: террейн-кэш + точки сущностей + туман + рамка камеры.
// ------------------------------------------------------------
// G.6: превращение миникарты — ВСЯ карта вписывается в квадрат канваса
// с сохранением пропорций (letterbox): k = min(S/pxW, S/pxH), карта
// центрируется смещением (ox, oy). Неквадратные карты (G.5: wide/tall)
// больше не срезаются снизу и не растягиваются; край карты виден рамкой.
// Одно и то же преобразование используют рендер (drawMinimap) и клики
// (mmWorld) — превью и ввод всегда согласованы.
export function minimapView(map) {
  const pxW = (map && map.pxW) || WORLD_W;
  const pxH = (map && map.pxH) || WORLD_H;
  const S = 176; // bitmap #minimap (index.html)
  const k = Math.min(S / pxW, S / pxH);
  return { S, k, ox: (S - pxW * k) / 2, oy: (S - pxH * k) / 2 };
}

export function drawMinimap(game) {
  const st = game.state;
  if (!st || !els) return;
  const g = els.minimap.getContext('2d');
  const { S, k, ox, oy } = minimapView(st.map);
  const mw = st.map.pxW * k, mh = st.map.pxH * k;
  g.imageSmoothingEnabled = false;
  // Поля за краем карты (letterbox) — глухой тёмный фон.
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#0a161c';
  g.fillRect(0, 0, S, S);
  g.drawImage(st.map.miniCanvas, ox, oy, mw, mh);

  // Кристаллы (только разведанные). F.1: яркость — по доле остатка.
  for (const c of st.map.crystals) {
    if (c.amount <= 0 || !st.fog.tileExplored(c.tx, c.ty)) continue;
    g.globalAlpha = mineralDotAlpha(c);
    g.fillStyle = COLORS.mineral;
    g.fillRect(ox + c.tx * TILE * k, oy + c.ty * TILE * k, 3, 3);
  }
  g.globalAlpha = 1;
  // Здания.
  for (const b of st.buildings) {
    if (b.dead) continue;
    if (b.side === 'enemy' && !b.spotted) continue;
    g.fillStyle = b.side === 'player' ? '#76e3d7' : '#ff806e';
    g.fillRect(ox + b.tx * TILE * k, oy + b.ty * TILE * k, Math.max(4, b.w * TILE * k), Math.max(3, b.h * TILE * k));
  }
  // Юниты (враги — только видимые).
  for (const u of st.units) {
    if (u.dead || u.garrison) continue;
    if (u.side === 'enemy' && !u.visible) continue;
    g.fillStyle = u.side === 'player' ? '#c5fff1' : '#ffd0b5';
    g.fillRect(ox + u.x * k - 1.5, oy + u.y * k - 1.5, 3, 3);
  }
  // Туман войны.
  if (st.fog.dirty) st.fog.paint();
  g.imageSmoothingEnabled = false;
  g.drawImage(st.fog.canvas, 0, 0, st.fog.w, st.fog.h, ox, oy, mw, mh);
  // G.6: край карты — тонкая рамка по границе: на letterbox-полях и при
  // любом размере карты видно, где мир кончается.
  g.strokeStyle = 'rgba(118,227,215,0.5)';
  g.lineWidth = 1;
  g.strokeRect(ox - 0.5, oy - 0.5, mw + 1, mh + 1);
  // Рамка обзора камеры.
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  // G.2: рамка — видимая область (за вычетом панели), а не весь канвас.
  // G.6: кламп в прямоугольник карты — за краем мира рамки не рисуем.
  const vz = st.camera.z || 1;
  const rx = st.camera.x + (game.uiLeft || 0) / vz;
  const ry = st.camera.y + (game.uiTop || 0) / vz;
  const x0 = Math.max(rx, 0), y0 = Math.max(ry, 0);
  const x1 = Math.min(rx + game.visW(), st.map.pxW), y1 = Math.min(ry + game.visH(), st.map.pxH);
  if (x1 > x0 && y1 > y0) g.strokeRect(ox + x0 * k, oy + y0 * k, (x1 - x0) * k, (y1 - y0) * k);
  // M0: ключевая цель — янтарный ромб (если здание разведано).
  for (const b of st.buildings) {
    if (b.dead || !b.keyTarget || (b.side === 'enemy' && !b.spotted)) continue;
    const dx = ox + (b.tx + b.w / 2) * TILE * k, dy = oy + (b.ty + b.h / 2) * TILE * k;
    g.fillStyle = '#f3c579';
    g.beginPath();
    g.moveTo(dx, dy - 4); g.lineTo(dx + 4, dy);
    g.lineTo(dx, dy + 4); g.lineTo(dx - 4, dy);
    g.closePath(); g.fill();
  }
  // M0: зона эвакуации — кольцо (своя земля, видна всегда).
  if (st.win && st.win.kind === 'evac') {
    const w = st.win;
    g.strokeStyle = '#8ff5e2';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(ox + (w.x + 0.5) * TILE * k, oy + (w.y + 0.5) * TILE * k, Math.max(3, w.r * TILE * k), 0, Math.PI * 2);
    g.stroke();
  }
  // Пинги тревоги.
  for (const p of st.pings) {
    const a = 1 - p.t / 2.5;
    g.strokeStyle = `rgba(255,128,110,${a})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(ox + p.x * k, oy + p.y * k, 4 + p.t * 10, 0, Math.PI * 2);
    g.stroke();
  }
}
