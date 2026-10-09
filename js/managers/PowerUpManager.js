import * as THREE from 'three';
import { LANE_POSITIONS } from '../entities/Player.js';
import { POWER_UPS } from '../data/StatesData.js';

const SPAWN_Z = -70;
const DESPAWN_Z = 14;
const POOL_SIZE = 12;

export class PowerUpManager {
  constructor(scene, gameManager, audioManager) {
    this.scene = scene;
    this.gm = gameManager;
    this.audio = audioManager;
    this.pool = [];
    this.active = [];
    this.spawnTimer = 0;
    this.spawnInterval = 15; // Every 15 seconds

    this._buildPool();
  }

  _buildPool() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const group = this._buildPowerUpMesh(POWER_UPS[i % POWER_UPS.length]);
      group.visible = false;
      this.scene.add(group);
      this.pool.push({ group, type: null, box: new THREE.Box3() });
    }
  }

  _buildPowerUpMesh(powerUp) {
    const group = new THREE.Group();
    const color = powerUp.color;

    // Outer glow sphere
    const outerGeo = new THREE.SphereGeometry(0.65, 10, 10);
    const outerMat = new THREE.MeshPhongMaterial({
      color, emissive: color, transparent: true, opacity: 0.3, wireframe: false
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    group.add(outer);

    // Inner icon shape (unique per type)
    switch (powerUp.id) {
      case 'ogi_shield': {
        const iconGeo = new THREE.SphereGeometry(0.4, 8, 8);
        const iconMat = new THREE.MeshPhongMaterial({ color: 0xFFFFFF, emissive: 0x888888 });
        group.add(new THREE.Mesh(iconGeo, iconMat));
        break;
      }
      case 'jet_fuel': {
        const iconGeo = new THREE.CylinderGeometry(0.15, 0.3, 0.7, 8);
        const iconMat = new THREE.MeshPhongMaterial({ color: 0xFF4500, emissive: 0x882200 });
        group.add(new THREE.Mesh(iconGeo, iconMat));
        break;
      }
      case 'coin_magnet': {
        const iconGeo = new THREE.TorusGeometry(0.3, 0.1, 6, 12);
        const iconMat = new THREE.MeshPhongMaterial({ color: 0xFFD700, emissive: 0x886600 });
        group.add(new THREE.Mesh(iconGeo, iconMat));
        break;
      }
      case 'juju_cloak': {
        const iconGeo = new THREE.ConeGeometry(0.3, 0.7, 6);
        const iconMat = new THREE.MeshPhongMaterial({ color: 0x9400D3, emissive: 0x440066 });
        group.add(new THREE.Mesh(iconGeo, iconMat));
        break;
      }
    }

    // Name label (canvas texture)
    const labelTex = this._makeLabel(powerUp.name, color);
    const labelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 0.6),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, side: THREE.DoubleSide })
    );
    labelMesh.position.set(0, 1.0, 0);
    group.add(labelMesh);

    group.userData.powerUpId = powerUp.id;
    group.userData.duration = powerUp.duration;
    group.userData.outerMesh = outer;
    return group;
  }

  _makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    return new THREE.CanvasTexture(canvas);
  }

  _getFromPool() {
    return this.pool.find(p => !p.group.visible) || null;
  }

  _spawn(typeIndex, lane) {
    const slot = this._getFromPool();
    if (!slot) return;
    const pu = POWER_UPS[typeIndex % POWER_UPS.length];
    slot.group.visible = true;
    slot.group.position.set(LANE_POSITIONS[lane], 1.2, SPAWN_Z);
    slot.group.userData.powerUpId = pu.id;
    slot.group.userData.duration = pu.duration;
    slot.type = pu.id;
    this.active.push(slot);
  }

  update(delta, speed, player) {
    if (this.gm.state !== 'PLAYING') return;

    this.spawnTimer += delta;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this._spawn(Math.floor(Math.random() * POWER_UPS.length), Math.floor(Math.random() * 3));
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const pu = this.active[i];
      pu.group.position.z += speed * delta;
      pu.group.rotation.y += delta * 2;
      pu.group.position.y = 1.2 + Math.sin(Date.now() * 0.003 + i) * 0.3;

      // Pulse glow
      if (pu.group.userData.outerMesh) {
        pu.group.userData.outerMesh.material.opacity = 0.2 + Math.sin(Date.now() * 0.006) * 0.15;
      }

      pu.box.setFromObject(pu.group);

      if (player.collisionBox.intersectsBox(pu.box)) {
        this.gm.collectPowerUp(pu.type, pu.group.userData.duration);
        this.audio.playPowerUp();
        pu.group.visible = false;
        this.active.splice(i, 1);
        continue;
      }

      if (pu.group.position.z > DESPAWN_Z) {
        pu.group.visible = false;
        this.active.splice(i, 1);
      }
    }
  }

  reset() {
    this.active.forEach(p => { p.group.visible = false; });
    this.active = [];
    this.spawnTimer = 0;
  }
}
