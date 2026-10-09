import * as THREE from 'three';
import { LANE_POSITIONS, RISKY_LANE_X } from '../entities/Player.js';

const SPAWN_Z = -75;
const DESPAWN_Z = 12;
const POOL_SIZE = 25;

// Obstacle type definitions
const OBSTACLE_TYPES = {
  police_car: {
    build: (scene) => buildPolice(scene),
    height: 1.2, width: 1.8, depth: 3.5, isChaser: false
  },
  danfo_bus: {
    build: (scene) => buildDanfo(scene),
    height: 2.0, width: 2.2, depth: 4.5, isChaser: false
  },
  market_stall: {
    build: (scene) => buildStallSprite(),
    height: 1.1, width: 2.4, depth: 2.0, isChaser: false
  },
  okada: {
    build: (scene) => buildOkada(scene),
    height: 1.2, width: 0.8, depth: 2.0, isChaser: false
  },
  cattle: {
    // Photoreal white Fulani zebu (Adamawa & other northern states)
    build: () => spriteObstacle('ada-cow.png', 1.5, 2.5, 1.6),
    height: 1.6, width: 1.4, depth: 1.8, isChaser: false
  },
  horse_rider: {
    // Fulani herdsman on horseback (Adamawa)
    build: () => spriteObstacle('ada-horseman.png', 1.25, 2.7, 1.9),
    height: 1.9, width: 1.4, depth: 2.2, isChaser: false
  },
  pothole: {
    build: (scene) => buildPotholeSprite(),
    height: 0.2, width: 2.2, depth: 1.2, isChaser: false, low: true
  },
  pedestrian: {
    build: (scene) => buildPedestrian(scene),
    height: 1.8, width: 0.6, depth: 0.6, isChaser: false
  },
  camel: {
    build: (scene) => buildCamel(scene),
    height: 2.0, width: 1.2, depth: 2.5, isChaser: false
  },
  oil_tanker: {
    build: (scene) => buildTruck(scene, 0xCC4400),
    height: 2.5, width: 2.4, depth: 7.0, isChaser: false, multiLane: true
  },
  LASTMA_officer: {
    build: (scene) => buildLastma(scene),
    height: 1.8, width: 1.8, depth: 3.5, isChaser: true
  },
  road_block: {
    build: (scene) => buildRoadblock(scene),
    height: 1.0, width: 2.0, depth: 0.5, isChaser: false
  },
  palm_oil_drum: {
    build: (scene) => buildDrumSprite(),
    height: 1.0, width: 0.9, depth: 0.9, isChaser: false
  },
  market_banner: {
    // Hangs at head height — must SLIDE under it (jumping into it hits).
    build: (scene) => buildBanner(),
    height: 0.9, width: 2.2, depth: 0.4, isChaser: false, elevatedY: 1.2
  },
  coal_truck: {
    build: (scene) => buildTruck(scene, 0x222222),
    height: 2.0, width: 2.2, depth: 5.0, isChaser: false
  }
};

export class ObstacleManager {
  constructor(scene, gameManager, audioManager) {
    this.scene = scene;
    this.gm = gameManager;
    this.audio = audioManager;
    this.pool = [];
    this.active = [];
    this.spawnTimer = 0;
    this.spawnInterval = 1.8;
    this.chaser = null;
    this.chaserTimer = 0;

    this._initPool();
  }

