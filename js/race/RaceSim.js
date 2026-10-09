// ─── Daily Race — deterministic race core ────────────────────────────────────
// Pure logic, no Three.js, no clock, no Math.random. The SAME file runs:
//   • in the browser (RaceMode drives it and draws its state), and
//   • on the server (supabase/functions/_shared/RaceSim.js — copied by
//     tools_buildweb.cjs) to REPLAY a submitted run from its seed + inputs.
// Same seed + same inputs ⇒ same score, so the server never trusts a score the
// client claims; it recomputes it. Bump RACE_VERSION whenever the rules change.
export const RACE_VERSION = 1;
export const TICK = 1 / 60;            // fixed simulation step (seconds)
export const MAX_SECONDS = 120;        // a race ends after 2 minutes…
export const MAX_TICKS = MAX_SECONDS * 60;
export const MAX_HITS = 3;             // …or on the 3rd crash
export const MAX_INPUTS = 3000;        // sanity cap for a submitted run
export const LANES = [-4.5, 0, 4.5];
export const INPUT_CODES = ['L', 'R', 'J', 'S'];

const BASE_Y = 0.6, GRAVITY = -32, JUMP_V = 14, SLIDE_TIME = 0.6;
const PLAYER = { w: 1.2, h: 1.0, d: 1.8 };
const START_SPEED = 24, MAX_SPEED = 70, ACCEL = 0.45, MIN_SPEED = 20;
const SPAWN_AHEAD = 75, DESPAWN_BEHIND = 12;
const COIN_POINTS = 10;

// Obstacles used in the race (sizes match ObstacleManager's visuals).
export const RACE_OBSTACLES = {
  palm_oil_drum: { w: 0.9, h: 1.0, d: 0.9 },
  market_stall:  { w: 2.4, h: 1.1, d: 2.0 },
  road_block:    { w: 2.0, h: 1.0, d: 0.5 },
  pothole:       { w: 2.2, h: 0.2, d: 1.2, low: true },
  danfo_bus:     { w: 2.2, h: 2.0, d: 4.5 },
  market_banner: { w: 2.2, h: 0.9, d: 0.4, elevatedY: 1.2 },   // slide under
};
const TYPES = Object.keys(RACE_OBSTACLES);

// mulberry32 — tiny, fast, identical results in every JS engine.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlap = (c1, s1, c2, s2) => Math.abs(c1 - c2) * 2 < s1 + s2;

