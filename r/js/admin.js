// ============================================================
// admin.js — ПАНЕЛЬ АДМИНА ПОЛИГОНА (пакет Э6).
//
// Открывается командой КЦ «Админ» (канон владельца: управление живёт в
// строениях, а не в топбаре). Вход по PIN (по умолчанию 1234, меняется здесь же;
// хранится в localStorage профиля браузера — это стенд, не прод).
//
// Что умеет:
//   1) ЭКОНОМИКА: масштаб цен (?econ) — 0.02…2, применяется после перезагрузки;
//      быстрые пресеты «тест 10 минут» / «канон».
//   2) КАПСУЛЫ: список, создание, правка (название, описание, редкость, иконка,
//      период выдачи, условие с параметрами, награды с весами), удаление,
//      «Сбросить к заводским», «Опубликовать на сервер».
//   3) ИГРОКИ: топ по рейдам/добыче с сервера, ручной подарок игроку.
//   4) ДИАГНОСТИКА: живое состояние (КЦ, Дом, рейды, добыча, отсек, трюм),
//      сброс «уже забрано», профиль сейва, канал API.
//
// Модель данных и идеи развития — design/ADMIN_AND_CHESTS.md.
// ============================================================
import { t } from './i18n.js?v=10262513';
import { loadRaidConfig, saveRaidConfig, resetRaidConfig } from './home-raid.js?v=10262513';
import {
  CONDITIONS, REWARD_KINDS, RARITY, loadConfig, saveConfig, resetConfig,
  loadState, availableChests, buildContext, fetchTop, publishConfigToServer,
  pullConfigFromServer,
} from './chests.js?v=10262513';

const PIN_KEY = 'ac_admin_pin';
const ECON_KEY = 'ac_econ_scale';
const DEFAULT_PIN = '1234';
let panel = null;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export function adminPin() {
  try { return localStorage.getItem(PIN_KEY) || DEFAULT_PIN; } catch { return DEFAULT_PIN; }
}

function setAdminPin(v) {
  try { localStorage.setItem(PIN_KEY, String(v)); } catch { /* */ }
}

