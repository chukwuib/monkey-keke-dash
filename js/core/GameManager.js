import { STATES, VEHICLES } from '../data/StatesData.js';

export class GameManager {
  constructor() {
    this.state = 'MENU'; // MENU | PLAYING | PAUSED | BAIL | GAMEOVER | SHOP | LEVEL_COMPLETE
    this.score = 0;
    this.distance = 0;
    this.coins = 0;
    this.totalCoins = parseInt(localStorage.getItem('mkd_coins') || '0');
    this.lives = 3;
    this.maxLives = 3;
    this.multiplier = 1;
    this.multiplierTimer = 0;

    this.stateIndex = 0;
    this.currentState = STATES[0];
    this.stateProgress = 0; // 0..1

    // Per-stage required service stops (fuel stations etc.). The stage's
    // mandatory mission is to stop at all of them; the border (state completion)
    // is held until stopsMade >= requiredStops. Count scales per level.
    this.requiredStops = 3;
    this.stopsMade = 0;
    this._awaitingStops = false; // true once at the border with stops still owed

    // ─── Difficulty tuning knobs ─────────────────────────────────
    // These four numbers drive the whole pace/challenge curve. They were
    // tuned so every state is completable with clean play (~20-25% time to
    // spare) while difficulty climbs from Abia → Lagos. See _applyStateDifficulty.
    this.DIST_SCALE   = 0.55;   // scale the narrative distanceToComplete down to a playable length
    this.CRUISE_AT_1  = 36;     // cruising speed (units/s) at speedMult 1.0, base keke (eased ~10% for the 35%-easier pass)
    this.START_FRAC   = 0.55;   // a run/level starts at this fraction of cruise, then ramps up
    this.RAMP_RATE    = 0.45;   // per-second lerp toward cruise (≈2.2s time constant)
    this.DIST_CREEP   = 1 / 700; // cruise inches up with distance so it never feels static
    this.MAX_ADS = 3;           // advert revives allowed per game; after that a fail is game over
    this.adsWatched = 0;
    this.TIMER_MARGIN = 1.55;  // level timer = clean-cruise time × this (spare buffer; raised from 1.15 → ~35% more spare time)

    // Per-level countdown timer (seconds) — recomputed per state.
    this.levelDuration = 45;
    this.timeLeft = 45;

    this.maxSpeed = 96;
    this.speed = this.CRUISE_AT_1 * this.START_FRAC;
    this.cruiseSpeed = this.CRUISE_AT_1;
    this.startSpeed = this.speed;
    this.speedFloor = this.speed;
    this.effDist = 2000 * this.DIST_SCALE;

    this.bailCount = 0;
    this.bailCost = 200;

    this.activePowerUps = {};

    // ─── Vehicle ownership & selection (persisted) ──────────────
    this.unlockedVehicles = this._loadUnlockedVehicles();
    this.vehicle = localStorage.getItem('mkd_selected_vehicle') || 'keke';
    if (!this.unlockedVehicles.includes(this.vehicle)) this.vehicle = 'keke';
    this.vehicleData = VEHICLES.find(v => v.id === this.vehicle) || VEHICLES[0];

    this.isBailed = false;
    this.caughtByPolice = false;
    this.policeChasing = false;
    this.shopQueue = null;

    this.listeners = {};

    // Risky lane active
    this.riskyLaneActive = false;
    this.riskyLaneTimer = 0;

    this.tutorialShown = localStorage.getItem('mkd_tutorial') === '1';
  }

  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  emit(event, data) {
    (this.listeners[event] || []).forEach(cb => cb(data));
  }

  startGame() {
    this.state = 'PLAYING';
    this.score = 0;
    this.distance = 0;
    this.coins = 0;
    this.lives = 3;
    this.multiplier = 1;
    this.stateIndex = 0;
    this.currentState = STATES[0];
    this.stateProgress = 0;

    // Apply the equipped vehicle's handling to this run
    this.vehicleData = VEHICLES.find(v => v.id === this.vehicle) || VEHICLES[0];
    this._applyStateDifficulty(true);
    this.bailCount = 0;
    this.bailCost = 200;
    this.adsWatched = 0;      // OLUKO advert revives used this game (max MAX_ADS)
    this._failReason = null;  // 'caught' | 'timeUp' while a fail screen is up
    this.activePowerUps = {};
    this.riskyLaneActive = false;
    this.policeChasing = false;
    this.emit('stateChanged', this.currentState);
    this.emit('gameStarted', {});
  }

