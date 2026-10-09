// What players can buy. Shared by both payment paths:
//   • web / PWA  → Paystack (card, bank transfer, USSD, MTN MoMo), priced in naira here
//   • Android    → Google Play Billing; create one-time products in Play Console
//                  with exactly these ids (Google shows its own localised price)
// The Supabase `paystack-verify` function keeps its own copy of these prices
// and re-checks the amount server-side, so edit both together.
export const PRODUCTS = [
  // Play product ids are permanent, so they name the pack, not the coin amount.
  { id: 'pack_starter', kind: 'coins', coins: 2500,  naira: 200,  title: '2,500 Coins',  tag: '' },
  { id: 'pack_popular', kind: 'coins', coins: 7000,  naira: 500,  title: '7,000 Coins',  tag: 'POPULAR' },
  { id: 'pack_big',     kind: 'coins', coins: 15000, naira: 1000, title: '15,000 Coins', tag: '' },
  { id: 'pack_best',    kind: 'coins', coins: 40000, naira: 2500, title: '40,000 Coins', tag: 'BEST VALUE' },
  { id: 'continue_run', kind: 'continue', naira: 100, title: 'Continue Run', tag: '' },
];

export const productById = id => PRODUCTS.find(p => p.id === id);

// Paystack channels offered on the web store page, in display order.
export const PAY_METHODS = [
  { id: 'card',          label: 'Card',          icon: '💳', hint: 'Visa, Mastercard, Verve' },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: '🏦', hint: 'Transfer to a one-time account' },
  { id: 'ussd',          label: 'USSD',          icon: '#️⃣', hint: 'Dial a code on any phone' },
  { id: 'mobile_money',  label: 'MTN MoMo',      icon: '📱', hint: 'Pay from your MoMo wallet', comingSoon: true },
];
