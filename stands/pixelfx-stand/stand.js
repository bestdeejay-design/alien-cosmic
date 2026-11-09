// Ресерч-стенд patch-gg/pixelfx для Alien Cosmic (координатор, 09.11.2026).
// Вендор: core/ + fx/ — оригинальные модули MIT, импорты нетронуты.
import { createFrame, clearFrame, createFx, composite } from "./core/index.js";

// --- Палитры «Рубежа 64» из js/config.js игры ---
const MODES = [
  {
    id: "asis", label: "Как есть", bg: "#141219", ramp: null,
    hint: "родные палитры библиотеки",
  },
  {
    id: "helios", label: "Гелиос · бирюза", bg: "#472b1b", ramp: [
      "#0a2830", "#123a44", "#245e68", "#2f8a94", "#4fb8b0", "#76e3d7", "#c5fff1", "#ffffff",
    ],
    hint: "свои: player/playerDark/playerBright, фон Актан-4",
  },
  {
    id: "kharid", label: "Кхарид · коралл", bg: "#2e1e4e", ramp: [
      "#3a1220", "#713943", "#a3503f", "#ff806e", "#ffa38a", "#ffd0b5", "#fff0e0", "#ffffff",
    ],
    hint: "враг: enemy/enemyDark/enemyBright, фон Брок-Тхаал",
  },
];

const CATS = [
  { id: "combat", label: "Бой" },
  { id: "kharid", label: "Кхарид" },
  { id: "infra", label: "База и шаттлы" },
  { id: "econ", label: "Экономика и UI" },
  { id: "ambient", label: "Атмосфера и переходы" },
];

// --- Отбор под наши нужды (путь = файл в fx/) ---
const ITEMS = [
  { path: "explosions/plasma-explosion", cat: "combat", title: "Плазменный взрыв", note: "гибель цели под турелью" },
  { path: "explosions/small-explosion", cat: "combat", title: "Малый подрыв", note: "гибель юнита / строения Г1" },
  { path: "explosions/barrel-explosion", cat: "combat", title: "Детонация склада", note: "вторичные взрывы" },
  { path: "projectiles/laser-bolt", cat: "combat", title: "Лазерный болт", note: "выстрел турели «Рубежа»" },
  { path: "projectiles/plasma-shot", cat: "combat", title: "Плазма-выстрел", note: "тяжёлая турель / мортира" },
  { path: "impacts/bullet-impact", cat: "combat", title: "Попадание", note: "эффект по цели" },
  { path: "impacts/crit-hit", cat: "combat", title: "Крит", note: "крит командира (Dead Cells freeze/shake)" },
  { path: "impacts/hit-spark", cat: "combat", title: "Искра удара", note: "ближний удар юнитов" },
  { path: "lightning/chain-lightning", cat: "combat", title: "Цепная молния", note: "турель по группам" },
  { path: "lightning/plasma-ball", cat: "combat", title: "Плазмоид", note: "снаряд/сущность" },
  { path: "fire/fireball", cat: "combat", title: "Огненный шар", note: "метательная атака" },
  { path: "ice/frost-nova", cat: "combat", title: "Морозная нова", note: "зонная заморозка" },
  { path: "nature/acid-splash", cat: "kharid", title: "Кислотный плевок", note: "Кислотник" },
  { path: "nature/poison-cloud", cat: "kharid", title: "Облако яда", note: "зона кхарид" },
  { path: "nature/spore-burst", cat: "kharid", title: "Споры", note: "Матка / кокон" },
  { path: "nature/earth-spike", cat: "kharid", title: "Шипы из земли", note: "выросты Нор" },
  { path: "spawn/spawn-portal", cat: "kharid", title: "Портал появления", note: "выход из Нор" },
  { path: "spawn/disintegrate", cat: "kharid", title: "Развоплощение", note: "смерть кхарида (манекен)" },
  { path: "scifi/teleporter-pad", cat: "infra", title: "Телепад", note: "высадка экспедиции" },
  { path: "scifi/energy-core", cat: "infra", title: "Ядро", note: "пульс КЦ" },
  { path: "scifi/force-field", cat: "infra", title: "Силовое поле", note: "щит бункера" },
  { path: "scifi/jetpack", cat: "infra", title: "Реактивный поток", note: "факелы шаттла" },
  { path: "scifi/warp-in", cat: "infra", title: "Варп-вход", note: "прибытие юнита" },
  { path: "scifi/warp-out", cat: "infra", title: "Варп-выход", note: "эвакуация шаттла" },
  { path: "scifi/emp-blast", cat: "infra", title: "ЭМИ", note: "выключение систем" },
  { path: "scifi/hologram", cat: "infra", title: "Голограмма", note: "проекция / стенды" },
  { path: "spawn/poof", cat: "infra", title: "Пуф", note: "выход юнита из казармы" },
  { path: "pickups/crystal-shard", cat: "econ", title: "Кристалл", note: "кристаллы эрга" },
  { path: "pickups/collect-burst", cat: "econ", title: "Сбор", note: "сбор эрга/минералов" },
  { path: "pickups/xp-orb", cat: "econ", title: "Сферы XP", note: "опыт командира" },
  { path: "ui/level-up", cat: "econ", title: "Уровень!", note: "грейд КЦ / командира" },
  { path: "ui/achievement", cat: "econ", title: "Достижение", note: "плашка ачивки" },
  { path: "ui/crit-number", cat: "econ", title: "Цифра крита", note: "урон числом" },
  { path: "status/burning", cat: "ambient", title: "Горение", note: "статус после турели" },
  { path: "status/frozen", cat: "ambient", title: "Заморозка", note: "статус" },
  { path: "weather/fireflies", cat: "ambient", title: "Светлячки", note: "амбиент планеты" },
  { path: "weather/fog", cat: "ambient", title: "Туман", note: "аналогия тумана войны" },
  { path: "transitions/iris", cat: "ambient", title: "Ирис-переход", note: "вход в рейд" },
  { path: "transitions/glitch-wipe", cat: "ambient", title: "Глитч-переход", note: "смена сезона / СЗ" },
];

