# R3-A Phase 1 — Playwright touch audit

**Scope:** audit only. No application code or game data was changed. The audited build is the archived remote `main` at **`ce01b41`** (canonical R3-A v2); deliverables are this report, screenshots, research, and the mailbox self-audit.

## Method and coverage

- Playwright Core **1.64.1**, headless Chromium **153.0.8010.0**, Node **22.22.3**; browser context used `isMobile: true`, `hasTouch: true`, DPR 1. The context reported coarse-pointer/touch support.
- Every game/menu action was a touch tap, touch swipe, or touch pinch (`Input.dispatchTouchEvent`). No mouse or keyboard input was used to operate the game. Viewport changes were test setup, not game input.
- Three required viewport sizes were exercised: **390×844**, **844×390**, and **360×740**. Menu layout was sampled at all three; live game flows included M0, M1 defense, M3, and Quick Battle 96×64 vs AI. RU and EN M0 placement were both checked.
- Test-only campaign progress was seeded in local storage to open M1/M3. M3 was reached by touch-scrolling the mission list; it was not unlocked by a played campaign win.
- No page errors or console errors were observed in the completed runs.

| Run | Route and touch actions | Result |
|---|---|---|
| M0 / RU, 390×844 | Campaign → start; tap worker; Build → “Дом”; tap occupied Command Center | Worker selection/build menu work. Invalid placement shows “Здесь строить нельзя”, but placement stays active and has no visible touch cancel or type-switch control. |
| M1 defense / RU, 390×844 | Campaign → all missions → “Ночь штырей” → “В бой!” | Defensive mission starts and renders its briefing/objective. One tap aimed at a moving worker did not select it; treated as an inconclusive target-timing attempt, not a confirmed product defect. |
| M3 / RU, 390×844 | Seed test progress 3; touch-swipe mission list to “Рудник-7”; briefing → start; tap worker | Touch scrolling reveals the fourth card; M3 starts on 88×88 and worker selection succeeds. |
| Quick Battle / RU, 96×64 vs AI | Hero CTA → select 96×64 → select Гелиос → start; tap minimap; drag field/minimap | Preset/faction/start path works; game starts on 96×64 against AI. Minimap tap moves camera; minimap and field drags do not. Idle probe reached 2:27 game time without an end state. |
| Quick Battle / RU, 48×48 loss probe | Select 48×48 → Гелиос → start; leave the live match to run | Natural defeat occurred at about 2:42–2:59 game time. The loss screen rendered; only one “Играть снова” button was present. No game state was forced. |
| M0 / EN, 390×844 | Campaign → start; tap worker; Build → “Depot”; tap occupied base | EN labels and failed-placement toast (“Cannot build here”) are present; the same touch-cancel gap reproduces. |

## Findings

No P0 findings. P1 denotes a core touch flow blocked or a large loss of usable playfield; P2 denotes a substantial usability/visual issue that does not stop starting a match.

### A-01 — P1 — Building placement has no usable touch cancel or type switch

- **Surface:** worker build mode.
- **Failure:** After choosing a building, the command grid disappears. The visible hint only offers RMB/Escape cancellation; there is no ✕ beside the ghost or floating cancel chip. Another building type cannot be selected while placement is active. An invalid tap does show a localized error toast, but leaves placement active.
- **Reproduction:** At 390×844, start M0, tap a worker, tap **Build**, tap **Дом** (EN: **Depot**), then tap the occupied Command Center. The toast appears and the ghost remains; the command grid stays empty.
- **Evidence:** `m0-placement-mode-390x844.png`, `m0-invalid-placement-390x844.png`, `m0-en-placement-390x844.png`, `m0-en-invalid-placement-390x844.png`.

### A-02 — P1 — Portrait topbar actions are outside the viewport

