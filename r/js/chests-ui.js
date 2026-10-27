// ============================================================
// chests-ui.js — входные карточки капсул и их вскрытие (пакет Э6).
//
// Что видит игрок:
//   • при входе на базу — оверлей «КАПСУЛЫ СНАБЖЕНИЯ» с карточками:
//     доступна / закрыта (и почему) / уже забрана сегодня;
//   • нажатие на доступную карточку — вскрытие с анимацией, награда уходит
//     в игру и дублируется тостом;
//   • повторно открыть список — команда КЦ «Капсулы» (канон владельца:
//     управление живёт в строениях, а не в топбаре);
//   • ежедневная капсула — раз в сутки, всегда в списке.
//
// Никаких новых кнопок в топбаре: точка входа — карточки при заходе и команда КЦ.
// ============================================================
import { t } from './i18n.js?v=10271846';
// З2 (#33): единая политика модалок — капсулы не открываются поверх
// командира/админки/профиля и сами закрывают то, что было открыто.
import { closeOthers, registerModal, unregisterModal, anyModalOpen } from './modals.js?v=10271846';
import {
  availableChests, buildContext, claimChest, loadConfig, RARITY,
  loadState, isClaimed, getBirthday, setBirthday, pullGrants, fetchTop,
  applyReward, pickReward,
} from './chests.js?v=10271846';

