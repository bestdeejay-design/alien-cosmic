// ============================================================
// harness.mjs — общие стабы браузера для headless-симов.
// DOM/Canvas/Audio/localStorage/rAF: достаточно, чтобы грузить
// настоящий js/game.js в node. Импорт ставит globals, экспорт —
// короткие ручки. Используют smoke.mjs, sim_wins.mjs.
// ============================================================

// ---------- Стабы браузера ----------
class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach((x) => this.s.add(x)); }
  remove(...c) { c.forEach((x) => this.s.delete(x)); }
  toggle(c, force) {
    const on = force !== undefined ? force : !this.s.has(c);
    if (on) this.s.add(c); else this.s.delete(c);
    return on;
  }
  contains(c) { return this.s.has(c); }
}

function makeCtx() {
  const grad = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (prop === 'createPattern') return () => ({});
      if (prop === 'measureText') return () => ({ width: 8 });
      if (prop === 'createImageData' || prop === 'getImageData') {
        return (w, h) => ({ width: w, height: h || w, data: new Uint8ClampedArray((w * (h || w) || 4) * 4) });
      }
      if (prop === 'canvas') return {};
      return (..._a) => undefined; // все методы рисования — no-op
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

class FakeEl {
  constructor(tag = 'div', id = '') {
    this.tag = tag; this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.textContent = '';
    this._html = '';
    this.parent = null;
    this.disabled = false;
    this.width = tag === 'canvas' ? 300 : 0;
    this.height = tag === 'canvas' ? 150 : 0;
    this._handlers = {};
    this._ctx = tag === 'canvas' ? makeCtx() : null;
  }
  get firstChild() { return this.children[0] || null; }
  // I: innerHTML читается симами (end-stats и т.п.) — сериализуем поддерево,
  // чтобы DOM-сборка (showEnd без innerHTML) оставалась проверяемой.
  get innerHTML() {
    const ser = (n) => {
      if (!n || typeof n !== 'object') return '';
      let own = n._html || '';
      if (!n.children || !n.children.length) return own + (n.textContent || '');
      return own + (n.textContent || '') + n.children.map(ser).join('');
    };
    return this._html + this.children.map(ser).join('');
  }
  set innerHTML(v) { this._html = v; this.children = []; }
  addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); }
  removeEventListener() {}
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'title') this.title = String(value);
    if (name === 'disabled') this.disabled = true;
  }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  removeAttribute(name) {
    this.attributes.delete(String(name));
    if (name === 'disabled') this.disabled = false;
  }
  focus() {
    const previous = globalThis.document && globalThis.document.activeElement;
    if (previous && previous !== this && previous.blur) previous.blur();
    if (globalThis.document) globalThis.document.activeElement = this;
    (this._handlers.focus || []).forEach((fn) => fn({ type: 'focus', target: this }));
  }
  blur() {
    if (globalThis.document && globalThis.document.activeElement === this) globalThis.document.activeElement = globalThis.document.body;
    (this._handlers.blur || []).forEach((fn) => fn({ type: 'blur', target: this }));
  }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
  }
  click() { (this._handlers.click || []).forEach((fn) => fn({ preventDefault() {} })); }
  getContext() { return this._ctx || (this._ctx = makeCtx()); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 800, height: this.height || 600 }; }
}

const elCache = {};
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.devicePixelRatio = 1;
const winHandlers = {};
globalThis.addEventListener = (ev, fn) => { (winHandlers[ev] = winHandlers[ev] || []).push(fn); };
globalThis.removeEventListener = () => {};
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
const store = new Map();
store.set('terranrts.language', 'ru'); // I: симы всегда на RU — детерминизм (node navigator врёт про en-US)
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  hidden: false,
  body: new FakeEl('body'),
  documentElement: new FakeEl('html'), // U: profile.js ставит game-touch/game-desktop на <html>
  getElementById: (id) => {
    if (!elCache[id]) {
      const isCanvas = id === 'game-canvas' || id === 'minimap';
      elCache[id] = new FakeEl(isCanvas ? 'canvas' : 'div', id);
    }
    return elCache[id];
  },
  createElement: (tag) => new FakeEl(tag),
  createTextNode: (text) => { const el = new FakeEl('#text'); el.textContent = String(text); return el; }, // I: setRich собирает переводы через DOM
  addEventListener: (ev, fn) => { (winHandlers['doc:' + ev] = winHandlers['doc:' + ev] || []).push(fn); },
};
globalThis.document.activeElement = globalThis.document.body;

// Ручки поверх стабов.
export function el(id) { return document.getElementById(id); }
export function endStatsHTML() { return el('end-stats').innerHTML; }
