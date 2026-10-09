import { STATES, SHOPS, VEHICLES } from '../data/StatesData.js';
import { DailyReward, DAILY_REWARDS } from '../core/DailyReward.js';
import { Stats } from '../core/Stats.js';
import { Leaderboard } from '../core/Leaderboard.js';
import { PaymentManager } from '../core/PaymentManager.js';

// Garage thumbnails. Vehicles with cut-out sprite art show the real image;
// the two without art yet (okada, innoson) fall back to an emoji placeholder.
// Keep `img` in sync with VEHICLE_SPRITES in Player.js as art lands.
const VEHICLE_THUMBS = {
  keke:     { img: 'player-keke.png',     emoji: '🛺' },
  okada:    { emoji: '🏍️' },
  danfo:    { img: 'player-danfo.png',     emoji: '🚐' },
  innoson:  { emoji: '🚗' },
  bolekaja: { img: 'player-bolekaja.png',  emoji: '🚌' }
};

export class UIManager {
  constructor(gameManager, audioManager, missionManager = null) {
    this.gm = gameManager;
    this.audio = audioManager;
    this.missions = missionManager;
    this.daily = new DailyReward();
    this.stats = new Stats(gameManager);
    this.leaderboard = new Leaderboard();
    this.payment = new PaymentManager(gameManager);
    this._pendingLevelComplete = null; // stashed while the username prompt is up
    this.notifQueue = [];
    this.activeScreen = 'screen-menu';

    this._bindGameManagerEvents();
    this._bindButtons();
    this._bindBackButton();
    this._updateMenuCoins();
    this._maybeShowDaily();
  }

  _el(id) { return document.getElementById(id); }

  // Android hardware back: swallowed while the advert plays (it can't be
  // exited); otherwise keeps Capacitor's default go-back-or-exit behaviour.
  _bindBackButton() {
    const App = window.Capacitor?.Plugins?.App;
    if (!App?.addListener) return;
    App.addListener('backButton', ({ canGoBack }) => {
      if (this._adActive) return;
      if (canGoBack) window.history.back();
      else App.exitApp();
    });
  }

  show(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = this._el(screenId);
    if (screen) screen.classList.add('active');
    this.activeScreen = screenId;
  }

