// ============================================================
// stamp.mjs — ЕДИНЫЙ источник версии модулей для headless-симов.
//
// Зачем: r/js/* импортируют друг друга как './ui.js?v=NNN'. Если сим поднимет
// модуль с другим стемпом, node создаст ВТОРУЮ копию модуля (двойные els,
// двойные счётчики) — так сломался E9 при смене стемпа 26.10.2026.
// Теперь стемп читается из r/index.html, и рассинхрон невозможен.
// ============================================================
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../r/index.html', import.meta.url), 'utf8');
const m = /(?:style\.css|game\.js)\?v=([0-9A-Za-z._-]+)/.exec(HTML);
if (!m) throw new Error('stamp: в r/index.html не найден параметр ?v= у style.css/game.js');
export const STAMP = m[1];
export const V = '?v=' + STAMP;
