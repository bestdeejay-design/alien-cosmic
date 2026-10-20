// ============================================================
// sim_menu.mjs — R2-C/R2-D menu acceptance: quick battle, persistence,
// full-page hero flow, campaign separation, locale-safe labels and metadata.
// Run with node scripts/sim_menu.mjs; also nested from check.mjs.
// ============================================================
import './harness.mjs';
import { readFileSync } from 'node:fs';
import { el } from './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(condition, msg) { if (!condition) throw new Error(msg); }

await import('../js/game.js');
const ui = await import('../js/ui.js');
const missions = await import('../js/missions.js');
const i18n = await import('../js/i18n.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game was not created'); process.exit(1); }

const STORAGE_KEY = 'terranrts.quickBattle';
const expectedPresets = [
  ['square-48', 48, 48], ['square-64', 64, 64], ['square-80', 80, 80],
  ['square-96', 96, 96], ['wide-96x64', 96, 64], ['tall-64x96', 64, 96],
];
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

async function check(phase, fn) {
  try { await fn(); pass(phase); }
  catch (e) { fail(phase, e); }
}

await check('M1 presets: six stable IDs show exact dimensions; menu semantics are current', () => {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert(expectedPresets.length === 6, 'test matrix should contain six canonical presets');
  for (const [id, w, h] of expectedPresets) {
    const button = buttons.find(([, attrs]) => attrs.includes(`id="quick-preset-${id}"`));
    assert(button, `${id} is missing from the home menu`);
    assert(button[2].includes(`<span class="preset-dims">${w}×${h}</span>`), `${id} does not display ${w}×${h}`);
  }
  assert(!html.includes('id="skirmish-overlay"') && !html.includes('id="btn-missions-skirmish"'), 'obsolete second skirmish path remains');
  assert(html.includes('id="btn-start"') && html.includes('id="menu-more"') && html.includes('id="menu-controls"'), 'campaign or disclosures are missing');
  assert(css.includes('touch-action: manipulation') && css.includes(':focus-visible'), 'touch/focus affordances are missing');
  const more = html.indexOf('<details id="menu-more"');
  const reset = html.indexOf('id="btn-reset"');
  assert(more >= 0 && reset > more, 'reset is not placed under More');
});

await check('M2 first run: 64×64 recommended, no silent faction, three actions start the selected battle', () => {
  localStorage.removeItem(STORAGE_KEY);
  const initial = ui.restoreQuickBattleConfig();
  assert(initial.presetId === 'square-64' && initial.faction === null && !initial.isSaved, 'fresh profile did not use the safe 64×64/no-side default');
  assert(el('quick-preset-square-64').getAttribute('aria-pressed') === 'true', '64×64 is not selected by default');
  assert(el('quick-faction-human').getAttribute('aria-pressed') === 'false' && el('quick-faction-alien').getAttribute('aria-pressed') === 'false', 'a faction was selected silently');
  assert(el('btn-quick-battle-start').getAttribute('aria-disabled') === 'true', 'CTA should wait for an explicit faction');
  assert(el('quick-battle-status').textContent.includes('64×64'), 'first-run guidance omits the recommended size');
  el('btn-quick-battle-start').click();
  assert(!game.started && el('quick-battle-status').textContent.length > 0, 'blocked CTA failed to explain the missing side');

  let actions = 0;
  const tap = (id) => { actions++; el(id).click(); };
  tap('quick-preset-square-80');
  tap('quick-faction-alien');
  const caption = el('btn-quick-battle-start').textContent;
  assert(caption.includes('80×80') && caption.includes('КХАРИД'), `CTA lacks the chosen setup: ${caption}`);
  assert(el('btn-quick-battle-start').getAttribute('aria-disabled') === 'false', 'CTA stayed disabled after side selection');
  tap('btn-quick-battle-start');
  assert(actions === 3, `battle took ${actions} actions, expected at most three`);
  assert(game.started && game.mission.id === -1, 'quick battle did not start as a skirmish');
  assert(game.mission.faction === 'alien' && game.state.map.w === 80 && game.state.map.h === 80,
    `wrong battle config: ${game.mission.faction}, ${game.state.map.w}×${game.state.map.h}`);
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  assert(saved.presetId === 'square-80' && saved.faction === 'alien', 'last config was not saved');
  assert(JSON.stringify(Object.keys(saved).sort()) === '["faction","presetId"]', 'storage contains data beyond preset ID and faction');
});

