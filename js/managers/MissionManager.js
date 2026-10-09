// MissionManager — per-STAGE missions.
// Every state (stage) gets a fresh set of ~5 missions that scale in difficulty
// with the state index. One of them — "stop at all service points" — is the
// stage's REQUIRED mission (GameManager holds the border until it's done).
// Progress is tracked from existing GameManager events; completing a mission
// pays its reward and fires `missionComplete` (UIManager shows a toast).

export class MissionManager {
  constructor(gameManager) {
    this.gm = gameManager;
    this.missions = [];
    this._resetStage();
    this._bind();
  }

  // ─── Build a stage's mission set (5), scaled by level ───────────
  _build(i) {
    const N = this.gm.requiredStops || Math.max(3, Math.round(3 + i * (4 / 35)));
    const coinGoal  = 60 + i * 8;                       // collect coins this stage
    const nmGoal    = 2 + Math.floor(i / 4);            // near-misses
    const maxHits   = Math.max(0, 2 - Math.floor(i / 12)); // allowed hits: 2 → 1 → 0
    const comboGoal = Math.min(8, 3 + Math.floor(i / 6)); // combo multiplier
    const r = base => base + i * 40;                    // reward grows per level

    return [
      { id: 'stops', icon: '⛽', metric: 'stops', goal: N, required: true,
        label: 'Stop at all {goal} service points', reward: r(250), progress: 0, done: false },
      { id: 'coins', icon: '🪙', metric: 'coins', goal: coinGoal,
        label: 'Collect {goal} coins this stage', reward: r(150), progress: 0, done: false },
      { id: 'nearmiss', icon: '✦', metric: 'nearmiss', goal: nmGoal,
        label: 'Pull off {goal} near-misses', reward: r(180), progress: 0, done: false },
      { id: 'nohit', icon: '🛡️', metric: 'nohit', goal: 1, maxHits,
        label: maxHits > 0 ? `Clear with ${maxHits} hit${maxHits === 1 ? '' : 's'} or fewer` : 'Clear the stage without a scratch',
        reward: r(220), progress: 0, done: false },
      { id: 'combo', icon: '✖️', metric: 'combo', goal: comboGoal,
        label: 'Reach a ×{goal} combo', reward: r(160), progress: 0, done: false },
    ];
  }

  _resetStage() {
    this.coins = 0;
    this.nearMiss = 0;
    this.hits = 0;
    this.maxMult = 1;
    this.missions = this._build(this.gm.stateIndex || 0);
  }

  // ─── Event wiring ───────────────────────────────────────────────
  _bind() {
    // Fresh missions on every state (incl. the first via startGame's stateChanged)
    this.gm.on('stateChanged', () => this._resetStage());

    this.gm.on('coinCollected', earned => { this.coins += earned; this._set('coins', this.coins); });
    this.gm.on('nearMiss', () => { this.nearMiss++; this._set('nearmiss', this.nearMiss); });
    this.gm.on('stopMade', ({ made }) => this._set('stops', made));
    this.gm.on('playerHurt', () => { this.hits++; });
    this.gm.on('multiplierChanged', mult => {
      if (mult > this.maxMult) this.maxMult = mult;
      this._set('combo', this.maxMult);
    });

    // The no-hit mission resolves when the stage is cleared.
    this.gm.on('stateCompleted', () => {
      const m = this.missions.find(x => x.metric === 'nohit' && !x.done);
      if (m && this.hits <= (m.maxHits || 0)) { m.progress = m.goal; this._finish(m); }
    });
  }

  // ─── Progress helpers ───────────────────────────────────────────
  _set(metric, value) {
    const m = this.missions.find(x => x.metric === metric && !x.done);
    if (!m) return;
    if (value > m.progress) m.progress = value;
    if (m.progress >= m.goal) this._finish(m);
  }

  _finish(m) {
    if (m.done) return;
    m.done = true;
    m.progress = m.goal;
    this.gm.addCoins(m.reward);
    this.gm.emit('missionComplete', m);
  }

  // ─── Read API for UI ────────────────────────────────────────────
  text(m) {
    return m.label
      .replace('{goal}', (m.goal || 0).toLocaleString())
      .replace('{maxHits}', m.maxHits);
  }
  list() { return this.missions; }
}