  // Derive this state's cruise speed, start speed, distance goal and timer
  // from the speedMult / distanceToComplete in StatesData plus the tuning
  // knobs. resetSpeed=true snaps speed to the start value (new run / fresh
  // state); false keeps current momentum and lets it lerp to the new cruise.
  _applyStateDifficulty(resetSpeed) {
    const sm = this.currentState.speedMult || 1;
    const veh = (this.vehicleData && this.vehicleData.speed) || 1;
    this.cruiseSpeed = Math.min(this.CRUISE_AT_1 * sm * veh, this.maxSpeed);
    this.startSpeed = this.cruiseSpeed * this.START_FRAC;
    this.speedFloor = this.startSpeed;
    this.effDist = this.currentState.distanceToComplete * this.DIST_SCALE;
    // Required refuel/service stops this stage: ~3 (Abia) → ~7 (Lagos),
    // averaging ~5 across the 36 states. The stage mission scales with this.
    this.requiredStops = Math.max(3, Math.round(3 + this.stateIndex * (4 / (STATES.length - 1))));
    this.stopsMade = 0;
    this._awaitingStops = false;
    // Clean cruise covers effDist in ~effDist/cruise seconds; give a margin.
    this.levelDuration = (this.effDist / this.cruiseSpeed) * this.TIMER_MARGIN + 3;
    this.timeLeft = this.levelDuration;
    if (resetSpeed) this.speed = this.startSpeed;
  }

  update(delta) {
    if (this.state !== 'PLAYING') return;

    // Ease speed toward this state's cruise (which itself creeps up with distance)
    const targetSpeed = Math.min(this.cruiseSpeed + this.distance * this.DIST_CREEP, this.maxSpeed);
    this.speed += (targetSpeed - this.speed) * this.RAMP_RATE * delta;

    // Jet fuel boost
    if (this.activePowerUps.jet_fuel) {
      this.speed = Math.min(this.speed * 1.8, this.maxSpeed * 1.3);
    }

    // Move forward
    this.distance += this.speed * delta;
    this.score = Math.floor(this.distance);

    // Level countdown — run out of time and it's game over. Frozen while held
    // at the border waiting on refuel stops (don't punish hunting a station).
    if (!this._awaitingStops) {
      this.timeLeft -= delta;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        // Out of time — offer the advert revive if any are left, else game over.
        if (this.adsLeft() > 0) {
          this.state = 'BAIL';
          this._failReason = 'timeUp';
          this.emit('timeUp', { adsLeft: this.adsLeft() });
        } else {
          this.gameOver();
        }
        return;
      }
    }

    // State progress + completion. Reaching the border (effDist) only clears
    // the state once every required service stop has been made — the stage's
    // refuel mission is mandatory. Until then, hold the bar just shy of full
    // and let ShopManager keep offering fuel stations.
    if (this.distance >= this.effDist) {
      if (this.stopsMade >= this.requiredStops) {
        this.completeState();
        return;
      }
      this.stateProgress = 0.99;
      if (!this._awaitingStops) {
        this._awaitingStops = true;
        this.emit('borderBlocked', { made: this.stopsMade, required: this.requiredStops });
      }
    } else {
      this.stateProgress = Math.min(this.distance / this.effDist, 1);
    }

    // Update power-up timers
    Object.keys(this.activePowerUps).forEach(id => {
      this.activePowerUps[id] -= delta;
      if (this.activePowerUps[id] <= 0) {
        delete this.activePowerUps[id];
        this.emit('powerUpExpired', id);
      }
    });

    // Multiplier decay
    if (this.multiplier > 1) {
      this.multiplierTimer -= delta;
      if (this.multiplierTimer <= 0) {
        this.multiplier = Math.max(1, this.multiplier - 1);
        this.multiplierTimer = 5;
      }
    }

    // Risky lane timer
    if (this.riskyLaneActive) {
      this.riskyLaneTimer -= delta;
      if (this.riskyLaneTimer <= 0) this.exitRiskyLane();
    }