- **Surface:** in-game topbar at 390×844 and 360×740.
- **Failure:** At 390px, the topbar has `scrollWidth=751` and `clientWidth=390`; Pause begins at x≈495, Restart at x≈580, Exit at x≈673. The row is clipped by the viewport and is not horizontally scrollable. At 360px the same row is clipped further. Thus pause/restart/exit/sound are not reachable by touch in portrait. At 844×390 the controls fit.
- **Reproduction:** Start M0 or the 96×64 skirmish in either portrait viewport and inspect/tap the topbar; only the brand/resources/time are visible.
- **Evidence:** `m0-start-390x844.png`, `skirmish-96x64-390x844.png`, `skirmish-96x64-360x740.png`.

### A-03 — P1 — Landscape bottom panel hides most of the field and starting units

- **Surface:** default bottom command panel at 844×390.
- **Failure:** In M0, the panel is 191px high (placing hint: 206px). With the 44px topbar, only 155px (or 140px in placement mode) remain as visible playfield—about 36–40% of the viewport. On the fresh landscape M0 start, a worker’s screen coordinate was y≈211 while the panel begins at y=199, so the starting unit is behind the panel and the touch misses it. Moving the panel or hiding it is a workaround, not a suitable default.
- **Reproduction:** Load at 844×390, start M0, leave the panel at bottom, and tap the worker near the panel edge. Repeat in placement mode to see the panel grow.
- **Evidence:** `m0-start-844x390-unselected.png`, `m0-placement-844x390.png`, `m0-paused-844x390.png`.

### A-04 — P1 — One-finger touch drag does not pan either the map or minimap

- **Surface:** world field and `#minimap` in a live match.
- **Failure:** A touch drag across empty field leaves the camera unchanged; dragging across the minimap also leaves it unchanged. A single tap on the minimap does jump the camera. This makes touch navigation depend on repeated taps and the current visible area.
- **Reproduction:** Start the 96×64 skirmish at 390×844. Tap the minimap once and note the camera change; then drag across the minimap and drag on empty field. Both drags leave camera x/y unchanged.
- **Evidence:** `skirmish-96x64-390x844.png`; measured camera snapshots are recorded in the Phase 1 run log and mailbox entry.

### A-05 — P1 — Pinch zooms the browser viewport, not the game

- **Surface:** two-finger gesture over the 390×844 game canvas.
- **Failure:** Pinching apart changed `visualViewport.scale` from 1 to 1.12 while `game.state.camera.z` remained 1. The page/UI then appears enlarged and clipped; the RTS view itself does not zoom. No visible +/- controls or zoom indicator were found.
- **Reproduction:** Start M0, pinch the field from roughly 70px to 140px finger separation, and compare browser scale with game zoom.
- **Evidence:** `m0-final-390x844.png` (post-pinch clipped viewport).

### A-06 — P2 — Wide-map minimap is small and letterboxed

- **Surface:** command-panel minimap in Quick Battle 96×64.
- **Failure:** The CSS canvas is 102×102 at 390px, but the 96×64 map is rendered as about 102×68, leaving roughly 17px of unused strip above and below. The bitmap remains fixed at 176×176. Tap-to-jump works, but the wide-map image is smaller than its slot and the touch-drag path still fails (A-04).
- **Reproduction:** Select the 96×64 preset and start the skirmish at 390×844; inspect the minimap. The same letterbox is visible at 844×390 and 360×740.
- **Evidence:** `skirmish-96x64-390x844.png`, `skirmish-96x64-844x390.png`, `skirmish-96x64-360x740.png`.

### A-07 — P2 — Pause label is occluded by the panel in landscape

- **Surface:** pause overlay at 844×390.
- **Failure:** The pause text is centered on the full viewport and sits underneath the bottom panel; only its upper portion remains visible. The topbar Resume control still works. This is a layering/placement issue, not a pause-state failure.
- **Reproduction:** At 844×390, tap Pause in M0 and inspect the center of the screen.
- **Evidence:** `m0-paused-844x390.png`.

### A-08 — P2 — Campaign/briefing/codex overlays show inactive game chrome behind them

