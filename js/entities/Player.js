import * as THREE from 'three';

export const LANE_POSITIONS = [-4.5, 0, 4.5];
export const RISKY_LANE_X = -9;
export const GROUND_Y = 0;

// Per-vehicle player sprites. All share the keke's framing: dead-rear view,
// monkey driver seen from behind, photoreal, on transparent cutout.
//   sw/sh = source PNG pixel size (sets aspect)   w = in-world width (units)
//   ready = art exists; until true we fall back to the keke so nothing 404s.
const VEHICLE_SPRITES = {
  keke:     { file: 'player-keke.png',     sw: 621, sh: 824, w: 2.9, ready: true },
  okada:    { file: 'player-okada.png',    sw: 600, sh: 900, w: 2.1, ready: false },
  danfo:    { file: 'player-danfo.png',    sw: 676, sh: 832, w: 3.5, ready: true },
  innoson:  { file: 'player-innoson.png',  sw: 880, sh: 680, w: 3.4, ready: false },
  bolekaja: { file: 'player-bolekaja.png', sw: 645, sh: 853, w: 3.8, ready: true },
};
function spriteDef(id) {
  const d = VEHICLE_SPRITES[id];
  return d && d.ready ? d : VEHICLE_SPRITES.keke;
}

export class Player {
  constructor(scene, gameManager, audioManager) {
    this.scene = scene;
    this.gm = gameManager;
    this.audio = audioManager;

    this.currentLane = 1; // 0=left, 1=center, 2=right
    this.isOnRiskyLane = false;
    this.targetX = LANE_POSITIONS[1];
    this.currentX = LANE_POSITIONS[1];
    this.isLaneChanging = false;

    this.isJumping = false;
    this.jumpVelocity = 0;
    this.isSliding = false;
    this.slideTimer = 0;
    this.squashTimer = 0; // landing squash impulse

    this.currentY = GROUND_Y + 0.6;
    this.baseY = GROUND_Y + 0.6;

    this.isShielded = false;
    this.isInvisible = false;
    this.isBoosted = false;

    this.hitCooldown = 0;

    this.group = new THREE.Group();
    this._buildKeke();
    this._buildMonkey();
    this.group.position.set(this.currentX, this.baseY, 0);
    scene.add(this.group);

    // Collision box (smaller than visual for fairness)
    this.collisionBox = new THREE.Box3();
    this.hitboxSize = new THREE.Vector3(1.2, 1.0, 1.8);
  }

