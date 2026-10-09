import * as THREE from 'three';
import { LANE_POSITIONS, RISKY_LANE_X } from '../entities/Player.js';

const SPAWN_Z = -70;
const DESPAWN_Z = 14;
const POOL_SIZE = 200;
const COIN_RADIUS = 0.35;
const COIN_TUBE = 0.08;
const MAGNET_RANGE = 12;

export class CoinManager {
  constructor(scene, gameManager, audioManager) {
    this.scene = scene;
    this.gm = gameManager;
    this.audio = audioManager;
    this.pool = [];
    this.active = [];
    this.spawnTimer = 0;
    this.spawnInterval = 0.6;
    this.patternIndex = 0;

    this._buildPool();
  }

  _buildPool() {
    // Billboard coin using the real gold ₦ coin art
    const tex = new THREE.TextureLoader().load('assets/img/coin.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const size = COIN_RADIUS * 2.6;
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide
    });

    for (let i = 0; i < POOL_SIZE; i++) {
      const coin = new THREE.Mesh(geo, mat);
      const group = new THREE.Group();
      group.add(coin);
      group.visible = false;

      this.scene.add(group);
      this.pool.push({ group, coin, value: 1, box: new THREE.Box3() });
    }
  }

  _makeNairaTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 44px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₦', 32, 34);
    return new THREE.CanvasTexture(canvas);
  }

  _getFromPool() {
    return this.pool.find(c => !c.group.visible) || null;
  }

  _spawnCoin(x, y, z, value = 1) {
    const slot = this._getFromPool();
    if (!slot) return;
    slot.group.position.set(x, y, z);
    slot.group.visible = true;
    slot.group.rotation.set(0, 0, 0);
    slot.coin.rotation.set(0, 0, 0);
    slot.value = value;
    this.active.push(slot);
  }

  _spawnPattern(pattern, z) {
    switch (pattern % 8) {
      case 0: // Straight line - all 3 lanes
        LANE_POSITIONS.forEach(x => {
          for (let i = 0; i < 6; i++) this._spawnCoin(x, 0.7, z - i * 3);
        });
        break;
      case 1: // Arc in center lane
        for (let i = 0; i < 8; i++) {
          const arc = Math.sin(i / 7 * Math.PI) * 2.5;
          this._spawnCoin(LANE_POSITIONS[1], 0.7 + arc, z - i * 2.5);
        }
        break;
      case 2: // Zigzag across lanes
        for (let i = 0; i < 9; i++) {
          const lane = i % 3;
          this._spawnCoin(LANE_POSITIONS[lane], 0.7, z - i * 2.5);
        }
        break;
      case 3: // High air coins
        for (let i = 0; i < 5; i++) {
          this._spawnCoin(LANE_POSITIONS[1], 2.5 + Math.sin(i * 0.8) * 1.5, z - i * 3);
        }
        break;
      case 4: // Fan pattern
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 4; j++) {
            this._spawnCoin(LANE_POSITIONS[i], 0.7 + j * 0.6, z - i * 2 - j * 0.5);
          }
        }
        break;
      case 5: // Risky lane bonus coins (worth 3x)
        for (let i = 0; i < 8; i++) {
          this._spawnCoin(RISKY_LANE_X, 0.7 + Math.abs(Math.sin(i * 0.5)) * 1.5, z - i * 2.5, 3);
        }
        break;
      case 6: // Diamond pattern
        const cx = LANE_POSITIONS[1];
        [[0,0], [-1.5,2.5], [0,5], [1.5,2.5], [0,5], [-1.5,7.5], [0,10], [1.5,7.5]].forEach(([dx, dz]) => {
          this._spawnCoin(cx + dx, 0.8, z - dz);
        });
        break;
      case 7: // Tunnel of coins (all lanes)
        for (let i = 0; i < 10; i++) {
          LANE_POSITIONS.forEach(x => this._spawnCoin(x, 1.2, z - i * 2));
        }
        break;
    }
  }

  update(delta, speed, player) {
    if (this.gm.state !== 'PLAYING') return;

    // Spawn
    this.spawnTimer += delta;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this._spawnPattern(this.patternIndex++, SPAWN_Z - speed * 0.5);
    }

    const hasMagnet = this.gm.hasPowerUp('coin_magnet');
    const playerPos = new THREE.Vector3(player.currentX, player.currentY, 0);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const coin = this.active[i];

      // Move forward
      coin.group.position.z += speed * delta;

      // Spin the coin (flip around its vertical axis)
      coin.coin.rotation.y += delta * 4;

      // Magnet effect
      if (hasMagnet) {
        const dist = coin.group.position.distanceTo(playerPos);
        if (dist < MAGNET_RANGE) {
          const dir = playerPos.clone().sub(coin.group.position).normalize();
          coin.group.position.addScaledVector(dir, delta * 20);
        }
      }

      // Update bounding box
      coin.box.setFromObject(coin.group);

      // Check collision with player
      if (player.collisionBox.intersectsBox(coin.box)) {
        const earned = this.gm.collectCoin(coin.value);
        this.audio.playCoinCollect(this.gm.multiplier);
        coin.group.visible = false;
        this.active.splice(i, 1);
        continue;
      }

      // Despawn
      if (coin.group.position.z > DESPAWN_Z) {
        coin.group.visible = false;
        this.active.splice(i, 1);
      }
    }
  }

  reset() {
    this.active.forEach(c => { c.group.visible = false; });
    this.active = [];
    this.spawnTimer = 0;
    this.patternIndex = 0;
  }
}
