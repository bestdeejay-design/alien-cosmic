// ============================================================
// sim_modals33.mjs — issue #33, З2 (модалки и Escape) + З3 (тихая неудача сейва).
//
// З2. Что было сломано (хант SZ):
//   • командир КЦ открывался ПОВЕРХ капсул — карточки становились некликабельны;
//   • Escape не закрывал ни одной модалки полигона;
//   • автопоказ капсул лез поверх уже открытой модалки.
// З3. Что было сломано: ошибка сохранения жила только в панели профиля —
//   игрок играл, думал, что прогресс сохраняется.
//
// Сценарии:
//   M1  одна модалка за раз: открытие новой закрывает предыдущую;
//   M2  Escape закрывает ВЕРХНЮЮ и не пропускает событие в игру;
//   M3  профиль (реальная панель save-client) открывается/закрывается Escape;
//   M4  капсулы не всплывают поверх открытой модалки (автопоказ + 900 мс);
//   M5  открытие капсул закрывает открытую модалку, у капсул есть Escape;
//   M6  консоль вылазки — тоже модалка: закрывает соседей, Escape снимает паузу;
//   S1  неудача сохранения → один тост, повтор молчит (антифлуд);
//   S2  успех сбрасывает эпизод — следующая неудача снова видна.
//
// Запуск: node scripts/sim_modals33.mjs
// ============================================================
import './harness.mjs';
import { el, fireWindow } from './harness.mjs';
import { V } from './stamp.mjs';

await import('../r/js/game.js');
// Панель профиля и __saveApi живут в save-client (он же публикует __saveReady).
await import('../r/save-client.js');
const M = await import('../r/js/modals.js' + V);
const chests = await import('../r/js/chests-ui.js' + V);
const ui = await import('../r/js/ui.js' + V);
const I = await import('../r/js/i18n.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };
const toasts = () => (el('toasts').children || []).map((c) => String(c.textContent || ''));

// Чистый реестр модалок между сценариями (сим не должен зависеть от порядка).
const reset = () => { for (const id of M.openModalIds()) M.closeModal(id); };

// ---------- M1: одна модалка за раз ----------
try {
  reset();
  let closedA = 0, closedB = 0;
  M.beginModal('a', () => { closedA++; });
  assert(M.anyModalOpen() && M.isModalOpen('a'), 'модалка A не зарегистрирована');
  M.beginModal('b', () => { closedB++; });
  assert(closedA === 1, 'открытие B не закрыло A');
  assert(!M.isModalOpen('a') && M.isModalOpen('b'), 'реестр после открытия B неверен: ' + M.openModalIds());
  assert(M.anyModalOpen('b') === false, 'anyModalOpen(except) врёт');
  reset();
  pass('M1 новая модалка закрывает предыдущую (реестр без наложений)');
} catch (e) { fail('M1 одна модалка', e); }

// ---------- M2: Escape закрывает верхнюю и не доходит до игры ----------
try {
  reset();
  const closed = [];
  // Три «наложенные» записи (так бывало, когда модалки открывались мимо
  // beginModal): Escape обязан снять ровно последнюю.
  M.registerModal('x1', () => closed.push('x1'));
  M.registerModal('x2', () => closed.push('x2'));
  M.registerModal('x3', () => closed.push('x3'));
  const ev = fireWindow('keydown', { key: 'Escape', code: 'Escape' });
  assert(closed.join(',') === 'x3', 'Escape снял не одну верхнюю: ' + JSON.stringify(closed));
  assert(M.isModalOpen('x1') && M.isModalOpen('x2'), 'Escape снёс больше одной модалки: ' + M.openModalIds());
  assert(ev.defaultPrevented && ev.propagationStopped, 'Escape не остановлен (игра получила бы паузу)');
  reset(); // реестр пуст → Escape принадлежит игре (пауза и т.п.)
  const evIdle = fireWindow('keydown', { key: 'Escape', code: 'Escape' });
  assert(!evIdle.defaultPrevented, 'пустой Escape не должен перехватываться');
  const evKey = fireWindow('keydown', { key: 'q', code: 'KeyQ' });
  assert(!evKey.defaultPrevented, 'обычная клавиша перехвачена обработчиком модалок');
  reset();
  pass('M2 Escape закрывает только верхнюю модалку и не пропускает событие в игру');
} catch (e) { fail('M2 Escape', e); }

// ---------- M3: реальная панель профиля ----------
try {
  reset();
  window.showProfilePanel();
  const panel = el('sv-panel');
  assert(panel && panel.id === 'sv-panel', 'панель профиля не создана');
  assert(M.isModalOpen('profile'), 'профиль не зарегистрирован как модалка');
  fireWindow('keydown', { key: 'Escape', code: 'Escape' });
  assert(!M.isModalOpen('profile'), 'Escape не снял профиль с учёта');
  assert(!(document.body.children || []).some((c) => c.id === 'sv-panel'),
    'панель профиля осталась в DOM после Escape');
  pass('M3 профиль: открывается как модалка, закрывается Escape');
} catch (e) { fail('M3 профиль и Escape', e); }

// ---------- M4: автопоказ капсул не лезет поверх модалки ----------
try {
  reset();
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  M.beginModal('commander', () => {});
  chests.maybeShowOnEntry(game, {});
  await sleep(1000);
  const ovBody = (document.body.children || []).find((c) => c.id === 'chest-overlay');
  const shown = !!ovBody && !ovBody.classList.contains('hidden');
  assert(!shown, 'капсулы всплыли поверх открытой модалки');
  assert(!M.isModalOpen('chests'), 'капсулы зарегистрировались поверх модалки');
  reset();
  // А без модалки — показываются (или честно нет, если капсул не выдано).
  chests.maybeShowOnEntry(game, {});
  await sleep(1000);
  const shown2 = M.isModalOpen('chests');
  pass(`M4 автопоказ капсул не всплывает поверх модалки (после снятия: ${shown2 ? 'показаны' : 'нет доступных капсул'})`);
} catch (e) { fail('M4 автопоказ капсул', e); }

// ---------- M5: капсулы закрывают предыдущую модалку; Escape закрывает капсулы ----------
try {
  reset();
  let closed = 0;
  M.beginModal('commander', () => { closed++; });
  chests.showChests(game);
  assert(closed === 1, 'открытие капсул не закрыло предыдущую модалку');
  assert(M.isModalOpen('chests'), 'капсулы не зарегистрированы');
  assert(M.openModalIds().length === 1, 'в реестре больше одной модалки: ' + M.openModalIds());
  fireWindow('keydown', { key: 'Escape', code: 'Escape' });
  assert(!M.isModalOpen('chests'), 'Escape не закрыл капсулы');
  const ov = (document.body.children || []).find((c) => c.id === 'chest-overlay');
  assert(ov && ov.classList.contains('hidden'), 'оверлей капсул не скрыт после Escape');
  reset();
  pass('M5 капсулы: одна модалка за раз + закрытие по Escape');
} catch (e) { fail('M5 капсулы и Escape', e); }

// ---------- M6: консоль вылазки — тоже модалка (одна за раз + Escape) ----------
try {
  reset();
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  M.beginModal('chests', () => {});
  game.openRaidLaunch();
  assert(M.isModalOpen('raidLaunch'), 'консоль вылазки не зарегистрирована как модалка');
  assert(!M.isModalOpen('chests'), 'консоль не закрыла предыдущую модалку: ' + M.openModalIds());
  assert(game.paused === true, 'консоль не поставила игру на паузу');
  const ev = fireWindow('keydown', { key: 'Escape', code: 'Escape' });
  assert(ev.defaultPrevented, 'Escape на консоли не перехвачен модалками');
  assert(!M.isModalOpen('raidLaunch'), 'Escape не снял консоль с учёта');
  assert(!ui.isRaidOverlayOpen(), 'оверлей консоли остался открыт');
  assert(game.paused === false, 'пауза не снята при закрытии консоли');
  pass('M6 консоль вылазки: закрывает соседние модалки, Escape снимает паузу');
} catch (e) { fail('M6 консоль как модалка', e); }

// ---------- S1/S2: тост тихой неудачи сохранения ----------
try {
  reset();
  const before = toasts().length;
  // Профиль ставим напрямую (сеть в этом сценарии — управляемая заглушка).
  window.__saveApi.setIdentity('sztester', '7777');
  const key = window.__saveApi.keys[0];
  localStorage.setItem(key, 'dummy-' + Date.now());
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('нет сети'); };
  let threw = null;
  try {
    await window.__saveApi.pushKey(key);
    await window.__saveApi.pushKey(key);
  } catch (e) { threw = e; }
  globalThis.fetch = origFetch;
  const after = toasts().filter((t) => /Сохранение не удалось/.test(t));
  assert(!threw, 'pushKey бросил исключение наружу: ' + (threw && threw.message));
  assert(after.length === 1, 'ожидался ровно один тост о неудаче сейва, а их ' + after.length + ': ' + JSON.stringify(after));
  pass(`S1 неудача сейва → один тост («${after[0].slice(0, 40)}…»), повтор молчит (антифлуд)`);
} catch (e) { fail('S1 тост неудачи сейва', e); }

