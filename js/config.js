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

// ─── Payments (web / PWA) ───────────────────────────────────────────────────
// Which checkout the browser / PWA uses: 'foren' (FOREN pop-up) or 'paystack'.
// Only PUBLIC keys go here (pk_test_… while testing, pk_live_… to go live).
// SECRET keys never go in the game: they live only in the Supabase Edge
// Functions (`foren-verify` / `paystack-verify`), which confirm each payment
// before coins are granted. Blank key = store shows, payments switched off.
// See PAYMENTS-SETUP.md.
export const WEB_PAY_PROVIDER = 'foren';

export const FOREN_PUBLIC_KEY = 'pk_test_c6d591b27af2fgb01hfhb4f1224b64cg40dgef4';
export const FOREN_VERIFY_URL = `${SUPABASE_URL}/functions/v1/foren-verify`;

export const PAYSTACK_PUBLIC_KEY = '';
export const PAYSTACK_VERIFY_URL = `${SUPABASE_URL}/functions/v1/paystack-verify`;

export const WEB_PAY_PUBLIC_KEY = WEB_PAY_PROVIDER === 'foren' ? FOREN_PUBLIC_KEY : PAYSTACK_PUBLIC_KEY;
export const WEB_PAY_VERIFY_URL = WEB_PAY_PROVIDER === 'foren' ? FOREN_VERIFY_URL : PAYSTACK_VERIFY_URL;
// The Android (Play Store) build uses Google Play Billing instead — products
// are set up in Play Console with the ids in js/data/Products.js.

// ─── Daily Race (₦50 entry, cash prize — Nigeria, web/PWA only) ────────────
// SUSPENDED by the owner until further notice (2026-10-09) — do not switch on
// without their go-ahead. Also needs the gaming licence + Paystack approval. The server
// has its own switch too (Edge Function secret RACE_ENABLED=true); both must
// be on for anyone to enter. See RACE-ENGINE.md.
export const RACE_ENABLED = false;
