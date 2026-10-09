import { SUPABASE_ANON_KEY, PAYSTACK_PUBLIC_KEY, PAYSTACK_VERIFY_URL } from '../config.js';
import { PRODUCTS, productById } from '../data/Products.js';

/**
 * PaymentManager — one buy() API, two payment rails:
 *   • Web / PWA  → Paystack inline checkout (card, bank transfer, USSD, MTN MoMo).
 *                  Every payment is confirmed server-side by the Supabase Edge
 *                  Function `paystack-verify` (holds the secret key) before
 *                  anything is granted.
 *   • Android    → Google Play Billing via cordova-plugin-purchase (Play's
 *                  Payments policy requires it for in-app digital items).
 * Products live in js/data/Products.js.
 */
const PENDING_KEY = 'mkd_pending_pay';   // Paystack refs paid but not yet confirmed
const CLAIMED_KEY = 'mkd_claimed_pay';   // refs / Play transaction ids already granted
const EMAIL_KEY = 'mkd_pay_email';
const LATE_CONTINUE_COINS = 500;         // a continue confirmed after the run ended

const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full / blocked */ } };

export class PaymentManager {
  constructor(gameManager) {
    this.gm = gameManager;
    this.isNative = !!window.Capacitor?.isNativePlatform?.();
    this.platform = this.isNative ? 'play' : 'paystack';
    this.isProcessing = false;
    this.playReady = false;
    this._playWaiters = {};   // productId → resolve() for an in-flight Play order
    this.onGrant = null;      // UI hook: (product, info) after anything is granted
    this.init();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  isAvailable() {
    return this.platform === 'play' ? this.playReady : !!PAYSTACK_PUBLIC_KEY;
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

  /** Buy a product. opts.method = Paystack channel (web only). Resolves {success, message}. */
  async buy(productId, opts = {}) {
    const product = productById(productId);
    if (!product) return { success: false, message: 'Unknown product' };
    if (this.isProcessing) return { success: false, message: 'A payment is already in progress' };
    this.isProcessing = true;
    try {
      return this.platform === 'play'
        ? await this._buyPlay(product)
        : await this._buyPaystack(product, opts.method || 'card', opts.email || this.email);
    } catch (err) {
      console.warn('Payment failed:', err);
      return { success: false, message: err?.message || 'Payment failed' };
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Startup: Play store hookup + retry unconfirmed Paystack payments ──────
  async init() {
    if (this.platform === 'play') this._initPlay();
    else this._retryPending();
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

  // ── Paystack (web / PWA) ──────────────────────────────────────────────────
  async _buyPaystack(product, method, email) {
    if (!PAYSTACK_PUBLIC_KEY) return { success: false, message: 'Payments are not switched on yet' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'Enter a valid email for your receipt' };
    this.email = email;
    if (!window.PaystackPop) await this._loadPaystackScript();

    const reference = this._generateReference();
    const paid = await new Promise(resolve => {
      let settled = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      const onPaid = res => done(res?.reference || reference);
      window.PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email,
        amount: product.naira * 100, // kobo
        currency: 'NGN',
        ref: reference,
        channels: [method],
        metadata: { product_id: product.id, game: 'monkey-keke-dash' },
        callback: onPaid,   // inline v1 success hook
        onSuccess: onPaid,  // newer inline name — whichever fires first wins
        onClose: () => done(null),
      }).openIframe();
    });
    if (!paid) return { success: false, message: 'Payment cancelled' };

    // Remember it until the server confirms, so a dropped connection never loses a payment.
    const pending = readJSON(PENDING_KEY, []);
    pending.push({ reference: paid, productId: product.id });
    writeJSON(PENDING_KEY, pending);
    return this._confirmPaystack(paid, product);
  }

  async _confirmPaystack(reference, product) {
    let res;
    try {
      res = await fetch(PAYSTACK_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ reference, productId: product.id }),
      });
    } catch (e) {
      return { success: false, pending: true, message: 'Payment received — confirming. Your coins will arrive automatically.' };
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      this._dropPending(reference);
      const g = this._grant(product, reference);
      return { success: true, ...g, message: 'Payment confirmed!' };
    }
    if (body.final) { // Paystack says it failed / wrong amount — stop retrying
      this._dropPending(reference);
      return { success: false, message: body.message || 'Payment could not be confirmed' };
    }
    return { success: false, pending: true, message: 'Payment received — confirming. Your coins will arrive automatically.' };
  }

  _dropPending(reference) {
    writeJSON(PENDING_KEY, readJSON(PENDING_KEY, []).filter(p => p.reference !== reference));
  }

  async _retryPending() {
    if (!PAYSTACK_PUBLIC_KEY) return;
    for (const p of readJSON(PENDING_KEY, [])) {
      const product = productById(p.productId);
      if (product) await this._confirmPaystack(p.reference, product);
      else this._dropPending(p.reference);
    }
  }

  _loadPaystackScript() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v1/inline.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not reach Paystack — check your connection'));
      document.head.appendChild(script);
    });
  }

  _generateReference() {
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `KEKE-${Date.now()}-${random}`;
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
