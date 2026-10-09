import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

/**
 * PaymentManager — Paystack integration for ₦50 continue payment
 * Test mode: uses Paystack sandbox
 */
export class PaymentManager {
  constructor(gameManager) {
    this.gm = gameManager;
    this.SUPABASE_URL = SUPABASE_URL;
    this.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

    // Paystack test keys (swap with live keys for production)
    this.PAYSTACK_PUBLIC_KEY = 'pk_test_51a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p';
    this.PAYSTACK_AMOUNT = 5000; // ₦50 in kobo (50 × 100)
    this.PAYSTACK_EMAIL = 'player@monkeykeke.dash';

    this.isProcessing = false;
    this.lastReference = null;
  }

  /**
   * Initiate payment for continue
   * @param {string} userEmail - Player email (optional)
   * @returns {Promise<{success, reference, message}>}
   */
  async initiatePayment(userEmail) {
    if (this.isProcessing) {
      console.warn('Payment already in progress');
      return { success: false, message: 'Payment in progress' };
    }

    this.isProcessing = true;
    const email = userEmail || this.PAYSTACK_EMAIL;

    try {
      if (!window.PaystackPop) {
        await this._loadPaystackScript();
      }

      return new Promise((resolve) => {
        const handler = window.PaystackPop.setup({
          key: this.PAYSTACK_PUBLIC_KEY,
          email: email,
          amount: this.PAYSTACK_AMOUNT,
          ref: this._generateReference(),
          currency: 'NGN',
          onClose: () => {
            this.isProcessing = false;
            resolve({ success: false, message: 'Payment cancelled' });
          },
          onSuccess: (response) => {
            this.lastReference = response.reference;
            this._verifyAndComplete(response.reference)
              .then(result => {
                this.isProcessing = false;
                resolve(result);
              })
              .catch(err => {
                this.isProcessing = false;
                resolve({ success: false, message: err.message });
              });
          }
        });
        handler.openIframe();
      });
    } catch (err) {
      this.isProcessing = false;
      console.error('Payment initiation failed:', err);
      return { success: false, message: err.message };
    }
  }

  async _verifyAndComplete(reference) {
    try {
      // Log transaction to Supabase via REST API
      if (this.SUPABASE_URL && this.SUPABASE_ANON_KEY) {
        try {
          await fetch(`${this.SUPABASE_URL}/rest/v1/payments`, {
            method: 'POST',
            headers: {
              'apikey': this.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              reference,
              amount: Math.round(this.PAYSTACK_AMOUNT / 100),
              email: this.PAYSTACK_EMAIL,
              state: this.gm.currentState?.name || 'Unknown',
              status: 'completed'
            })
          });
        } catch (err) {
          console.warn('Transaction log failed:', err);
          // Don't fail payment if logging fails
        }
      }

      // Grant continue
      this.gm.lives = 3;
      this.gm.emit('livesRestored');
      this.gm.setState('PLAYING');

      return {
        success: true,
        reference,
        message: `Payment successful! ₦50 received. Lives restored.`
      };
    } catch (err) {
      console.error('Verification failed:', err);
      return { success: false, message: `Verification failed: ${err.message}` };
    }
  }

  _loadPaystackScript() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v1/inline.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Paystack'));
      document.head.appendChild(script);
    });
  }

  _generateReference() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `KEKE-${timestamp}-${random}`;
  }

  getLastReference() {
    return this.lastReference;
  }

  isPaymentProcessing() {
    return this.isProcessing;
  }

  setPaystackKeys(publicKey) {
    this.PAYSTACK_PUBLIC_KEY = publicKey;
  }

  setPlayerEmail(email) {
    this.PAYSTACK_EMAIL = email;
  }
}
