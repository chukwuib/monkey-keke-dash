// Lifetime stats + local high-score table. Listens to GameManager events and
// persists everything to localStorage. Feeds the Top Riders screen.

const MAX_SCORES = 5;

export class Stats {
  constructor(gameManager) {
    this.gm = gameManager;
    this.runs = parseInt(localStorage.getItem('mkd_runs') || '0');
    this.statesCleared = parseInt(localStorage.getItem('mkd_states_cleared') || '0');
    this.missionsDone = parseInt(localStorage.getItem('mkd_missions_done') || '0');
    this.scores = this._loadScores(); // [{ d, state, date }] sorted desc by distance
    this._bind();
  }

  _loadScores() {
    try {
      const s = JSON.parse(localStorage.getItem('mkd_scores') || '[]');
      if (Array.isArray(s)) return s;
    } catch (e) { /* ignore */ }
    return [];
  }

  _bind() {
    this.gm.on('gameStarted', () => { this.runs++; localStorage.setItem('mkd_runs', this.runs); });
    this.gm.on('stateCompleted', () => { this.statesCleared++; localStorage.setItem('mkd_states_cleared', this.statesCleared); });
    this.gm.on('missionComplete', () => { this.missionsDone++; localStorage.setItem('mkd_missions_done', this.missionsDone); });
    this.gm.on('gameOver', s => this.recordScore(s.distance, s.state));
  }

  recordScore(distance, state) {
    const d = Math.floor(distance || 0);
    if (d <= 0) return;
    const now = new Date();
    const date = `${now.getDate()}/${now.getMonth() + 1}`;
    this.scores.push({ d, state: state || '—', date });
    this.scores.sort((a, b) => b.d - a.d);
    this.scores = this.scores.slice(0, MAX_SCORES);
    localStorage.setItem('mkd_scores', JSON.stringify(this.scores));
  }

  bestDistance() {
    const top = this.scores[0]?.d || 0;
    return Math.max(top, parseInt(localStorage.getItem('mkd_best_score') || '0'));
  }
}
