# Alien Cosmic — Press Kit

## Факты

- **Название:** Alien Cosmic — Frontier-64 RTS
- **Жанр:** Браузерная RTS (реального времени), одиночная кампания + скирмиш, план сети — PvP
- **Стек:** Чистый JavaScript (ES-модули), Canvas 2D, Web Audio. Без фреймворков, бандлеров, внешних ассетов
- **Хостинг:** GitHub Pages — статичный сайт, https://bestdeejay-design.github.io/alien-cosmic/
- **Карта:** 64×64 тайла (2048×2048 px), `TILE=32`, биомы 3 (mars/nest/moon), генератор с симметрией
- **Логика:** 30 Гц фиксированный шаг (`LOGIC_DT=1/30`), рендер rAF с интерполяцией, потолок кадра 0.25 с
- **Юниты:** 8 ролей ×2 облика (зеркальные статы), `UNITS` в `js/config.js`
- **Здания:** 8 типов + грейды Г2/Г3, `BUILDINGS`/`GRADES` в `js/config.js`
- **Улучшения:** 4 ветки ×3 (infAtk/infArm/vehAtk/vehArm) + Авторемонт (CC Г2)
- **Кампания:** 15 миссий, 3 акта, 3 силы (Гелиос/кхарид/Красный флаг), `js/missions.js`
- **Сезон-2:** 15 миссий, 3 главы 64→128, 21 механика, сценарий в `SCENARIO.md` (изоляция `s2/`)
- **Авто-режимы:** A+ЛКМ атака-движение, огонь на задаче, авто-добыча/возврат, точка сбора на кристалле, двойной клик, анти-застревание 3.0
- **Туман:** 3 состояния + призраки, миникарта 168×168, зум 0.5–2.0, пинги
- **Версия:** `Y` от 22.10.2026 (см. `js/config.js:GAME_VERSION`)
- **Автор:** bestdeejay-design

## Ссылки

- Игра: https://bestdeejay-design.github.io/alien-cosmic/
- Репо: https://github.com/bestdeejay-design/alien-cosmic
- Вики: https://bestdeejay-design.github.io/alien-cosmic/docs/wiki/
- Лор: LORE.md / LORE.en.md
- Вижн: VISION.md
- Сценарий С2: SCENARIO.md
- Промо-тексты: docs/SEASON2_PROMO.md, promo/social-pack.md

## Скриншоты

- `design/shots/*` — геймплей, меню, биомы, миссии p5/p6/p7/p8/r3a
- `assets/planets/*.svg` — 3 планеты (MARS-референс)
- `assets/og-image.png` — 1200×630 шапка

## Лого и палитра

- Лого: ALIEN **COSMIC** (Inter 900, трекинг .13em), бирюза `#76e3d7` vs огонь `#ff806e`
- Фон: `#071218`, панели `#0d2028`, янтарь `#f3c579`, текст `#e9f8f2`, muted `#91adae`

## Контакты

Владелец — bestdeejay-design (через GitHub issues + `design/ARENA_MAILBOX.md`).

---

*Пресс-кит статичен — раздаётся с Pages. Обновляй при релизе Сезона-2.*
