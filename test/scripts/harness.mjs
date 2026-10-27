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
    // Пакет R: CSSStyleDeclaration-стаб — applyVV ставит --vv-* через
    // setProperty/removeProperty (в браузере кастом-свойства ставятся только так).
    this.style.setProperty = (k, v) => { this.style[k] = String(v); };
    this.style.removeProperty = (k) => { delete this.style[k]; };
    this.style.getPropertyValue = (k) => (this.style[k] !== undefined ? String(this.style[k]) : '');
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
  // className и classList должны жить синхронно: модули ставят класс строкой,
  // а потом добавляют/снимают через classList (анимации, состояния карточек).
  get className() { return Array.from(this.classList.s).join(' '); }
  set className(v) {
    this.classList.s = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean));
  }
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
  // Перерисовка innerHTML сбрасывает кэш ленивых узлов (как в браузере:
  // старые узлы уходят из дерева вместе со слушателями).
  set innerHTML(v) { this._html = v; this.children = []; this._qcache = {}; this._qallCache = {}; }
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
  append(...nodes) { for (const n of nodes) this.appendChild(n); }
  prepend(...nodes) { for (const n of nodes.reverse()) { n.parent = this; this.children.unshift(n); } }
  insertBefore(n, ref) {
    const i = this.children.indexOf(ref);
    n.parent = this;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  contains(n) { return this.children.includes(n); }
  remove() {
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    }
  }
  click() { (this._handlers.click || []).forEach((fn) => fn({ preventDefault() {} })); }
  // Пакет Э6: UI-модули (chests-ui/admin) собирают оверлей через innerHTML и
  // потом ищут кнопки по id/классу. Стаб не строит дерево, но разбирает теги
  // разметки: находит нужные элементы и отдаёт ленивые FakeEl с id, классами и
  // data-* — headless-прогон проходит те же ветки кода (обработчики, guard'ы,
  // тексты), не требуя jsdom.
  _parseTags(sel) {
    const html = this._html || '';
    let re;
    if (sel.startsWith('#')) {
      const id = sel.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp('<([a-z]+)\\b[^>]*\\bid="' + id + '"[^>]*>', 'g');
    } else if (sel.startsWith('.')) {
      const cls = sel.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp('<([a-z]+)\\b[^>]*\\bclass="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>', 'g');
    } else {
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (attr) {
        re = new RegExp('<([a-z]+)\\b[^>]*\\b' + attr[1] + '(?:="' + (attr[2] || '[^"]*') + '")?[^>]*>', 'g');
      } else if (/^[a-z]+$/.test(sel)) {
        re = new RegExp('<(' + sel + ')\\b[^>]*>', 'g');
      } else return [];
    }
    const out = [];
    let m;
    while ((m = re.exec(html))) {
      const tagText = m[0];
      const node = new FakeEl(m[1] || 'div', '');
      const idm = /\bid="([^"]*)"/.exec(tagText);
      if (idm) node.id = idm[1];
      const decode = (v) => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      const vm = /\bvalue="([^"]*)"/.exec(tagText);
      if (vm) node.value = decode(vm[1]);
      if (node.tagName === 'textarea' || m[1] === 'textarea') {
        // <textarea> держит текст между тегами — в браузере это .value.
        const rest = html.slice(m.index + tagText.length);
        const close = rest.indexOf('</textarea>');
        node.value = close >= 0 ? decode(rest.slice(0, close)) : '';
      }
      if (/\bchecked\b/.test(tagText)) node.checked = true;
      const clm = /\bclass="([^"]*)"/.exec(tagText);
      if (clm) clm[1].split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
      const dt = /\bdata-([\w-]+)="([^"]*)"/g;
      let d;
      while ((d = dt.exec(tagText))) node.dataset[d[1]] = d[2];
      out.push(node);
    }
    return out;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (sel.startsWith('#') && c.id === sel.slice(1)) return c;
      if (!sel.startsWith('#') && c._parseTags && c._parseTags(sel).length) return c;
    }
    this._qcache = this._qcache || {};
    if (this._qcache[sel]) return this._qcache[sel];
    const nodes = this._parseTags(sel);
    if (!nodes.length) return null;
    return (this._qcache[sel] = nodes[0]);
  }
  querySelectorAll(sel) {
    this._qallCache = this._qallCache || {};
    if (this._qallCache[sel]) return this._qallCache[sel];
    const kids = this.children.filter((c) => (sel.startsWith('#') ? c.id === sel.slice(1) : c._parseTags && c._parseTags(sel).length));
    const out = kids.length ? kids : this._parseTags(sel);
    return (this._qallCache[sel] = out);
  }
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
// sessionStorage — для панели админа (Э6): «вход по PIN на эту сессию».
const sessionStore = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
  setItem: (k, v) => sessionStore.set(k, String(v)),
  removeItem: (k) => sessionStore.delete(k),
  clear: () => sessionStore.clear(),
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
// Ручки для симов модалок (#33 З2): прокинуть window-событие и посмотреть,
// кто на него подписан (harness собирает их в winHandlers).
export function windowHandlers(ev) { return (winHandlers[ev] || []).slice(); }
export function fireWindow(ev, data = {}) {
  const e = {
    type: ev, defaultPrevented: false, propagationStopped: false, immediateStopped: false,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { e.propagationStopped = true; },
    stopImmediatePropagation() { e.immediateStopped = true; },
    ...data,
  };
  for (const fn of windowHandlers(ev)) fn(e);
  return e;
}
export function endStatsHTML() { return el('end-stats').innerHTML; }