try {
  const key = window.__saveApi.keys[0];
  const beforeCount = toasts().filter((t) => /Сохранение не удалось/.test(t)).length;
  const origFetch = globalThis.fetch;
  // Успешный пуш: api-канал уже известен (resolveApi не нужен).
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, ts: Date.now(), player: 'sztester' }),
  });
  // Анти-спам самого ui.toast — 1.6 с на одинаковый текст; ждём, чтобы
  // проверять именно наш антифлуд и сброс эпизода, а не соседний слой.
  await sleep(1800);
  localStorage.setItem(key, 'fresh-' + Date.now());
  await window.__saveApi.pushKey(key);
  // Затем снова сбой — эпизод сброшен, игрок должен увидеть новую ошибку.
  globalThis.fetch = async () => { throw new Error('сеть пропала снова'); };
  localStorage.setItem(key, 'again-' + Date.now());
  await window.__saveApi.pushKey(key);
  globalThis.fetch = origFetch;
  const afterCount = toasts().filter((t) => /Сохранение не удалось/.test(t)).length;
  assert(afterCount === beforeCount + 1,
    'после успешного сейва новая ошибка не показана: ' + beforeCount + ' → ' + afterCount);
  window.__saveApi.clearIdentity();
  pass('S2 успешный сейв сбрасывает эпизод — следующая неудача снова видна');
} catch (e) { fail('S2 эпизод сейва', e); }

// ---------- Итог ----------
if (failures.length) {
  console.log(`\n❌ SIM_MODALS33: провалено ${failures.length}: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n✅ SIM_MODALS33: модалки без наложений, Escape, честный тост сейва');
process.exit(0);
