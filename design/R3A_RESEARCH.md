# R3-A Phase 1 — Research and recommendations

**Status:** owner-review package; **no Phase 2 code has started**. This document compares implementation options against the touch audit in `design/R3A_AUDIT.md`. Estimates are planning ranges, not commitments. The audit targets archived `main` **`ce01b41`**.

## Decision 1 — Touch placement and cancel

The M0 touch run confirmed a real dead end: after a worker chooses a building, the command grid disappears. The help says RMB/Escape, neither available as a visible touch action. An invalid placement does show a localized toast, but it does not exit placement. The audit also confirms that a different build type cannot be chosen from the active placement screen.

| Option | Behavior | Estimated cost and risk |
|---|---|---|
| **A. Ghost-side ✕ only** | Show a 44px+ cancel target beside the building ghost; keep the existing invalid-placement toast. | ~3 app files (`ui.js`, `style.css`, RU/EN strings) + focused test; low–medium risk. The target can overlap the field or be difficult to reach at screen edges. |
| **B. Persistent panel cancel chip only** | Keep a visible “Отмена”/“Cancel” chip in a fixed safe area of the command panel while placing. | ~3 app files (`ui.js`, `style.css`, RU/EN strings) + focused test; low–medium risk. It is easier to hit but farther from the ghost and can be obscured by a collapsed/landscape panel. |
| **C. Two accessible cancel affordances and live type switching** | Show ✕ by the ghost and a fixed cancel chip; keep or restore the build palette; tapping another building type changes the active ghost without exiting. Invalid placement remains active and gives an explicit toast. | ~4–5 app files (`ui.js`, `game.js`, `style.css`, RU/EN strings) + touch regression; medium risk because placement state, palette state, and panel resize must stay synchronized. |

**Recommendation: C.** Give the ghost-side control and panel chip the same cancel action, and make both reachable without relying on the current panel position. Keep the selected worker. A different build choice should replace `st.placing.type` directly; do not trap the player in a cancel/reopen loop. Preserve the existing localized failure toast—the audit verified that it appears in both RU and EN.

## Decision 2 — Landscape command panel

At 844×390 the default bottom panel measured 191px; placement text grew it to 206px. With a 44px topbar, only 155px (140px while placing) remained visible as playfield. A starting M0 worker’s computed screen point fell behind the panel. The present responsive rules are width-based and do not adapt the bottom layout to short landscape height.

| Option | Behavior | Estimated cost and risk |
|---|---|---|
| **A. Retain the fixed bottom panel** | Keep the current 190px minimum and allow content growth. | 0 app files; low implementation risk, **high UX risk**. Reject for short landscape. |
| **B. Compact/collapsed bottom shelf** | In short landscape, use a narrow action row with a clear expand/collapse affordance; show the minimap and detailed selection card only when expanded. | ~2–3 app files (`style.css`, `ui.js`, possibly `game.js`) + resize tests; medium risk because panel dimensions feed camera insets. |
| **C. Move the full panel to a side rail in landscape** | Keep the existing bottom layout in portrait; use a right-side rail in landscape so playfield height is preserved. | ~3 app files (`style.css`, `ui.js`, `game.js`) + tests; medium risk, with less horizontal playfield on narrow devices and more orientation/position interactions. |

**Recommendation: B**, with C retained as an explicit user choice if the owner prefers a persistent minimap. Add orientation- and height-aware rules (for example, landscape with a short viewport), target a compact state below roughly 25% of viewport height, and keep the remaining playfield clearly usable. Expanded controls still need touch-sized targets. Recompute actual `getPanelInsets()` after each state change; do not replace the existing measurement/`ResizeObserver` contract with CSS-only assumptions. Preserve all four user-selectable panel positions.

## Decision 3 — Existing `#minimap` geometry and touch input

This is the command-panel minimap—not a new Quick Battle map-preview feature. On a 96×64 map, the current 176×176 bitmap letterboxes the map to about 176×117px; at 390px the CSS canvas is 102×102, leaving about 17px of unused strip above and below. The rendered map is therefore only about 102×68px. A tap jumps correctly; a touch drag does not. `ui.js` also hardcodes bitmap size `176` in its transform.

| Option | Behavior | Estimated cost and risk |
|---|---|---|
| **A. Keep square letterboxing, enlarge the square** | Preserve the existing transform and make the canvas/slot bigger. | ~2–3 app files (`style.css`, `ui.js`, perhaps `index.html`) + tests; low–medium risk, but dead strips remain and the visible map still underuses the slot. |
| **B. Aspect-aware, full-bleed slot with one shared transform** | Size the preview slot to the actual map aspect; draw the map edge-to-edge without letterbox strips or distortion. Derive bitmap dimensions from the actual canvas and map dimensions. Use that same transform for tap-to-jump and touch-drag pan. | ~3–4 app files (`index.html`, `style.css`, `ui.js`, optional `game.js`) + map-size tests; medium–high risk because render and hit-test geometry must stay identical across square/wide/tall maps and resize. |
| **C. Crop or stretch to fill the square** | Fill the current square by cropping edges or distorting the map. | ~2–3 app files + tests; medium–high risk to map-edge fidelity and camera targeting. Reject. |

