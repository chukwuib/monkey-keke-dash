import { SUPABASE_URL, SUPABASE_ANON_KEY, PAYSTACK_PUBLIC_KEY, RACE_ENABLED } from '../config.js';

// Daily Race lobby → ₦50 Paystack entry → race → server-verified result.
// Web/PWA only (the Play app never shows it). All money logic is server-side.
const FN = `${SUPABASE_URL}/functions/v1`;
const PROFILE_KEY = 'mkd_race_profile';
const ENTRY_FEE_KOBO = 5000;

// Common Nigerian banks (Paystack bank codes). The server re-checks every
// account with Paystack's resolve API, so a wrong pick simply fails safely.
const BANKS = [
  ['044', 'Access Bank'], ['023', 'Citibank'], ['050', 'Ecobank'], ['070', 'Fidelity Bank'],
  ['011', 'First Bank'], ['214', 'FCMB'], ['058', 'GTBank'], ['030', 'Heritage Bank'],
  ['082', 'Keystone Bank'], ['50211', 'Kuda'], ['50515', 'Moniepoint'], ['999992', 'OPay'],
  ['999991', 'PalmPay'], ['076', 'Polaris Bank'], ['101', 'Providus Bank'], ['221', 'Stanbic IBTC'],
  ['232', 'Sterling Bank'], ['032', 'Union Bank'], ['033', 'UBA'], ['215', 'Unity Bank'],
  ['035', 'Wema Bank'], ['057', 'Zenith Bank'],
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };

export class RaceUI {
  constructor({ ui, raceMode, payment }) {
    this.ui = ui;                 // UIManager (screens, toasts, leaderboard session)
    this.race = raceMode;
    this.payment = payment;       // reuses the Paystack loader + receipt email
    this.isNative = !!window.Capacitor?.isNativePlatform?.();
    this.busy = false;
    const btn = document.getElementById('btn-race');
    // Hidden until the race is switched on, and never inside the Play app.
    if (btn) btn.style.display = (RACE_ENABLED && !this.isNative) ? '' : 'none';
    btn?.addEventListener('click', () => this.open());
    document.getElementById('btn-race-close')?.addEventListener('click', () => this.ui.show('screen-menu'));
    document.getElementById('btn-race-pay')?.addEventListener('click', () => this._payAndRace());
    document.getElementById('btn-race-claim')?.addEventListener('click', () => this._claim());
    document.getElementById('btn-race-again')?.addEventListener('click', () => this.open());
    const bankSel = document.getElementById('race-bank');
    if (bankSel) bankSel.innerHTML = '<option value="">Choose your bank</option>' +
      BANKS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  }

  async _session() { return this.ui.leaderboard._getSession(); }

