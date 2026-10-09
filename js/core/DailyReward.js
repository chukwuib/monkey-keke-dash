// Daily login-streak reward. 7-day escalating cycle; the streak grows while you
// play on consecutive days and resets if you miss a day. All persisted locally.

export const DAILY_REWARDS = [100, 250, 500, 800, 1200, 2000, 5000];

export class DailyReward {
  constructor() {
    this.rewards = DAILY_REWARDS;
    this.last = '';
    this.streak = 0;
    this.load();
  }

  load() {
    this.last = localStorage.getItem('mkd_daily_last') || '';
    this.streak = parseInt(localStorage.getItem('mkd_daily_streak') || '0');
  }

  // Local calendar date as YYYY-M-D (local, not UTC, so "today" matches the player)
  _dateStr(d = new Date()) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  _prevStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return this._dateStr(d);
  }

  // What's the player's situation right now?
  status() {
    const today = this._dateStr();
    if (this.last === today) {
      const dayIndex = ((this.streak - 1) % 7 + 7) % 7;
      return { claimable: false, claimedToday: true, streak: this.streak, dayIndex };
    }
    const continues = this.last === this._prevStr();
    const nextStreak = continues ? this.streak + 1 : 1;
    const dayIndex = (nextStreak - 1) % 7;
    return { claimable: true, claimedToday: false, streak: nextStreak, dayIndex, reward: this.rewards[dayIndex] };
  }

  // Awards the reward and advances the streak. Returns coins granted (0 if none).
  claim() {
    const st = this.status();
    if (!st.claimable) return 0;
    this.streak = st.streak;
    this.last = this._dateStr();
    localStorage.setItem('mkd_daily_streak', this.streak.toString());
    localStorage.setItem('mkd_daily_last', this.last);
    return st.reward;
  }
}
