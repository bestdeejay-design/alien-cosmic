// ============================================================
// modals.js — ЕДИНАЯ ПОЛИТИКА МОДАЛОК ПОЛИГОНА (issue #33, З2).
//
// Что было не так (хант SZ, подтверждено живьём):
//   1) командир КЦ (`#commander-overlay`, z=30) открывался ПОВЕРХ капсул
//      (`#chest-overlay`) — карточки капсул становились некликабельными;
//   2) Escape не закрывал НИ ОДНУ модалку полигона — обработчика не было;
//   3) автопоказ капсул при входе (`maybeShowOnEntry`) лез поверх уже
//      открытой модалки.
//
// Правило теперь одно и оно здесь:
//   • открытие новой модалки закрывает предыдущую (не «вторая поверх»);
//   • Escape закрывает ВЕРХНЮЮ (последнюю открытую) и не доходит до игры
//     (иначе он заодно снимал бы паузу);
//   • тот, кто хочет открыться сам (автопоказ), спрашивает `anyModalOpen()`.
//
// Модуль без импортов — его можно подключать откуда угодно, циклов нет.
// ============================================================

const registry = new Map(); // id → { close, seq }
let seq = 0;
let escapeBound = false;

// Зарегистрировать открытую модалку. `close` — её собственный закрыватель.
// opts.onEscape — необязательный обработчик «первого Escape»: если он вернёт
// true, модалка СЧИТАЕТ СОБЫТИЕ СВОИМ и остаётся открытой (так работает пинпад
// авторизации: Escape сначала стирает введённые точки, и только следующий
// Escape закрывает панель).
export function registerModal(id, close, opts = {}) {
  if (!id) return;
  registry.set(String(id), { close, seq: ++seq, onEscape: opts && opts.onEscape });
}

export function unregisterModal(id) {
  registry.delete(String(id));
}

export function isModalOpen(id) {
  return registry.has(String(id));
}

export function openModalIds() {
  return [...registry.keys()];
}

export function anyModalOpen(exceptId) {
  for (const k of registry.keys()) if (k !== String(exceptId)) return true;
  return false;
}

// Закрыть одну (без рекурсии: из реестра убираем ДО вызова close).
export function closeModal(id) {
  const key = String(id);
  const e = registry.get(key);
  if (!e) return false;
  registry.delete(key);
  try { if (typeof e.close === 'function') e.close(); } catch { /* модалка уже мертва */ }
  return true;
}

// Открытие новой модалки: всё остальное закрываем, себя помечаем.
export function beginModal(id, close) {
  closeOthers(id);
  registerModal(id, close);
}

export function closeOthers(exceptId) {
  const keep = String(exceptId);
  for (const k of [...registry.keys()]) if (k !== keep) closeModal(k);
}

// Верхняя = последняя открытая. Escape закрывает именно её.
// Верхняя модалка может САМА обработать Escape (onEscape вернул true) —
// тогда она остаётся открытой. Возврат: id закрытой модалки, либо null.
export function closeTop(ev) {
  let top = null, topSeq = -1;
  for (const [id, e] of registry) if (e.seq > topSeq) { top = id; topSeq = e.seq; }
  if (!top) return null;
  const entry = registry.get(top);
  if (entry && typeof entry.onEscape === 'function') {
    try { if (entry.onEscape(ev) === true) return null; } catch { /* падение обработчика не блокирует закрытие */ }
  }
  closeModal(top);
  return top;
}

// Один глобальный Escape на все модалки. Capture-фаза + stopPropagation:
// игра не должна получить это нажатие (иначе Esc заодно снимал бы паузу).
export function installEscape() {
  if (escapeBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  escapeBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.code !== 'Escape') return;
    if (!registry.size) return;
    // Если верхняя модалка «съела» Escape сама (пинпад: стереть точки) — событие
    // всё равно не должно дойти до игры, иначе Esc заодно снял бы паузу.
    const closed = closeTop(e);
    if (!closed) { if (typeof e.preventDefault === 'function') e.preventDefault(); return; }
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }, true);
}

// Для headless-сим: разобрать состояние без DOM-событий.
export const _debug = { registry, reset: () => registry.clear() };

installEscape();