await check('M3 repeat: restores the last config and launches in one action', () => {
  game.toMenu();
  const restored = ui.restoreQuickBattleConfig();
  assert(restored.isSaved && restored.presetId === 'square-80' && restored.faction === 'alien', 'saved config was not restored');
  assert(el('quick-preset-square-80').getAttribute('aria-pressed') === 'true', 'restored map is not visibly selected');
  assert(el('quick-faction-alien').getAttribute('aria-pressed') === 'true', 'restored faction is not visibly selected');
  assert(el('quick-battle-status').textContent.includes('Последняя конфигурация'), 'last-config status is missing');
  let actions = 0;
  actions++;
  el('btn-quick-battle-start').click();
  assert(actions === 1, 'repeat did not launch in one action');
  assert(game.started && game.mission.id === -1 && game.mission.faction === 'alien', 'repeat launched the wrong mode or faction');
  assert(game.state.map.w === 80 && game.state.map.h === 80, 'repeat launched the wrong map');
});

await check('M4 storage validation: malformed, unknown, invalid-side and extra simulation fields fall back safely', () => {
  game.toMenu();
  const badValues = [
    '{broken',
    JSON.stringify({ presetId: 'unknown-map', faction: 'alien' }),
    JSON.stringify({ presetId: 'square-96', faction: 'player' }),
    JSON.stringify({ presetId: 'square-96', faction: 'human', seed: 1234 }),
  ];
  for (const raw of badValues) {
    localStorage.setItem(STORAGE_KEY, raw);
    const restored = ui.restoreQuickBattleConfig();
    assert(restored.presetId === 'square-64' && restored.faction === null && !restored.isSaved, `unsafe fallback for ${raw}`);
  }
  localStorage.removeItem(STORAGE_KEY);
  const missing = ui.restoreQuickBattleConfig();
  assert(missing.presetId === 'square-64' && missing.faction === null && !missing.isSaved, 'missing storage did not fall back to 64×64');
});

await check('M5 each canonical ID launches with its exact map dimensions', () => {
  for (const [id, w, h] of expectedPresets) {
    game.toMenu();
    localStorage.removeItem(STORAGE_KEY);
    ui.restoreQuickBattleConfig();
    el('quick-preset-' + id).click();
    el('quick-faction-human').click();
    el('btn-quick-battle-start').click();
    assert(game.started && game.mission.id === -1 && game.mission.faction === 'human', `${id}: quick battle did not launch for HELIOS`);
    assert(game.state.map.w === w && game.state.map.h === h, `${id}: received ${game.state.map.w}×${game.state.map.h}, expected ${w}×${h}`);
  }
});