export class RaceSim {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.tick = 0;
    this.distance = 0;
    this.speed = START_SPEED;
    this.lane = 1;
    this.x = LANES[1];
    this.targetX = LANES[1];
    this.laneChanging = false;
    this.y = BASE_Y;
    this.vy = 0;
    this.jumping = false;
    this.sliding = false;
    this.slideT = 0;
    this.hitCooldown = 0;
    this.hits = 0;
    this.coins = 0;
    this.over = false;
    this.obstacles = [];   // { id, type, lane, s, w, h, d, cy }
    this.coinList = [];    // { id, lane, s }
    this.nextRowAt = 60;   // track position of the next obstacle row
    this.nextId = 1;
    this.events = [];      // per-step events for the renderer (hit, coin)
  }

  get elapsed() { return this.tick * TICK; }
  get score() { return Math.floor(this.distance) + this.coins * COIN_POINTS; }

  // Apply one player input. Called BEFORE step() on the tick it happens.
  input(code) {
    if (this.over) return;
    if (code === 'L' && !this.laneChanging && this.lane > 0) {
      this.lane--; this.targetX = LANES[this.lane]; this.laneChanging = true;
    } else if (code === 'R' && !this.laneChanging && this.lane < 2) {
      this.lane++; this.targetX = LANES[this.lane]; this.laneChanging = true;
    } else if (code === 'J' && !this.jumping && !this.sliding) {
      this.jumping = true; this.vy = JUMP_V;
    } else if (code === 'S' && !this.sliding && !this.jumping) {
      this.sliding = true; this.slideT = SLIDE_TIME;
    }
  }

  step() {
    if (this.over) return;
    const dt = TICK;
    this.events = [];

    // Speed ramps up over the race; crashes knock it back.
    this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    this.distance += this.speed * dt;
    if (this.hitCooldown > 0) this.hitCooldown -= dt;

    // Lane movement (same easing as the main game)
    this.x += (this.targetX - this.x) * Math.min(1, dt * 16);
    if (Math.abs(this.x - this.targetX) < 0.05) { this.x = this.targetX; this.laneChanging = false; }

    // Jump / slide
    if (this.jumping) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= BASE_Y) { this.y = BASE_Y; this.jumping = false; this.vy = 0; }
    }
    if (this.sliding) {
      this.slideT -= dt;
      if (this.slideT <= 0) this.sliding = false;
    }

    this._spawn();
    this._collide();
    this._collectCoins();

    // Drop what is now behind the player
    this.obstacles = this.obstacles.filter(o => this.distance - o.s < DESPAWN_BEHIND);
    this.coinList = this.coinList.filter(c => this.distance - c.s < DESPAWN_BEHIND);

    this.tick++;
    if (this.hits >= MAX_HITS || this.tick >= MAX_TICKS) this.over = true;
  }

  // Rows of obstacles appear SPAWN_AHEAD units in front; gaps shrink over time
  // but never below a reaction-time floor. A row never blocks all 3 lanes.
  _spawn() {
    while (this.nextRowAt - this.distance < SPAWN_AHEAD) {
      const s = this.nextRowAt;
      const r = this.rng();
      const lane = Math.floor(this.rng() * 3);
      const pick = () => TYPES[Math.floor(this.rng() * TYPES.length)];
      let lanes;
      if (r < 0.5) lanes = [lane];
      else if (r < 0.75) lanes = [lane, (lane + 1) % 3];
      else lanes = [0, 1, 2].filter(l => l !== lane);
      lanes.forEach((l, i) => this._addObstacle(pick(), l, s - i * 4));

      const free = [0, 1, 2].filter(l => !lanes.includes(l));
      const gap = Math.max(26, 52 - this.elapsed * 0.15) * (0.85 + this.rng() * 0.3);
      if (free.length && this.rng() < 0.7) {
        const cl = free[Math.floor(this.rng() * free.length)];
        for (let k = 0; k < 5; k++) this.coinList.push({ id: this.nextId++, lane: cl, s: s + 6 + k * 3 });
      }
      this.nextRowAt = s + gap;
    }
  }

  _addObstacle(type, lane, s) {
    const d = RACE_OBSTACLES[type];
    const cy = d.low ? 0 : (d.elevatedY != null ? d.elevatedY : d.h / 2);
    this.obstacles.push({ id: this.nextId++, type, lane, s, w: d.w * 0.85, h: d.h, d: d.d * 0.85, cy });
  }

  _collide() {
    if (this.hitCooldown > 0) return;
    const ph = this.sliding ? PLAYER.h * 0.5 : PLAYER.h;
    const py = this.sliding ? this.y - PLAYER.h * 0.25 : this.y;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      const oz = this.distance - o.s;               // obstacle z relative to player (−ahead)
      if (overlap(this.x, PLAYER.w, LANES[o.lane], o.w) &&
          overlap(py, ph, o.cy, o.h) &&
          overlap(0, PLAYER.d, oz, o.d)) {
        this.hits++;
        this.hitCooldown = 1.5;
        this.speed = Math.max(MIN_SPEED, this.speed * 0.7);
        this.obstacles.splice(i, 1);
        this.events.push({ type: 'hit', id: o.id });
        return;
      }
    }
  }

  _collectCoins() {
    for (let i = this.coinList.length - 1; i >= 0; i--) {
      const c = this.coinList[i];
      const cz = this.distance - c.s;
      if (Math.abs(this.x - LANES[c.lane]) < 1.2 && Math.abs(cz) < 1.0 && this.y < 2.4) {
        this.coins++;
        this.coinList.splice(i, 1);
        this.events.push({ type: 'coin', id: c.id });
      }
    }
  }
}

// Validate a submitted input log: [[tick, code], …] with whole, non-decreasing
// ticks inside the race window and known codes. Returns an error string or null.
export function validateInputs(inputs) {
  if (!Array.isArray(inputs)) return 'inputs must be an array';
  if (inputs.length > MAX_INPUTS) return 'too many inputs';
  let last = -1;
  for (const ev of inputs) {
    if (!Array.isArray(ev) || ev.length !== 2) return 'bad input entry';
    const [t, c] = ev;
    if (!Number.isInteger(t) || t < 0 || t >= MAX_TICKS) return 'bad tick';
    if (t < last) return 'ticks out of order';
    if (!INPUT_CODES.includes(c)) return 'bad input code';
    last = t;
  }
  return null;
}

// Re-run a race from scratch. This is what the server trusts.
export function replayRace(seed, inputs) {
  const err = validateInputs(inputs);
  if (err) return { ok: false, error: err };
  const sim = new RaceSim(seed);
  let i = 0;
  while (!sim.over) {
    while (i < inputs.length && inputs[i][0] === sim.tick) sim.input(inputs[i++][1]);
    sim.step();
  }
  // Inputs after the race ended are ignored (harmless), but a log claiming
  // inputs far beyond the end is suspicious — report it for review.
  const trailing = inputs.length - i;
  return { ok: true, score: sim.score, distance: Math.floor(sim.distance), coins: sim.coins,
           hits: sim.hits, ticks: sim.tick, trailingInputs: trailing, version: RACE_VERSION };
}
