// ============================================================
// ui.js — интерфейс: главное меню (кампания / быстрый бой),
// выбор миссии с брифингами, выбор фракции, верхняя панель
// ресурсов и цели, панель команд, миникарта, тосты, экран финала.
// Весь UI — DOM поверх canvas; иконки команд рисуются кодом.
// ============================================================
import {
  TILE, UNITS, BUILDINGS, UPGRADES, WORLD_W, WORLD_H, SUPPLY_MAX, COLORS,
  fname, fdesc,
} from './config.js';
import { MISSIONS, loadProgress, resetProgress, objectiveLabel } from './missions.js';
import { CODEX, tr, codexEntryHTML } from './lore.js';
import { crystalAt } from './units.js'; // F.1: тултип кристалла

const $ = (id) => document.getElementById(id);

const FACTIONS = {
  human: { title: 'ГЕЛИОС', sub: 'Корпорация людей: техника, турели, танки', cls: 'fac-human' },
  alien: { title: 'КХАРИД', sub: 'Кристаллорождённые: рой, шипы, органика улья', cls: 'fac-alien' },
};

// ------------------------------------------------------------
// Иконки команд: маленькие canvas 26×26, рисуются один раз.
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
let pendingMission = null; // миссия, выбранная в брифинге
let pendingNext = null;    // следующая миссия после победы

