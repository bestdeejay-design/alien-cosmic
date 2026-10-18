// ============================================================
// audio.js — звук целиком на Web Audio API, без файлов.
// Контекст создаётся только после жеста пользователя (кнопка
// «Начать игру») — требование автоплей-политики браузеров.
// Состояние мьюта хранится в localStorage (с try/catch).
// ============================================================

const STORE_KEY = 'terranrts.muted';

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
    this.lastShot = 0;
    try { this.muted = localStorage.getItem(STORE_KEY) === '1'; } catch (e) { /* приватный режим */ }
  }

  // Вызывается из обработчика клика — легально «разблокирует» звук.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.45;
      this.master.connect(this.ctx.destination);
      // Буфер белого шума 1 c — основа для выстрелов/взрывов.
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
    try { localStorage.setItem(STORE_KEY, m ? '1' : '0'); } catch (e) { /* игнорируем */ }
  }

  toggle() { this.setMuted(!this.muted); return this.muted; }

  // Тон с частотной огибающей f0→f1 и экспоненциальным затуханием.
  tone(f0, f1, dur, type = 'square', vol = 0.2, when = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  // Шумовой удар через фильтр — выстрелы, взрывы, сварка.
  noise(dur, freq, vol, type = 'lowpass', when = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // ---- Конкретные звуки игры ----
  click()  { this.tone(660, 880, 0.06, 'square', 0.10); }
  ack()    { this.tone(440, 560, 0.05, 'triangle', 0.09); }
  error()  { this.tone(150, 105, 0.20, 'square', 0.16); }
  shot() {
    // Троттлинг: не более одного звука выстрела в 70 мс (массовые бои).
    const now = performance.now();
    if (now - this.lastShot < 70) return;
    this.lastShot = now;
    this.noise(0.08, 2600, 0.14, 'highpass');
    this.tone(210, 90, 0.06, 'sawtooth', 0.07);
  }
  boom(big) {
    this.noise(big ? 0.7 : 0.35, big ? 500 : 900, big ? 0.5 : 0.28);
    this.tone(big ? 110 : 160, 35, big ? 0.5 : 0.25, 'sine', big ? 0.4 : 0.18);
  }
  cannon() {
    // Тяжёлое орудие: низкий удар + шипение.
    this.noise(0.3, 700, 0.42);
    this.tone(95, 32, 0.4, 'sine', 0.4);
    this.tone(320, 90, 0.1, 'sawtooth', 0.12);
  }
  repair() {
    // Сварка/лащение: короткий металлический «тик».
    this.tone(900 + Math.random() * 500, 1400, 0.04, 'square', 0.05);
    this.noise(0.05, 3200, 0.05, 'highpass');
  }
  enter() {
    // Юнит вошёл в бункер/кокон.
    this.tone(300, 190, 0.12, 'triangle', 0.12);
  }
  build()  { this.tone(300, 430, 0.12, 'square', 0.11); this.noise(0.12, 1800, 0.08, 'highpass'); }
  ready()  { this.tone(520, 520, 0.07, 'triangle', 0.15); this.tone(780, 780, 0.10, 'triangle', 0.15, 0.08); }
  deposit(){ this.tone(880, 880, 0.05, 'triangle', 0.09); this.tone(1318, 1318, 0.07, 'triangle', 0.09, 0.05); }
  mine()   { this.tone(170 + Math.random() * 90, 130, 0.05, 'square', 0.05); }
  ping()   { this.tone(980, 980, 0.12, 'sine', 0.22); this.tone(980, 980, 0.12, 'sine', 0.22, 0.18); }
  win()    { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, 'triangle', 0.2, i * 0.14)); }
  lose()   { [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.9, 0.24, 'sawtooth', 0.14, i * 0.17)); }
}
