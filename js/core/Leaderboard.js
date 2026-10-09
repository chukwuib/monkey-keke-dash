// Online leaderboard client. Talks to a Supabase `leaderboard` table over the
// PostgREST API. Reads are public (anon key). Writes require a Supabase
// ANONYMOUS auth session: the game silently signs the device in once, and each
// row is owned by that anonymous user id — so a player can only ever write their
// own row and nobody can tamper with someone else's. If Supabase isn't
// configured (config.js blank) or a network call fails, every method degrades
// gracefully so the game keeps working offline (local fallback board).

import { SUPABASE_URL, SUPABASE_ANON_KEY, LEADERBOARD_ONLINE } from '../config.js';

const TABLE = 'leaderboard';
const USERNAME_KEY = 'mkd_username';
const SESSION_KEY = 'mkd_sb_session';
// Sane ceiling — far above any legitimate run. Mirrors the DB CHECK constraint
// so honest submissions are never rejected, and keeps obviously-bogus values out.
const MAX_DISTANCE = 10000000;

export class Leaderboard {
  constructor() {
    this.online = LEADERBOARD_ONLINE;
  }

  // ── username (stored locally, chosen once) ────────────────────────────────
  getUsername() {
    return localStorage.getItem(USERNAME_KEY) || '';
  }

  hasUsername() {
    return Boolean(this.getUsername());
  }

  // Clean + clamp a typed name. Returns '' if nothing usable is left.
  static sanitize(raw) {
    return (raw || '')
      .replace(/[<>]/g, '')      // no markup
      .replace(/\s+/g, ' ')      // collapse whitespace
      .trim()
      .slice(0, 16);
  }

  setUsername(name) {
    const clean = Leaderboard.sanitize(name);
    if (clean) localStorage.setItem(USERNAME_KEY, clean);
    return clean;
  }

  // ── anonymous auth session ────────────────────────────────────────────────
  // Returns a valid { access_token, user_id } or null. Reuses the stored
  // session, refreshes it when expired, and only signs in a brand-new
  // anonymous user the first time (or if the stored session is unusable).
  async _getSession() {
    let sess = null;
    try { sess = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { /* ignore */ }
    const now = Math.floor(Date.now() / 1000);
    if (sess && sess.access_token && sess.user_id && sess.expires_at && sess.expires_at - 60 > now) {
      return sess; // still valid
    }
    if (sess && sess.refresh_token) {
      const refreshed = await this._refreshSession(sess.refresh_token);
      if (refreshed) return refreshed;
    }
    return await this._signInAnonymously();
  }

  async _signInAnonymously() {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) return null;
      return this._storeSession(await res.json());
    } catch (e) {
      return null;
    }
  }

  async _refreshSession(refresh_token) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token })
      });
      if (!res.ok) return null;
      return this._storeSession(await res.json());
    } catch (e) {
      return null;
    }
  }

  _storeSession(j) {
    if (!j || !j.access_token) return null;
    const sess = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
      user_id: (j.user && j.user.id) || j.user_id
    };
    if (!sess.user_id) return null;
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    return sess;
  }

  // Read-only header set (public board read uses the anon key).
  _readHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    };
  }

  // Upsert this player's best distance into THEIR OWN row. Signs in anonymously
  // if needed. Safe to call often; no-ops offline. Returns true on success.
  async submitScore(distance, stateName) {
    if (!this.online) return false;
    const username = this.getUsername();
    let d = Math.floor(distance || 0);
    if (!username || d <= 0) return false;
    if (d > MAX_DISTANCE) d = MAX_DISTANCE; // clamp bogus/overflow values
    const state = (stateName || '—').slice(0, 32);
    try {
      const sess = await this._getSession();
      if (!sess) return false; // couldn't authenticate — stay silent, keep playing
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${sess.access_token}`,
          // Upsert on the user's own row (user_id PK); merge to overwrite.
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          user_id: sess.user_id,
          username,
          distance: d,
          state,
          updated_at: new Date().toISOString()
        })
      });
      return res.ok;
    } catch (e) {
      return false; // offline / blocked — silently keep playing
    }
  }

  // Fetch the global top N. Public read — no sign-in needed. Returns [] offline.
  async fetchTop(limit = 20) {
    if (!this.online) return [];
    try {
      const url = `${SUPABASE_URL}/rest/v1/${TABLE}` +
        `?select=username,distance,state,updated_at` +
        `&order=distance.desc&limit=${limit}`;
      const res = await fetch(url, { headers: this._readHeaders() });
      if (!res.ok) return [];
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }
}