// --- Цвет фона в формат composite: 0xAABBGGRR ---
function packBg(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const RESTART_PAUSE = 1.5;   // пауза после он-шота, с
const grid = document.getElementById("grid");
const state = { mode: MODES[0], cat: "all", cells: [] };
window.__PF = state; // дебаг стенда

function buildCell(item, index) {
  const fig = document.createElement("figure");
  fig.className = "cell";
  fig.dataset.cat = item.cat;
  const canvas = document.createElement("canvas");
  const cap = document.createElement("figcaption");
  fig.append(canvas, cap);
  grid.append(fig);

  const cell = { item, fig, canvas, ctx: null, mod: null, meta: null, frame: null, img: null, fx: null, t: -index * 0.22, seed: null, active: true };
  fig._cell = cell;

  cell.launch = async () => {
    try {
      cell.mod = await import(`./fx/${item.path}.js`);
      cell.meta = cell.mod.meta;
      canvas.width = cell.meta.size[0];
      canvas.height = cell.meta.size[1];
      canvas.title = `${item.title} — тап: повтор`;
      cell.ctx = canvas.getContext("2d");
      cell.frame = createFrame(canvas.width, canvas.height);
      cell.img = new ImageData(canvas.width, canvas.height);
      const recolorable = !!(cell.meta.options && cell.meta.options.palette);
      cap.innerHTML = `
        <span class="t">${item.title}
          <span class="pal ${recolorable ? "rec" : ""}" title="${recolorable ? "палитра — опция, перекрашивается без правки кода" : "палитра зашита в код эффекта"}">${recolorable ? "перекрас ✓" : "фикс. палитра"}</span>
          <button class="dice" type="button" title="новый seed">🎲</button>
        </span>
        <span class="n">${item.note}</span>`;
      cap.querySelector(".dice").addEventListener("click", (e) => {
        e.stopPropagation();
        cell.seed = (Math.random() * 1e9) | 0;
        spawn(cell); cell.t = 0;
      });
      canvas.addEventListener("click", () => { spawn(cell); cell.t = 0; });
      spawn(cell);
      state.cells.push(cell);
    } catch (err) {
      cap.innerHTML = `<span class="t">${item.title}</span><span class="err">не загрузился: ${String(err.message || err)}</span>`;
    }
  };

  cell.launch();
  return cell;
}

// Создать инстанс эффекта под текущий режим (палитра/фон) и нарисовать «пустой» кадр.
function spawn(cell) {
  const { mod, meta } = cell;
  const o = { x: meta.origin ? meta.origin[0] : Math.floor(meta.size[0] / 2), y: meta.origin ? meta.origin[1] : Math.floor(meta.size[1] / 2) };
  if (cell.seed !== null) o.seed = cell.seed;
  if (state.mode.ramp) o.palette = state.mode.ramp;
  cell.fx = createFx(mod, o);
  drawCell(cell, 0);
}

function drawCell(cell, dt) {
  if (dt > 0) cell.fx.update(dt);
  clearFrame(cell.frame);
  cell.fx.draw(cell.frame, "back");
  cell.fx.draw(cell.frame, "front");
  composite(cell.frame, cell.img.data, packBg(state.mode.bg));
  cell.ctx.putImageData(cell.img, 0, 0);
}

// --- Управление: режимы и категории ---
const modesEl = document.getElementById("modes");
for (const m of MODES) {
  const b = document.createElement("button");
  b.textContent = m.label;
  b.title = m.hint;
  if (m === state.mode) b.classList.add("on");
  b.addEventListener("click", () => {
    state.mode = m;
    [...modesEl.children].forEach((x) => x.classList.toggle("on", x === b));
    for (const c of state.cells) { c.t = 0; spawn(c); }
  });
  modesEl.append(b);
}

const catsEl = document.getElementById("cats");
const CAT_FILTERS = [{ id: "all", label: "Все" }, ...CATS];
for (const c of CAT_FILTERS) {
  const b = document.createElement("button");
  b.textContent = c.label;
  if (c.id === "all") b.classList.add("on");
  b.addEventListener("click", () => {
    state.cat = c.id;
    [...catsEl.children].forEach((x) => x.classList.toggle("on", x === b));
    for (const fig of grid.children) {
      fig.classList.toggle("hidden", c.id !== "all" && fig.dataset.cat !== c.id);
    }
  });
  catsEl.append(b);
}

// --- Активность: анимируем только видимые клетки ---
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const cell = e.target._cell;
    if (cell) cell.active = e.isIntersecting;
  }
}, { rootMargin: "120px" });

// --- Главный цикл: rAF + interval-фолбэк (придушённый/скрытый webview не даёт rAF,
// но таймеры живут; на живой странице работает только rAF-ветка) ---
let last = performance.now(), frames = 0, fpsAt = last;
const fpsEl = document.getElementById("fps");
function step(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  for (const c of state.cells) {
    if (!c.active || !c.fx) continue;
    c.t += dt;
    if (c.t < 0) continue;
    const dur = c.meta.duration || 1;
    if (!c.meta.loop && c.t > dur + RESTART_PAUSE) { c.t = 0; spawn(c); continue; }
    drawCell(c, dt);
    frames++;
  }
  if (now - fpsAt > 1000) {
    fpsEl.textContent = `${frames} к/с`;
    frames = 0; fpsAt = now;
  }
}
function tick(now) {
  step(now);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
setInterval(() => { const now = performance.now(); if (now - last > 150) step(now); }, 120);
for (const [i, item] of ITEMS.entries()) io.observe(buildCell(item, i).fig);