  _initPool() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const group = new THREE.Group();
      group.visible = false;
      this.scene.add(group);
      this.pool.push({
        group,
        mesh: null,
        type: null,
        box: new THREE.Box3(),
        lane: 1,
        isChaser: false
      });
    }
  }

  _getFromPool() {
    return this.pool.find(o => !o.group.visible) || null;
  }

  _buildMeshForType(typeName) {
    const def = OBSTACLE_TYPES[typeName];
    if (!def) return { mesh: buildPolice(this.scene), def: OBSTACLE_TYPES.police_car };
    return { mesh: def.build(this.scene), def };
  }

  _spawn(typeName, lane, z = SPAWN_Z) {
    const slot = this._getFromPool();
    if (!slot) return;

    // Remove old mesh from group
    while (slot.group.children.length > 0) slot.group.remove(slot.group.children[0]);

    const { mesh, def } = this._buildMeshForType(typeName);
    if (!mesh) return;
    slot.group.add(mesh);

    const laneX = lane === 'risky' ? RISKY_LANE_X : LANE_POSITIONS[lane];
    const groundY = def.low ? 0 : (def.elevatedY != null ? def.elevatedY : def.height / 2);
    slot.group.position.set(laneX, groundY, z);
    slot.group.visible = true;
    slot.type = typeName;
    slot.lane = lane;
    slot.isChaser = def.isChaser || false;
    slot.nearMissed = false;
    slot.hitBoxSize = new THREE.Vector3(def.width * 0.85, def.height, def.depth * 0.85);

    // Multi-lane obstacles span 2 lanes
    if (def.multiLane) {
      slot.hitBoxSize.x *= 1.8;
    }

    this.active.push(slot);
  }

  spawnChaser(stateTheme) {
    if (this.chaser) return;
    const typeName = this._getChaserType(stateTheme);
    const slot = this._getFromPool();
    if (!slot) return;

    while (slot.group.children.length > 0) slot.group.remove(slot.group.children[0]);
    const { mesh, def } = this._buildMeshForType(typeName);
    if (!mesh) return;
    slot.group.add(mesh);
    slot.group.position.set(LANE_POSITIONS[1], def.height / 2, 15); // behind player
    slot.group.visible = true;
    slot.type = typeName;
    slot.isChaser = true;
    slot.hitBoxSize = new THREE.Vector3(def.width, def.height, def.depth);

    this.chaser = slot;
    this.chaserTimer = 0;
  }

  _getChaserType(stateMusic) {
    if (stateMusic === 'hausa_folk' || stateMusic === 'fuji_north') return 'LASTMA_officer';
    return 'police_car';
  }

  removeChaser() {
    if (!this.chaser) return;
    this.chaser.group.visible = false;
    const idx = this.active.indexOf(this.chaser);
    if (idx >= 0) this.active.splice(idx, 1);
    this.chaser = null;
  }

  _getStateObstacles(state) {
    const types = state.obstacles || ['police_car', 'danfo_bus', 'market_stall', 'pedestrian', 'pothole'];
    // Filter to only types we have builders for, then always offer the
    // slide-under banner so ducking stays relevant across states.
    return types.filter(t => OBSTACLE_TYPES[t] || t.includes('police') || t.includes('danfo')).concat('market_banner');
  }

  update(delta, speed, player, currentState) {
    if (this.gm.state !== 'PLAYING') return;

    // Spawn timer. Spacing is distance-based (a target gap in world units),
    // converted to a time interval by the current speed — so obstacles stay
    // a fair, dodge-able distance apart no matter how fast the keke is going.
    // The gap tightens with state index and progress, floored so it never
    // drops below human reaction time even on the Lagos final level.
    // DIFFICULTY: obstacle field density. Higher = denser/harder. Eased from
    // 1.5 → 1.1 for the "35% easier" pass — gaps are ~35% wider and the
    // reaction-time floor rises (0.5/1.1 ≈ 0.45s vs 0.33s), so there's more
    // room and time to dodge on every state.
    const DIFFICULTY = 1.1;
    this.spawnTimer += delta;
    const targetGap = (60 - this.gm.stateIndex * 0.4 - this.gm.stateProgress * 12) / DIFFICULTY;
    const interval = Math.min(2.0, Math.max(0.5 / DIFFICULTY, targetGap / Math.max(speed, 1)));
    if (this.spawnTimer >= interval) {
      this.spawnTimer = 0;
      this._spawnForState(currentState, speed);
    }

    // Move obstacles
    for (let i = this.active.length - 1; i >= 0; i--) {
      const obs = this.active[i];

      if (obs === this.chaser) {
        // Chaser behavior: chase player
        this.chaserTimer += delta;
        const chaserSpeed = speed * 0.75;
        obs.group.position.z += chaserSpeed * delta;

        // Move toward player lane
        const targetX = player.currentX;
        obs.group.position.x += (targetX - obs.group.position.x) * delta * 0.8;

        if (obs.group.position.z > 4) {
          // Check if caught
          if (Math.abs(obs.group.position.x - player.currentX) < 1.5 && !this.gm.hasPowerUp('juju_cloak')) {
            this.gm.caughtByPoliceChaser();
            this.audio.playCatch();
          }
        }
        if (obs.group.position.z > 20) {
          this.removeChaser();
          continue;
        }
      } else {
        // Regular obstacles move toward player
        obs.group.position.z += speed * delta;
      }

      // Update bounding box
      obs.box.setFromCenterAndSize(
        obs.group.position.clone().add(new THREE.Vector3(0, 0, 0)),
        obs.hitBoxSize
      );

      // Collision check
      if (player.checkCollision(obs.box) && obs !== this.chaser) {
        this.audio.playHit();
        player.onHit();
        this.gm.hitObstacle();
        obs.group.visible = false;
        this.active.splice(i, 1);
        continue;
      }

      // Near-miss: a still-active obstacle slips just past the player (dodged
      // by jumping/sliding or a last-second lane change). Chasers don't count.
      if (obs !== this.chaser && !obs.nearMissed && obs.group.position.z > 1.0) {
        obs.nearMissed = true;
        const lateral = Math.abs(obs.group.position.x - player.currentX);
        const half = obs.hitBoxSize.x / 2 + player.hitboxSize.x / 2;
        if (lateral < half + 1.8) {
          const intensity = Math.max(0.35, Math.min(1, 1 - (lateral - half) / 1.8));
          this.audio.playWhoosh(intensity);
          this.gm.emit('nearMiss', { intensity });
        }
      }

      // Despawn
      if (obs.group.position.z > DESPAWN_Z) {
        obs.group.visible = false;
        this.active.splice(i, 1);
      }
    }

    // Periodic chaser spawn
    if (!this.chaser && this.gm.state === 'PLAYING') {
      const chaserInterval = Math.max(12, 30 - this.gm.stateIndex);
      if (this.gm.distance > 500 && Math.random() < delta / chaserInterval) {
        this.spawnChaser(currentState);
      }
    }
  }

  _spawnForState(state, speed) {
    const types = this._getStateObstacles(state);
    const randomType = types[Math.floor(Math.random() * types.length)];
    const lane = Math.floor(Math.random() * 3);
    const z = SPAWN_Z - (speed * 1.5);

    // Pattern types
    const pattern = Math.random();
    if (pattern < 0.5) {
      // Single obstacle
      this._spawn(randomType, lane, z);
    } else if (pattern < 0.75) {
      // Two obstacles on different lanes
      const lane2 = (lane + 1) % 3;
      this._spawn(randomType, lane, z);
      this._spawn(types[Math.floor(Math.random() * types.length)], lane2, z - 5);
    } else if (pattern < 0.9) {
      // Gap pattern: obstacles on 2 of 3 lanes (leave one free)
      const blocked = [0, 1, 2].filter(l => l !== lane);
      blocked.forEach((bl, i) => this._spawn(randomType, bl, z - i * 3));
    } else {
      // Risky lane bonus: obstacle row with risky lane clear
      this._spawn(randomType, 0, z);
      this._spawn(randomType, 1, z);
      this._spawn(randomType, 2, z);
    }
  }

  reset() {
    this.active.forEach(obs => { obs.group.visible = false; });
    this.active = [];
    this.chaser = null;
    this.spawnTimer = 0;
  }
}