**Recommendation: B.** Make the minimap larger in responsive layouts while respecting the panel’s compact state; use a full-bleed aspect-aware box for 96×64, 64×96, and square maps. Read `canvas.width`/`height` and actual bounding-box dimensions rather than a literal 176. Keep tap-to-jump; add touch pointer capture so dragging within the minimap pans continuously. Scope `touch-action` to the minimap only, and test the map frame, input transform, and camera in all three aspect ratios. Do not modify `map.js` or map generation.

## Decision 4 — End-screen actions and campaign continuation

A natural 48×48 Quick Battle defeat was reached after about 2:42 battle time; the result screen was visually inspected, but its button was not activated. The 96×64 idle probe remained active after 2:27. The defeat overlay contains one “Играть снова” button; source inspection shows its label changes to “Следующая” when a campaign successor is pending, and the handler restarts or opens the next briefing. A separate home action is absent. Campaign victory/next was not reached naturally.

| Option | Behavior | Estimated cost and risk |
|---|---|---|
| **A. Keep one context-sensitive action** | Rename the single button to “Следующая”/“Ещё раз” and keep no Home action. | ~2–3 app files; low risk, but does not meet the requested Home + Replay actions. Reject. |
| **B. Home and Replay always; Next only when applicable** | Add “На главный экран” → `game.toMenu()` and “Ещё раз”/“Реванш” → `game.restart()`. On campaign victory with `pendingNext`, add a separate “Следующая миссия” action that opens the existing next briefing. | ~4–5 app files (`index.html`, `ui.js`, `style.css`, RU/EN strings) + end-flow tests; medium risk due to `pendingNext`, progress, and focus order. |
| **C. Add a separate end-screen mode chooser** | Route to a secondary menu for Home/Replay/Next. | ~5–6 app files + more state/tests; high risk and an unnecessary extra tap. |

**Recommendation: B.** Keep Home and Replay independently available on victory and defeat. On campaign victory, preserve the next-mission briefing as a third explicit action; do not overload Replay with Next. Keep campaign progress semantics unchanged. Localize all labels in RU/EN and preserve focus order/keyboard activation.

## Decision 5 — Zoom and touch gestures

Touch testing found no game pinch handler: the browser page zooms instead, while game zoom remains unchanged. A one-finger drag on the empty field or minimap does not move the camera. No visible +/- controls or zoom indicator were found. The current contextual order is mouse-right-click based.

| Option | Behavior | Estimated cost and risk |
|---|---|---|
| **A. Minimal touch layer** | Add visible +/- buttons and a zoom indicator; leave map drag/right-click as mouse/keyboard-only. | ~3–4 app files (`ui.js`, `style.css`, `index.html`, RU/EN strings) + tests; medium risk, but leaves touch navigation/context commands incomplete. |
| **B. Direct-manipulation touch model** | Pinch zoom anchored at the gesture midpoint; visible +/- and zoom indicator; empty-field drag pans; drag starting on a friendly unit box-selects; a ~450ms long press on the field issues the right-click equivalent. Cancel long-press on movement (suggested threshold 8–10px) or a second pointer. | ~5–6 app files (`input.js`, `game.js`, `ui.js`, `style.css`, `index.html`, RU/EN strings) + interaction tests; high risk due to tap/drag/selection/pinch arbitration. |
| **C. Two-finger navigation** | Reserve two-finger drag for pan, pinch for zoom; single-finger drag always box-selects; long-press supplies the context order. | ~4–5 app files + tests; high risk and less discoverable on small screens. |

**Recommendation: B.** Use a deliberate split: one-finger drag on empty terrain pans; drag beginning on a friendly unit starts box-select; taps still select; pinch zooms around its midpoint; a short visible +/- control and indicator provide discoverable alternatives. Treat long-press as the RMB equivalent, canceled on movement or a second contact. Restrict gesture suppression to the game canvas/minimap; do not block scrolling of the landing page, mission list, briefing, or Codex. Retain existing mouse, keyboard, and focus behavior.

## Phase 2 guardrails and proposed acceptance gate

1. Obtain explicit owner approval before implementation. This is still Phase 1.
2. Keep `map.js`/`missions.js` generation, mission data, IDs, progression, seeds, and existing P1/G.6/R2-C/R2-D invariants unchanged.
3. Preserve the M2 fullscreen/resize contract F1–F6. Phase 1 tested viewport resizing only; Phase 2 must run F1–F6 end-to-end, not infer them from the resize probe.
4. Test all four panel positions and hidden/show states at 390×844, 844×390, and 360×740; verify the visible playfield and actual measured insets after resize/orientation/fullscreen.
5. Run at least four fresh `hasTouch` flows: M0 placement/cancel/failure/switch, M1 defense, M3/M4, and 96×64 skirmish versus AI. Add touch traces/screenshots and check RU/EN parity.
6. Verify minimap tap/drag and full-bleed geometry on square, wide, and tall maps; gesture behavior on canvas; zoom clamp/anchor; native page zoom remains stable.
7. Verify end-screen Home/Replay/Next flows for win/loss, including campaign continuation and progress, in RU and EN.
8. Re-run `scripts/check.mjs`, all simulation/smoke/audit checks, `ac_g_browse`, pageerrors, focus/keyboard, and M2 F1–F6. No implementation or test changes belong to Phase 1.

## Owner decisions requested

The numbered decision questions are appended to `design/ARENA_MAILBOX.md`. In short: confirm the combined placement affordances, compact landscape default, full-bleed minimap, distinct end-screen actions, gesture model, and Phase 2 regression gate. No option above is treated as approval until the owner explicitly responds.