  _bindGameManagerEvents() {
    this.gm.on('gameStarted', () => {
      this.show('screen-hud');
      this._updateHUD();
      if (!this.gm.tutorialShown) {
        this._showTutorial();
        this.gm.tutorialShown = true;
        localStorage.setItem('mkd_tutorial', '1');
      }
    });

    this.gm.on('tick', ({ distance, score, stateProgress, timeLeft }) => {
      this._el('hud-score').textContent = Math.floor(distance);
      this._el('hud-coins').textContent = this.gm.coins;
      this._el('state-progress-fill').style.width = `${stateProgress * 100}%`;
      const t = this._el('hud-timer');
      if (t) {
        const secs = Math.max(0, Math.ceil(timeLeft));
        t.textContent = `⏱ ${secs}`;
        t.classList.toggle('low', secs <= 10);
      }
    });

    this.gm.on('coinCollected', earned => {
      const c = this._el('hud-coins');
      c.textContent = this.gm.coins;
      c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
      if (earned > 1) this._floatText(`₦×${earned}!`, 0, -80, '#FFD700');
    });

    this.gm.on('powerUpActivated', ({ id, duration }) => {
      this._showPowerUpHUD(id, duration);
      this._floatText(this._puName(id) + '!', 0, -50, '#FFFFFF');
    });

    this.gm.on('powerUpExpired', id => {
      this._removePowerUpHUD(id);
    });

    this.gm.on('stateChanged', state => {
      this._el('hud-state-name').textContent = state.name.toUpperCase();
      this._updateStops();
      this._showStateEnter(state);
    });

    // Refuel/service stop made → update the HUD tracker + a quick toast.
    this.gm.on('stopMade', ({ made, required }) => {
      this._updateStops();
      this._floatText(`⛽ Refueled ${made}/${required}`, 0, -110, '#00E5FF');
    });

    // Reached the border but still owe stops → tell the player to refuel.
    this.gm.on('borderBlocked', ({ made, required }) => {
      this._floatText(`⛽ Refuel at all stations! (${made}/${required})`, 0, -40, '#FF9500');
    });

    this.gm.on('playerHurt', lives => {
      this._updateLives(lives);
      this._flashScreen('red');
      this._floatText('OUCH!', 0, -60, '#FF0000');
    });

    this.gm.on('playerCaught', ({ bailCost }) => {
      this.show('screen-bail');
      this._el('bail-amount').textContent = bailCost.toLocaleString();
      this.audio.playCatch();
      this._updateBailAffordable(bailCost);
      this._updateAdButton('btn-watch-ad');
    });

    // Ran out of time — the advert revive (if any left) buys extra time.
    this.gm.on('timeUp', () => {
      this.show('screen-timeup');
      this.audio.playCatch();
      this._updateAdButton('btn-timeup-watch-ad');
    });

    this.gm.on('bailPaid', () => {
      this.show('screen-hud');
      this._floatText('₦ Bail Paid! RUN!', 0, -60, '#FFD700');
      this._el('menu-total-coins').textContent = this.gm.totalCoins.toLocaleString();
    });

    this.gm.on('adWatched', ({ adsLeft }) => {
      this.show('screen-hud');
      this._updateHUD();
      this._floatText('FREE RIDE! Go go go!', 0, -60, '#00FF00');
      this._floatText(adsLeft > 0 ? `📺 ${adsLeft} ad revive${adsLeft === 1 ? '' : 's'} left`
                                  : '⚠️ LAST AD REVIVE USED!', 0, -20, '#FFD700');
    });

    this.gm.on('riskyLaneEntered', () => {
      this._floatText('⚠️ RISKY LANE! 3× COINS!', 0, -100, '#FF6600');
      this._el('screen-hud').style.borderColor = '#FF0000';
    });

    this.gm.on('riskyLaneExited', () => {
      this._el('screen-hud').style.borderColor = '';
    });

    this.gm.on('stateCompleted', ({ state, bonusCoins, nextState }) => {
      this.audio.playLevelComplete();
      const data = { state, bonusCoins, nextState };
      // First state (Abia) cleared and no rider name yet → ask them to join the
      // leaderboard before showing the "state cleared" panel.
      if (this.gm.stateIndex === 0 && !this.leaderboard.hasUsername()) {
        this._pendingLevelComplete = data;
        this._showUsernamePrompt();
      } else {
        this._showLevelComplete(data);
        // Keep their best on the global board as they progress.
        this.leaderboard.submitScore(this.stats.bestDistance() || this.gm.distance, state.name);
      }
    });

    this.gm.on('gameOver', stats => {
      this.leaderboard.submitScore(this.stats.bestDistance(), stats.state);
      setTimeout(() => {
        this.show('screen-gameover');
        this._el('go-distance').textContent = Math.floor(stats.distance).toLocaleString();
        this._el('go-coins').textContent = stats.coins.toLocaleString();
        this._el('go-state').textContent = stats.state;
        this.audio.playGameOver();
        this._el('menu-total-coins').textContent = this.gm.totalCoins.toLocaleString();
      }, 500);
    });

    this.gm.on('shopOpened', (type) => {
      this._openShopUI(type);
    });

    this.gm.on('shopClosed', () => {
      this.show('screen-hud');
    });

    this.gm.on('paused', () => this.show('screen-pause'));
    this.gm.on('resumed', () => this.show('screen-hud'));

    this.gm.on('gameWon', ({ totalCoins }) => {
      this.show('screen-gameover');
      this._el('go-distance').textContent = '🏆 ALL 36 STATES!';
      this._el('go-coins').textContent = totalCoins.toLocaleString();
      this._el('go-state').textContent = 'LAGOS (FINAL CHAMPION!)';
      document.querySelector('#screen-gameover h2').textContent = '🏆 CHAMPION!';
    });

    this.gm.on('itemPurchased', item => {
      this._floatText(`${item.name} purchased!`, 0, -70, '#00FF88');
    });

    this.gm.on('insufficientCoins', ({ needed }) => {
      this._floatText(`Need ₦${needed}!`, 0, -70, '#FF3333');
    });

    this.gm.on('multiplierChanged', mult => {
      const el = this._el('hud-multiplier');
      if (mult > 1) {
        el.style.display = 'block';
        this._el('multiplier-value').textContent = mult;
      } else {
        el.style.display = 'none';
      }
    });

    // ─── Missions & Garage ─────────────────────────────────────
    this.gm.on('missionComplete', m => {
      const reward = m.reward.toLocaleString();
      this._showMissionToast(`${m.icon} MISSION DONE!`, `+₦${reward}`);
      this.audio.playLevelComplete?.();
      this._updateMenuCoins();
      if (this.activeScreen === 'screen-missions') this._renderMissions();
    });

    this.gm.on('nearMiss', ({ intensity }) => {
      if (intensity > 0.72) {
        const x = (Math.random() - 0.5) * 120;
        this._floatText('✦ CLOSE!', x, -90, '#00E5FF');
      }
    });

    this.gm.on('vehicleUnlocked', v => {
      this._floatText(`🔓 ${v.name} unlocked!`, 0, -40, '#00FF88');
    });

    this.gm.on('totalCoinsChanged', () => this._updateMenuCoins());
  }

