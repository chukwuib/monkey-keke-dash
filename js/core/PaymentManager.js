import { SUPABASE_ANON_KEY, WEB_PAY_PROVIDER, WEB_PAY_PUBLIC_KEY, WEB_PAY_VERIFY_URL } from '../config.js';
import { PRODUCTS, PAY_METHODS, productById } from '../data/Products.js';

/**
 * PaymentManager — one buy() API, two payment rails:
 *   • Web / PWA  → FOREN pop-up (or Paystack inline, see WEB_PAY_PROVIDER).
 *                  Every payment is confirmed server-side by a Supabase Edge
 *                  Function (`foren-verify` / `paystack-verify`, holds the
 *                  secret key) before anything is granted.
 *   • Android    → Google Play Billing via cordova-plugin-purchase (Play's
 *                  Payments policy requires it for in-app digital items).
 * Products live in js/data/Products.js.
 */
const PENDING_KEY = 'mkd_pending_pay';   // web refs started but not yet confirmed
const CLAIMED_KEY = 'mkd_claimed_pay';   // refs / Play transaction ids already granted
const EMAIL_KEY = 'mkd_pay_email';
const DEVICE_KEY = 'mkd_device_id';      // ties a payment reference to this device
const LATE_CONTINUE_COINS = 1000;         // a continue confirmed after the run ended
const PENDING_MAX_AGE = 3 * 24 * 3600e3;  // stop chasing an unpaid reference after 3 days
const STARTED_MAX_AGE = 3600e3;           // …or after 1 hour if checkout was never even started
const RETRY_EVERY = 30e3;                 // re-check pending payments while the game is open
const FOREN_CHECKOUT = 'https://pay.foren.co/redirect/';  // + base64(JSON payload)
const FOREN_WATCH_MS = 35 * 60e3;          // FOREN transfer accounts expire after 30 min
const PAYSTACK_JS = 'https://js.paystack.co/v1/inline.js';
const PENDING_MSG = 'Waiting for your payment to be confirmed — your coins will arrive automatically.';

const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ } };

