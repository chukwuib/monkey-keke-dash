import * as THREE from 'three';
import { SHOPS } from '../data/StatesData.js';

const SPAWN_Z = -80;
const DESPAWN_Z = 20;
const SHOP_INTERVAL = 40; // every ~40 seconds

const SHOP_COLORS = {
  filling_station: 0xFFCC00,
  hospital:        0xFF3333,
  mechanic:        0x666666,
  egemole:         0xFF69B4,
  aduke_supermarket: 0x00AA44
};

export class ShopManager {
  constructor(scene, gameManager) {
    this.scene = scene;
    this.gm = gameManager;
    this.shops = [];
    this.shopTypes = Object.keys(SHOPS);
    this.shopIndex = 0;

    // Service points are anchored to distance checkpoints across the stage, so
    // the player meets exactly gm.requiredStops of them. Computed in reset().
    this.spawnDistances = [];
    this.spawnPtr = 0;
    this._forceTimer = 0; // throttles fuel-station re-offers while at the border

    // Approaching-service banner state (player taps to enter)
    this.activeShop = null;
    this.activeType = null;
    this.onApproach = null; // (type, shopData) => show banner
    this.onPass = null;     // () => hide banner
  }

  enterActiveShop() {
    if (this.activeShop && !this.activeShop.triggered) {
      this.activeShop.triggered = true;
      this.gm.recordStop();          // counts toward the stage's required stops
      this.gm.openShop(this.activeType);
      this._clearActive();
    }
  }

  _clearActive() {
    this.activeShop = null;
    this.activeType = null;
    if (this.onPass) this.onPass();
  }

  _buildShopMesh(type) {
    const group = new THREE.Group();
    const color = SHOP_COLORS[type] || 0xFFFFFF;
    const shop = SHOPS[type];

    // Main building
    const buildGeo = new THREE.BoxGeometry(4, 4, 3);
    const buildMat = new THREE.MeshLambertMaterial({ color: 0xFFFFFF });
    const building = new THREE.Mesh(buildGeo, buildMat);
    building.position.set(0, 2, 0);
    building.castShadow = true;
    group.add(building);

    // Colored roof
    const roofGeo = new THREE.BoxGeometry(4.5, 0.4, 3.5);
    const roofMat = new THREE.MeshLambertMaterial({ color });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(0, 4.2, 0);
    group.add(roof);

    // Sign board
    const signGeo = new THREE.BoxGeometry(3.5, 1.2, 0.2);
    const signMat = new THREE.MeshLambertMaterial({ color });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 3.2, 1.55);
    group.add(sign);

    // Sign text (canvas texture)
    const tex = this._makeSignTex(shop.name, shop.icon);
    const textMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.0),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
    );
    textMesh.position.set(0, 3.2, 1.66);
    group.add(textMesh);

    // Blinking neon arrow
    const arrowGeo = new THREE.CylinderGeometry(0, 0.3, 0.7, 3);
    const arrowMat = new THREE.MeshLambertMaterial({ color, emissive: color });
    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(0, 5 + i * 0.7, 0);
      arrow.rotation.z = Math.PI;
      group.add(arrow);
    }

    group.userData.type = type;
    return group;
  }

  _makeSignTex(name, icon) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${icon} ${name}`, 256, 64);
    return new THREE.CanvasTexture(canvas);
  }

  update(delta, speed, player) {
    if (this.gm.state !== 'PLAYING') return;

    // Spawn the next scheduled service point as we reach its distance marker.
    while (this.spawnPtr < this.spawnDistances.length &&
           this.gm.distance >= this.spawnDistances[this.spawnPtr]) {
      this._spawnShop();
      this.spawnPtr++;
    }

    // At the border with stops still owed: keep offering fuel stations so the
    // player can always finish (GameManager holds completion + freezes timer).
    if (this.gm._awaitingStops && this.gm.stopsMade < this.gm.requiredStops) {
      this._forceTimer -= delta;
      if (!this.activeShop && this._forceTimer <= 0) {
        this._spawnShop('filling_station');
        this._forceTimer = 3.0;
      }
    }

    for (let i = this.shops.length - 1; i >= 0; i--) {
      const shop = this.shops[i];
      shop.group.position.z += speed * delta;

      // Pulse arrows
      const arrows = shop.group.children.filter((_, idx) => idx > 4);
      arrows.forEach((a, ai) => {
        a.material.opacity = 0.5 + Math.sin(Date.now() * 0.005 + ai * 1.5) * 0.5;
        a.material.transparent = true;
      });

      // Banner stays up until the player taps it or the shop drives past
      if (this.activeShop === shop && shop.group.position.z > 9) {
        this._clearActive();
      }

      if (shop.group.position.z > DESPAWN_Z) {
        this.scene.remove(shop.group);
        this.shops.splice(i, 1);
      }
    }
  }

  _spawnShop(forceType) {
    const type = forceType || this.shopTypes[this.shopIndex % this.shopTypes.length];
    this.shopIndex++;
    const group = this._buildShopMesh(type);
    // Place shop on right side of road
    group.position.set(12, 0, SPAWN_Z);
    this.scene.add(group);
    const shopObj = { group, triggered: false };
    this.shops.push(shopObj);

    // Announce the approaching service via the tappable banner
    this.activeShop = shopObj;
    this.activeType = type;
    if (this.onApproach) this.onApproach(type, SHOPS[type]);
  }

  reset() {
    this.shops.forEach(s => this.scene.remove(s.group));
    this.shops = [];
    this.shopIndex = 0;
    this._clearActive();

    // Space the stage's required stops evenly across the playable distance,
    // the last one well before the border so they're all catchable in time.
    const N = this.gm.requiredStops || 4;
    const eff = this.gm.effDist || 1100;
    this.spawnDistances = [];
    for (let k = 1; k <= N; k++) this.spawnDistances.push(eff * (k / (N + 1)));
    this.spawnPtr = 0;
    this._forceTimer = 0;
  }
}
