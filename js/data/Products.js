// What players can buy. Shared by both payment paths:
//   • web / PWA  → Paystack (card, bank transfer, USSD, MTN MoMo), priced in naira here
//   • Android    → Google Play Billing; create one-time products in Play Console
//                  with exactly these ids (Google shows its own localised price)
// The Supabase `paystack-verify` function keeps its own copy of these prices
// and re-checks the amount server-side, so edit both together.
export const PRODUCTS = [
  { id: 'coins_1000', kind: 'coins', coins: 1000, naira: 200,  title: '1,000 Coins',  tag: '' },
  { id: 'coins_3500', kind: 'coins', coins: 3500, naira: 500,  title: '3,500 Coins',  tag: 'POPULAR' },
  { id: 'coins_8000', kind: 'coins', coins: 8000, naira: 1000, title: '8,000 Coins',  tag: 'BEST VALUE' },
  { id: 'continue_run', kind: 'continue', naira: 50, title: 'Continue Run', tag: '' },
];

export const productById = id => PRODUCTS.find(p => p.id === id);

// Paystack channels offered on the web store page, in display order.
export const PAY_METHODS = [
  { id: 'card',          label: 'Card',          icon: '💳', hint: 'Visa, Mastercard, Verve' },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: '🏦', hint: 'Transfer to a one-time account' },
  { id: 'ussd',          label: 'USSD',          icon: '#️⃣', hint: 'Dial a code on any phone' },
  { id: 'mobile_money',  label: 'MTN MoMo',      icon: '📱', hint: 'Pay from your MoMo wallet' },
];