  _bindButtons() {
    // Menu
    this._el('btn-play')?.addEventListener('click', () => {
      this.audio.resume();
      this.gm.startGame();
    });
    this._el('btn-shop')?.addEventListener('click', () => this._openGarage());
    this._el('btn-missions')?.addEventListener('click', () => this._openMissions());
    this._el('btn-daily')?.addEventListener('click', () => this._openDaily());
    this._el('btn-leaderboard')?.addEventListener('click', () => this._showLeaderboard());
    this._el('btn-exit')?.addEventListener('click', () => this._exitApp());

    // Username / join leaderboard
    this._el('btn-username-save')?.addEventListener('click', () => this._saveUsername());
    this._el('btn-username-skip')?.addEventListener('click', () => this._finishUsernamePrompt());
    this._el('username-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._saveUsername(); }
    });

    // Daily reward
    this._el('btn-daily-claim')?.addEventListener('click', () => this._claimDaily());
    this._el('btn-daily-close')?.addEventListener('click', () => {
      this.show('screen-menu'); this._updateMenuCoins();
    });

    // Garage / Missions back buttons
    this._el('btn-garage-close')?.addEventListener('click', () => {
      this.show('screen-menu'); this._updateMenuCoins();
    });
    this._el('btn-missions-close')?.addEventListener('click', () => {
      this.show('screen-menu'); this._updateMenuCoins();
    });
    this._el('btn-lb-close')?.addEventListener('click', () => {
      this.show('screen-menu'); this._updateMenuCoins();
    });

    // HUD
    this._el('btn-pause')?.addEventListener('click', () => this.gm.pause());

    // Pause
    this._el('btn-resume')?.addEventListener('click', () => this.gm.resume());
    this._el('btn-restart')?.addEventListener('click', () => { this.gm.startGame(); });
    this._el('btn-main-menu')?.addEventListener('click', () => {
      this.gm.state = 'MENU';
      this.show('screen-menu');
      this._updateMenuCoins();
    });

    // Bail
    this._el('btn-pay-bail')?.addEventListener('click', () => {
      if (!this.gm.payBail()) {
        this._floatText('Not enough ₦!', 0, -80, '#FF0000');
      }
    });
    this._el('btn-watch-ad')?.addEventListener('click', () => this._playAd());
    this._el('btn-give-up')?.addEventListener('click', () => this.gm.gameOver());
    this._el('btn-timeup-watch-ad')?.addEventListener('click', () => this._playAd());
    this._el('btn-timeup-give-up')?.addEventListener('click', () => this.gm.gameOver());

    // Shop
    this._el('btn-shop-close')?.addEventListener('click', () => this.gm.closeShop());

    // Level complete
    this._el('btn-continue')?.addEventListener('click', () => {
      this.gm.nextState();
      this.show('screen-hud');
    });

    // Game over
    this._el('btn-continue-payment')?.addEventListener('click', async () => {
      const btn = this._el('btn-continue-payment');
      btn.disabled = true;
      btn.textContent = '⏳ Processing...';

      const result = await this.payment.initiatePayment();

      if (result.success) {
        this._floatText('✅ Payment Success!', 2000, 'rgba(0,255,0,0.8)');
        this.show('screen-hud');
      } else {
        this._floatText(`❌ ${result.message}`, 2000, 'rgba(255,0,0,0.8)');
        btn.disabled = false;
        btn.textContent = '💳 CONTINUE FOR ₦50';
      }
    });