// ============================================================
// MESH BUILDER FUNCTIONS
// ============================================================

function buildPolice(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.8, 3.2),
    new THREE.MeshLambertMaterial({ color: 0x1C1C80 })
  );
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.75, 1.8),
    new THREE.MeshLambertMaterial({ color: 0x1C1C80 })
  );
  cabin.position.set(0, 0.77, -0.1);
  g.add(cabin);
  // Siren lights
  const sirenGeo = new THREE.BoxGeometry(0.9, 0.2, 0.4);
  const sirenMat = new THREE.MeshLambertMaterial({ color: 0xFF0000, emissive: 0x880000 });
  const siren = new THREE.Mesh(sirenGeo, sirenMat);
  siren.position.set(0, 1.2, -0.1);
  g.add(siren);
  const siren2 = new THREE.Mesh(sirenGeo, new THREE.MeshLambertMaterial({ color: 0x0000FF, emissive: 0x000088 }));
  siren2.position.set(0, 1.2, 0.1);
  g.add(siren2);
  addWheels(g, 1.6);
  // "POLICE" white stripe
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 0.15, 1.0),
    new THREE.MeshLambertMaterial({ color: 0xFFFFFF })
  );
  stripe.position.set(0, 0.1, 0);
  g.add(stripe);
  return g;
}

function buildDanfo(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 1.8, 4.2),
    new THREE.MeshLambertMaterial({ color: 0xFFCC00 })
  );
  g.add(body);
  // Black stripes
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 0.2, 4.25),
    new THREE.MeshLambertMaterial({ color: 0x111111 })
  );
  stripe.position.set(0, 0.4, 0);
  g.add(stripe);
  // Windows
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.6, 2.5),
    new THREE.MeshLambertMaterial({ color: 0x444444, transparent: true, opacity: 0.7 })
  );
  win.position.set(1.05, 0.6, 0);
  g.add(win);
  addWheels(g, 2.0, 4);
  return g;
}