// ------------------------------------------------------------
// Панель
// ------------------------------------------------------------
export function openAdmin(game) {
  if (!game || !game.state) return;
  if (panel && document.body.contains(panel)) { panel.remove(); panel = null; return; }
  const entered = sessionStorage.getItem('ac_admin_ok');
  panel = document.createElement('div');
  panel.id = 'admin-overlay';
  panel.className = 'overlay';
  panel.innerHTML = `
    <div class="overlay-box adm-box" role="dialog" aria-modal="true">
      <div class="adm-head">
        <h1>ПАНЕЛЬ АДМИНА</h1>
        <div id="adm-gate" class="${entered ? 'hidden' : ''}">
          <div class="adm-row"><label>PIN</label>
            <input id="adm-pin" type="password" inputmode="numeric" maxlength="12" placeholder="1234" autocomplete="off">
            <button id="adm-login" class="adm-btn primary" type="button">Войти</button>
          </div>
          <div class="adm-hint">По умолчанию PIN <b>1234</b> (стенд). Смените его в разделе «Диагностика».</div>
        </div>
      </div>
      <div id="adm-main" class="${entered ? '' : 'hidden'}">
        <div class="adm-tabs" role="tablist">
          <button class="adm-tab is-active" data-tab="econ" type="button">Экономика</button>
          <button class="adm-tab" data-tab="chests" type="button">Капсулы</button>
          <button class="adm-tab" data-tab="raid" type="button">Оборона</button>
          <button class="adm-tab" data-tab="players" type="button">Игроки</button>
          <button class="adm-tab" data-tab="diag" type="button">Диагностика</button>
        </div>
        <div id="adm-body" class="adm-body"></div>
        <div id="adm-msg" class="adm-msg"></div>
        <div class="adm-row" style="justify-content:flex-end;margin-top:10px">
          <button id="adm-close" class="adm-btn" type="button">Закрыть</button>
        </div>
      </div>
    </div>`;
  document.body.append(panel);
  // Панель админа — модальная: игра стоит, пока её не закроют.
  if (game.state) { game.adminPausedBefore = !!game.paused; game.paused = true; }
  const $ = (s) => panel.querySelector(s);
  const msg = (text, isErr) => {
    const el = $('#adm-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'adm-msg' + (isErr ? ' err' : '');
  };

  $('#adm-close').addEventListener('click', closeAdmin);
  panel.addEventListener('click', (e) => { if (e.target === panel) closeAdmin(); });

  const login = () => {
    const v = String($('#adm-pin').value || '').trim();
    if (v !== adminPin()) { msg('Неверный PIN', true); return; }
    sessionStorage.setItem('ac_admin_ok', '1');
    $('#adm-gate').classList.add('hidden');
    $('#adm-main').classList.remove('hidden');
    render('econ');
  };
  $('#adm-login').addEventListener('click', login);
  $('#adm-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  if (entered) render('econ');

  for (const tab of panel.querySelectorAll('.adm-tab')) {
    tab.addEventListener('click', () => {
      for (const x of panel.querySelectorAll('.adm-tab')) x.classList.toggle('is-active', x === tab);
      render(tab.dataset.tab);
    });
  }

  function render(tab) {
    const body = $('#adm-body');
    if (!body) return;
    msg('');
    if (tab === 'econ') renderEcon(body);
    else if (tab === 'raid') renderRaid(body);
    else if (tab === 'chests') renderChests(body);
    else if (tab === 'players') renderPlayers(body);
    else renderDiag(body);
  }

  // ---------- Экономика ----------
  function renderEcon(body) {
    let cur = 1;
    try { cur = Number(localStorage.getItem(ECON_KEY)) || 1; } catch { cur = 1; }
    body.innerHTML = `
      <div class="adm-hint">Масштаб цен действует на ВСЮ экономику полигона (грейды, ранги, трюм).
      Применяется после перезагрузки страницы. Канон = 1.0; <b>?econ=</b> в адресе имеет приоритет.</div>
      <div class="adm-row"><label>Масштаб цен</label>
        <input id="adm-econ" type="range" min="0.02" max="2" step="0.01" value="${cur}">
        <b id="adm-econ-val">${cur.toFixed(2)}×</b>
      </div>
      <div class="adm-row">
        <button class="adm-btn" data-preset="1" type="button">Канон (1.0)</button>
        <button class="adm-btn" data-preset="0.2" type="button">Тест (0.2)</button>
        <button class="adm-btn" data-preset="0.05" type="button">Быстрый прогон (0.05)</button>
        <button class="adm-btn primary" id="adm-econ-apply" type="button">Применить и перезагрузить</button>
      </div>
      <div class="adm-hint">Ориентир: при 0.05 весь путь до КЦ-20 проходится за один вечер — удобно проверять контент.</div>`;
    const range = body.querySelector('#adm-econ');
    const val = body.querySelector('#adm-econ-val');
    range.addEventListener('input', () => { val.textContent = Number(range.value).toFixed(2) + '×'; });
    for (const b of body.querySelectorAll('[data-preset]')) {
      b.addEventListener('click', () => { range.value = b.dataset.preset; val.textContent = Number(b.dataset.preset).toFixed(2) + '×'; });
    }
    body.querySelector('#adm-econ-apply').addEventListener('click', () => {
      try { localStorage.setItem(ECON_KEY, String(Number(range.value))); } catch { /* */ }
      msg('Сохранено: ' + Number(range.value).toFixed(2) + '× — перезагружаю…');
      setTimeout(() => location.reload(), 500);
    });
  }

  // ---------- Оборона базы (Э7) ----------
  function renderRaid(body) {
    const cfg = loadRaidConfig();
    body.innerHTML = `
      <div class="adm-hint">Входящие рейды на домашнюю базу. Пока рейд не отбит, следующий не
      начинается. «Первый» — через сколько секунд после входа на базу; «Интервал» — пауза после
      отражения. Масштаб уменьшает/увеличивает волну (0.5 — вдвое легче, 2 — вдвое злее).
      Учебная тревога в карточке командира работает всегда.</div>
      <div class="adm-row"><label><input id="adm-rd-on" type="checkbox" ${cfg.enabled ? 'checked' : ''}> входящие рейды включены</label></div>
      <div class="adm-row"><label>Первый рейд, с</label>
        <input id="adm-rd-first" type="number" min="30" max="1800" step="10" value="${cfg.first}" style="width:110px">
      </div>
      <div class="adm-row"><label>Интервал, с</label>
        <input id="adm-rd-interval" type="number" min="60" max="1800" step="10" value="${cfg.interval}" style="width:110px">
      </div>
      <div class="adm-row"><label>Масштаб волны</label>
        <input id="adm-rd-scale" type="range" min="0.25" max="3" step="0.05" value="${cfg.scale}">
        <b id="adm-rd-scale-val">×${Number(cfg.scale).toFixed(2)}</b>
      </div>
      <div class="adm-row">
        <button class="adm-btn" data-preset="240,300,1" type="button">Стандарт</button>
        <button class="adm-btn" data-preset="120,180,0.6" type="button">Мягко (для школы)</button>
        <button class="adm-btn" data-preset="60,90,1.6" type="button">Жёстко (проверка обороны)</button>
        <button class="adm-btn primary" id="adm-rd-save" type="button">Сохранить</button>
        <button class="adm-btn" id="adm-rd-reset" type="button">Сброс</button>
      </div>
      <div class="adm-hint">Новые настройки применяются к СЛЕДУЮЩЕМУ рейду; текущий таймер не перезапускается.</div>`;
    const first = body.querySelector('#adm-rd-first');
    const interval = body.querySelector('#adm-rd-interval');
    const scale = body.querySelector('#adm-rd-scale');
    const scaleVal = body.querySelector('#adm-rd-scale-val');
    scale.addEventListener('input', () => { scaleVal.textContent = '×' + Number(scale.value).toFixed(2); });
    for (const b of body.querySelectorAll('[data-preset]')) {
      b.addEventListener('click', () => {
        const [f, i, sc] = b.dataset.preset.split(',');
        first.value = f; interval.value = i; scale.value = sc;
        scaleVal.textContent = '×' + Number(sc).toFixed(2);
        body.querySelector('#adm-rd-on').checked = true;
      });
    }
    body.querySelector('#adm-rd-save').addEventListener('click', () => {
      const saved = saveRaidConfig({
        enabled: body.querySelector('#adm-rd-on').checked,
        first: Number(first.value),
        interval: Number(interval.value),
        scale: Number(scale.value),
      });
      msg(`Оборона: ${saved.enabled ? 'вкл' : 'выкл'}, первый ${saved.first} с, интервал ${saved.interval} с, волна ×${saved.scale}`);
    });
    body.querySelector('#adm-rd-reset').addEventListener('click', () => {
      resetRaidConfig();
      renderRaid(body);
      msg('Настройки обороны сброшены к стандарту');
    });
  }

  // ---------- Капсулы ----------
  function renderChests(body) {
    const cfg = loadConfig();
    const condOptions = Object.entries(CONDITIONS)
      .map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    const rarOptions = Object.entries(RARITY)
      .map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    body.innerHTML = `
      <div class="adm-hint">Капсула = контейнер с наградой. Условие решает, КОМУ она падает;
      период — как часто (раз в день / раз в жизни). Награды выбираются случайно по весам.</div>
      <div class="adm-row">
        <button class="adm-btn primary" id="adm-add" type="button">+ Новая капсула</button>
        <button class="adm-btn" id="adm-reset" type="button">Заводской набор</button>
        <button class="adm-btn" id="adm-publish" type="button">Опубликовать на сервер</button>
        <button class="adm-btn" id="adm-pull" type="button">Забрать с сервера</button>
      </div>
      <div id="adm-list"></div>
      <div class="adm-row" style="margin-top:8px">
        <label><input id="adm-entry" type="checkbox" ${cfg.showOnEntry ? 'checked' : ''}> показывать карточки при входе</label>
        <label><input id="adm-enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}> капсулы включены</label>
      </div>`;
    const list = body.querySelector('#adm-list');

    body.querySelector('#adm-entry').addEventListener('change', (e) => {
      const c = loadConfig(); c.showOnEntry = e.target.checked; saveConfig(c); msg('Сохранено');
    });
    body.querySelector('#adm-enabled').addEventListener('change', (e) => {
      const c = loadConfig(); c.enabled = e.target.checked; saveConfig(c); msg('Сохранено');
    });

    const draw = () => {
      const c = loadConfig();
      list.innerHTML = '';
      if (!c.chests.length) list.innerHTML = '<div class="adm-hint">Капсул нет.</div>';
      c.chests.forEach((chest, idx) => {
        const el = document.createElement('div');
        el.className = 'adm-chest';
        const cond = chest.condition || { type: 'always', params: {} };
        const params = Object.entries(cond.params || {})
          .map(([k, v]) => `${k}=${v}`).join(', ');
        el.innerHTML = `
          <div class="adm-chest-head">
            <span class="adm-chest-name">${esc(chest.name)} <span style="opacity:.6">· ${esc(chest.id)}</span></span>
            <span>
              <button class="adm-btn" data-act="edit" data-i="${idx}" type="button">Правка</button>
              <button class="adm-btn danger" data-act="del" data-i="${idx}" type="button">Удалить</button>
            </span>
          </div>
          <div class="adm-hint">условие: <b>${esc(cond.type)}</b>${params ? ' (' + esc(params) + ')' : ''}
            · период: <b>${esc(chest.period || 'day')}</b> · редкость: <b>${esc((RARITY[chest.rarity] || {}).name || chest.rarity)}</b>
            · наград: ${(chest.rewards || []).length}</div>`;
        list.appendChild(el);
      });
      for (const b of list.querySelectorAll('[data-act]')) {
        b.addEventListener('click', () => {
          const c2 = loadConfig();
          const i = Number(b.dataset.i);
          if (b.dataset.act === 'del') {
            c2.chests.splice(i, 1);
            saveConfig(c2);
            draw();
            msg('Капсула удалена');
          } else {
            editChest(i);
          }
        });
      }
    };

    const editChest = (index) => {
      const c = loadConfig();
      const isNew = index < 0;
      const chest = isNew ? {
        id: 'chest-' + Date.now().toString(36), name: 'Новая капсула', desc: '',
        icon: 'capsule', rarity: 'rare', condition: { type: 'always', params: {} },
        period: 'day', rewards: [{ kind: 'erg', params: { amount: 1000 }, weight: 1 }],
      } : JSON.parse(JSON.stringify(c.chests[index]));
      list.innerHTML = `
        <div class="adm-chest">
          <div class="adm-row"><label>Название</label><input id="ce-name" value="${esc(chest.name)}" style="flex:1 1 220px"></div>
          <div class="adm-row"><label>Описание</label><input id="ce-desc" value="${esc(chest.desc || '')}" style="flex:1 1 300px"></div>
          <div class="adm-row">
            <label>Редкость</label><select id="ce-rar">${rarOptions}</select>
            <label style="min-width:auto">Период</label>
            <select id="ce-period">
              <option value="day">раз в день</option>
              <option value="once">раз в жизни</option>
            </select>
            <label style="min-width:auto">Иконка</label>
            <select id="ce-icon">
              <option value="capsule">капсула</option><option value="cake">именинник</option>
              <option value="raider">рейдер</option><option value="crown">лидер</option>
              <option value="daily">ежедневная</option>
            </select>
          </div>
          <div class="adm-row"><label>Условие</label><select id="ce-cond">${condOptions}</select></div>
          <div class="adm-row"><label>Параметры</label><input id="ce-params" value="${esc(JSON.stringify(chest.condition.params || {}))}" style="flex:1 1 300px" placeholder='{"n":20}'></div>
          <div class="adm-hint">Параметры условий: window → {"from":"20:00","to":"20:30"}; raids → {"n":20};
            loot → {"n":50000}; top → {"n":100,"metric":"raids"}; cc → {"n":10}; birthday/daily/always → {}.</div>
          <div class="adm-row"><label>Награды (JSON)</label></div>
          <textarea id="ce-rewards">${esc(JSON.stringify(chest.rewards, null, 1))}</textarea>
          <div class="adm-hint">Формат: [{"kind":"erg","params":{"amount":1200},"weight":60}, …].
            Виды: ${Object.keys(REWARD_KINDS).map((k) => esc(k)).join(', ')}.
            unit → {"unit":"marine","count":3}; grade → {"building":"depot","levels":1};
            tech → {"key":"infAtk","levels":1}; boost → {"mul":1.5,"minutes":20}.</div>
          <div class="adm-row">
            <button class="adm-btn primary" id="ce-save" type="button">Сохранить</button>
            <button class="adm-btn" id="ce-cancel" type="button">Отмена</button>
          </div>
        </div>`;
      list.querySelector('#ce-rar').value = chest.rarity;
      list.querySelector('#ce-period').value = chest.period || 'day';
      list.querySelector('#ce-icon').value = chest.icon || 'capsule';
      list.querySelector('#ce-cond').value = (chest.condition && chest.condition.type) || 'always';
      const nameEl = list.querySelector('#ce-name');
      const descEl = list.querySelector('#ce-desc');
      const condEl = list.querySelector('#ce-cond');
      const paramsEl = list.querySelector('#ce-params');
      const rewardsEl = list.querySelector('#ce-rewards');
      condEl.addEventListener('change', () => {
        const map = { always: {}, birthday: {}, daily: {}, window: { from: '20:00', to: '20:30' }, raids: { n: 20 }, loot: { n: 50000 }, top: { n: 100, metric: 'raids' }, cc: { n: 10 } };
        paramsEl.value = JSON.stringify(map[condEl.value] || {});
      });
      list.querySelector('#ce-cancel').addEventListener('click', draw);
      list.querySelector('#ce-save').addEventListener('click', () => {
        let params, rewards;
        try { params = paramsEl.value.trim() ? JSON.parse(paramsEl.value) : {}; }
        catch { msg('Параметры условия: неверный JSON', true); return; }
        try { rewards = JSON.parse(rewardsEl.value); }
        catch { msg('Награды: неверный JSON', true); return; }
        if (!Array.isArray(rewards) || !rewards.length) { msg('Награды: нужен непустой массив', true); return; }
        const c2 = loadConfig();
        chest.name = nameEl.value.trim() || chest.name;
        chest.desc = descEl.value.trim();
        chest.rarity = list.querySelector('#ce-rar').value;
        chest.period = list.querySelector('#ce-period').value;
        chest.icon = list.querySelector('#ce-icon').value;
        chest.condition = { type: condEl.value, params };
        chest.rewards = rewards;
        if (isNew) c2.chests.push(chest);
        else c2.chests[index] = chest;
        saveConfig(c2);
        msg('Капсула сохранена');
        draw();
      });
    };

    body.querySelector('#adm-add').addEventListener('click', () => editChest(-1));
    body.querySelector('#adm-reset').addEventListener('click', () => {
      resetConfig();
      draw();
      msg('Заводской набор восстановлен');
    });
    body.querySelector('#adm-publish').addEventListener('click', async () => {
      const r = await publishConfigToServer(window.__saveIdentity);
      msg(r.ok ? 'Конфиг опубликован на сервер' : 'Не вышло: ' + (r.error || ''), !r.ok);
    });
    body.querySelector('#adm-pull').addEventListener('click', async () => {
      const ok = await pullConfigFromServer(window.__saveIdentity);
      msg(ok ? 'Конфиг забран с сервера' : 'На сервере нет конфига (или нет профиля)', !ok);
      if (ok) draw();
    });
    draw();
  }

  // ---------- Игроки ----------
  function renderPlayers(body) {
    body.innerHTML = `
      <div class="adm-row">
        <label>Метрика</label>
        <select id="adm-metric"><option value="raids">по вылетам</option><option value="loot">по добыче</option></select>
        <button class="adm-btn" id="adm-top" type="button">Обновить топ</button>
      </div>
      <div id="adm-top-box" class="adm-hint">Нажмите «Обновить топ» (нужен сейв-сервер и профиль).</div>
      <hr style="border-color:#1e2c33">
      <div class="adm-hint">Ручной подарок игроку — при следующем входе он получит капсулу
        «Подарок администрации» (серверный ключ ac_grant).</div>
      <div class="adm-row"><label>Ник</label><input id="adm-g-nick" placeholder="BEST" style="flex:0 1 160px"></div>
      <div class="adm-row"><label>Эрг</label><input id="adm-g-erg" type="number" value="5000" style="width:110px"></div>
      <div class="adm-row"><label>Грейд Дома</label><input id="adm-g-grade" type="number" value="0" min="0" max="5" style="width:80px"></div>
      <div class="adm-row"><label>Токен сервера</label>
        <input id="adm-token" placeholder="ADMIN_PIN (если задан)" style="flex:0 1 200px" autocomplete="off">
        <button class="adm-btn" id="adm-savetoken" type="button">Запомнить</button>
      </div>
      <div class="adm-row"><button class="adm-btn primary" id="adm-grant" type="button">Выдать</button></div>`;
    body.querySelector('#adm-top').addEventListener('click', async () => {
      const metric = body.querySelector('#adm-metric').value;
      const box = body.querySelector('#adm-top-box');
      box.textContent = 'загружаю…';
      const r = await fetchTop(metric, 100);
      if (!r || !r.ok) { box.textContent = 'Сервер недоступен (или нет сохранений с ac_stats).'; return; }
      if (!r.top.length) { box.textContent = 'Пока никто не сохранял статистику.'; return; }
      box.innerHTML = `<div class="adm-hint">всего игроков: ${r.total}, метрика: ${esc(r.metric)}</div>
        <table class="adm-table"><thead><tr><th>#</th><th>ник</th><th>вылеты</th><th>добыто</th><th>КЦ</th><th>Дом</th></tr></thead>
        <tbody>${r.top.slice(0, 30).map((x) => `<tr><td>${x.rank}</td><td>${esc(x.player)}</td><td>${x.raids}</td><td>${Math.round(x.loot)}</td><td>${x.ccLevel}</td><td>${x.houseLevel}</td></tr>`).join('')}</tbody></table>`;
    });
    const tokenEl = body.querySelector('#adm-token');
    try { tokenEl.value = localStorage.getItem('ac_admin_token') || ''; } catch { /* */ }
    body.querySelector('#adm-savetoken').addEventListener('click', () => {
      try { localStorage.setItem('ac_admin_token', tokenEl.value.trim()); } catch { /* */ }
      msg('Токен сохранён в этом браузере');
    });
    body.querySelector('#adm-grant').addEventListener('click', async () => {
      const nick = String(body.querySelector('#adm-g-nick').value || '').trim();
      const erg = num(body.querySelector('#adm-g-erg').value, 0);
      const grade = num(body.querySelector('#adm-g-grade').value, 0);
      if (!nick) { msg('Укажите ник', true); return; }
      const rewards = [];
      if (erg > 0) rewards.push({ kind: 'erg', params: { amount: erg }, weight: 1 });
      if (grade > 0) rewards.push({ kind: 'grade', params: { building: 'depot', levels: grade }, weight: 1 });
      const save = window.__saveApi;
      let token = '';
      try { token = localStorage.getItem('ac_admin_token') || ''; } catch { token = ''; }
      const r = save && save.api
        ? await save.api('/api/grant', { player: nick, grant: { name: 'Подарок администрации', rewards } }, { pin: token || undefined })
        : null;
      if (r && r.ok) msg(`Выдано игроку ${r.player} (всего подарков: ${r.grants})`);
      else msg('Не вышло: ' + ((r && r.error) || 'сервер недоступен'), true);
    });
  }

  // ---------- Диагностика ----------
  function renderDiag(body) {
    const st = game.state;
    const s = game.raidSession;
    const ctx = buildContext(game, {});
    const cfg = loadConfig();
    const state = loadState();
    const house = (st.buildings || []).find((b) => !b.dead && b.side === 'player' && b.type === 'depot');
    const cc = (st.buildings || []).find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
    const ident = window.__saveIdentity;
    const saveStatus = window.__saveApi ? window.__saveApi.status : null;
    const claimed = Object.keys(state.claimed || {});
    body.innerHTML = `
      <table class="adm-table"><tbody>
        <tr><td>Режим</td><td>${esc(st.raidMode || '—')}</td></tr>
        <tr><td>Эрг на базе</td><td>${Math.round(st.minerals.player)}</td></tr>
        <tr><td>КЦ</td><td>ур. ${cc ? cc.level || 1 : '—'}</td></tr>
        <tr><td>Дом</td><td>${house ? `ур. ${house.level || 1} · отсек ${(house.garrison || []).length}` : '—'}</td></tr>
        <tr><td>Вылетов</td><td>${ctx.raids}</td></tr>
        <tr><td>Добыто (сессия)</td><td>${Math.round(ctx.loot)}</td></tr>
        <tr><td>Оборона базы</td><td>${(() => {
          const rc = loadRaidConfig();
          return rc.enabled
            ? `рейд через ${(st.homeRaid ? Math.max(0, Math.ceil(st.homeRaid.nextAt - st.homeRaid.t)) : rc.first)} с · первый ${rc.first} с · интервал ${rc.interval} с · волна ×${rc.scale}${st.homeRaid && st.homeRaid.active ? ' · РЕЙД ИДЁТ' : ''}`
            : 'входящие рейды выключены';
        })()}</td></tr>
        <tr><td>Посты отрядов</td><td>${(() => {
          const posts = (st.units || []).filter((u) => u && !u.dead && u.hold).length;
          return posts ? `${posts} бойц(ов) держат сектор` : '—';
        })()}</td></tr>
        <tr><td>Капсул в конфиге</td><td>${cfg.chests.length}${cfg.enabled ? '' : ' (выключены)'}</td></tr>
        <tr><td>Забрано капсул</td><td>${claimed.length ? esc(claimed.join(', ')) : '—'}</td></tr>
        <tr><td>Профиль</td><td>${ident ? esc(ident.nick) : 'аноним'}</td></tr>
        <tr><td>Сейв-канал</td><td>${saveStatus ? `${saveStatus.online ? 'на связи' : 'нет связи'} · ${esc(saveStatus.api)}` : '—'}</td></tr>
        <tr><td>Масштаб цен</td><td>${(() => { try { return Number(localStorage.getItem(ECON_KEY)) || 1; } catch { return 1; } })()}×</td></tr>
      </tbody></table>
      <div class="adm-row" style="margin-top:10px">
        <button class="adm-btn" id="adm-reset-claims" type="button">Сбросить «забрано»</button>
        <button class="adm-btn" id="adm-wipe" type="button">Сбросить сейв базы рейда</button>
      </div>
      <div class="adm-row"><label>Новый PIN админа</label>
        <input id="adm-newpin" type="password" inputmode="numeric" maxlength="12" style="width:120px">
        <button class="adm-btn" id="adm-savepin" type="button">Сохранить PIN</button>
      </div>`;
    body.querySelector('#adm-reset-claims').addEventListener('click', () => {
      try { localStorage.removeItem('ac_chest_state_v1'); } catch { /* */ }
      msg('Отметки «забрано» сброшены');
    });
    body.querySelector('#adm-wipe').addEventListener('click', () => {
      if (!confirm('Сбросить базу рейда? Прогресс полигона начнётся заново.')) return;
      try { localStorage.removeItem('ac_raid_session_v1'); } catch { /* */ }
      if (window.__saveApi) window.__saveApi.pushKey('ac_raid_session_v1');
      msg('Сейв базы сброшен — перезагрузите страницу');
    });
    body.querySelector('#adm-savepin').addEventListener('click', () => {
      const v = String(body.querySelector('#adm-newpin').value || '').trim();
      if (!/^\d{3,12}$/.test(v)) { msg('PIN: 3–12 цифр', true); return; }
      setAdminPin(v);
      msg('PIN обновлён');
    });
  }
}

export function closeAdmin() {
  if (panel) { panel.remove(); panel = null; }
  const g = window.game;
  if (g && g.state) { g.paused = !!g.adminPausedBefore; g.adminPausedBefore = false; }
}