    this._el('btn-go-restart')?.addEventListener('click', () => {
      this.audio.resume();
      this.gm.startGame();
    });
    this._el('btn-go-menu')?.addEventListener('click', () => {
      this.gm.state = 'MENU';
      this.show('screen-menu');
      this._updateMenuCoins();
    });
  }

  _updateMenuCoins() {
    this._el('menu-total-coins').textContent = this.gm.totalCoins.toLocaleString();
  }

  _updateHUD() {
    this._el('hud-state-name').textContent = this.gm.currentState.name.toUpperCase();
    this._updateLives(this.gm.lives);
    this._updateStops();
  }

  // Required-stop tracker (⛽ made / required) shown on the HUD.
  _updateStops() {
    const el = this._el('hud-stops');
    if (!el) return;
    const made = this.gm.stopsMade || 0;
    const need = this.gm.requiredStops || 0;
    el.textContent = `⛽ ${made}/${need}`;
    el.classList.toggle('done', need > 0 && made >= need);
  }

  _updateLives(lives) {
    const heartsEl = this._el('hud-lives');
    heartsEl.innerHTML = '';
    for (let i = 0; i < this.gm.maxLives; i++) {
      const heart = document.createElement('span');
      heart.textContent = i < lives ? '❤️' : '🖤';
      heartsEl.appendChild(heart);
    }
  }

  // Show "WATCH AD (n left)" while revives remain; hide the button once all
  // MAX_ADS have been used this game.
  _updateAdButton(id) {
    const btn = this._el(id);
    if (!btn) return;
    const left = this.gm.adsLeft();
    btn.style.display = left > 0 ? '' : 'none';
    btn.innerHTML = `📺 WATCH AD (FREE)<span class="ads-left">${left} of ${this.gm.MAX_ADS} left</span>`;
  }

  // Full-screen OLUKO advert. Once started it cannot be skipped, paused or
  // closed — the revive is only granted when the video ends.
  _playAd() {
    if (this._adActive || !this.gm.startAd()) return;
    const video = this._el('ad-video');
    const countdown = this._el('ad-countdown');
    this._adActive = true;
    this.audio.setAdMode(true);
    this.show('screen-ad');

    const finish = () => {
      if (!this._adActive) return;
      this._adActive = false;
      video.removeEventListener('ended', finish);
      video.removeEventListener('error', finish);
      video.removeEventListener('pause', keepPlaying);
      video.removeEventListener('timeupdate', tick);
      document.removeEventListener('visibilitychange', keepPlaying);
      this.audio.setAdMode(false);
      this.gm.watchAd();
    };
    // Any pause before the end (OS media controls, app backgrounded) resumes.
    const keepPlaying = () => {
      if (this._adActive && !video.ended && !document.hidden) video.play().catch(() => {});
    };
    const tick = () => {
      const d = isFinite(video.duration) ? video.duration : 18;
      countdown.textContent = Math.max(0, Math.ceil(d - video.currentTime));
    };

    video.addEventListener('ended', finish);
    video.addEventListener('error', finish); // never strand the player on a broken video
    video.addEventListener('pause', keepPlaying);
    video.addEventListener('timeupdate', tick);
    document.addEventListener('visibilitychange', keepPlaying);

    video.muted = this.audio.muted;
    video.volume = Math.max(0.3, this.audio.masterVolume);
    video.currentTime = 0;
    tick();
    video.play().catch(() => {
      // Autoplay with sound refused — retry muted so the ad still runs to the end.
      video.muted = true;
      video.play().catch(finish);
    });
  }

  _updateBailAffordable(bailCost) {
    const btn = this._el('btn-pay-bail');
    if (this.gm.totalCoins < bailCost) {
      btn.disabled = true;
      btn.textContent = `₦${bailCost.toLocaleString()} (Not enough coins)`;
    } else {
      btn.disabled = false;
      btn.textContent = `PAY BAIL ₦${bailCost.toLocaleString()} 🔓`;
    }
  }

  _showPowerUpHUD(id, duration) {
    const container = this._el('hud-powerups');
    const existing = document.getElementById(`pu-${id}`);
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = `pu-${id}`;
    el.className = 'powerup-badge';
    el.innerHTML = `<span>${this._puIcon(id)}</span><div class="pu-timer" id="pu-bar-${id}"></div>`;
    container.appendChild(el);

    // Animate timer bar
    const bar = document.getElementById(`pu-bar-${id}`);
    if (bar) {
      bar.style.transition = `width ${duration}s linear`;
      requestAnimationFrame(() => { bar.style.width = '0%'; });
    }
  }

  _removePowerUpHUD(id) {
    document.getElementById(`pu-${id}`)?.remove();
  }

  _puName(id) {
    const names = { ogi_shield: 'OGI SHIELD', jet_fuel: 'JET FUEL', coin_magnet: 'MAGNET', juju_cloak: 'JUJU CLOAK' };
    return names[id] || id;
  }

  _puIcon(id) {
    const icons = { ogi_shield: '🛡️', jet_fuel: '🔥', coin_magnet: '🧲', juju_cloak: '👻' };
    return icons[id] || '⚡';
  }

  _floatText(text, x, y, color = '#FFD700') {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.cssText = `left:50%;top:50%;transform:translate(calc(-50% + ${x}px), calc(-50% + ${y}px));color:${color};`;
    this._el('notifications').appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  _flashScreen(color) {
    const flash = document.createElement('div');
    flash.className = 'screen-flash';
    flash.style.background = color === 'red' ? 'rgba(255,0,0,0.3)' : 'rgba(255,255,255,0.4)';
    document.getElementById('ui-root').appendChild(flash);
    setTimeout(() => flash.remove(), 300);
  }

  _showStateEnter(state) {
    // Each state opens with a "scroll" write-up. The run is paused behind it
    // and intro ambience (drums + jungle + monkey) plays until the player taps
    // CONTINUE. States without authored intro data get a synthesised one.
    const intro = state.intro || this._fallbackIntro(state);
    if (this.gm.state === 'PLAYING') this.gm.state = 'PAUSED';
    if (this.audio && this.audio.playIntroAmbience) this.audio.playIntroAmbience();

    const overlay = document.createElement('div');
    overlay.className = 'state-scroll-overlay';
    const bullets = intro.bullets.map(b => `<li>${b}</li>`).join('');

    overlay.innerHTML = `
      <div class="state-scroll">
        <div class="scroll-rod"></div>
        <div class="scroll-body">
          <div class="scroll-welcome">Welcome to</div>
          <h2 class="scroll-state">${state.name.toUpperCase()} STATE</h2>
          <div class="scroll-nick">“${state.nickname}”</div>
          <div class="scroll-capital">with <b>${state.capital}</b> as its capital</div>
          <div class="scroll-known">The state is known for:</div>
          <ul class="scroll-bullets">${bullets}</ul>
          <div class="scroll-historic">${intro.historic}</div>
          <button class="scroll-continue">▶ CONTINUE THE JOURNEY</button>
        </div>
        <div class="scroll-rod"></div>
      </div>`;
    document.getElementById('ui-root').appendChild(overlay);

    const resume = () => { if (this.gm.state === 'PAUSED') this.gm.state = 'PLAYING'; };
    const close = () => {
      if (overlay._closed) return; overlay._closed = true;
      if (this.audio && this.audio.stopIntroAmbience) this.audio.stopIntroAmbience();
      overlay.remove();
      // Stage missions get their own page AFTER the intro — but only from
      // state 5 (index 4) onward; states 1–4 ease the player in with no
      // mission page and go straight into the run.
      if (this.gm.stateIndex >= 4) this._showStageMissions(state, resume);
      else resume();
    };
    overlay.querySelector('.scroll-continue').addEventListener('click', close);
  }

  // Dedicated "stage missions" page, shown right after a state's intro scroll
  // (state 5+). Lists this stage's objectives; the button starts the run.
  _showStageMissions(state, onStart) {
    const ms = (this.missions && this.missions.list) ? this.missions.list() : [];
    if (!ms.length) { onStart(); return; }

    const overlay = document.createElement('div');
    overlay.className = 'state-scroll-overlay stage-missions-overlay';
    overlay.innerHTML = `
      <div class="state-scroll">
        <div class="scroll-rod"></div>
        <div class="scroll-body">
          <div class="scroll-welcome">${state.name.toUpperCase()}</div>
          <h2 class="scroll-state">🎯 STAGE MISSIONS</h2>
          <div class="scroll-known">Clear these for bonus ₦. The ⛽ one is required to cross the border:</div>
          <ul class="scroll-missions">${ms.map(m =>
            `<li>${m.icon} ${this.missions.text(m)}${m.required ? ' <b class="sm-req">(required)</b>' : ''} <span class="sm-reward">+₦${m.reward.toLocaleString()}</span></li>`
          ).join('')}</ul>
          <button class="scroll-continue">▶ START THE STAGE</button>
        </div>
        <div class="scroll-rod"></div>
      </div>`;
    document.getElementById('ui-root').appendChild(overlay);

    overlay.querySelector('.scroll-continue').addEventListener('click', () => {
      overlay.remove();
      onStart();
    });
  }

  // Synthesise a scroll for states that have no authored `intro` yet, so every
  // state still opens with a proper write-up.
  _fallbackIntro(state) {
    const obs = (state.obstacles || []).slice(0, 2).join(' and ').replace(/_/g, ' ');
    return {
      bullets: [
        `🏛️ Landmark — ${state.landmark}.`,
        `🎶 Culture — home of ${String(state.music).replace(/_/g, ' ')} sounds and proud traditions.`,
        `🛒 Commerce & life — bustling markets, farms and roadside trade.`,
        `🛣️ On the road — watch for ${obs || 'unexpected hazards'}.`,
        `✨ Special — ${state.special ? state.special.desc : 'a unique challenge awaits.'}`
      ],
      historic: state.story
    };
  }

  _showTutorial() {
    const hint = this._el('swipe-hint');
    hint.style.display = 'flex';
    setTimeout(() => {
      hint.style.opacity = '0';
      setTimeout(() => { hint.style.display = 'none'; }, 1000);
    }, 4000);
  }

  _openShopUI(type) {
    const shop = SHOPS[type];
    if (!shop) return;
    this._el('shop-name').textContent = `${shop.icon} ${shop.name}`;
    const walletEl = this._el('shop-wallet');
    if (walletEl) walletEl.textContent = this.gm.totalCoins.toLocaleString();
    const itemsEl = this._el('shop-items');
    itemsEl.innerHTML = '';
    shop.items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'shop-item-btn';
      const canAfford = this.gm.totalCoins >= item.cost;
      btn.innerHTML = `<span class="item-name">${item.name}</span><span class="item-cost ${canAfford ? '' : 'cant-afford'}">₦${item.cost.toLocaleString()}</span>`;
      btn.disabled = !canAfford;
      btn.addEventListener('click', () => this.gm.purchaseShopItem(item));
      itemsEl.appendChild(btn);
    });
    this.show('screen-shop');
    // Pause game while shopping
    if (this.gm.state === 'PLAYING') this.gm.state = 'SHOP';
  }

  // ─── GARAGE ──────────────────────────────────────────────────
  _openGarage() {
    this._renderGarage();
    this.show('screen-garage');
  }

  // Quit the app. Uses the Capacitor App plugin on Android; on the web there is
  // no reliable way to close the tab, so we just confirm and no-op there.
  _exitApp() {
    if (!window.confirm('Exit Monkey Keke Dash?')) return;
    const App = window.Capacitor?.Plugins?.App;
    if (App?.exitApp) {
      App.exitApp();
    } else {
      // Browser fallback — attempt to close, otherwise leave the menu as-is.
      window.close();
    }
  }

  // Render + show the "state cleared" panel from stashed event data.
  _showLevelComplete({ state, bonusCoins, nextState }) {
    this.show('screen-level-complete');
    this._el('lc-state-name').textContent = state.name.toUpperCase();
    this._el('lc-bonus').textContent = bonusCoins.toLocaleString();
    this._el('lc-next-state').textContent = nextState
      ? `Next: ${nextState.name} →`
      : '🏆 YOU COMPLETED ALL 36 STATES!';
  }

  // ── Username prompt (shown once, after Abia) ──────────────────────────────
  _showUsernamePrompt() {
    this._el('username-error').textContent = '';
    this._el('username-input').value = '';
    this.show('screen-username');
    // Focus the field so the keyboard pops on mobile.
    setTimeout(() => this._el('username-input')?.focus(), 50);
  }

  _saveUsername() {
    const raw = this._el('username-input').value;
    const name = this.leaderboard.setUsername(raw);
    if (!name) {
      this._el('username-error').textContent = 'Please enter a name (letters or numbers).';
      return;
    }
    // Put their Abia run on the board straight away.
    this.leaderboard.submitScore(this.stats.bestDistance() || this.gm.distance,
                                 this._pendingLevelComplete?.state?.name);
    this._showMissionToast('🏆 You\'re on Top Riders!', `Ride hard, ${this._esc(name)}!`);
    this._finishUsernamePrompt();
  }

  _finishUsernamePrompt() {
    const data = this._pendingLevelComplete;
    this._pendingLevelComplete = null;
    if (data) this._showLevelComplete(data);
    else { this.show('screen-menu'); this._updateMenuCoins(); }
  }

  _renderGarage() {
    this._el('garage-wallet').textContent = this.gm.totalCoins.toLocaleString();
    const list = this._el('garage-items');
    list.innerHTML = '';

    VEHICLES.forEach(v => {
      const unlocked = this.gm.isVehicleUnlocked(v.id);
      const equipped = this.gm.vehicle === v.id;
      const canAfford = this.gm.totalCoins >= v.cost;

      // Thumbnail: real sprite where art exists, emoji placeholder otherwise.
      const thumb = VEHICLE_THUMBS[v.id] || {};
      const locked = !unlocked;
      const thumbHtml = thumb.img
        ? `<img class="garage-img${locked ? ' locked' : ''}" src="assets/img/${thumb.img}" alt="${v.name}">`
        : `<span class="garage-img placeholder${locked ? ' locked' : ''}">${thumb.emoji || '🚗'}</span>`;

      const card = document.createElement('div');
      card.className = 'garage-item' + (equipped ? ' equipped' : '');

      // Stat pips (speed / size) for at-a-glance comparison
      const speedPct = Math.round(v.speed * 100);
      const stats = `⚡ ${speedPct}%  •  📐 ${v.width < 0.9 ? 'Slim' : v.width > 1.1 ? 'Wide' : 'Standard'}`;

      let action;
      if (equipped) {
        action = `<span class="garage-tag equipped-tag">EQUIPPED</span>`;
      } else if (unlocked) {
        action = `<button class="garage-btn btn-equip" data-id="${v.id}">EQUIP</button>`;
      } else {
        action = `<button class="garage-btn btn-buy ${canAfford ? '' : 'cant-afford'}" data-id="${v.id}" ${canAfford ? '' : 'disabled'}>₦${v.cost.toLocaleString()}</button>`;
      }

      card.innerHTML = `
        <div class="garage-thumb">${thumbHtml}</div>
        <div class="garage-info">
          <div class="garage-name">${v.name}</div>
          <div class="garage-desc">${v.description}</div>
          <div class="garage-stats">${stats}</div>
        </div>
        <div class="garage-action">${action}</div>`;
      list.appendChild(card);
    });

    list.querySelectorAll('.btn-equip').forEach(b =>
      b.addEventListener('click', () => { this.gm.selectVehicle(b.dataset.id); this._renderGarage(); }));
    list.querySelectorAll('.btn-buy').forEach(b =>
      b.addEventListener('click', () => { this.gm.buyVehicle(b.dataset.id); this._renderGarage(); }));
  }

  // ─── MISSIONS ────────────────────────────────────────────────
  _openMissions() {
    this._renderMissions();
    this.show('screen-missions');
  }

  _renderMissions() {
    const list = this._el('missions-list');
    if (!list || !this.missions) return;
    list.innerHTML = '';
    this.missions.list().forEach(m => {
      const pct = Math.min(100, Math.round((m.progress / m.goal) * 100));
      const row = document.createElement('div');
      row.className = 'mission-row';
      row.innerHTML = `
        <div class="mission-icon">${m.icon}</div>
        <div class="mission-body">
          <div class="mission-label">${this.missions.text(m)}</div>
          <div class="mission-bar"><div class="mission-fill" style="width:${pct}%"></div></div>
          <div class="mission-meta">
            <span class="mission-prog">${Math.floor(m.progress).toLocaleString()} / ${m.goal.toLocaleString()}</span>
            <span class="mission-reward">+₦${m.reward.toLocaleString()}</span>
          </div>
        </div>`;
      list.appendChild(row);
    });
  }

  // ─── DAILY REWARD ────────────────────────────────────────────
  _maybeShowDaily() {
    if (this.gm.state === 'MENU' && this.daily.status().claimable) this._openDaily();
  }

  _openDaily() {
    this._renderDaily();
    this.show('screen-daily');
  }

  _renderDaily() {
    const st = this.daily.status();
    this._el('daily-streak-num').textContent = st.streak;
    const cells = this._el('daily-cells');
    cells.innerHTML = '';
    DAILY_REWARDS.forEach((amt, i) => {
      const cell = document.createElement('div');
      cell.className = 'daily-cell' + (i === 6 ? ' day7' : '');
      if (st.claimable) {
        if (i < st.dayIndex) cell.classList.add('claimed');
        else if (i === st.dayIndex) cell.classList.add('active');
      } else if (i <= st.dayIndex) {
        cell.classList.add('claimed');
      }
      cell.innerHTML = `<div class="dc-day">Day ${i + 1}</div><div class="dc-amt">₦${amt.toLocaleString()}</div>`;
      cells.appendChild(cell);
    });
    const claimBtn = this._el('btn-daily-claim');
    if (st.claimable) {
      claimBtn.disabled = false;
      claimBtn.innerHTML = `CLAIM ₦${st.reward.toLocaleString()}`;
    } else {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Come back tomorrow!';
    }
  }

  _claimDaily() {
    const reward = this.daily.claim();
    if (reward > 0) {
      this.gm.addCoins(reward);
      this._showMissionToast('🎁 DAILY GIFT!', `+₦${reward.toLocaleString()}`);
      this.audio.playLevelComplete?.();
      this._renderDaily();
      this._updateMenuCoins();
    }
  }

  _showMissionToast(title, sub) {
    const el = document.createElement('div');
    el.className = 'mission-toast';
    el.innerHTML = `<div class="mt-title">${title}</div><div class="mt-sub">${sub}</div>`;
    document.getElementById('ui-root').appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  _esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async _showLeaderboard() {
    const s = this.stats;
    const bestState = parseInt(localStorage.getItem('mkd_best_state') || '0');

    const stat = (val, lbl) => `<div class="lb-stat"><div class="lb-val">${val}</div><div class="lb-lbl">${lbl}</div></div>`;
    this._el('lb-stats').innerHTML =
      stat(s.bestDistance().toLocaleString() + 'm', 'Best') +
      stat('₦' + this.gm.totalCoins.toLocaleString(), 'Total') +
      stat(s.runs, 'Runs') +
      stat(s.statesCleared, 'States') +
      stat(s.missionsDone, 'Missions') +
      stat(STATES[bestState]?.name || 'Abia', 'Furthest');

    this.show('screen-leaderboard');

    const head = this._el('screen-leaderboard').querySelector('.lb-table-head');
    const list = this._el('lb-scores');

    // Online global board when configured; otherwise the local fallback.
    if (this.leaderboard.online) {
      if (head) head.innerHTML = '<span>#</span><span>Rider</span><span>Distance</span><span>Reached</span>';
      list.innerHTML = `<div class="lb-loading">Loading global riders…</div>`;
      const rows = await this.leaderboard.fetchTop(20);
      // Guard against the user navigating away while we were fetching.
      if (this.activeScreen !== 'screen-leaderboard') return;
      if (rows.length) {
        const me = this.leaderboard.getUsername();
        list.innerHTML = rows.map((r, i) => {
          const isMe = me && r.username === me;
          return `<div class="lb-row ${i === 0 ? 'top1' : ''} ${isMe ? 'is-me' : ''}">
             <span class="lb-rank">${i + 1}</span>
             <span class="lb-name">${this._esc(r.username)}</span>
             <span class="lb-dist">${Number(r.distance).toLocaleString()}m</span>
             <span>${this._esc(r.state || '—')}</span>
           </div>`;
        }).join('');
        return;
      }
      // Empty or fetch failed → fall through to local board.
    }

    if (head) head.innerHTML = '<span>#</span><span>Distance</span><span>Reached</span><span>When</span>';
    const scores = s.scores;
    if (!scores.length) {
      list.innerHTML = `<div class="lb-empty">No runs yet — hit PLAY and set a record!</div>`;
    } else {
      list.innerHTML = scores.map((r, i) =>
        `<div class="lb-row ${i === 0 ? 'top1' : ''}">
           <span class="lb-rank">${i + 1}</span>
           <span class="lb-dist">${r.d.toLocaleString()}m</span>
           <span>${this._esc(r.state)}</span>
           <span class="lb-when">${r.date}</span>
         </div>`).join('');
    }
  }
}