await check('M6 locale + campaign: dynamic menu labels remain distinct; both campaign routes are intact', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: 'wide-96x64', faction: 'human' }));
  ui.restoreQuickBattleConfig();
  await i18n.setLocale('en');
  assert(el('btn-quick-battle-start').textContent.includes('DEPLOY') && el('btn-quick-battle-start').textContent.includes('96×64'), 'English quick-battle CTA did not update');
  assert(/campaign/i.test(el('btn-start').textContent) && /mission 1/i.test(el('btn-start').textContent), 'English campaign CTA is unclear');
  assert(!/campaign/i.test(el('btn-quick-battle-start').textContent), 'quick battle is mislabeled as campaign');

  await i18n.setLocale('ru');
  game.toMenu();
  assert(missions.loadProgress() === 0, 'campaign progress should still be fresh');
  assert(el('btn-start').textContent.includes('Начать кампанию') && el('btn-start').textContent.includes('1'), 'fresh-profile campaign label is wrong');
  assert(!el('btn-start').textContent.includes('бой'), 'campaign CTA is mislabeled as quick battle');
  const quickBefore = localStorage.getItem(STORAGE_KEY);
  el('btn-start').click();
  assert(game.started && game.mission.id === 0 && game.mission.id !== -1, '#btn-start no longer starts the current campaign mission');
  assert(localStorage.getItem(STORAGE_KEY) === quickBefore, 'campaign start changed the quick-battle preference');
  game.toMenu();

  el('btn-season1').click();
  const first = el('mission-list').children.find((node) => node.tag === 'button' && !node.disabled);
  assert(first, 'campaign list has no available mission');
  first.click();
  assert(!el('brief-overlay').classList.contains('hidden'), 'campaign mission did not open its briefing');
  el('btn-brief-go').click();
  assert(game.started && game.mission.id === 0 && game.mission.id !== -1, 'campaign list → briefing → battle path is broken');
  assert(localStorage.getItem(STORAGE_KEY) === quickBefore, 'campaign path overwrote the quick-battle preference');
  game.toMenu();
});

await check('M7 secondary menu: Universe, Season 2 teaser and confirmed reset stay independent', () => {
  assert(i18n.t('ui.menu.universe') === 'Вселенная', 'menu link was not renamed to Universe');
  assert(i18n.t('ui.codexScr.universeTitle') === 'Вселенная', 'Universe screen heading was not renamed');
  el('btn-codex').click();
  assert(!el('codex-overlay').classList.contains('hidden'), 'Universe screen did not open');
  el('btn-codex-back').click();
  el('btn-season2').click();
  assert(el('toasts').children.some((node) => node.textContent.includes('Сезон 2')), 'Season 2 teaser no longer shows its toast');

  missions.saveProgress(1);
  game.toMenu();
  assert(el('btn-start').textContent.includes('Кампания') && el('btn-start').textContent.includes('2'), 'campaign label did not follow loadProgress()');
  const originalConfirm = globalThis.confirm;
  let confirmResult = false;
  let confirmCalls = 0;
  globalThis.confirm = () => { confirmCalls++; return confirmResult; };
  try {
    el('btn-reset').click();
    assert(confirmCalls === 1 && missions.loadProgress() === 1, 'reset ignored the existing confirmation');
    confirmResult = true;
    el('btn-reset').click();
    assert(confirmCalls === 2 && missions.loadProgress() === 0, 'confirmed reset did not clear campaign progress');
    assert(el('btn-start').textContent.includes('Начать кампанию') && el('btn-start').textContent.includes('1'), 'fresh campaign label did not return after reset');
  } finally {
    if (originalConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = originalConfirm;
  }
});

await check('D1 landing page: full-height hero, single primary, scroll sections, social metadata and generated OG asset', () => {
  const heroStart = html.indexOf('<section id="hero"');
  const quickStart = html.indexOf('<section id="quick-battle"');
  const hero = html.slice(heroStart, quickStart);
  assert(heroStart >= 0 && quickStart > heroStart, 'full-screen hero is missing or not before the page sections');
  assert((html.match(/id="btn-quick-primary"/g) || []).length === 1, 'hero primary CTA must exist exactly once');
  assert((hero.match(/class="big-btn hero-cta"/g) || []).length === 1, 'the first screen must have exactly one primary button');
  assert(hero.includes('data-i18n="ui.menu.heroQuickCta"') && hero.includes('id="hero-quick-status"'), 'hero CTA or its live explanation is missing');
  const sectionIds = ['quick-battle', 'campaign', 'universe', 'controls', 'more'];
  const sectionPositions = sectionIds.map((id) => html.indexOf(`id="${id}"`));
  assert(sectionPositions.every((position, i) => position > quickStart && (i === 0 || position > sectionPositions[i - 1])), 'scroll sections are missing or out of order');
  assert(html.includes('id="landing-page"') && !html.includes('id="overlay"'), 'the landing page is still an overlay shell');
  for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:type"', 'name="twitter:card" content="summary_large_image"']) {
    assert(html.includes(tag), `social metadata is missing ${tag}`);
  }
  assert(html.includes('content="./assets/og-image.png"') && html.includes('content="1200"') && html.includes('content="630"'), 'OG image path or declared dimensions are wrong');
  const og = readFileSync(new URL('../assets/og-image.png', import.meta.url));
  assert(og.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'OG asset is not a PNG');
  assert(og.readUInt32BE(16) === 1200 && og.readUInt32BE(20) === 630, 'OG PNG must be exactly 1200×630');
  assert(html.includes('src="./assets/hero-art.svg"') && css.includes('#landing-page.hidden'), 'the hero illustration or page/game mode styling is missing');
  assert(css.includes('overflow-x: clip') && css.includes('@media (max-width: 560px)') && css.includes('repeat(2, minmax(0, 1fr))'), 'responsive page/quick-choice rules are missing');
});

