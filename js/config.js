// ─── Monkey Keke Dash — runtime config ──────────────────────────────────────
// Online leaderboard (Supabase). Leave these blank to run fully offline:
// when blank, the Top Riders board shows the player's own local scores only
// and the game never makes a network call. Fill both in to switch on the
// global, shared leaderboard.
//
//   SUPABASE_URL      e.g. "https://abcdefgh.supabase.co"
//   SUPABASE_ANON_KEY the project's public anon key (safe to ship in the app)
//
// See playstore/LEADERBOARD-SETUP.md for the one-time setup steps.

export const SUPABASE_URL = 'https://yeontoxypatsbptrjfmc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inllb250b3h5cGF0c2JwdHJqZm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDAzMzAsImV4cCI6MjA5NzM3NjMzMH0.shEdP6p3ncbSSF8gH812eH4jfMxVd8GAZinS0orgSEA';

// True only when both values above are present.
export const LEADERBOARD_ONLINE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