function buildMarketStall(scene) {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.2, 2.2),
    new THREE.MeshLambertMaterial({ color: 0xD2691E })
  );
  g.add(stand);
  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.1, 2.6),
    new THREE.MeshLambertMaterial({ color: [0xFF6600, 0x00AA44, 0xFF3399, 0xFFCC00][Math.floor(Math.random() * 4)] })
  );
  cover.position.set(0, 1.35, 0);
  g.add(cover);
  // Goods on stall
  const goodsGeo = new THREE.BoxGeometry(1.8, 0.6, 1.8);
  const goods = new THREE.Mesh(goodsGeo, new THREE.MeshLambertMaterial({ color: 0xFF8C00 }));
  goods.position.set(0, 0.9, 0);
  g.add(goods);
  return g;
}

function buildOkada(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.6, 1.8),
    new THREE.MeshLambertMaterial({ color: 0xFF4500 })
  );
  g.add(body);
  // Wheels
  const wGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 8);
  const wMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  [-0.7, 0.7].forEach(z => {
    const w = new THREE.Mesh(wGeo, wMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(0, -0.2, z);
    g.add(w);
  });
  // Rider
  const rider = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.7, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x1A3A6B })
  );
  rider.position.set(0, 0.65, 0);
  g.add(rider);
  return g;
}

function buildCattle(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.0, 2.0),
    new THREE.MeshLambertMaterial({ color: 0xC8A878 })
  );
  g.add(body);
  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.7),
    new THREE.MeshLambertMaterial({ color: 0xC8A878 })
  );
  head.position.set(0, 0.3, 1.1);
  g.add(head);
  // Legs
  const legGeo = new THREE.BoxGeometry(0.2, 0.8, 0.2);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xA88060 });
  [[-0.35, 0.7], [0.35, 0.7], [-0.35, -0.7], [0.35, -0.7]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, -0.9, z);
    g.add(leg);
  });
  // Horns
  const hornGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5);
  const hornMat = new THREE.MeshLambertMaterial({ color: 0xF0E0B0 });
  [[-0.2, 0.3, 1.1, 0.4], [0.2, 0.3, 1.1, -0.4]].forEach(([x, y, z, rx]) => {
    const horn = new THREE.Mesh(hornGeo, hornMat);
    horn.position.set(x, y + 0.5, z);
    horn.rotation.z = rx;
    g.add(horn);
  });
  return g;
}

function buildPothole(scene) {
  const g = new THREE.Group();
  const hole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 0.15, 10),
    new THREE.MeshLambertMaterial({ color: 0x1A1A1A })
  );
  g.add(hole);
  // Warning triangle
  const warn = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 0.3, 0.5, 3),
    new THREE.MeshLambertMaterial({ color: 0xFF6600 })
  );
  warn.position.set(0.8, 0.3, 0);
  g.add(warn);
  return g;
}

function buildPedestrian(scene) {
  const g = new THREE.Group();
  const colors = [0xFF6600, 0x1A3A6B, 0xFF3399, 0x228B22, 0xFFCC00];
  const col = colors[Math.floor(Math.random() * colors.length)];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.0, 0.4),
    new THREE.MeshLambertMaterial({ color: col })
  );
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 7, 7),
    new THREE.MeshLambertMaterial({ color: 0x8B5A2B })
  );
  head.position.set(0, 0.72, 0);
  g.add(head);
  // Item on head (tray/bag)
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.15, 0.5),
    new THREE.MeshLambertMaterial({ color: 0xFFCC00 })
  );
  tray.position.set(0, 0.98, 0);
  g.add(tray);
  return g;
}

function buildCamel(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.2, 2.2),
    new THREE.MeshLambertMaterial({ color: 0xD2B48C })
  );
  g.add(body);
  // Hump
  const hump = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 7, 7),
    new THREE.MeshLambertMaterial({ color: 0xC8A878 })
  );
  hump.position.set(0, 0.9, -0.2);
  g.add(hump);
  // Head/neck
  const neck = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.8, 0.35),
    new THREE.MeshLambertMaterial({ color: 0xD2B48C })
  );
  neck.position.set(0, 0.7, 1.0);
  g.add(neck);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.45, 0.6),
    new THREE.MeshLambertMaterial({ color: 0xD2B48C })
  );
  head.position.set(0, 1.2, 1.2);
  g.add(head);
  // Legs
  const legGeo = new THREE.BoxGeometry(0.22, 1.0, 0.22);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xC4A068 });
  [[-0.38, 0.8], [0.38, 0.8], [-0.38, -0.8], [0.38, -0.8]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, -1.1, z);
    g.add(leg);
  });
  return g;
}

function buildTruck(scene, color) {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.0, 2.0),
    new THREE.MeshLambertMaterial({ color: 0x888888 })
  );
  cab.position.set(0, 0, 1.5);
  g.add(cab);
  const trailer = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 2.2, 5.0),
    new THREE.MeshLambertMaterial({ color })
  );
  trailer.position.set(0, 0.1, -1.0);
  g.add(trailer);
  addWheels(g, 2.3, 6);
  return g;
}