export class PaymentManager {
  constructor(gameManager) {
    this.gm = gameManager;
    this.isNative = !!window.Capacitor?.isNativePlatform?.();
    this.platform = this.isNative ? 'play' : 'web';
    this.provider = WEB_PAY_PROVIDER;
    this.enabledChannels = null;  // FOREN channels switched on for NGN (null = not loaded yet)
    this.isProcessing = false;
    this.playReady = false;
    this._playWaiters = {};   // productId → resolve() for an in-flight Play order
    this.onGrant = null;      // UI hook: (product, info) after anything is granted
    this.init();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  isAvailable() {
    return this.platform === 'play' ? this.hasPlayProducts() : !!WEB_PAY_PUBLIC_KEY;
  }

  // Web checkout running on test keys (no real money moves).
  isTestMode() {
    return this.platform !== 'play' && /^pk_test_/.test(WEB_PAY_PUBLIC_KEY);
  }

  // Can this pay method be used right now? (web only)
  methodAvailable(methodId) {
    const m = PAY_METHODS.find(x => x.id === methodId);
    if (!m || m.comingSoon) return false;
    if (this.provider !== 'foren') return true;
    if (!m.foren) return false;                       // FOREN doesn't offer it
    return !this.enabledChannels || this.enabledChannels.includes(m.foren);
  }

  // Ask the server which FOREN channels are switched on for NGN (Card may be
  // off until enabled in the FOREN dashboard). Calls onPricesChanged to re-render.
  async loadChannels() {
    if (this.platform !== 'web' || this.provider !== 'foren' || !WEB_PAY_PUBLIC_KEY) return;
    try {
      const res = await fetch(WEB_PAY_VERIFY_URL, { headers: this._fnHeaders() });
      const body = await res.json();
      if (res.ok && Array.isArray(body.channels)) {
        this.enabledChannels = body.channels;
        this.onPricesChanged?.();
      }
    } catch (e) { /* offline — offer every FOREN channel; the pop-up will say if one is off */ }
  }

  // True once Google Play has returned at least one of our products (they must
  // be created + activated in Play Console). Until then the app hides the store.
  hasPlayProducts() {
    const store = this._playStore();
    return this.playReady && !!store && PRODUCTS.some(p => store.get(p.id)?.pricing);
  }

  priceLabel(product) {
    if (this.platform === 'play') {
      const p = this._playStore()?.get(product.id);
      return p?.pricing?.price || '…';
    }
    return `₦${product.naira.toLocaleString()}`;
  }

  get email() { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch (e) { return ''; } }
  set email(v) { try { localStorage.setItem(EMAIL_KEY, v); } catch (e) { /* ignore */ } }

  /** Buy a product. opts.method = PAY_METHODS id (web only). Resolves {success, pending?, message}. */
  async buy(productId, opts = {}) {
    const product = productById(productId);
    if (!product) return { success: false, message: 'Unknown product' };
    if (this.isProcessing) return { success: false, message: 'A payment is already in progress' };
    this.isProcessing = true;
    try {
      return this.platform === 'play'
        ? await this._buyPlay(product)
        : await this._buyWeb(product, opts.method || 'card', opts.email || this.email, opts);
    } catch (err) {
      console.warn('Payment failed:', err);
      return { success: false, message: err?.message || 'Payment failed' };
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Startup: Play store hookup, or retry unconfirmed web payments ─────────
  async init() {
    if (this.platform === 'play') return this._initPlay();
    this.loadChannels();
    this._retryPending();
    // A bank transfer can land minutes after the pop-up closes: keep checking.
    setInterval(() => { if (!this.isProcessing && readJSON(PENDING_KEY, []).length) this._retryPending(); }, RETRY_EVERY);
  }

  // ── Granting ──────────────────────────────────────────────────────────────
  _alreadyClaimed(id) { return readJSON(CLAIMED_KEY, []).includes(id); }
  _markClaimed(id) {
    const list = readJSON(CLAIMED_KEY, []);
    list.push(id);
    writeJSON(CLAIMED_KEY, list.slice(-200));
  }

  // Idempotent per payment id: a reference / transaction is only ever granted once.
  _grant(product, paymentId) {
    if (paymentId && this._alreadyClaimed(paymentId)) return { granted: false };
    if (paymentId) this._markClaimed(paymentId);
    let info;
    if (product.kind === 'coins') {
      this.gm.addCoins(product.coins);
      info = { coins: product.coins };
    } else if (product.kind === 'continue' && this.gm.state === 'GAMEOVER') {
      this.gm.continueRun();
      info = { continued: true };
    } else {
      // Paid for a continue but the run is gone (confirmed late / app restarted).
      this.gm.addCoins(LATE_CONTINUE_COINS);
      info = { coins: LATE_CONTINUE_COINS, lateContinue: true };
    }
    this.onGrant?.(product, info);
    return { granted: true, ...info };
  }

  // ── Web checkout (FOREN hosted checkout or Paystack inline) ────────────────────────
  async _buyWeb(product, methodId, email, opts = {}) {
    if (!WEB_PAY_PUBLIC_KEY) return { success: false, message: 'Payments are not switched on yet' };
    if (!this.methodAvailable(methodId)) return { success: false, message: 'That payment method is not available yet — choose another' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'Enter a valid email for your receipt' };
    this.email = email;

    // The product id travels inside the reference so the server can check the amount.
    const reference = this._generateReference(product.id);
    // Saved BEFORE checkout opens: a bank transfer may be paid after the pop-up is
    // closed, so every started checkout is chased until paid, failed or expired.
    const pending = readJSON(PENDING_KEY, []);
    pending.push({ reference, productId: product.id, method: methodId, at: Date.now() });
    writeJSON(PENDING_KEY, pending);

    // FOREN: checkout opens in a new tab and this tab watches for the payment.
    if (this.provider === 'foren') return this._payForen(product, methodId, email, reference, opts);

    const outcome = await this._openPaystack(product, methodId, email, reference);
    if (outcome === 'error') {
      this._dropPending(reference);
      return { success: false, message: 'Payment was not successful — no money was taken. Try again or choose another method.' };
    }
    const result = await this._confirmWeb(reference, product);
    if (result.success || result.final) return result;
    if (outcome === 'closed' && methodId !== 'bank_transfer') {
      // Card / USSD closed without paying: nothing to wait for.
      this._dropPending(reference);
      return { success: false, message: 'Payment cancelled' };
    }
    return { success: false, pending: true, message: PENDING_MSG };
  }

  // FOREN hosted checkout (their pop-up page refuses to load in a frame, so we use
  // the documented redirect checkout). Must run before any await so the browser
  // treats window.open as part of the tap and doesn't block it.
  async _payForen(product, methodId, email, reference, opts) {
    const payload = {
      redirectUrl: new URL('payment-done.html', location.href).href,
      key: WEB_PAY_PUBLIC_KEY,
      showPersonalInformation: false,
      customerEmail: email,
      customerName: 'Keke Rider',
      reference,
      shouldWindowClose: false,
      amount: product.naira,               // FOREN takes whole naira (200 = ₦200)
      currencyCode: 'NGN',
      channels: [PAY_METHODS.find(m => m.id === methodId)?.foren],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const url = FOREN_CHECKOUT + btoa(String.fromCharCode(...bytes));
    const win = window.open(url, '_blank');
    if (!win) {
      // Pop-ups blocked (or installed app without tabs): pay in this tab. The
      // reference is already saved, so coins are added when the game reopens.
      location.assign(url);
      return { success: false, pending: true, message: 'Opening checkout…' };
    }

    opts.onStatus?.('⏳ Complete your payment in the FOREN tab — this page updates by itself.');
    const started = Date.now();
    let closedAt = 0;
    while (Date.now() - started < FOREN_WATCH_MS) {
      await new Promise(r => setTimeout(r, 4000));
      const r = await this._confirmWeb(reference, product);
      if (r.success || r.final) { try { win.close(); } catch (e) { /* ignore */ } return r; }
      if (win.closed) {
        closedAt ||= Date.now();
        if (Date.now() - closedAt > 12000) break;   // a few last checks after the tab closes
      }
    }
    return { success: false, pending: true,
      message: 'Checkout closed. If you paid, your coins will arrive automatically.' };
  }

  async _openPaystack(product, methodId, email, reference) {
    if (!window.PaystackPop) await this._loadScript(PAYSTACK_JS);
    return new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      window.PaystackPop.setup({
        key: WEB_PAY_PUBLIC_KEY,
        email,
        amount: product.naira * 100, // kobo
        currency: 'NGN',
        ref: reference,
        channels: [methodId],
        metadata: { product_id: product.id, game: 'monkey-keke-dash' },
        callback: () => done('success'),   // inline v1 success hook
        onSuccess: () => done('success'),  // newer inline name — whichever fires first wins
        onClose: () => done('closed'),
      }).openIframe();
    });
  }

  _fnHeaders() {
    return { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
  }

  // Server-side confirmation. {success} → granted; {final} → stop chasing; else still pending.
  async _confirmWeb(reference, product) {
    let res;
    try {
      res = await fetch(WEB_PAY_VERIFY_URL, {
        method: 'POST',
        headers: this._fnHeaders(),
        body: JSON.stringify({ reference, productId: product.id, deviceId: this._deviceId() }),
      });
    } catch (e) {
      return { success: false, pending: true, message: PENDING_MSG };
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      this._dropPending(reference);
      const g = this._grant(product, reference);
      return { success: true, ...g, message: 'Payment confirmed!' };
    }
    if (body.final) { // failed / expired / wrong amount / used elsewhere — stop retrying
      this._dropPending(reference);
      return { success: false, final: true, message: body.message || 'Payment could not be confirmed' };
    }
    // unknown = FOREN has no such payment yet (checkout opened but never started).
    return { success: false, pending: true, unknown: !!body.unknown, message: PENDING_MSG };
  }

  _dropPending(reference) {
    writeJSON(PENDING_KEY, readJSON(PENDING_KEY, []).filter(p => p.reference !== reference));
  }

  async _retryPending() {
    if (!WEB_PAY_PUBLIC_KEY || this._retrying) return;
    this._retrying = true;
    try {
      for (const p of readJSON(PENDING_KEY, [])) {
        const product = productById(p.productId);
        if (!product || (p.at && Date.now() - p.at > PENDING_MAX_AGE)) { this._dropPending(p.reference); continue; }
        const r = await this._confirmWeb(p.reference, product);
        // A checkout that FOREN never heard of after an hour was abandoned before paying.
        if (r.unknown && p.at && Date.now() - p.at > STARTED_MAX_AGE) this._dropPending(p.reference);
      }
    } finally {
      this._retrying = false;
    }
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not reach the payment page — check your connection'));
      document.head.appendChild(script);
    });
  }

  // Kept for the (suspended) Daily Race, which uses Paystack directly.
  _loadPaystackScript() { return this._loadScript(PAYSTACK_JS); }

  _deviceId() {
    let id = '';
    try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { /* ignore */ }
    if (!/^[a-z0-9]{16,40}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  // e.g. MKD-pack_popular-1791567165000-K3P9QZ (server reads the product back out).
  _generateReference(productId) {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36).padStart(2, '0')).join('').toUpperCase();
    return `MKD-${productId}-${Date.now()}-${random}`;
  }

  // ── Google Play Billing (Android) ─────────────────────────────────────────
  _playStore() { return window.CdvPurchase?.store; }

  async _initPlay() {
    // cordova-plugin-purchase attaches window.CdvPurchase once the bridge is up.
    for (let i = 0; i < 50 && !window.CdvPurchase; i++) await new Promise(r => setTimeout(r, 200));
    const C = window.CdvPurchase;
    if (!C) { console.warn('Play Billing plugin not available'); return; }
    const { store, ProductType, Platform } = C;

    store.register(PRODUCTS.map(p => ({ id: p.id, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY })));
    // Consumables: grant, then finish() so Google consumes it and it can be bought again.
    // Also fires on startup for anything paid but not yet finished (app was killed).
    store.when().approved(tx => {
      for (const item of tx.products) {
        const product = productById(item.id);
        if (product) this._grant(product, `play:${tx.transactionId}:${item.id}`);
        this._playWaiters[item.id]?.({ success: true, message: 'Purchase complete!' });
        delete this._playWaiters[item.id];
      }
      tx.finish();
    });
    store.when().productUpdated(() => this.onPricesChanged?.());
    store.error(err => console.warn('Play Billing error:', err?.code, err?.message));

    await store.initialize([Platform.GOOGLE_PLAY]);
    this.playReady = true;
    this.onPricesChanged?.();
  }

  _buyPlay(product) {
    const C = window.CdvPurchase;
    const offer = this._playStore()?.get(product.id, C?.Platform.GOOGLE_PLAY)?.getOffer();
    if (!offer) return Promise.resolve({ success: false, message: 'Google Play store not ready — try again in a moment' });
    return new Promise(resolve => {
      this._playWaiters[product.id] = resolve;
      offer.order().then(err => {
        if (!err) return; // success arrives via the approved() handler
        delete this._playWaiters[product.id];
        const cancelled = err.code === C.ErrorCode.PAYMENT_CANCELLED;
        resolve({ success: false, message: cancelled ? 'Payment cancelled' : (err.message || 'Purchase failed') });
      });
    });
  }
}
