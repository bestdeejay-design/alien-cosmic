# Controls — mouse, keyboard, camera

Verified against `js/input.js` and `js/ui.js`. Hover any button —
the tooltip shows price, stats and role.

## From the launch deck

In Quick Battle, choose one of the six map spans and a side, then commit
through the button that names the selected setup. A first visit recommends
64×64, but never picks a faction for you. Your last sortie returns ready for
a one-action launch. Campaign lives on its own card: its button resumes the
mission named by campaign progress, never a quick battle.

## Mouse

| Gesture | Action |
|---|---|
| LMB | Select; drag — box selection |
| Double-click a unit | Every matching unit on screen |
| RMB (own building selected) | Rally point (on a crystal — new workers start mining at once) |
| RMB on an enemy | Attack |
| RMB on a crystal | Mine (the first goes to the clicked one, the rest spread) |
| RMB on damaged own unit/structure | Repair (two techs per target, surplus keeps mining) |
| RMB on a bunker (infantry selected) | Garrison it |
| RMB on a half-built structure | Send workers back to construction |
| RMB on the ground | Formation move (slots are verified — never "into a wall") |
| `A + LMB` | Attack-move: advance and engage everything en route |
| Wheel / two fingers | Pan the map |
| Middle button (hold) | "Grab" the map and drag |
| Minimap: LMB / drag | Jump / steer the camera |
| Minimap: RMB | Order from any point of the map |

Walls and turrets (all 1×1) are placed in a line: hold LMB in build
mode and drag — the preview shows the price. Exit build mode with RMB/Esc.

## Keyboard

| Key | Action |
|---|---|
| `B` | Build menu, then type: `Q` CC, `W` home, `E` barracks, `R` turret, `T` bunker, `Y` wall, `U` factory, `I` lab |
| `Q/W/E` | Production in barracks/factory; `R` — grade a building |
| `T` | Factory: scout; laboratory: Auto-Repair (after CC Tier II); CC Tier III: Recon |
| `G` | CC Tier III: Rally — idle units head for the rally point |
| `Q/W/E/R/T` | Research in the lab; `T` — Auto-Repair behind CC Tier II |
| `S` | Stop | `X` | Cancel / back |
| `F` | Release garrison | `A` | Attack-move |
| `P` | Pause (Esc releases) | `V` | Hide/show panel |
| `Space` | Jump to base | `H` | Jump to the last alarm |
| `Tab` | Cycle fighters one by one (with camera) |
| `.` | Next idle worker (with camera) |
| `,` | Select the whole army |
| `+ / −` | Zoom 0.5–2.0 anchored under the cursor |
| Arrows / screen edge | Camera (UI panels are dead zones) |
| `1…9` | Select squad; `Ctrl/Shift/Alt + digit` — assign; double-tap — jump (350ms window) |
| `Enter` | Place the building under the ghost (arrows — move it) |

[Screenshot H — CC Tier III with T/G buttons (awaiting capture)](img/todo-h-cc-g3.md)

## Panel and camera

The command panel can be moved (bottom / left / right / top — the
"Panel" button on the panel itself) and hidden with `V`; the choice
is remembered. In every position the camera keeps the target in the
visible area — it never drives units under the panel. Building
statuses (production, research, garrison) are visible right in the world.

Select one of your structures for a live station readout: build progress
without a guessed timer, and production, research or tier-upgrade progress
with an ETA when the remaining time is known. Standby, garrison and fire
states stay explicit, with no pretend progress bar. Queue chips show the
refund before you cancel; `X` does the same for research and tier work.
Hover, focus or tap a dimmed command to learn why it is locked or short
on resources. After victory or defeat, orders fade while the inspector
remains readable.

Edge scroll: bring the cursor to the edge of the play area — the rim
lights up turquoise (the pan zone), and the camera starts after a
short delay, so brushing past toward the panel does not drag the
camera away. Over panels and the top bar the zones go dark: the
camera does not react there. Cursor outside the window — scrolling
freezes. Formations reach the edge of a map of any size (48–96):
group orders are no longer clamped to the legacy 64×64 tiles.

## Trackpad (no mouse)

RMB — two-finger tap or `Ctrl+tap`; box — tap + drag; pan — two-finger
scroll. Assign squads via `Alt+digit` (`Ctrl+digit` is taken by Spaces,
`Cmd+digit` — by browser tabs). Full no-mouse cycle: `.`, `B`, building
key, tap, `,` — and you are back with the army.
