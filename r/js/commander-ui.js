// ============================================================
// commander-ui.js — карточка КОМАНДИРА (Э7).
//
// Открывается командой КЦ «Командир» (KeyK) — канон владельца соблюдён:
// никаких кнопок в топбаре, управление живёт в строении.
//
// Что видно:
//   • звание (капитан/майор/полковник/генерал) и уровень 1…20 + полоса опыта;
//   • бонусы звания числами (места, скорость грейда, урон в обороне, ремонт);
//   • служба: вылеты, отбитые атаки, уничтоженные враги;
//   • оборона: таймер следующего рейда / «рейд идёт» и переключатель автозащиты;
//   • кнопка «Учебная тревога» — малая волна сразу, чтобы проверить оборону;
//   • журнал последних событий.
// ============================================================
import { t } from './i18n.js?v=10271841';
import {
  ensureCommander, rankOf, xpNeed, bonuses, commanderTitle, MAX_COMMANDER_LEVEL,
} from './commander.js?v=10271841';
import { homeRaidStatus, spawnHomeWave } from './home-raid.js?v=10271841';
import { issueRetreatToCC, clearHold, squadHoldCount } from './squad.js?v=10271841';
import { closeOthers, registerModal, unregisterModal } from './modals.js?v=10271841';

let panel = null;
let timer = null;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => Math.round((Number(v) || 0) * 1000) / 10;

function pips(n) {
  return '<span class="cm-pips">' + '◆'.repeat(Math.max(0, Math.min(4, n))) + '</span>';
}

export function openCommander(game) {
  if (!game || !game.state) return;
  if (panel && document.body.contains(panel)) { closeCommander(); return; }
  // З2 (#33): командир закрывает всё, что было открыто (капсулы/админку/профиль)
  // — раньше он лез поверх капсул и карточки становились некликабельными.
  closeOthers('commander');
  const st = game.state;
  const c = ensureCommander(st);
  const b = bonuses(c.level);
  panel = document.createElement('div');
  panel.id = 'commander-overlay';
  panel.className = 'overlay';
  panel.innerHTML = `
    <div class="overlay-box cm-box" role="dialog" aria-modal="true">
      <div class="cm-head">
        <div class="cm-title">${esc(t('ui.commander.title'))}${pips(rankOf(c.level).pips)}</div>
        <div class="cm-rank" id="cm-rank">${esc(commanderTitle(c.level))}</div>
        <div class="cm-sub">${esc(t('ui.commander.sub'))}</div>
        <div class="cm-xpwrap"><div class="cm-xpbar" id="cm-xpbar"></div></div>
        <div class="cm-xp" id="cm-xp"></div>
      </div>
      <div class="cm-cols">
        <div class="cm-col">
          <div class="cm-h">${esc(t('ui.commander.bonusTitle'))}</div>
          <ul class="cm-list" id="cm-bonus">
            <li>${esc(t('ui.commander.bonusSupply', { n: b.supply }))}</li>
            <li>${esc(t('ui.commander.bonusGrade', { p: pct(b.gradeSpeed) }))}</li>
            <li>${esc(t('ui.commander.bonusDefense', { p: pct(b.defense - 1) }))}</li>
            <li>${esc(t('ui.commander.bonusRepair', { n: b.repair }))}</li>
          </ul>
          <div class="cm-h">${esc(t('ui.commander.statsTitle'))}</div>
          <ul class="cm-list" id="cm-stats">
            <li>${esc(t('ui.commander.statRaids', { n: c.stats.raids }))}</li>
            <li>${esc(t('ui.commander.statDefenses', { n: c.stats.defenses }))}</li>
            <li>${esc(t('ui.commander.statKills', { n: c.stats.kills }))}</li>
          </ul>
        </div>
        <div class="cm-col">
          <div class="cm-h">${esc(t('ui.commander.defenseTitle'))}</div>
          <div class="cm-status" id="cm-def">—</div>
          <label class="cm-toggle"><input type="checkbox" id="cm-auto" ${c.autoDefense ? 'checked' : ''}> ${esc(t('ui.commander.autoDefense'))}</label>
          <div class="cm-status cm-posts" id="cm-posts">—</div>
          <div class="cm-row2">
            <button class="cm-mini" id="cm-retreat" type="button">${esc(t('ui.commander.defenseRetreat'))}</button>
            <button class="cm-mini" id="cm-clear" type="button">${esc(t('ui.commander.defenseClear'))}</button>
          </div>
          <div class="cm-salvage" id="cm-salvage"></div>
          <div class="cm-hint">${esc(t('ui.commander.trainingHint'))}</div>
          <button class="big-btn" id="cm-training" type="button">${esc(t('ui.commander.training'))}</button>
          <div class="cm-h">${esc(t('ui.commander.logTitle'))}</div>
          <ul class="cm-log" id="cm-log"></ul>
        </div>
      </div>
      <div class="cm-foot"><button class="big-btn ghost-btn" id="cm-close" type="button">${esc(t('ui.commander.close'))}</button></div>
    </div>`;
  document.body.append(panel);
  registerModal('commander', closeCommander);
  if (st) { game.commanderPausedBefore = !!game.paused; game.paused = true; }

  const $ = (id) => panel.querySelector(id);
  $('#cm-close').addEventListener('click', closeCommander);
  panel.addEventListener('click', (e) => { if (e.target === panel) closeCommander(); });
  $('#cm-auto').addEventListener('change', (e) => {
    const cc = ensureCommander(game.state);
    cc.autoDefense = !!e.target.checked;
    game.ui.toast(cc.autoDefense ? t('ui.commander.autoOn') : t('ui.commander.autoOff'), 'info');
  });
  $('#cm-retreat').addEventListener('click', () => {
    const n = issueRetreatToCC(game.state);
    game.ui.toast(n ? t('ui.squad.retreat', { n }) : t('ui.squad.none'), n ? 'info' : 'warn');
    if (n) game.sound.ack();
    refresh(game);
  });
  $('#cm-clear').addEventListener('click', () => {
    const n = clearHold(game.state);
    game.ui.toast(n ? t('ui.squad.cleared', { n }) : t('ui.squad.none'), n ? 'info' : 'warn');
    refresh(game);
  });
  $('#cm-training').addEventListener('click', () => {
    const res = spawnHomeWave(game.state, { training: true });
    if (res.ok) {
      game.ui.toast(t('ui.commander.trainingStart'), 'warn', 3500);
      game.sound.alarm();
    } else {
      game.ui.toast(res.error || '—', 'warn');
    }
    refresh(game);
  });

  refresh(game);
  timer = setInterval(() => {
    if (!panel || !document.body.contains(panel)) { closeCommander(); return; }
    refresh(game);
  }, 1000);
}

