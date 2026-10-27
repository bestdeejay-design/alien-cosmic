# Promo Social Pack — тексты, баннеры, рассылка

> Всё — из канона `LORE.md` + сценария `SCENARIO.md` + ленда `index.html#planets`. Для копипасты в VK/TG/X/IG/Discord. Сохрани в `promo/` и на Pages.

---

## Баннеры — что экспортировать из репо

| Баннер | Из чего | Размер | Текст на картинке |
|---|---|---|---|
| **OG-image** (уже есть) | `assets/og-image.png` | 1200×630 | ALIEN COSMIC · FRONTIER-64 RTS |
| **Планета Актан-4** | `assets/planets/aktan-4.svg` → PNG | 1080×1350 (IG) | АКТАН-4 · 0.42 EARTH MASS · HIGH ERG FIELD |
| **Планета Брок-Тхаал** | `assets/planets/brok-thaal.svg` | 1080×1350 | BROK-THAAL · BROOD SONG 9.3 Hz |
| **Планета Селенит-Б** | `assets/planets/selenite-b.svg` | 1080×1350 | SELENITE-B · 3420 km · EYE OF THE STORM |
| **System Map** | `#planets .system-map` (скрин) | 1200×630 | SABGIR SECTOR — ORBITAL VIEW |
| **Скрин боя 40×40** | `design/shots/gameplay-*` или `smoke.mjs` стресс | 1920×1080 | без текста (только бой) |

Экспорт: открыть SVG → `rsvg-convert -w 1080` или скрин 2× в браузере. Текст на картинке — уже в SVG (не добавлять).

---

## VK — 3 поста (короткий, средний, длинный)

### VK-1 — Короткий (анонс планет)

> Рубеж-64 получил карту. Три мира — три поля боя.
>
> **Актан-4** — ржавчина и соль. **Брок-Тхаал** — песня выводка. **Селенит-Б** — Око бури.
>
> Эрг растёт только здесь. Кто владеет полями — кормит полсистемы.
>
> Лендинг теперь с орбитами как на плакате MARS: загляни → https://bestdeejay-design.github.io/alien-cosmic/
>
> #AlienCosmic #RTS #инди

### VK-2 — Средний (геймплей)

> **8 юнитов. 8 зданий. 3 биома. 15 миссий. Браузер. Бесплатно.**
>
> Alien Cosmic — RTS без установок: чистый JS, Canvas, Web Audio. 64×64 тайла, 30 Гц логика, авто-режимы (A+ЛКМ, авто-добыча, лечение на марше).
>
> Две расы — один баланс: Гелиос (ховер + плазма) vs кхарид (органика + кислота). Каждая миссия — новый юнит или враг (как в StarCraft).
>
> Играть: https://bestdeejay-design.github.io/alien-cosmic/
> Вики: https://bestdeejay-design.github.io/alien-cosmic/docs/wiki/

### VK-3 — Длинный (лор + Сезон-2)

> **В 2189 человечество держится на эрге**
>
> Эрг-кристалл растёт лишь в трёх местах Сектора Сабгир. Все три — чужие миры.
>
> «Гелиос-Индастриз» считал кхарид неразумной фауной — пока дюны не встали. Теперь на Актан-4 молчат шахты, на Брок-Тхаале — святые поля, а на Селените-Б — Око бури.
>
> Третья сила — «Красный флаг» — строит «Глушитель», гасящий эрг-поля целого региона. Без эрга падут и корпорация, и рой.
>
> Сезон-1 (15 миссий) уже в игре. Сезон-2 — 15 миссий про сеть связи: ретрансляторы включает только герой, разрыв = слепой КЦ, а на 13-й — выбор «пощадить или добить». Твоя `mercy` решит, придёт ли союзник в финале и какой будет концовка — мир или война.
>
> Лендинг: https://bestdeejay-design.github.io/alien-cosmic/
> Вижн: VISION.md
> Лор: LORE.md

---

## Telegram — 2 поста

**TG-короткий (300 симв)**

> 🛰️ **Три планеты — три фронта**
> Актан-4 · Брок-Тхаал · Селенит-Б. Новый лендинг — как плакат MARS: орбиты, гравитация, эрг. Анимация — чистый SVG.
> 15 миссий внутри. Ещё 15 — в Сезоне-2: сеть, ретрансляторы, 2 концовки.
> ▶️ https://bestdeejay-design.github.io/alien-cosmic/

**TG-карточка (с гиф)**

> 🔥 **Бастион vs Кристожал: кто кого?**
> Бастион — 260 HP, сплэш 46/0.6. Кристожал — 52 HP, 7×0.85с. Подсказка: бастион без прикрытия — корм для Скифа (158 скор).
> Гиф боя + вики юнитов → docs/wiki/units.md

---

## X/Twitter — тред + одиночные

**Тред 5 (копипаст как в VISION.md §8)** — уже готов.

**Одиночные для рандомных дней:**

> Indie RTS in your browser. No install. Canvas + Web Audio. 64×64, 30 Hz, deterministic. 8 units ×2, 8 buildings, 3 biomes. → bestdeejay-design.github.io/alien-cosmic/ #RTS #indiedev

> The Frontier holds. The erg flows. Helios vs Kharid. You decide which children to steal. #AlienCosmic

---

## Instagram — карусель + Reels

**Карусель (3):** постеры планет как в #planets, подпись единая:

> Three worlds. One frontier.
> AKTAN-4 — rust + salt. BROK-THAAL — crystal + song. SELENITE-B — crater + rift.
> Browser RTS · Free · No install → link in bio
> #RTS #IndieGame #BrowserGame #AlienCosmic #Frontier64

**Reels (15 с):** геймплей добыча+стройка+бой, финальный титр 3 планеты, CTA.

---

## Discord / Reddit — devlog

> **Devlog: Как мы перестали терять юнитов в стенах**
>
> Симптом: юнит застревает в вогнутом кармане «П» или долбится в новый дом на маршруте.
> Что сделали: маршрут с габаритом корпуса (r×0.8), веер руления 11 проб + правило одной руки, лестница эскалации (обход → уступка → боковая ступенька → спокойная сдача `!`), разрыв цикла одинаковых репутей, строй по карте.
> Доказательства: `scripts/audit_move.mjs` A1–A8 + `sim_move.mjs` S1–S5 — зелёные.
> Подробности: AUDIT_REPORT.md + DESIGN_SYSTEM.md

---

## YouTube описание (под трейлер)

> Alien Cosmic — браузерная RTS о войне за эрг на Рубеже-64. 15 миссий, 2 расы, 3 планеты, 8 юнитов ×2, 8 зданий, авто-режимы. Чистый JS, Canvas 2D, Web Audio — без установок. Играет на GitHub Pages.
>
> Играть: https://bestdeejay-design.github.io/alien-cosmic/
> Вики: https://bestdeejay-design.github.io/alien-cosmic/docs/wiki/
> Лор: https://bestdeejay-design.github.io/alien-cosmic/LORE.md
> Пресс-кит: https://bestdeejay-design.github.io/alien-cosmic/promo/presskit.md
>
> #RTS #IndieGame #BrowserGame

---

## Рассылка — тема и тело

Тема: «Рубеж-64 получил планеты — и таймер Сезона-2»

Тело — см. `docs/SEASON2_PROMO.md` §5 (копипаст).

---

*Шаблоны баннеров: открой `assets/planets/*.svg` в Figma → экспорт PNG. Гиф боя: запись экрана 40×40 стресса (Chrome DevTools → Recorder).*