    this.emit('tick', { distance: this.distance, score: this.score, speed: this.speed, stateProgress: this.stateProgress, timeLeft: this.timeLeft });
  }

  collectCoin(value = 1) {
    const earned = value * this.multiplier;
    this.coins += earned;
    this.totalCoins += earned;
    if (this.coins % 50 === 0 && this.coins > 0) {
      this.multiplier = Math.min(this.multiplier + 1, 8);
      this.multiplierTimer = 5;
      this.emit('multiplierChanged', this.multiplier);
    }
    this.emit('coinCollected', earned);
    return earned;
  }

  // A service point (fuel station etc.) was entered — count it toward the
  // stage's required stops. ShopManager calls this when the player pulls in.
  recordStop() {
    if (this.stopsMade >= this.requiredStops) return;
    this.stopsMade++;
    this.emit('stopMade', { made: this.stopsMade, required: this.requiredStops });
  }

  collectPowerUp(id, duration) {
    this.activePowerUps[id] = duration;
    this.emit('powerUpActivated', { id, duration });
  }

  hasPowerUp(id) {
    return !!this.activePowerUps[id];
  }

  enterRiskyLane() {
    this.riskyLaneActive = true;
    this.riskyLaneTimer = 8;
    this.emit('riskyLaneEntered', {});
  }

  exitRiskyLane() {
    this.riskyLaneActive = false;
    this.emit('riskyLaneExited', {});
  }

  hitObstacle() {
    if (this.hasPowerUp('ogi_shield')) return;

    if (this.lives > 1) {
      this.lives--;
      this.speed = Math.max(this.speed * 0.7, this.speedFloor);
      this.multiplier = 1;
      this.emit('playerHurt', this.lives);
      // Two hits taken — the police are now on your tail
      if (this.lives === 1 && !this.policeChasing) {
        this.policeChasing = true;
        this.emit('policeChaseStarted', {});
      }
    } else {
      this.caughtByPolice = true;
      this.state = 'BAIL';
      this._failReason = 'caught';
      this.emit('playerCaught', { bailCost: this.bailCost });
    }
  }

  caughtByPoliceChaser() {
    if (this.hasPowerUp('ogi_shield') || this.hasPowerUp('juju_cloak')) return;
    this.state = 'BAIL';
    this._failReason = 'caught';
    this.emit('playerCaught', { bailCost: this.bailCost });
  }

  payBail() {
    if (this.totalCoins >= this.bailCost) {
      this.totalCoins -= this.bailCost;
      this.coins -= Math.min(this.coins, this.bailCost);
      this.bailCount++;
      this.bailCost = Math.min(this.bailCost * 2, 3200);
      this.lives = 1;
      this.state = 'PLAYING';
      this.policeChasing = false;
      this.emit('policeChaseEnded', {});
      this.emit('bailPaid', this.bailCost);
      this.saveProgress();
      return true;
    }
    return false;
  }

  adsLeft() { return Math.max(0, this.MAX_ADS - this.adsWatched); }

  // The player chose to watch the advert — freeze the run while it plays.
  // UIManager plays the video and calls watchAd() only once it has finished.
  startAd() {
    if (this.adsLeft() <= 0) return false;
    this.state = 'AD';
    return true;
  }

  watchAd() {
    // Free revival after the advert has played through
    if (this.adsLeft() <= 0) return false;
    this.adsWatched++;
    this.lives = 1;
    if (this._failReason === 'timeUp') {
      this.timeLeft = Math.max(15, this.levelDuration * 0.35);
    }
    this._failReason = null;
    this.state = 'PLAYING';
    this.policeChasing = false;
    this.emit('policeChaseEnded', {});
    this.emit('adWatched', { adsLeft: this.adsLeft() });
    return true;
  }

  gameOver() {
    this.state = 'GAMEOVER';
    this.saveProgress();
    this.emit('gameOver', {
      score: this.score,
      distance: this.distance,
      coins: this.coins,
      state: this.currentState.name,
      statesCleared: this.stateIndex
    });
  }

  completeState() {
    const bonusCoins = this.currentState.bonusCoins;
    this.coins += bonusCoins;
    this.totalCoins += bonusCoins;
    this.state = 'LEVEL_COMPLETE';
    this.policeChasing = false;
    this.emit('policeChaseEnded', {});
    this.emit('stateCompleted', {
      state: this.currentState,
      bonusCoins,
      nextState: STATES[this.stateIndex + 1]
    });
  }

  nextState() {
    if (this.stateIndex >= STATES.length - 1) {
      // Final victory!
      this.emit('gameWon', { totalCoins: this.totalCoins });
      this.state = 'GAMEOVER';
      return;
    }
    this.stateIndex++;
    this.currentState = STATES[this.stateIndex];
    this.stateProgress = 0;
    this.distance = 0;
    this._applyStateDifficulty(false); // recompute cruise/goal/timer; keep momentum
    this.lives = Math.min(this.lives + 1, this.maxLives); // Restore 1 life per state
    this.state = 'PLAYING';
    this.emit('stateChanged', this.currentState);
  }

  openShop(shopType) {
    this.shopQueue = shopType;
    this.state = 'SHOP';
    this.emit('shopOpened', shopType);
  }

  closeShop() {
    this.shopQueue = null;
    this.state = 'PLAYING';
    this.emit('shopClosed', {});
  }

  purchaseShopItem(item) {
    if (this.totalCoins >= item.cost) {
      this.totalCoins -= item.cost;
      this.coins -= Math.min(this.coins, item.cost);
      this.applyShopEffect(item);
      this.emit('itemPurchased', item);
      this.saveProgress();
      return true;
    }
    this.emit('insufficientCoins', { needed: item.cost, have: this.totalCoins });
    return false;
  }

  applyShopEffect(item) {
    switch (item.effect) {
      case 'speed_restore_half': this.speed = Math.max(this.speed, this.cruiseSpeed * 0.85); break;
      case 'speed_restore_full': this.speed = this.cruiseSpeed; break;
      case 'speed_boost_120s': this.activePowerUps.jet_fuel = 120; break;
      case 'restore_half_health': this.lives = Math.min(Math.ceil(this.maxLives / 2), this.maxLives); break;
      case 'restore_full_health': this.lives = this.maxLives; break;
      case 'add_life': this.maxLives = Math.min(this.maxLives + 1, 5); this.lives = this.maxLives; break;
      case 'all_repairs': this.lives = this.maxLives; this.speed = this.cruiseSpeed; break;
      case 'all_stats_boost': this.activePowerUps.ogi_shield = 30; this.activePowerUps.coin_magnet = 60; break;
    }
  }

  pause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.emit('paused', {});
    }
  }

  resume() {
    if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.emit('resumed', {});
    }
  }

  // ─── Vehicles / Garage ───────────────────────────────────────
  _loadUnlockedVehicles() {
    try {
      const saved = JSON.parse(localStorage.getItem('mkd_vehicles') || '["keke"]');
      if (Array.isArray(saved) && saved.includes('keke')) return saved;
    } catch (e) { /* fall through */ }
    return ['keke'];
  }

  isVehicleUnlocked(id) {
    return this.unlockedVehicles.includes(id);
  }

  buyVehicle(id) {
    const v = VEHICLES.find(x => x.id === id);
    if (!v || this.isVehicleUnlocked(id)) return false;
    if (this.totalCoins < v.cost) {
      this.emit('insufficientCoins', { needed: v.cost, have: this.totalCoins });
      return false;
    }
    this.totalCoins -= v.cost;
    this.unlockedVehicles.push(id);
    this.selectVehicle(id);
    this.saveProgress();
    this.emit('vehicleUnlocked', v);
    return true;
  }

  selectVehicle(id) {
    if (!this.isVehicleUnlocked(id)) return false;
    this.vehicle = id;
    this.vehicleData = VEHICLES.find(v => v.id === id) || VEHICLES[0];
    localStorage.setItem('mkd_selected_vehicle', id);
    this.emit('vehicleSelected', this.vehicleData);
    return true;
  }

  addCoins(amount) {
    this.totalCoins += amount;
    this.saveProgress();
    this.emit('totalCoinsChanged', this.totalCoins);
  }

  saveProgress() {
    localStorage.setItem('mkd_coins', this.totalCoins.toString());
    localStorage.setItem('mkd_best_state', this.stateIndex.toString());
    localStorage.setItem('mkd_best_score', Math.max(this.score, parseInt(localStorage.getItem('mkd_best_score') || '0')).toString());
    localStorage.setItem('mkd_vehicles', JSON.stringify(this.unlockedVehicles));
    localStorage.setItem('mkd_selected_vehicle', this.vehicle);
  }

  loadProgress() {
    this.totalCoins = parseInt(localStorage.getItem('mkd_coins') || '0');
    this.unlockedVehicles = this._loadUnlockedVehicles();
    this.vehicle = localStorage.getItem('mkd_selected_vehicle') || 'keke';
    if (!this.unlockedVehicles.includes(this.vehicle)) this.vehicle = 'keke';
    this.vehicleData = VEHICLES.find(v => v.id === this.vehicle) || VEHICLES[0];
  }
}