function refresh(game) {
  if (!panel) return;
  const st = game.state || {};
  const c = ensureCommander(st);
  const b = bonuses(c.level);
  const $ = (id) => panel.querySelector(id);
  const rankEl = $('#cm-rank');
  if (rankEl) rankEl.textContent = commanderTitle(c.level);
  const need = xpNeed(c.level);
  const bar = $('#cm-xpbar');
  if (bar) {
    const frac = need > 0 ? Math.max(0, Math.min(1, c.xp / need)) : 1;
    bar.style.width = Math.round(frac * 100) + '%';
  }
  const xpEl = $('#cm-xp');
  if (xpEl) xpEl.textContent = need > 0 ? t('ui.commander.xp', { xp: c.xp, need }) : t('ui.commander.xpMax');
  const bonusEl = $('#cm-bonus');
  if (bonusEl) {
    bonusEl.innerHTML = [
      t('ui.commander.bonusSupply', { n: b.supply }),
      t('ui.commander.bonusGrade', { p: pct(b.gradeSpeed) }),
      t('ui.commander.bonusDefense', { p: pct(b.defense - 1) }),
      t('ui.commander.bonusRepair', { n: b.repair }),
    ].map((x) => `<li>${esc(x)}</li>`).join('');
  }
  const statsEl = $('#cm-stats');
  if (statsEl) {
    statsEl.innerHTML = [
      t('ui.commander.statRaids', { n: c.stats.raids }),
      t('ui.commander.statDefenses', { n: c.stats.defenses }),
      t('ui.commander.statKills', { n: c.stats.kills }),
    ].map((x) => `<li>${esc(x)}</li>`).join('');
  }
  const rs = homeRaidStatus(st);
  const defEl = $('#cm-def');
  if (defEl) {
    defEl.textContent = rs.active
      ? t('ui.commander.raidActive', { n: rs.alive })
      : t('ui.commander.nextRaid', { s: rs.countdown });
    defEl.className = 'cm-status' + (rs.active ? ' is-hot' : '');
  }
  const postsEl = $('#cm-posts');
  if (postsEl) {
    const posts = squadHoldCount(st);
    postsEl.textContent = posts ? t('ui.commander.postsCount', { n: posts }) : t('ui.commander.postsNone');
    postsEl.classList.toggle('is-hot', posts > 0);
  }
  const svEl = $('#cm-salvage');
  if (svEl) {
    svEl.textContent = rs.salvage ? t('ui.commander.salvageInfo', { erg: rs.salvage.amount, s: rs.salvage.left }) : '';
    svEl.classList.toggle('is-hot', !!rs.salvage);
  }
  const logEl = $('#cm-log');
  if (logEl) {
    const list = Array.isArray(c.log) && c.log.length ? c.log : [];
    logEl.innerHTML = list.length
      ? list.slice(0, 6).map((e) => `<li class="is-${esc(e.kind || 'info')}">${esc(e.text)}</li>`).join('')
      : `<li class="is-muted">${esc(t('ui.commander.logEmpty'))}</li>`;
  }
  void MAX_COMMANDER_LEVEL;
}

export function closeCommander() {
  unregisterModal('commander');
  if (timer) { clearInterval(timer); timer = null; }
  if (panel) { panel.remove(); panel = null; }
  const g = window.game;
  if (g && g.state) { g.paused = !!g.commanderPausedBefore; g.commanderPausedBefore = false; }
}

// Для headless-проверок.
export const _debug = { pips };