  async _call(name, { method = 'POST', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
    if (auth) {
      const s = await this._session();
      if (!s) throw new Error('Could not sign in — check your connection');
      headers.Authorization = `Bearer ${s.access_token}`;
    } else headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
    const res = await fetch(`${FN}/${name}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  }

  _status(text, kind = '') {
    const el = document.getElementById('race-status');
    if (el) { el.textContent = text; el.className = `store-status ${kind}`; }
  }

  async open() {
    this.ui.show('screen-race');
    document.getElementById('race-result').style.display = 'none';
    document.getElementById('race-lobby').style.display = '';
    const live = RACE_ENABLED && !!PAYSTACK_PUBLIC_KEY;
    document.getElementById('race-closed-note').style.display = live ? 'none' : '';
    document.getElementById('btn-race-pay').disabled = !live;
    const prof = readJSON(PROFILE_KEY, {});
    document.getElementById('race-name').value = prof.name || '';
    document.getElementById('race-phone').value = prof.phone || '';
    document.getElementById('race-email').value = this.payment.email || '';
    this._status('');
    if (live) { this._loadBoard(); this._loadWins(); }
  }

  async _loadBoard() {
    const el = document.getElementById('race-board');
    el.innerHTML = '<div class="race-muted">Loading today\'s race…</div>';
    try {
      const b = await this._call('race-board', { method: 'GET', auth: !!(await this._session()) });
      if (!b.ok || !b.enabled) { el.innerHTML = '<div class="race-muted">The daily race is not open yet.</div>'; return; }
      const closes = new Date(b.closes_at);
      document.getElementById('race-prize').textContent = `₦${b.prize_naira.toLocaleString()}`;
      document.getElementById('race-meta').textContent =
        `${b.entries.toLocaleString()} entries · pool ₦${b.contribution_naira.toLocaleString()} · closes ${closes.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      el.innerHTML = (b.top.length ? b.top.map(r =>
        `<div class="race-row"><span>#${r.rank}</span><span>${esc(r.name)}</span><span>${r.score.toLocaleString()}</span></div>`).join('')
        : '<div class="race-muted">No scores yet today — be the first!</div>') +
        (b.you ? `<div class="race-row you"><span>#${b.you.rank}</span><span>You</span><span>${b.you.best.toLocaleString()}</span></div>` : '') +
        (b.last_winner ? `<div class="race-muted">Last winner: ${esc(b.last_winner.name)} — ₦${b.last_winner.prize_naira.toLocaleString()}</div>` : '');
    } catch (e) {
      el.innerHTML = '<div class="race-muted">Couldn\'t load the leaderboard.</div>';
    }
  }

  async _loadWins() {
    const box = document.getElementById('race-claim-box');
    box.style.display = 'none';
    try {
      const r = await this._call('race-claim', { method: 'GET' });
      const due = (r.wins || []).filter(w => w.status === 'awaiting_bank');
      if (due.length) {
        box.style.display = '';
        document.getElementById('race-claim-text').textContent =
          `🏆 You won ₦${due[0].prize_naira.toLocaleString()} on ${due[0].date}! Add your bank account to receive it.`;
      }
    } catch (e) { /* not signed in yet — nothing to claim */ }
  }

  async _payAndRace() {
    if (this.busy) return;
    const name = document.getElementById('race-name').value.trim();
    const phone = document.getElementById('race-phone').value.replace(/\s+/g, '');
    const email = document.getElementById('race-email').value.trim();
    if (name.length < 2) return this._status('❌ Enter your rider name', 'err');
    if (!/^(\+234|0)[789][01][0-9]{8}$/.test(phone)) return this._status('❌ Enter a valid Nigerian phone number', 'err');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return this._status('❌ Enter an email for your receipt', 'err');
    if (!document.getElementById('race-terms').checked) return this._status('❌ Please accept the race rules', 'err');
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, phone })); } catch (e) { /* ignore */ }
    this.payment.email = email;

    this.busy = true;
    try {
      const sess = await this._session();
      if (!sess) throw new Error('Could not sign in — check your connection');
      this._status('⏳ Opening secure checkout…', 'wait');
      if (!window.PaystackPop) await this.payment._loadPaystackScript();
      const reference = `RACE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const paid = await new Promise(resolve => {
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        window.PaystackPop.setup({
          key: PAYSTACK_PUBLIC_KEY, email, amount: ENTRY_FEE_KOBO, currency: 'NGN', ref: reference,
          channels: ['card', 'bank_transfer', 'ussd'],
          metadata: { purpose: 'race_entry', player_id: sess.user_id, game: 'monkey-keke-dash' },
          callback: r => finish(r?.reference || reference), onSuccess: r => finish(r?.reference || reference),
          onClose: () => finish(null),
        }).openIframe();
      });
      if (!paid) { this._status('Payment cancelled'); return; }

      this._status('⏳ Confirming your ₦50 entry…', 'wait');
      let entry;
      for (let attempt = 0; attempt < 6; attempt++) {   // bank transfers can take a moment to confirm
        entry = await this._call('race-enter', { body: { reference: paid, display_name: name, phone } });
        if (entry.ok || entry.final) break;
        await new Promise(r => setTimeout(r, 4000));
      }
      if (!entry?.ok) { this._status(`❌ ${entry?.message || 'Entry failed'}`, 'err'); return; }

      this._status('');
      this.ui.show('screen-race-play');
      await this._countdown();
      this.ui.show('race-running');   // no screen: just the 3D race + race HUD
      this.race.start(entry, run => this._submit(run));
    } catch (e) {
      this._status(`❌ ${e.message || 'Something went wrong'}`, 'err');
    } finally {
      this.busy = false;
    }
  }

  _countdown() {
    const el = document.getElementById('race-countdown');
    return new Promise(resolve => {
      let n = 3;
      const tick = () => {
        el.textContent = n > 0 ? n : 'GO!';
        if (n-- < 0) return resolve();
        setTimeout(tick, 700);
      };
      tick();
    });
  }

  async _submit(run) {
    this.ui.show('screen-race');
    document.getElementById('race-lobby').style.display = 'none';
    const res = document.getElementById('race-result');
    res.style.display = '';
    const out = document.getElementById('race-result-text');
    out.innerHTML = `Your run: <b>${run.score.toLocaleString()}</b><br><span class="race-muted">Verifying with the race server…</span>`;
    let r;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { r = await this._call('race-submit', { body: { entry_id: run.entry.entry_id, inputs: run.inputs, client_score: run.score } }); }
      catch (e) { r = { ok: false, message: e.message }; }
      if (r.ok || r.final) break;
      await new Promise(x => setTimeout(x, 3000));
    }
    if (r?.ok) {
      out.innerHTML = `✅ Verified score: <b>${r.score.toLocaleString()}</b><br>` +
        `Your best today: <b>${r.best_today.toLocaleString()}</b> — currently <b>#${r.rank}</b> of ${r.players}`;
    } else {
      out.innerHTML = `❌ ${esc(r?.message || 'Could not verify this run')}`;
    }
  }

  async _claim() {
    const bank_code = document.getElementById('race-bank').value;
    const account_number = document.getElementById('race-acct').value.trim();
    const msg = document.getElementById('race-claim-status');
    if (!bank_code || !/^[0-9]{10}$/.test(account_number)) { msg.textContent = '❌ Choose your bank and enter your 10-digit account number'; return; }
    msg.textContent = '⏳ Checking account…';
    const r = await this._call('race-claim', { body: { bank_code, account_number } }).catch(e => ({ ok: false, message: e.message }));
    msg.textContent = r.ok ? `✅ Saved: ${r.account_name}. Your prize will be sent after review.` : `❌ ${r.message || 'Could not save'}`;
  }
}