function buildLastma(scene) {
  const g = new THREE.Group();
  // LASTMA vehicle (yellow/green)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.0, 3.5),
    new THREE.MeshLambertMaterial({ color: 0xFFCC00 })
  );
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.8, 2.0),
    new THREE.MeshLambertMaterial({ color: 0xFFCC00 })
  );
  cabin.position.set(0, 0.9, 0.3);
  g.add(cabin);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 0.25, 3.55),
    new THREE.MeshLambertMaterial({ color: 0x006400 })
  );
  stripe.position.set(0, 0.1, 0);
  g.add(stripe);
  // Flashing light
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0xFF6600, emissive: 0xFF3300 })
  );
  light.position.set(0, 1.4, 0);
  g.add(light);
  addWheels(g, 1.7);
  return g;
}

function buildRoadblock(scene) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.2, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xFF0000 })
  );
  g.add(bar);
  // Orange/white stripes
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.5, 0.1),
    new THREE.MeshLambertMaterial({ color: 0xFF6600 })
  );
  stripe.position.set(0, -0.5, 0);
  g.add(stripe);
  // Cones
  [[-1.2, 0], [0, 0], [1.2, 0]].forEach(([x, z]) => {
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0, 0.2, 0.7, 6),
      new THREE.MeshLambertMaterial({ color: 0xFF6600 })
    );
    cone.position.set(x, -0.8, z);
    g.add(cone);
  });
  return g;
}

function buildDrum(scene, color) {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.85, 10),
    new THREE.MeshLambertMaterial({ color })
  );
  g.add(drum);
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.08, 10),
    new THREE.MeshLambertMaterial({ color: 0x444444 })
  );
  lid.position.y = 0.45;
  g.add(lid);
  return g;
}

// ── Photoreal billboard obstacles (cut Aba art) ───────────────
const _obsTexCache = {};
function obsTex(file) {
  if (!_obsTexCache[file]) {
    const t = new THREE.TextureLoader().load('assets/img/' + file);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    _obsTexCache[file] = t;
  }
  return _obsTexCache[file];
}
// VW/VH = in-world plane size. Upright billboards face +z (toward the player);
// `flat` lays the plane on the road as a decal. The plane's bottom is aligned
// to the ground given the pool group's y-offset (def.height/2 for non-low types).
function spriteObstacle(file, VW, VH, defHeight, flat = false) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    map: obsTex(file), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), mat);
  if (flat) { p.rotation.x = -Math.PI / 2; p.position.y = 0.02; }
  else { p.position.y = VH / 2 - defHeight / 2; }
  g.add(p);
  return g;
}
// Hanging market banner — group is placed at elevatedY (~1.2), so build relative
// to that. Cloth + top bar sit at head height; poles drop to the ground.
function buildBanner() {
  const g = new THREE.Group();
  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.7, 0.06),
    new THREE.MeshLambertMaterial({ color: [0xCC2222, 0x1E6F5C, 0x255CA8, 0xC2531B][Math.floor(Math.random() * 4)] })
  );
  g.add(cloth);
  // white stripe across the cloth for a signboard look
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.07), new THREE.MeshLambertMaterial({ color: 0xF5EACB }));
  g.add(stripe);
  // top support bar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0x3A2A1A }));
  bar.position.y = 0.42;
  g.add(bar);
  // poles down to the ground (group sits ~1.2 above ground)
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3A2A1A });
  [-1.18, 1.18].forEach(x => {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.7, 0.12), poleMat);
    pole.position.set(x, -0.35, 0);
    g.add(pole);
  });
  return g;
}
function buildDrumSprite()    { return spriteObstacle('obs-oildrum.png', 1.5 * 748 / 929, 1.5, 1.0); }
function buildStallSprite()   { return spriteObstacle('obs-stall.png', 2.7, 2.7 * 402 / 1203, 1.1); }
function buildPotholeSprite() { return spriteObstacle('obs-pothole.png', 2.2, 2.2 * 695 / 1338, 0.2, true); }

function addWheels(group, axleWidth = 1.8, count = 4) {
  const wGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.22, 10);
  const wMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const zPositions = count === 4 ? [-1.0, 1.0] : [-1.5, -0.5, 0.5, 1.5];
  [-axleWidth / 2, axleWidth / 2].forEach(x => {
    zPositions.forEach(z => {
      const w = new THREE.Mesh(wGeo, wMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, -0.4, z);
      group.add(w);
    });
  });
}