- **Surface:** mission list, mission briefing, and Codex overlays at 390×844.
- **Failure:** Resource/time HUD and bottom-panel controls remain visible at the modal edges/behind its dim backdrop. A tap on the exposed-looking “Панель: низ” at y≈812 is intercepted by `#mission-overlay`, so it is visible but inert. This adds clutter and resembles a live control.
- **Reproduction:** Open Campaign → All missions, a briefing, or Codex from the landing page; tap the visible-looking panel control below the modal card.
- **Evidence:** `missions-390x844.png`, `briefing-M0-390x844.png`, `codex-390x844.png`, `missions-overlay-edge-390x844.png`.

### A-09 — P2 — Several mobile targets and instructions remain mouse-sized/mouse-only

- **Surface:** landing navigation, campaign buttons, game topbar/panel controls, and control help.
- **Failure:** Measured heights include header nav links 20–25px, language selector 25–27px, hero CTA 39px at 390px, campaign start/browse buttons 36px, topbar actions 28px, and panel position/hide buttons 21px. Quick Battle preset/faction cards are larger at 62/68px. The “Управление” copy and build-mode hint still describe LMB/RMB/Escape rather than touch alternatives.
- **Reproduction:** At the listed viewport sizes, inspect the landing header and start M0; open the Controls disclosure and placement mode.
- **Evidence:** `menu-390x844.png`, `menu-844x390.png`, `menu-360x740.png`, `controls-open-390x844.png`, `m0-placement-mode-390x844.png`.

### A-10 — P1 — Defeat screen has no Home action

- **Surface:** end screen after a natural Quick Battle defeat, 390×844.
- **Failure:** The runtime defeat overlay shows a single “Играть снова” button. There is no “На главный экран” action. In portrait the topbar Exit is already clipped (A-02), and the overlay dims/covers the underlying game, so the result screen has no visible path back to menu.
- **Reproduction:** Start Quick Battle 48×48 as Гелиос vs AI by touch and let the AI win naturally. At roughly 2:42 battle time, the defeat overlay appears. The result itself was reached without scripted game-state changes.
- **Evidence:** `end-probe-screen-390x844.png`. The replay button was visually inspected; its touch activation was not tested. Campaign-victory “Следующая” flow remains source-only.

## Surfaces checked and not checked

**Checked by touch:** landing/home and hero Quick Battle CTA; all six map presets and both faction cards were visible, with 96×64/Гелиос selected for the run; campaign start and mission list; touch-scroll to M3; M0 direct campaign start and M1/M3 briefings/starts; Codex; Controls and More disclosures; placement failure feedback; pause/resume; all four panel positions and hide/show; topbar reachability; minimap tap and drag; viewport resize 390×844 ↔ 844×390 ↔ 360×740; RU and EN placement copy; a natural Quick Battle defeat screen (48×48).

**Not verified by a natural gameplay result:** campaign victory and its “Следующая” briefing flow. M0 and the 96×64 skirmish did not end during their shorter probes; a separate 48×48 AI skirmish did naturally reach defeat at about 2:42 battle time. The loss overlay was touch-reached and visually inspected, but its only “Играть снова” button was not activated by touch. Source inspection confirms the button restarts without `pendingNext` and routes to the next briefing when `pendingNext` is set; no separate “На главный экран” button exists. RU/EN victory end paths are therefore still open.

**Also not covered here:** hardware-device/browser differences, native fullscreen F1–F6 end-to-end, keyboard/focus behavior, every preset, and mission completion. Basic viewport resize was observed to recalculate the canvas/panel insets; the full M2 fullscreen/resize contract must still be rerun in Phase 2.

## Phase 1 boundary

No code, map generation, mission data, campaign progression, or runtime invariants were modified. No Phase 2 implementation has started. See `design/R3A_RESEARCH.md` for options, recommendations, effort/risk, and the proposed Phase 2 acceptance gate.
