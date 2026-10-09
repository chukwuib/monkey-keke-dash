export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this.gainNode = null;
    this.musicNode = null;
    this.currentMusic = null;

    // Real generated soundtrack (ElevenLabs-style Afro-Caribbean/jungle loops,
    // produced via Higgsfield). Played through an <audio> element and looped.
    // Falls back to the procedural samba synth if a file fails to load.
    this.musicEl = null;
    this.MUSIC_FILES = {
      drive:  'assets/audio/music-drive.m4a',   // high-energy jungle/Afrobeat
      island: 'assets/audio/music-island.m4a',  // breezy Caribbean/highlife
    };
    // State music theme -> which loop to play. Alternates the two flavours so
    // the journey keeps variety; unknown themes default to the driving loop.
    this.TRACK_FOR = {
      highlife: 'island', igbo_highlife: 'island', afrobeats_lagos: 'island', lagos: 'island',
      afrobeats: 'drive', hausa_folk: 'drive', fuji_north: 'drive', yoruba_folk: 'drive',
    };
    this.MUSIC_VOL = 0.85; // music sits just under SFX
    this._musicDuck = 1;   // <1 while the intro-scroll drum ambience plays over it

    // Persisted master volume + mute
    const savedVol = parseFloat(localStorage.getItem('mkd_volume'));
    this.masterVolume = isNaN(savedVol) ? 0.7 : Math.min(1, Math.max(0, savedVol));
    this.muted = localStorage.getItem('mkd_muted') === '1';

    this._initContext();
  }

  _initContext() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.muted ? 0 : this.masterVolume;
      this.gainNode.connect(this.ctx.destination);
    } catch (e) {
      this.enabled = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ── Master volume control ──────────────────────────────────────
  _applyGain() {
    if (this.gainNode) {
      const v = (this.muted || this._adMode) ? 0 : this.masterVolume;
      this.gainNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
    this._applyMusicVolume(); // keep the <audio> soundtrack in sync with master
  }

  setMasterVolume(v) {
    this.masterVolume = Math.min(1, Math.max(0, v));
    this.muted = this.masterVolume <= 0.001;
    this._applyGain();
    localStorage.setItem('mkd_volume', this.masterVolume.toFixed(2));
    localStorage.setItem('mkd_muted', this.muted ? '1' : '0');
  }

  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted && this.masterVolume <= 0.001) this.masterVolume = 0.6;
    this._applyGain();
    localStorage.setItem('mkd_muted', this.muted ? '1' : '0');
    localStorage.setItem('mkd_volume', this.masterVolume.toFixed(2));
    return this.muted;
  }

  // ── State-intro ambience: drums + jungle bed + monkey whoops ───
  // Procedural so it works with no audio assets. Routed through the master
  // gain, so it respects volume/mute. Played behind the state-intro scroll.
  playIntroAmbience() {
    if (!this.enabled || !this.ctx) return;
    this.resume();
    this.stopIntroAmbience();
    this._introOn = true;
    this._musicDuck = 0.25; this._applyMusicVolume(); // make room for the drums
    const ctx = this.ctx;

    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(this.gainNode);
    bus.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
    this._introBus = bus;

    // Jungle bed — looping filtered noise (airy, insect/leaf hiss)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    noise.connect(bp).connect(ng).connect(bus);
    noise.start();
    this._introNoise = noise;

    // Djembe-style drum hit (sine body with a fast downward pitch drop)
    const hit = (when, freq, g) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      const ga = ctx.createGain();
      o.frequency.setValueAtTime(freq, when);
      o.frequency.exponentialRampToValueAtTime(freq * 0.5, when + 0.18);
      ga.gain.setValueAtTime(0.0001, when);
      ga.gain.exponentialRampToValueAtTime(g, when + 0.005);
      ga.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
      o.connect(ga).connect(bus); o.start(when); o.stop(when + 0.35);
    };
    // Monkey whoop — quick up-then-down pitch sweep
    const whoop = (when) => {
      const o = ctx.createOscillator(); o.type = 'triangle';
      const ga = ctx.createGain();
      const base = 500 + Math.random() * 220;
      o.frequency.setValueAtTime(base, when);
      o.frequency.exponentialRampToValueAtTime(base * 2.2, when + 0.12);
      o.frequency.exponentialRampToValueAtTime(base * 0.8, when + 0.32);
      ga.gain.setValueAtTime(0.0001, when);
      ga.gain.exponentialRampToValueAtTime(0.12, when + 0.04);
      ga.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);
      o.connect(ga).connect(bus); o.start(when); o.stop(when + 0.46);
    };

    // Repeating bar of drums with an occasional monkey call
    const bar = () => {
      if (!this._introOn) return;
      const t = ctx.currentTime;
      hit(t, 150, 0.5); hit(t + 0.25, 220, 0.3); hit(t + 0.5, 150, 0.45); hit(t + 0.65, 300, 0.25);
      if (Math.random() < 0.6) whoop(t + 0.3 + Math.random() * 0.4);
    };
    bar();
    this._introTimer = setInterval(bar, 800);
  }

  stopIntroAmbience() {
    this._introOn = false;
    this._musicDuck = 1; this._applyMusicVolume(); // restore soundtrack level
    if (this._introTimer) { clearInterval(this._introTimer); this._introTimer = null; }
    if (this._introNoise) { try { this._introNoise.stop(); } catch (e) { /* already stopped */ } this._introNoise = null; }
    if (this._introBus && this.ctx) {
      const bus = this._introBus;
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      setTimeout(() => { try { bus.disconnect(); } catch (e) { /* gone */ } }, 600);
      this._introBus = null;
    }
  }

  // ── Soundtrack: real generated Afro-Caribbean/jungle loops ─────
  // Picks one of the looped tracks for the state's music theme and plays it.
  // If the audio file can't load/play, falls back to the procedural samba.
  playStateMusic(stateTheme) {
    if (!this.enabled || !this.musicEnabled) return;
    this.resume();

    const key = this.TRACK_FOR[stateTheme] || 'drive';
    // Already playing this track? leave it running (don't restart on re-entry).
    if (this.currentMusic === key && this.musicEl && !this.musicEl.paused) return;

    this.stopMusic();
    this.currentMusic = key;

    try {
      const el = this.musicEl || new Audio();
      this.musicEl = el;
      el.loop = true;
      el.preload = 'auto';
      el.volume = this.muted ? 0 : this.masterVolume * this.MUSIC_VOL;
      el.src = this.MUSIC_FILES[key];
      el.onerror = () => this._fallbackSamba(stateTheme);
      const p = el.play();
      if (p && p.catch) p.catch(() => { /* autoplay gate — retried on next user gesture */ });
    } catch (e) {
      this._fallbackSamba(stateTheme);
    }
  }

  _applyMusicVolume() {
    if (this.musicEl) this.musicEl.volume = (this.muted || this._adMode) ? 0 : this.masterVolume * this.MUSIC_VOL * this._musicDuck;
  }

  // Silence all game audio while the advert video plays (it has its own sound).
  setAdMode(on) {
    this._adMode = !!on;
    this._applyGain();
  }

  // ── Lively Afro-samba music (procedural fallback) ──────────────
  _fallbackSamba(stateTheme) {
    if (!this.enabled || !this.musicEnabled || !this.ctx) return;
    // Each state gets a samba variant: different key, tempo & melody riff
    const V = {
      highlife:        { bpm: 104, root: 49, scale: 'major', mel: 0 },
      igbo_highlife:   { bpm: 104, root: 49, scale: 'major', mel: 0 },
      afrobeats:       { bpm: 110, root: 45, scale: 'major', mel: 1 },
      afrobeats_lagos: { bpm: 118, root: 47, scale: 'major', mel: 2 },
      lagos:           { bpm: 118, root: 47, scale: 'major', mel: 2 },
      yoruba_folk:     { bpm: 106, root: 50, scale: 'major', mel: 1 },
      hausa_folk:      { bpm: 100, root: 45, scale: 'minor', mel: 3 },
      fuji_north:      { bpm: 100, root: 45, scale: 'minor', mel: 3 },
    };
    const cfg = V[stateTheme] || V.afrobeats;
    this._playSamba(stateTheme || 'afrobeats', cfg);
  }

  _midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // Pitched drum (surdo / tom) with a quick downward pitch drop
  _drum(time, freq, dur, vol) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.9, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + dur * 0.5);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g); g.connect(this.gainNode);
    osc.start(time); osc.stop(time + dur + 0.02);
  }

  // Filtered noise burst (shaker / caixa snare)
  _hit(time, dur, vol, hp = 4000) {
    if (!this.ctx) return;
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(filt); filt.connect(g); g.connect(this.gainNode);
    src.start(time); src.stop(time + dur + 0.02);
  }

  // Pitched tone (bass / melody / agogô)
  _tone(time, freq, dur, type = 'triangle', vol = 0.08) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g); g.connect(this.gainNode);
    osc.start(time); osc.stop(time + dur + 0.02);
  }

  _playSamba(name, cfg) {
    if (!this.ctx) return;
    this.currentMusic = name;
    const bpm = cfg.bpm;
    const six = 60 / bpm / 4;        // sixteenth-note duration
    const SPB = 16, BARS = 2, STEPS = SPB * BARS;

    const major = [0, 2, 4, 5, 7, 9, 11];
    const minor = [0, 2, 3, 5, 7, 8, 10];
    const sc = cfg.scale === 'minor' ? minor : major;
    // scale-degree -> frequency (handles negative degrees / octaves)
    const deg = (i, oct = 0) => {
      const idx = ((i % 7) + 7) % 7;
      const semis = sc[idx] + Math.floor(i / 7) * 12 + oct * 12;
      return this._midi(cfg.root + semis);
    };

    // bouncy samba bassline (16 eighth-notes over 2 bars)
    const bassSeq = [0, null, 4, 0, null, 3, 4, null, 0, null, 4, 2, null, 0, -3, null];
    // bright marimba riffs
    const riffs = [
      [4, null, 2, 4, 7, null, 4, 2, 0, null, 2, 4, 2, null, 0, null],
      [7, null, 7, 4, 2, null, 4, null, 7, 9, 7, 4, 2, null, 0, null],
      [9, 7, null, 9, 11, null, 9, 7, 4, null, 7, 9, 7, null, 4, null],
      [4, null, 3, 4, null, 2, 0, null, 3, null, 4, 3, null, 2, 0, null],
    ];
    const riff = riffs[cfg.mel] || riffs[0];

    const loop = () => {
      if (!this.musicEnabled || this.currentMusic !== name || !this.ctx) return;
      const t0 = this.ctx.currentTime + 0.06;

      // Percussion grid (sixteenths)
      for (let s = 0; s < STEPS; s++) {
        const t = t0 + s * six;
        const inBar = s % SPB;
        // ganzá shaker every sixteenth, accent offbeats
        this._hit(t, 0.025, inBar % 2 ? 0.026 : 0.014, 7000);
        // surdo — samba heartbeat on beats 2 & 4
        if (inBar === 4 || inBar === 12) this._drum(t, 92, 0.22, 0.24);
        if (inBar === 8) this._drum(t, 70, 0.18, 0.15);
        // caixa snare accents
        if ([3, 6, 7, 11, 14, 15].includes(inBar)) this._hit(t, 0.05, 0.05, 2400);
        // tamborim / agogô metallic syncopation
        if ([0, 3, 6, 10].includes(inBar)) {
          this._tone(t, this._midi(cfg.root + 24 + (inBar % 3 === 0 ? 7 : 4)), 0.07, 'square', 0.03);
        }
      }

      // Bass + melody (eighths)
      const eighth = six * 2;
      for (let i = 0; i < 16; i++) {
        const t = t0 + i * eighth;
        const b = bassSeq[i];
        if (b != null) this._tone(t, deg(b, -1), eighth * 0.9, 'sawtooth', 0.13);
        const m = riff[i];
        if (m != null) this._tone(t, deg(m, 1), eighth * 0.8, 'triangle', 0.085);
      }

      setTimeout(loop, STEPS * six * 1000 - 60);
    };
    loop();
  }

  stopMusic() {
    this.currentMusic = null; // stops the procedural samba loop
    if (this.musicEl) {
      try { this.musicEl.pause(); this.musicEl.currentTime = 0; } catch (e) { /* not ready */ }
    }
  }

  // ── Sound effects ──────────────────────────────────────────────
  // Coin chime: pitch climbs with the combo multiplier for a satisfying ramp,
  // with a soft octave sparkle on top.
  playCoinCollect(combo = 1) {
    const step = Math.min(combo - 1, 11);           // cap the climb
    const base = 880 * Math.pow(2, step / 12);      // +1 semitone per combo
    this._beep(base, 0.06, 'sine', 0.06);
    this._beep(base * 2, 0.05, 'sine', 0.025);      // shimmer
  }
  playJump()        { this._sweep(200, 500, 0.1); }
  // Air-rush as an obstacle whips past — quick noise swell, brighter on closer calls
  playWhoosh(intensity = 1) {
    if (!this.ctx || !this.sfxEnabled) return;
    this.resume();
    const dur = 0.22;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); // decaying
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.Q.value = 0.9;
    const t = this.ctx.currentTime;
    filt.frequency.setValueAtTime(420, t);
    filt.frequency.exponentialRampToValueAtTime(1700 + 900 * intensity, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.gainNode);
    src.start(t); src.stop(t + dur + 0.02);
  }
  playSlide()       { this._beep(150, 0.15, 'sawtooth', 0.08); }
  playHit()         { this._noise(0.2, 0.15); }
  playCatch()       { this._beep(220, 0.5, 'square', 0.12); }
  playPowerUp()     { this._beep(660, 0.2, 'sine', 0.1); this._beep(880, 0.2, 'sine', 0.1); }
  playLevelComplete(){ this._beep(523, 0.1, 'sine', 0.1); this._beep(659, 0.1, 'sine', 0.1); this._beep(784, 0.3, 'sine', 0.1); }
  playGameOver()    { this._beep(440, 0.2, 'square', 0.1); this._beep(330, 0.2, 'square', 0.1); this._beep(220, 0.4, 'square', 0.1); }
  playBailAlert()   { this._beep(440, 0.1, 'square', 0.12); this._beep(330, 0.1, 'square', 0.12); }
  playRiskyLane()   { this._sweep(400, 200, 0.15); }

  _beep(freq, dur, type = 'sine', vol = 0.1) {
    if (!this.ctx || !this.sfxEnabled) return;
    this.resume();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.gainNode);
    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  }

  _sweep(fromFreq, toFreq, dur) {
    if (!this.ctx || !this.sfxEnabled) return;
    this.resume();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(fromFreq, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(toFreq, this.ctx.currentTime + dur);
    g.gain.setValueAtTime(0.1, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.gainNode);
    osc.start();
    osc.stop(this.ctx.currentTime + dur);
  }

  _noise(dur, vol) {
    if (!this.ctx || !this.sfxEnabled) return;
    this.resume();
    const bufSize = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    source.connect(g);
    g.connect(this.gainNode);
    source.start();
    source.stop(this.ctx.currentTime + dur);
  }

  // ── Police siren (looping two-tone wail) ───────────────────────
  startSiren() {
    if (!this.ctx || !this.sfxEnabled || this._siren) return;
    this.resume();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    g.gain.value = 0.0001;
    o.connect(g); g.connect(this.gainNode);
    o.start();
    this._siren = { o, g };
    g.gain.setTargetAtTime(0.06, this.ctx.currentTime, 0.15);
    this._sirenLoop();
  }

  _sirenLoop() {
    if (!this._siren || !this.ctx) return;
    const t = this.ctx.currentTime, o = this._siren.o;
    o.frequency.setValueAtTime(680, t);
    o.frequency.linearRampToValueAtTime(1040, t + 0.45);
    o.frequency.linearRampToValueAtTime(680, t + 0.9);
    this._sirenTimer = setTimeout(() => this._sirenLoop(), 880);
  }

  stopSiren() {
    if (this._sirenTimer) { clearTimeout(this._sirenTimer); this._sirenTimer = null; }
    if (this._siren) {
      try {
        this._siren.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        this._siren.o.stop(this.ctx.currentTime + 0.3);
      } catch (e) {}
      this._siren = null;
    }
  }
}
