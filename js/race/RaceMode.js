import * as THREE from 'three';
import { RaceSim, TICK, LANES, MAX_SECONDS, MAX_HITS } from './RaceSim.js';

// Plays one Daily Race run. RaceSim is the source of truth (fixed 60 Hz steps,
// seeded track); this class only feeds it inputs and draws its state with the
// game's existing keke, obstacle art and road. Every input is logged as
// [tick, code] — the exact log the server replays to verify the score.
export class RaceMode {
  constructor({ scene, gm, player, road, obsMgr, audio }) {
    Object.assign(this, { scene, gm, player, road, obsMgr, audio });
    this.active = false;
    this.slots = new Map();      // sim obstacle id → obsMgr pool slot
    this.coinMeshes = [];
    this.coinById = new Map();
    this.hud = document.getElementById('race-hud');
    const tex = new THREE.TextureLoader().load('assets/img/coin.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    this.coinMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    this.coinGeo = new THREE.PlaneGeometry(0.9, 0.9);
  }

  start(entry, onFinish) {
    this.entry = entry;
    this.onFinish = onFinish;
    this.sim = new RaceSim(entry.seed);
    this.log = [];
    this.pending = [];
    this.acc = 0;
    this.active = true;
    this.gm.state = 'RACE';            // normal game loop + its spawners stay idle
    this.obsMgr.reset();
    this.road.reset();
    this._clearVisuals();
    this.player.currentX = LANES[1];
    this.player.group.visible = true;
    this.player.group.scale.set(1, 1, 1);
    this.audio.playStateMusic('afrobeats');
    if (this.hud) this.hud.style.display = 'flex';
    this._renderHud();
  }

  // InputManager gestures → race codes. Applied at the start of the next tick.
  input(code) { if (this.active && !this.sim.over) this.pending.push(code); }

  update(delta) {
    if (!this.active) return;
    this.acc += delta;
    while (this.acc >= TICK && !this.sim.over) {
      for (const code of this.pending) { this.log.push([this.sim.tick, code]); this.sim.input(code); }
      this.pending = [];
      this.sim.step();
      for (const ev of this.sim.events) {
        if (ev.type === 'hit') { this.audio.playHit(); this.gm.emit('playerHurt', MAX_HITS - this.sim.hits); }
        if (ev.type === 'coin') this.audio.playCoinCollect(1);
      }
      this.acc -= TICK;
    }
    this._sync(delta);
    this._renderHud();
    if (this.sim.over) this._finish();
  }

  // Leave mid-race (e.g. app closed): the run is simply never submitted.
  abort() {
    if (!this.active) return;
    this.active = false;
    this._clearVisuals();
    if (this.hud) this.hud.style.display = 'none';
  }

  _finish() {
    this.active = false;
    this._clearVisuals();
    if (this.hud) this.hud.style.display = 'none';
    this.gm.state = 'MENU';
    const s = this.sim;
    this.onFinish?.({ entry: this.entry, inputs: this.log, score: s.score,
                      distance: Math.floor(s.distance), coins: s.coins, hits: s.hits });
  }

  _sync(delta) {
    const s = this.sim, p = this.player;
    p.currentX = s.x;
    p.currentY = s.y;
    p.group.position.set(s.x, s.y, 0);
    p.group.scale.set(1, s.sliding ? 0.5 : 1, 1);
    this.road.update(delta, s.speed, 'afrobeats');

    // Obstacles: create art for new sim obstacles, move all, hide removed ones.
    const live = new Set();
    for (const o of s.obstacles) {
      live.add(o.id);
      let slot = this.slots.get(o.id);
      if (!slot) {
        slot = this.obsMgr._getFromPool();
        if (!slot) continue;
        while (slot.group.children.length) slot.group.remove(slot.group.children[0]);
        const { mesh } = this.obsMgr._buildMeshForType(o.type);
        slot.group.add(mesh);
        slot.group.visible = true;
        this.slots.set(o.id, slot);
      }
      slot.group.position.set(LANES[o.lane], o.cy, s.distance - o.s);
    }
    for (const [id, slot] of this.slots) {
      if (!live.has(id)) { slot.group.visible = false; this.slots.delete(id); }
    }

    // Coins: small spinning billboards from a reusable pool.
    const liveCoins = new Set();
    for (const c of s.coinList) {
      liveCoins.add(c.id);
      let m = this.coinById.get(c.id);
      if (!m) {
        m = this.coinMeshes.find(x => !x.visible) || this._newCoin();
        m.visible = true;
        this.coinById.set(c.id, m);
      }
      m.position.set(LANES[c.lane], 1.0, s.distance - c.s);
      m.rotation.y += delta * 4;
    }
    for (const [id, m] of this.coinById) {
      if (!liveCoins.has(id)) { m.visible = false; this.coinById.delete(id); }
    }
  }

  _newCoin() {
    const m = new THREE.Mesh(this.coinGeo, this.coinMat);
    this.scene.add(m);
    this.coinMeshes.push(m);
    return m;
  }

  _clearVisuals() {
    for (const slot of this.slots.values()) slot.group.visible = false;
    this.slots.clear();
    for (const m of this.coinMeshes) m.visible = false;
    this.coinById.clear();
  }

  _renderHud() {
    if (!this.hud || !this.sim) return;
    const s = this.sim;
    const left = Math.max(0, Math.ceil(MAX_SECONDS - s.elapsed));
    this.hud.innerHTML =
      `<span>🏁 ${s.score.toLocaleString()}</span>` +
      `<span>🪙 ${s.coins}</span>` +
      `<span>${'❤️'.repeat(Math.max(0, MAX_HITS - s.hits))}${'🖤'.repeat(s.hits)}</span>` +
      `<span>⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>`;
  }
}
