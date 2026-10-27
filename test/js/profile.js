// ============================================================
// profile.js — ScreenProfile: источник правды о профиле ввода.
// Пакет U (аудит адаптивности design/ADAPTIVE_AUDIT.md, вариант B):
// геометрия (иконки/плотность/раскладка) остаётся в CSS-медиазапросах,
// а афордансы ввода (чем зумить, как отменять, какие подсказки,
// какие кнопки команд нужны) управляются одним состоянием.
//
// Сигналы:   media-запросы (pointer/hover), реальные события ввода
//            (pointerType на window, keydown), выбор пользователя.
// Состояние: override 'auto'|'touch'|'desktop' (localStorage),
//            effective 'touch'|'desktop'.
// Выход:     классы game-touch/game-desktop + data-input на <html>,
//            колбэки onChange, API game.profile.
//
// Политика auto-режима: базис — media-запросы; первое реальное событие
// ввода фиксирует профиль на сессию (тач → тач, мышь/клавиатура →
// десктоп); с десктопа обратно в тач не переключаемся (без маяты на
// гибридах). Смена профиля без участия пользователя — тихая: контролы
// сами появляются/исчезают через CSS-классы, тосты не спамим.
// ============================================================

const PROFILE_KEY = 'terranrts.profile';

export function createProfile(doc = (typeof document !== 'undefined' ? document : null),
                              win = (typeof window !== 'undefined' ? window : null)) {
  const mql = (q) => !!(win && typeof win.matchMedia === 'function' && win.matchMedia(q).matches);

  // Базис auto: coarse без hover → тач; иначе десктоп.
  // Нет matchMedia (headless-симы) → десктоп: детерминизм тестов.
  const mediaBasis = () => {
    if (mql('(pointer: coarse)') && mql('(hover: none)')) return 'touch';
    return 'desktop';
  };

  let override = 'auto';
  try {
    const v = win && win.localStorage && win.localStorage.getItem(PROFILE_KEY);
    if (v === 'touch' || v === 'desktop' || v === 'auto') override = v;
  } catch { /* приватный режим — авто */ }
  let runtimeSignal = null; // 'touch' | 'desktop' — первый реальный ввод (односторонне)

  const listeners = [];

  const effective = () => {
    if (override !== 'auto') return override;
    if (runtimeSignal) return runtimeSignal;
    return mediaBasis();
  };

  const apply = () => {
    const p = effective();
    const root = doc && doc.documentElement;
    if (root && root.classList) {
      root.classList.toggle('game-touch', p === 'touch');
      root.classList.toggle('game-desktop', p === 'desktop');
      if (root.setAttribute) root.setAttribute('data-input', p);
    }
    for (const fn of listeners) {
      try { fn(p); } catch { /* сломанный слушатель не роняет профиль */ }
    }
  };

  const onSignal = (p) => {
    if (override !== 'auto' || runtimeSignal === p) return;
    // Односторонняя политика сессии: с десктопа в тач не возвращаемся.
    if (runtimeSignal === 'desktop' && p === 'touch') return;
    runtimeSignal = p;
    apply();
  };

  // Pointer-события — чистая правда об устройстве: синтетические
  // compat-события тача — это MouseEvent'ы (mousemove/mousedown), они
  // НЕ диспетчатся в 'pointer*'-слушатели, так что дедупликации с
  // гвардами input.js (isCompatMouse) не требуется.
  if (win && typeof win.addEventListener === 'function') {
    const onPointer = (e) => {
      if (!e) return;
      if (e.pointerType === 'touch') onSignal('touch');
      else if (e.pointerType === 'mouse') onSignal('desktop');
      // 'pen' нейтрален: стилус бывает и на тач-планшетах.
    };
    win.addEventListener('pointerdown', onPointer, true);
    win.addEventListener('pointermove', onPointer, true);
    // Клавиатура — десктопный сигнал (у тача физической клавиатуры нет).
    win.addEventListener('keydown', () => onSignal('desktop'), true);
  }

  apply(); // классы на <html> должны существовать до первой отрисовки UI

  return {
    effective,
    mode: () => override,
    isTouchUI: () => effective() === 'touch',
    set(mode) { // override из меню «Ещё»; 'auto' возвращает управление сигналам
      if (mode !== 'auto' && mode !== 'touch' && mode !== 'desktop') return;
      override = mode;
      if (mode === 'auto') runtimeSignal = null; // авто — пересчёт с нуля
      try { if (win && win.localStorage) win.localStorage.setItem(PROFILE_KEY, mode); } catch { /* приватный режим */ }
      apply();
    },
    onChange(fn) { if (typeof fn === 'function') listeners.push(fn); },
    // Смена media-базиса (подключили мышь к планшету) — зовётся из resize.
    refresh: apply,
  };
}
