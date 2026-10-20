# scripts/shots — генераторы скриншот-артефактов

Пересборка эталонных снимков юнитов/зданий/геймплея из живого кода,
чтобы не собирать их вручную заново. Результат кладётся в `design/shots/`
(WebP, lossless).

## Запуск

```bash
# 1. Сервер из корня репо
python3 -m http.server 8079 &

# 2. Нужен playwright (npm i -D playwright && npx playwright install chromium)
#    Либо NODE_PATH на машину с уже установленным playwright.

# 3. Всё разом (9 снимков):
node scripts/shots/grids_and_gameplay.mjs

# Детальный лист состояний юнитов (5 состояний x 7 типов x 2 фракции):
node scripts/shots/unit_sheet.mjs
```

ENV: `GAME_URL` (свой порт/хост), `OUT` (папка результата, default
`design/shots`), `SCALE` (для unit_sheet, default 2).

## Social preview

`python3 scripts/shots/og_image.py` builds `assets/og-image.png` at exactly
1200×630. The PNG is generated from code (Pillow required: `pip install
pillow`), not hand-edited; its planet, orbital tracks, two scouting silhouettes,
mineral shards, typography, and palette follow the landing hero.

## Харнессы (страницы, которые снимает playwright)

- `unit_grid.html` — юниты 7×2 в игровом масштабе (`__GRID_DONE__`)
- `unit_sheet.html` — юниты 7×2×5 состояний с зумом ×4 (`__U_DONE__`)
- `building_grid.html` — здания 8×2 в масштабе ×2 (`__B_DONE__`)

Состояния в `unit_sheet.html`: покой / на ходу / выстрел (откат и жар
дула) / груз-кристалл у рабочего, жар у боевых / ранен (кольцо выделения,
HP-бар, вспышка урона).

## Что считать эталоном

Все снимки — рендер актуального `main`. Если спрайт в игре отличается от
листа — код поменялся, лист надо перегенерить, а не править руками.