await check('D2 hero CTA: first visit leads to an explicit choice and reaches default battle in three taps', () => {
  game.toMenu();
  localStorage.removeItem(STORAGE_KEY);
  const fresh = ui.restoreQuickBattleConfig();
  assert(!fresh.isSaved && fresh.presetId === 'square-64' && fresh.faction === null, 'first visit did not restore the safe recommended setup');
  let scrolls = 0;
  el('quick-battle').scrollIntoView = (options) => {
    scrolls++;
    assert(options.block === 'start', 'hero CTA did not align the selection section');
  };
  let actions = 0;
  actions++;
  el('btn-quick-primary').click();
  assert(scrolls === 1 && !game.started, 'first-run hero CTA must lead to the choice, not silently launch');
  assert(el('quick-faction-human').getAttribute('aria-pressed') === 'false' && el('quick-faction-alien').getAttribute('aria-pressed') === 'false', 'hero path silently selected a faction');
  assert(el('hero-quick-status').textContent.includes('Выбор ещё не сохранён'), 'hero does not explain the unsaved first-run choice');
  actions++;
  el('quick-faction-human').click();
  actions++;
  el('btn-quick-battle-start').click();
  assert(actions === 3 && game.started && game.mission.id === -1, `first-run hero path used ${actions} taps or started the wrong mode`);
  assert(game.mission.faction === 'human' && game.state.map.w === 64 && game.state.map.h === 64, 'first-run hero path launched the wrong default battle');
});

await check('D3 saved hero CTA: one tap launches the validated preset; invalid storage routes to selection', () => {
  game.toMenu();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: 'wide-96x64', faction: 'alien' }));
  ui.restoreQuickBattleConfig();
  let scrolls = 0;
  el('quick-battle').scrollIntoView = () => { scrolls++; };
  let actions = 0;
  actions++;
  el('btn-quick-primary').click();
  assert(actions === 1 && scrolls === 0, 'saved hero CTA did not launch directly in one tap');
  assert(game.started && game.mission.id === -1 && game.mission.faction === 'alien', 'saved hero CTA launched the wrong mode or side');
  assert(game.state.map.w === 96 && game.state.map.h === 64, 'saved hero CTA lost the wide preset dimensions');

  game.toMenu();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: 'wide-96x64', faction: 'player' }));
  const fallback = ui.restoreQuickBattleConfig();
  assert(!fallback.isSaved && fallback.presetId === 'square-64' && fallback.faction === null, 'invalid saved setup did not fall back safely');
  scrolls = 0;
  el('btn-quick-primary').click();
  assert(scrolls === 1 && !game.started, 'invalid storage did not route to explicit selection');
});

console.log(failures.length ? `\nИТОГ SIM_MENU: ${failures.length} ПРОВАЛОВ (${failures.join(', ')})` : '\nИТОГ SIM_MENU: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failures.length ? 1 : 0);