  _buildKeke() {
    this.kekeGroup = new THREE.Group();

    // Billboard sprite for the currently-equipped vehicle (rear-view art)
    this._buildVehicleSprite();

    // Soft contact shadow under the vehicle (flat dark ellipse)
    const shadowTex = this._makeRadialShadow();
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 });
    this.shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5), shadowMat);
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.set(0, -0.55, 0.1);
    this.kekeGroup.add(this.shadowMesh);

    this.kekeGroup.position.set(0, 0, 0);
    this.group.add(this.kekeGroup);
  }

  _buildVehicleSprite() {
    const def = spriteDef(this.gm.vehicle);
    const W = def.w, H = W * (def.sh / def.sw);  // keep aspect ratio
    const tex = new THREE.TextureLoader().load('assets/img/' + def.file);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    // wheels sit on the ground: group origin is baseY (0.6) above ground
    plane.position.set(0, H / 2 - 0.6, 0);
    this.spriteMesh = plane;
    this.bodyMesh = plane; // for onHit flash + setVehicleColor tint
    // shadow scales a little with vehicle width
    if (this.shadowMesh) this.shadowMesh.scale.x = W / 2.9;
    this.kekeGroup.add(plane);
  }

  // Swap the player art when a different vehicle is equipped
  setVehicle(id) {
    if (this.spriteMesh) {
      this.kekeGroup.remove(this.spriteMesh);
      this.spriteMesh.geometry.dispose();
      this.spriteMesh.material.map?.dispose();
      this.spriteMesh.material.dispose();
      this.spriteMesh = null;
    }
    this._buildVehicleSprite();
  }

  _makeRadialShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  _buildMonkey() {
    // Monkey is part of the keke billboard now; keep an empty group so the
    // driving-bob update has a harmless target.
    this.monkeyGroup = new THREE.Group();
    this.group.add(this.monkeyGroup);
  }

  // Shield effect mesh
  _addShieldEffect() {
    if (this._shieldMesh) return;
    const geo = new THREE.SphereGeometry(1.8, 12, 12);
    const mat = new THREE.MeshPhongMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.25, wireframe: false });
    this._shieldMesh = new THREE.Mesh(geo, mat);
    this._shieldMesh.position.set(0, 0.2, 0);
    this.group.add(this._shieldMesh);
  }

  _removeShieldEffect() {
    if (this._shieldMesh) {
      this.group.remove(this._shieldMesh);
      this._shieldMesh = null;
    }
  }

  swipeLeft() {
    if (this.isLaneChanging) return;
    if (this.isOnRiskyLane) {
      // Exit risky lane back to left
      this.isOnRiskyLane = false;
      this.targetX = LANE_POSITIONS[0];
      this.isLaneChanging = true;
      this.gm.exitRiskyLane();
      return;
    }
    if (this.currentLane > 0) {
      this.currentLane--;
      this.targetX = LANE_POSITIONS[this.currentLane];
      this.isLaneChanging = true;
    }
  }

  swipeRight() {
    if (this.isLaneChanging) return;
    if (this.currentLane < 2) {
      this.currentLane++;
      this.targetX = LANE_POSITIONS[this.currentLane];
      this.isLaneChanging = true;
    }
  }

  swipeFarLeft() {
    // A big left swipe from the leftmost lane enters the risky lane; from any
    // other lane it must still move you one lane left. Without this fallback a
    // normal (long) phone swipe from the centre lane fired here and did nothing
    // — the "slide left does not respond" bug, while far-right always moved.
    if (!this.isOnRiskyLane && this.currentLane === 0 && !this.isLaneChanging) {
      this.isOnRiskyLane = true;
      this.targetX = RISKY_LANE_X;
      this.isLaneChanging = true;
      this.gm.enterRiskyLane();
      this.audio.playRiskyLane();
    } else {
      this.swipeLeft();
    }
  }

  swipeFarRight() {
    if (this.isLaneChanging) return;
    // Leaving the risky lane must clear its state, otherwise the flag goes
    // stale (on lane 2 but still "risky") and corrupts the next left swipe.
    if (this.isOnRiskyLane) {
      this.isOnRiskyLane = false;
      this.gm.exitRiskyLane();
    }
    this.currentLane = 2;
    this.targetX = LANE_POSITIONS[2];
    this.isLaneChanging = true;
  }

  jump() {
    if (!this.isJumping && !this.isSliding) {
      this.isJumping = true;
      this.jumpVelocity = 14;
      this.isSliding = false;
      this.audio.playJump();
    }
  }

  slide() {
    if (!this.isSliding && !this.isJumping) {
      this.isSliding = true;
      this.slideTimer = 0.6;
      this.audio.playSlide();
    }
  }

  update(delta) {
    if (this.hitCooldown > 0) this.hitCooldown -= delta;

    // Lane movement
    this.currentX += (this.targetX - this.currentX) * Math.min(1, delta * 16);
    if (Math.abs(this.currentX - this.targetX) < 0.05) {
      this.currentX = this.targetX;
      this.isLaneChanging = false;
    }

    // Jumping
    const GRAVITY = -32;
    if (this.isJumping) {
      this.jumpVelocity += GRAVITY * delta;
      this.currentY += this.jumpVelocity * delta;
      if (this.currentY <= this.baseY) {
        this.currentY = this.baseY;
        this.isJumping = false;
        this.jumpVelocity = 0;
        this.squashTimer = 0.18; // touchdown squash
      }
    } else {
      this.currentY = this.baseY;
    }

    // Sliding
    if (this.isSliding) {
      this.slideTimer -= delta;
      this.group.scale.set(1, 0.5, 1);
      if (this.slideTimer <= 0) {
        this.isSliding = false;
        this.group.scale.set(1, 1, 1);
      }
    }

    this.group.position.set(this.currentX, this.currentY, 0);

    // ── Juice: squash & stretch, lane-change lean, idle bob ──────────
    const now = Date.now();
    let sx = 1, sy = 1;
    if (this.isJumping) {
      // stretch upward while rising, flatten as it falls
      const s = Math.max(-0.16, Math.min(0.16, this.jumpVelocity * 0.012));
      sy = 1 + s; sx = 1 - s * 0.6;
    } else if (this.squashTimer > 0) {
      this.squashTimer -= delta;
      const amt = Math.sin(Math.max(0, this.squashTimer / 0.18) * Math.PI) * 0.22;
      sy = 1 - amt; sx = 1 + amt * 0.7; // squat on touchdown
    }
    if (!this.isSliding) this.kekeGroup.scale.set(sx, sy, 1);

    // Lean into lane changes; gentle bob/wobble when settled
    const tilt = (this.currentX - this.targetX) * 0.075;       // banking
    let wobble = 0;
    if (!this.isJumping && !this.isSliding) {
      this.kekeGroup.position.y = Math.sin(now * 0.012) * 0.05;
      wobble = Math.sin(now * 0.006) * 0.015;
    } else {
      this.kekeGroup.position.y = 0;
    }
    this.kekeGroup.rotation.z += ((tilt + wobble) - this.kekeGroup.rotation.z) * Math.min(1, delta * 12);

    // Update power-up visuals
    const shielded = this.gm.hasPowerUp('ogi_shield');
    if (shielded && !this._shieldMesh) this._addShieldEffect();
    if (!shielded && this._shieldMesh) this._removeShieldEffect();

    if (this._shieldMesh) {
      this._shieldMesh.rotation.y += delta * 1.5;
      this._shieldMesh.material.opacity = 0.15 + Math.sin(Date.now() * 0.005) * 0.1;
    }

    // Juju cloak - make keke semi-transparent
    const invisible = this.gm.hasPowerUp('juju_cloak');
    this.kekeGroup.traverse(c => {
      if (c.material) {
        c.material.transparent = invisible;
        c.material.opacity = invisible ? 0.35 : 1.0;
      }
    });

    // Update collision box — sliding drops the player low so high obstacles
    // (hanging banners/barriers) pass overhead.
    if (this.isSliding) {
      const h = this.hitboxSize.y * 0.5;
      const center = new THREE.Vector3(this.currentX, this.currentY - this.hitboxSize.y * 0.25, 0);
      this.collisionBox.setFromCenterAndSize(center, new THREE.Vector3(this.hitboxSize.x, h, this.hitboxSize.z));
    } else {
      const center = new THREE.Vector3(this.currentX, this.currentY, 0);
      this.collisionBox.setFromCenterAndSize(center, this.hitboxSize);
    }
  }

  // Check if hit by an obstacle's bounding box
  checkCollision(obstBox) {
    if (this.hitCooldown > 0) return false;
    if (this.gm.hasPowerUp('ogi_shield')) return false;
    return this.collisionBox.intersectsBox(obstBox);
  }

  onHit() {
    this.hitCooldown = 1.5;
    // Flash red
    this.kekeGroup.traverse(c => {
      if (c.material && c.material.color) {
        const orig = c.material.color.getHex();
        c.material.color.setHex(0xFF0000);
        setTimeout(() => c.material.color.setHex(orig), 300);
      }
    });
  }

  setVehicleColor(color) {
    this.bodyMesh.material.color.setHex(color);
  }
}