let overlay = null;
let shownThisSession = false;
let pendingCtx = null;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Иконки рисуем кодом (в проекте нет растровых ассетов для UI-иконок).
function iconSVG(kind, color) {
  const c = color || '#9fe8de';
  const common = `fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case 'cake': // именинник: капсула со свечой
      return `<svg viewBox="0 0 32 32" width="34" height="34"><rect x="6" y="16" width="20" height="10" rx="3" ${common}/><path d="M16 16V9" ${common}/><circle cx="16" cy="7" r="2" fill="${c}"/></svg>`;
    case 'raider': // рейдер: штурвал-шеврон
      return `<svg viewBox="0 0 32 32" width="34" height="34"><path d="M8 22l8-12 8 12" ${common}/><path d="M12 25h8" ${common}/></svg>`;
    case 'crown':
      return `<svg viewBox="0 0 32 32" width="34" height="34"><path d="M6 22l3-11 5 6 2-8 2 8 5-6 3 11z" ${common}/></svg>`;
    case 'daily':
      return `<svg viewBox="0 0 32 32" width="34" height="34"><circle cx="16" cy="16" r="9" ${common}/><path d="M16 11v5l4 3" ${common}/></svg>`;
    default: // капсула
      return `<svg viewBox="0 0 32 32" width="34" height="34"><rect x="9" y="6" width="14" height="20" rx="7" ${common}/><path d="M9 16h14" ${common}/><circle cx="16" cy="11" r="1.6" fill="${c}"/></svg>`;
  }
}

function ensureOverlay() {
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'chest-overlay';
  overlay.className = 'overlay hidden';
  overlay.innerHTML = `
    <div class="overlay-box chest-box" role="dialog" aria-modal="true">
      <div class="chest-head">
        <h1 id="chest-title">КАПСУЛЫ СНАБЖЕНИЯ</h1>
        <p class="sub" id="chest-sub"></p>
      </div>
      <div id="chest-grid" class="chest-grid"></div>
      <div id="chest-open" class="chest-open hidden"></div>
      <div class="chest-foot">
        <button id="chest-close" class="big-btn ghost-btn" type="button">На базу</button>
      </div>
    </div>`;
  document.body.append(overlay);
  overlay.querySelector('#chest-close').addEventListener('click', hide);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
  return overlay;
}

function hide() {
  unregisterModal('chests');
  if (!overlay) return;
  overlay.classList.add('hidden');
  // P1-фоллоуап (жалоба владельца 27.10): страховка поверх CSS — скрытый
  // оверлей не должен иметь НИКАКОГО шанса перехватить ввод (клики «в никуда»).
  overlay.style.pointerEvents = 'none';
  const game = window.game;
  // Паузу снимаем только если её поставили мы (как в raid-launch оверлее).
  if (game && game.state) {
    game.paused = !!game.chestPausedBefore;
    game.chestPausedBefore = false;
  }
}

export function showChests(game) {
  if (!game || !game.state) return;
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  // З2: открытие капсул закрывает любую другую модалку (и наоборот).
  closeOthers('chests');
  const ov = ensureOverlay();
  // Аудит-2 (27.10.2026): «Забрать и продолжить» перерисовывает панель через
  // showChests ПОВЕРХ уже открытого оверлея. Старый код в этом повторном входе
  // видел game.paused === true (поставленный первым открытием) и записывал его
  // в chestPausedBefore, затирая честный «false». Дальше hide() «восстанавливал»
  // паузу навсегда — игра на базе не отвечала на тапы («ничего не нажимается»),
  // тот же класс жалобы владельца, что и P1-фоллоуап. Паузу трогаем ТОЛЬКО при
  // реальном открытии из скрытого состояния.
  const wasHidden = ov.classList.contains('hidden');
  registerModal('chests', hide);
  const grid = ov.querySelector('#chest-grid');
  const openBox = ov.querySelector('#chest-open');
  const sub = ov.querySelector('#chest-sub');
  openBox.classList.add('hidden');
  grid.classList.remove('hidden');

  const ctx = buildContext(game, pendingCtx || {});
  const list = availableChests(game, ctx);
  const bd = getBirthday();
  sub.innerHTML = `Планета Актан-4 · вылетов: <b>${ctx.raids}</b> · добыто: <b>${Math.round(ctx.loot)}</b> · КЦ ур. <b>${ctx.ccLevel}</b>`
    + ` · ДР: <b>${bd ? String(bd.day).padStart(2, '0') + '.' + String(bd.month).padStart(2, '0') : 'не указан'}</b>`
    + `<button id="chest-bd" class="mini-btn" type="button" style="margin-left:8px">${bd ? 'изменить ДР' : 'указать ДР'}</button>`;

  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="chest-empty">Капсул пока нет. Администратор может добавить их в панели админа (команда КЦ «Админ»).</div>';
  }
  for (const item of list) {
    const r = RARITY[item.chest.rarity] || RARITY.common;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'chest-card' + (item.eligible && !item.claimed ? ' is-ready' : ' is-locked');
    card.style.setProperty('--rar', r.color);
    card.innerHTML = `
      <span class="chest-rar">${esc(r.name)}</span>
      <span class="chest-icon">${iconSVG(item.chest.icon, r.color)}</span>
      <span class="chest-name">${esc(item.chest.name)}</span>
      <span class="chest-desc">${esc(item.chest.desc || '')}</span>
      <span class="chest-state">${item.claimed ? 'забрана' : item.eligible ? 'готова к вскрытию' : esc(item.why)}</span>`;
    card.addEventListener('click', () => {
      if (item.claimed) { flashCard(card); return; }
      if (!item.eligible) { flashCard(card); return; }
      card.classList.add('is-opening');
      openChest(game, item.chest, ctx, ov);
    });
    grid.appendChild(card);
  }

  const bdBtn = ov.querySelector('#chest-bd');
  if (bdBtn) bdBtn.addEventListener('click', () => {
    const raw = prompt('Дата рождения (ДД.ММ):', bd ? `${bd.day}.${bd.month}` : '');
    if (!raw) return;
    const m = /^(\d{1,2})[.\-/](\d{1,2})$/.exec(raw.trim());
    if (!m) { alert('Формат: ДД.ММ'); return; }
    setBirthday(Number(m[2]), Number(m[1]));
    showChests(game);
  });

  ov.classList.remove('hidden');
  ov.style.pointerEvents = '';
  if (wasHidden) {
    if (!game.chestPausedBefore) game.chestPausedBefore = !!game.paused;
    game.paused = true;
  }
}

function flashCard(card) {
  card.classList.add('blocked-feedback');
  setTimeout(() => card.classList.remove('blocked-feedback'), 400);
}

function openChest(game, chest, ctx, ov) {
  const grid = ov.querySelector('#chest-grid');
  const box = ov.querySelector('#chest-open');
  // Любая ошибка награды должна быть ВИДНА: молчаливый throw в обработчике
  // клика выглядел для игрока как «кнопка не нажимается» (аудит 26.10.2026).
  let res;
  try {
    res = claimChest(game, chest.id, ctx);
  } catch (err) {
    console.error('[capsules] claimChest упал', err);
    res = { ok: false, error: 'сбой выдачи награды: ' + String((err && err.message) || err) };
  }
  if (!res || !res.ok) {
    grid.innerHTML = `<div class="chest-empty">Не удалось вскрыть: ${esc((res && res.error) || 'неизвестная ошибка')}</div>`;
    if (game.ui && game.ui.toast) game.ui.toast('Капсула не вскрылась: ' + ((res && res.error) || 'ошибка'), 'error', 4000);
    return;
  }
  grid.classList.add('hidden');
  box.classList.remove('hidden');
  const r = RARITY[chest.rarity] || RARITY.common;
  box.style.setProperty('--rar', r.color);
  box.innerHTML = `
    <div class="chest-burst" aria-hidden="true"></div>
    <div class="chest-reward">
      <div class="chest-reward-rar">${esc(r.name)}</div>
      <div class="chest-reward-text">${esc(res.text || 'награда получена')}</div>
      <div class="chest-reward-sub">${esc(chest.name)}</div>
    </div>
    <button id="chest-more" class="big-btn" type="button">Забрать и продолжить</button>`;
  box.querySelector('#chest-more').addEventListener('click', () => {
    try {
      if (game.ui && game.ui.toast) game.ui.toast(`${chest.name}: ${res.text}`, 'info');
    } catch { /* тост не критичен — список обязан вернуться */ }
    // Перерисовываем список: забранная капсула станет «забрана».
    try { showChests(game); } catch (err) { console.error('[capsules] showChests', err); hide(); }
  });
  if (game.sound && game.sound.win) game.sound.win();
}

// ------------------------------------------------------------
// Автопоказ при входе (по канону «без новых кнопок» — карточки, не кнопка).
// ------------------------------------------------------------
export function maybeShowOnEntry(game, extra) {
  if (shownThisSession) return;
  // З2 (#33): автопоказ не лезет поверх уже открытой модалки — иначе вторая
  // карточка перекрывает первую и обе становятся некликабельными.
  if (anyModalOpen()) return;
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.showOnEntry) return;
  pendingCtx = extra || null;
  const ctx = buildContext(game, extra || {});
  const list = availableChests(game, ctx);
  const ready = list.filter((x) => x.eligible && !x.claimed);
  const anyNew = ready.length > 0;
  if (!anyNew) return;
  shownThisSession = true;
  // З2 (#33): между «показать» и «показал» 900 мс — за это время игрок мог
  // открыть командира/профиль. Второй раз проверяем прямо перед показом.
  setTimeout(() => { if (anyModalOpen()) return; showChests(game); }, 900);
}

// Подтянуть серверные данные один раз: топ (для «капсулы лидера») и ручные
// подарки администрации (превращаются в отдельную капсулу).
export async function hydrateFromServer(game) {
  const ident = window.__saveIdentity;
  if (!ident) return;
  try {
    const top = await fetchTop('raids', 100);
    if (top && Array.isArray(top.top)) {
      const me = top.top.find((x) => String(x.player).toLowerCase() === String(ident.nick).toLowerCase());
      pendingCtx = { ...(pendingCtx || {}), topRank: me ? me.rank : 0, statsAvailable: true };
    }
  } catch { /* офлайн — «капсула лидера» просто закрыта */ }
  try {
    const grants = await pullGrants(ident);
    if (grants.length) {
      const cfg = loadConfig();
      let changed = false;
      for (const g of grants) {
        const id = 'grant-' + (g.id || g.ts || Math.random().toString(36).slice(2));
        if (cfg.chests.some((c) => c.id === id)) continue;
        cfg.chests.push({
          id,
          name: g.name || 'Подарок администрации',
          desc: g.desc || 'Ручная выдача: заберите, пока не истекло.',
          icon: 'capsule',
          rarity: 'legend',
          condition: { type: 'always', params: {} },
          period: 'once',
          rewards: Array.isArray(g.rewards) && g.rewards.length ? g.rewards : [{ kind: 'erg', params: { amount: 5000 }, weight: 1 }],
        });
        changed = true;
      }
      if (changed) {
        // сохраняем локально, чтобы подарок не выдавался повторно
        const { saveConfig } = await import('./chests.js?v=10271846');
        saveConfig(cfg);
      }
    }
  } catch { /* офлайн */ }
}

// Команда КЦ «Капсулы» — регистрируем как глобальную ручку.
export function registerChestCommand(game) {
  window.showChestPanel = () => showChests(game);
}

// Тестовые утилиты (для панели админа и симов).
export const _debug = { applyReward, pickReward, loadState, isClaimed };