export function initUI(game) {
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
    skirmishOverlay: $('skirmish-overlay'),
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
  };

  // Главное меню: сезоны. G.6: Сезон 1 → миссии, Сезон 2 — заглушка с тостом.
  $('btn-season1').addEventListener('click', () => showMissions(game));
  $('btn-season2').addEventListener('click', () => toast('Сезон 2 — сюжетные миссии. Скоро.'));
  $('btn-missions-back').addEventListener('click', () => {
    els.missionOverlay.classList.add('hidden');
    els.overlay.classList.remove('hidden');
  });
  // G.6: быстрый бой живёт внутри сезона 1 (миссии ⇄ скирмиш).
  $('btn-missions-skirmish').addEventListener('click', () => {
    els.missionOverlay.classList.add('hidden');
    els.skirmishOverlay.classList.remove('hidden');
  });
  $('btn-skirmish-back').addEventListener('click', () => {
    els.skirmishOverlay.classList.add('hidden');
    els.missionOverlay.classList.remove('hidden');
  });
  // Кодекс «Легенда».
  $('btn-codex').addEventListener('click', () => {
    els.overlay.classList.add('hidden');
    showCodex();
    els.codexOverlay.classList.remove('hidden');
  });
  $('btn-codex-back').addEventListener('click', () => {
    els.codexOverlay.classList.add('hidden');
    els.overlay.classList.remove('hidden');
  });
  // Выбор фракции в быстром бою (G.5: с пресетом размера/формы).
  const skDimsLabel = () => {
    const d = skirmishDims($('sk-size').value, $('sk-shape').value);
    $('sk-dims').textContent = d.w + '×' + d.h;
  };
  $('sk-size').addEventListener('change', skDimsLabel);
  $('sk-shape').addEventListener('change', skDimsLabel);
  skDimsLabel();
  for (const fac of ['human', 'alien']) {
    $(fac === 'human' ? 'btn-skirmish-human' : 'btn-skirmish-alien')
      .addEventListener('click', () => {
        els.skirmishOverlay.classList.add('hidden');
        game.startSkirmish(fac, skirmishDims($('sk-size').value, $('sk-shape').value));
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
  els.startBtn.textContent = 'Быстрый старт — миссия ' + (loadProgress() + 1);
  els.startBtn.addEventListener('click', () => game.startMission(MISSIONS[loadProgress()]));
  // П8: сброс прогресса — кодекс и главы закрываются сами (читают прогресс).
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Сбросить прогресс кампании? Кодекс закроется, главы Хроники скроются.')) return;
    resetProgress();
    els.startBtn.textContent = 'Быстрый старт — миссия ' + (loadProgress() + 1);
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

  // Миникарта: ЛКМ — прыжок/перетаскивание камеры, ПКМ — приказ.
  const mm = els.minimap;
  const mmWorld = (e) => {
    const r = mm.getBoundingClientRect();
    // C/П7: масштаб миникарты — от размера карты (фолбэк 64 до старта).
    const mp = (game.state && game.state.map) || { pxW: WORLD_W, pxH: WORLD_H };
    return {
      x: ((e.clientX - r.left) / r.width) * mp.pxW,
      y: ((e.clientY - r.top) / r.height) * mp.pxH,
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
// G.5: габариты скирмиша из пресета — size (строка из select — ок) длинная
// сторона, short чётная ≈ 2/3: 32/42/54/64 для 48/64/80/96.
export function skirmishDims(size, shape) {
  const n = Number(size);
  const s = [48, 64, 80, 96].includes(n) ? n : 64;
  const short = Math.round(s / 3) * 2;
  if (shape === 'wide') return { w: s, h: short };
  if (shape === 'tall') return { w: short, h: s };
  return { w: s, h: s };
}

export function showMissions(game) {
  els.overlay.classList.add('hidden');
  els.missionOverlay.classList.remove('hidden');
  const unlocked = loadProgress();
  els.missionList.innerHTML = '';
  let lastAct = null;
  // П8: бонусные главы видны только после финала (победа №14 → прогресс 15).
  // Разблокировка — по порядку массива (id бонусных идут с разрывом).
  MISSIONS.forEach((m, idx) => {
    if (m.bonus && unlocked <= 14) return;
    // Заголовок акта перед первой миссией акта.
    if (m.act !== lastAct) {
      lastAct = m.act;
      const head = document.createElement('div');
      head.className = 'act-head';
      head.textContent = m.act;
      els.missionList.appendChild(head);
    }
    const card = document.createElement('button');
    card.className = 'mission-card' + (idx > unlocked ? ' locked' : '');
    const fac = FACTIONS[m.faction];
    card.innerHTML =
      `<div class="mc-top"><span class="badge ${fac.cls}">${fac.title}</span>` +
      `<span class="mc-num">${m.bonus ? 'Глава ' + (idx - 14) : 'Миссия ' + (m.id + 1)}</span>` +
      (idx > unlocked ? '<span class="mc-lock">■ закрыто</span>' : '') + '</div>' +
      `<div class="mc-name">${m.name}</div>` +
      `<div class="mc-place">${m.place}</div>` +
      `<div class="mc-obj">${objectiveLabel(m)}</div>` +
      (m.intro ? `<div class="mc-intro">${m.intro}</div>` : '') +
      (m.defense ? '<div class="mc-def">◆ режим обороны: волны врага</div>' : '');
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
  const fac = FACTIONS[m.faction];
  els.briefBadge.textContent = 'За: ' + fac.title;
  els.briefBadge.className = 'badge ' + fac.cls;
  els.briefTitle.textContent = m.name;
  els.briefPlace.textContent = m.place;
  els.briefText.innerHTML = m.brief.map((p) => `<p>${p}</p>`).join('') +
    (m.intro ? `<p class="brief-intro">${m.intro}</p>` : '');
  els.briefObjective.textContent = 'Цель: ' + objectiveLabel(m) +
    (m.defense ? ` · подготовка ${Math.round(m.defense.prep / 60)} мин, затем ${Math.round(m.defense.total / 60)} мин обороны` : '');
  els.briefOverlay.classList.remove('hidden');
}

// Кодекс: вкладки из CODEX (lore.js), тело — абзацы вкладки.
export function showCodex() {
  els.codexTabs.innerHTML = '';
  const progress = loadProgress(); // П8: кодекс читает только прогресс кампании
  const render = (entry) => {
    els.codexBody.innerHTML = codexEntryHTML(entry, progress);
    for (const b of els.codexTabs.children) {
      b.classList.toggle('active', b.dataset.id === entry.id);
    }
  };
  for (const entry of CODEX) {
    const b = document.createElement('button');
    b.className = 'codex-tab';
    b.dataset.id = entry.id;
    b.textContent = entry.tab;
    b.addEventListener('click', () => render(entry));
    els.codexTabs.appendChild(b);
  }
  render(CODEX[0]);
}

export function hideStart() { els.overlay.classList.add('hidden'); }
export function showStart() { els.overlay.classList.remove('hidden'); }

// ------------------------------------------------------------
// Пакет E.1: положение командной панели + режим «скрыть».
// Низ (как было) / слева / справа / верх; выбор в localStorage.
// Инсеты — константы по CSS (190px высота, 236px ширина боковых).
// ------------------------------------------------------------
const PANEL_KEY = 'terranrts.panel';
const PANEL_POS = ['bottom', 'left', 'right', 'top'];
const PANEL_NAMES = { bottom: 'низ', left: 'слева', right: 'справа', top: 'верх' };
let panelPos = 'bottom', panelHidden = false;

export function getPanelPos() { return panelPos; }
export function isPanelHidden() { return panelHidden; }
export function getPanelInsets() {
  if (panelHidden) return { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    top: panelPos === 'top' ? 190 : 0,
    bottom: panelPos === 'bottom' ? 190 : 0,
    left: panelPos === 'left' ? 236 : 0,
    right: panelPos === 'right' ? 236 : 0,
  };
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
  if (els && els.panelPosBtn) els.panelPosBtn.textContent = 'Панель: ' + PANEL_NAMES[panelPos];
  if (els && els.panelShow) els.panelShow.textContent = 'Панель';
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
  els.endTitle.textContent = win ? 'Победа!' : 'Поражение';
  els.endTitle.className = win ? 'win' : 'lose';
  els.endReason.textContent = opts.reason || '';
  els.endEpilogue.textContent = win ? (opts.epilogue || '') : '';
  if (opts.campaignDone) els.endReason.textContent = 'Кампания пройдена — поля кхарид свободны!';
  els.endStats.innerHTML =
    `<div class="row"><span>Время боя</span><b>${fmtElapsed(stats.time)}</b></div>` +
    `<div class="row"><span>Уничтожено врагов</span><b>${stats.kills}</b></div>` +
    `<div class="row"><span>Потери</span><b>${stats.losses}</b></div>` +
    `<div class="row"><span>${tr(opts.faction, 'mined')}</span><b>${stats.mined}</b></div>`;
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
    '|' + (firstB ? 'Q' + firstB.queue.length + (firstB.res ? 'R' + firstB.res.key : '') +
      'G' + (firstB.gradeUp ? firstB.gradeUp.to : '') + 'L' + (firstB.level || 1) + // Б2: реакция на грейд
      'H' + Math.ceil((firstB.hp / firstB.maxHp) * 12) : '');
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
    els.selInfo.innerHTML = '<div class="hint">Клик — поставить (серия: режим не сбрасывается).<br>' +
    'Стена/турель: тяни ЛКМ — линия с ценой.<br>Стрелки — призрак, Enter — поставить.<br>ПКМ / ESC — отмена.</div>';
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
    box.appendChild(portraitEl(b.faction === 'alien' ? 'a_' + b.type : b.type));
    const name = document.createElement('div');
    name.className = 'sel-name';
    name.textContent = fname(b.cfg, b.faction) + (b.done ? '' : ' — строится');
    box.appendChild(name);
    const bst = buildingStatus(b);
    box.appendChild(statusLine(bst.led, bst.text).el);
    const hp = bar(b.hp / b.maxHp);
    box.appendChild(hp.el);
    dyn.hpFill = hp.fill;
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
    const usl = statusLine('idle', '');
    box.appendChild(usl.el);
    dyn.unitLed = usl.led; dyn.unitText = usl.text;
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
// Б1: ленивое создание #cmd-tip — общее для кнопочных тултипов и кристалла.
function ensureTipEl() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'cmd-tip';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
function showTip(tip, btn) {
  ensureTipEl();
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

// F.1: тултип в точке экрана (для остатков кристалла).
function tipAt(html, x, y) {
  ensureTipEl(); // Б1: работает и до первого наведения на кнопку
  tipEl.innerHTML = html;
  tipEl.style.left = Math.min(x + 14, window.innerWidth - 250) + 'px';
  tipEl.style.top = Math.max(y - 10, 8) + 'px';
  tipEl.classList.add('show');
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
  if (!c || c.amount <= 0) { if (tipEl) tipEl.classList.remove('show'); return; }
  let sum = 0;
  for (const k of st.map.crystals) {
    if (k.amount > 0 && k.fieldId === c.fieldId && k.fieldId !== 0) sum += k.amount;
  }
  if (!sum) sum = c.amount;
  const mx = (game.mouse && game.mouse.x) || 0, my = (game.mouse && game.mouse.y) || 0;
  tipAt('<b>Эрг ' + c.amount + '/' + c.max + '</b><br>Месторождение: ' + sum, mx, my);
}

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
    if (dyn.hpFill) {
      const f = Math.max(0, first.hp / first.maxHp);
      dyn.hpFill.style.width = (f * 100) + '%';
      dyn.hpFill.classList.toggle('warn', f <= 0.55 && f > 0.28);
      dyn.hpFill.classList.toggle('crit', f <= 0.28);
    }
    // Статус приказа юнита — живой, каждый кадр (приказы меняются часто).
    if (dyn.unitText && first.kind === 'unit') {
      const ORDL = {
        idle: ['idle', 'Ожидает'], move: ['work', 'Марш'],
        attack: ['err', 'Атака'], attackMove: ['err', 'Зачистка'],
        gather: ['warn', 'Добыча'], build: ['warn', 'Стройка'],
        repair: ['ok', 'Ремонт'], garrison: ['work', 'В гарнизон'],
        heal: ['ok', 'Лечение'],
      };
      let led, text;
      if (first.idleReason === 'unreachable') {
        led = 'err blink'; text = 'Путь закрыт!';
      } else {
        const o = (first.order && ORDL[first.order.kind]) || ORDL.idle;
        led = o[0]; text = o[1];
        if (sel.length > 1) text += ' · отряд ' + sel.length;
      }
      dyn.unitLed.className = 'led ' + led;
      if (dyn.unitText.textContent !== text) dyn.unitText.textContent = text;
    }
    if (dyn.progFill) dyn.progFill.style.width = Math.min(100, first.progress * 100) + '%';
    if (dyn.chipFill && first.kind === 'building' && first.queue.length) {
      const q = first.queue[0];
      dyn.chipFill.style.width = ((1 - q.t / q.total) * 100) + '%';
      if (dyn.timerEl) {
        dyn.timerEl.textContent = q.hold ? 'ждёт' : Math.ceil(q.t) + 'с';
        dyn.timerEl.classList.toggle('hold', !!q.hold);
      }
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

// Статус здания на момент перестройки панели (очередь/исследование/
// ранение входят в подпись — панель пересоберётся при их смене).
function buildingStatus(b) {
  if (!b.done) return { led: 'warn blink', text: 'Строится — ' + Math.round((b.progress || 0) * 100) + '%' };
  if (b.flashT > 0) return { led: 'err blink', text: 'Под огнём!' };
  if (b.res) return { led: 'work', text: 'Исследование: ' + fname(UPGRADES[b.res.key], b.faction) };
  if (b.queue && b.queue.length) {
    if (b.queue[0].hold) return { led: 'warn', text: 'Производство ждёт (нет снабжения)' };
    return { led: 'ok', text: 'Производство: ' + fname(UNITS[b.queue[0].type], b.faction) };
  }
  if (b.cfg.produces) return { led: 'warn', text: 'Ожидает приказа — очередь пуста' };
  if (b.cfg.garrisonCap) {
    return {
      led: b.garrison.length ? 'ok' : 'work',
      text: 'Гарнизон: ' + b.garrison.length + '/' + b.cfg.garrisonCap,
    };
  }
  if (b.cfg.attack) return { led: 'ok', text: 'На позиции' };
  return { led: 'work', text: 'Активно' };
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
  const k = S / st.map.pxW; // C/П7: карты квадратные — один масштаб
  g.imageSmoothingEnabled = false;
  g.drawImage(st.map.miniCanvas, 0, 0, S, S);

  // Кристаллы (только разведанные). F.1: яркость — по доле остатка.
  for (const c of st.map.crystals) {
    if (c.amount <= 0 || !st.fog.tileExplored(c.tx, c.ty)) continue;
    g.globalAlpha = mineralDotAlpha(c);
    g.fillStyle = COLORS.mineral;
    g.fillRect(c.tx * TILE * k, c.ty * TILE * k, 3, 3);
  }
  g.globalAlpha = 1;
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
  g.drawImage(st.fog.canvas, 0, 0, st.fog.w, st.fog.h, 0, 0, S, S);
  // Рамка обзора камеры.
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  // G.2: рамка — видимая область (за вычетом панели), а не весь канвас.
  const vz = st.camera.z || 1;
  g.strokeRect((st.camera.x + (game.uiLeft || 0) / vz) * k, (st.camera.y + (game.uiTop || 0) / vz) * k,
    game.visW() * k, game.visH() * k);
  // M0: ключевая цель — янтарный ромб (если здание разведано).
  for (const b of st.buildings) {
    if (b.dead || !b.keyTarget || (b.side === 'enemy' && !b.spotted)) continue;
    const dx = (b.tx + b.w / 2) * TILE * k, dy = (b.ty + b.h / 2) * TILE * k;
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
    g.arc((w.x + 0.5) * TILE * k, (w.y + 0.5) * TILE * k, Math.max(3, w.r * TILE * k), 0, Math.PI * 2);
    g.stroke();
  }
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
