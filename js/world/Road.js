import * as THREE from 'three';
import { LANE_POSITIONS, RISKY_LANE_X } from '../entities/Player.js';

const TILE_LENGTH = 80;
const TILE_COUNT = 5;
const ROAD_WIDTH = 15;
const SIDEWALK_WIDTH = 3;

// Bright, saturated palette for the Subway-Surfers-style market corridor
const SHOP_COLORS = [0xE2574C, 0xF2A33A, 0x3FA796, 0x4A90D9, 0xE05A8A, 0x8E6FC9, 0xF2C53D, 0x59B85B, 0xEF7D54];
const SIGN_COLORS = [0x1A2A4A, 0xB02A2A, 0x1E6F5C, 0x9A3070, 0x255CA8, 0x222222];
const AWN_COLORS  = [0xE2574C, 0x4A90D9, 0x59B85B, 0xF2A33A, 0xE05A8A, 0xF2C53D];
const TOWER_COLORS = [0x9FB1C4, 0xB7C2CE, 0x8FA0B5, 0xC8C6BE, 0xA6B8C6];

// Real Ariaria / Aba market shop names so the place is unmistakable
const SIGN_NAMES = [
  'ARIARIA SHOES', 'ABA TEXTILES', 'OKRIKA BALE', 'ABA MADE', 'CHIDI & SONS',
  'LEATHER WORKS', 'ANKARA HOUSE', 'SHOE PLAZA', 'EKEONUNWA', 'OGA BOSS',
  'ABA FABRICS', 'POWERLINE STORES'
];
const SIGN_BG = ['#13245C', '#B23A2A', '#1E6F5C', '#9A3070', '#255CA8', '#C2531B'];

// Per-state shop signage + building palette so each state reads as itself
// (Abia keeps the default Ariaria signs + bright SHOP_COLORS below).
const STATE_ART = {
  Adamawa: {
    signs: ['YOLA MARKET', 'MUBI TEXTILES', 'SAHEL STORES', 'SUKUR CRAFTS', 'FULANI WARES',
            'ADAMAWA GOODS', 'MANDARA SHOP', 'JIMETA PLAZA', 'GANYE STORES', 'BENUE TRADERS'],
    colors: [0xC9A86A, 0xB8895A, 0xD8C088, 0xA9763F, 0xCBB489, 0xBFA46A, 0xD2A857]
  }
};

export class Road {
  constructor(scene, camera = null) {
    this.scene = scene;
    this.camera = camera;
    this.tiles = [];
    this.people = [];
    this.props = [];
    this.envObjects = [];
    this.currentTheme = null;
    this.totalZ = 0;

    // Which art set the roadside props / street crowd use — swapped per state
    // by setState(). Defaults to the Aba/Ariaria set.
    this.propSet = ['okrika', 'shoes', 'fabric'];
    this.peopleSet = ['walk', 'walk', 'stroll', 'hawk', 'talk', 'pram', 'cycle'];

    this._createLighting();
    this._buildSignAssets();
    this._initPeopleAssets();
    this._initPropAssets();
    this._createStaticElements();
    this._initTiles();
    this._addSkyline();
  }

  // Distant photoreal Aba rooftops sitting at the far horizon (static backdrop).
  _addSkyline() {
    const tex = new THREE.TextureLoader().load('assets/img/skyline-aba.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 });
    const W = 140, H = W * (309 / 1458);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    plane.position.set(0, H / 2 - 1.5, -150);
    plane.renderOrder = -1;
    this.scene.add(plane);
    this.skyline = plane;
    this.skylineMat = mat;
    this._skyH = H;
  }

  // Swap the roadside art set + distant skyline to match the current state.
  // Called from main.js on stateChanged. Recycled tiles pick up the new props
  // and crowd within a few seconds of driving; the skyline swaps instantly.
  setState(state) {
    const ada = state && state.name === 'Adamawa';
    this.propSet = ada
      ? ['ahut', 'aacacia', 'aminaret', 'akraal']
      : ['okrika', 'shoes', 'fabric'];
    this.peopleSet = ada
      ? ['awoman', 'aman', 'awoman', 'aman']
      : ['walk', 'walk', 'stroll', 'hawk', 'talk', 'pram', 'cycle'];
    if (this.skyline && this.skylineMat) {
      const tex = new THREE.TextureLoader().load('assets/img/' + (ada ? 'skyline-adamawa.png' : 'skyline-aba.png'));
      tex.colorSpace = THREE.SRGBColorSpace;
      this.skylineMat.map = tex;
      this.skylineMat.needsUpdate = true;
      const sy = ada ? 2.2 : 1.0; // the highland panorama is much taller than the Aba strip
      this.skyline.scale.y = sy;
      this.skyline.position.y = this._skyH * sy / 2 - 1.5;
    }

    // Shop signage + building palette for this state (recycled tiles pick it
    // up as you drive). Abia keeps its Ariaria identity; others get their own.
    const art = STATE_ART[state && state.name];
    const names = art ? art.signs : SIGN_NAMES;
    this.signTextures = names.map((n, i) => this._makeTextTexture(n, SIGN_BG[i % SIGN_BG.length]));
    this.shopColors = art ? art.colors : SHOP_COLORS;

    // Gateway arch announcing the state (Abia keeps the Ariaria Market arch).
    if (state) {
      this.marketTex = (state.name === 'Abia')
        ? this._makeBannerTexture('ARIARIA MARKET', 'ABA, NIGERIA')
        : this._makeBannerTexture(state.name.toUpperCase(), (state.capital || '').toUpperCase() + ', NIGERIA');
      this._spawnArches();
    }
  }

  // Photoreal Aba market props (billboards lining the sidewalk).
  _initPropAssets() {
    this.propDefs = {
      okrika: { file: 'prop-okrika.png', w: 739, h:  799, height: 1.8 },
      shoes:  { file: 'prop-shoes.png',  w: 630, h: 1107, height: 2.5 },
      fabric: { file: 'prop-fabric.png', w: 662, h: 1082, height: 2.6 },
      // Adamawa highlands set
      ahut:     { file: 'ada-hut.png',     w: 819, h: 1011, height: 3.4 },
      aacacia:  { file: 'ada-acacia.png',  w: 813, h:  844, height: 5.0 },
      aminaret: { file: 'ada-minaret.png', w: 848, h: 1264, height: 6.0 },
      akraal:   { file: 'ada-kraal.png',   w: 719, h:  823, height: 2.0 },
    };
    const loader = new THREE.TextureLoader();
    this.propMats = {};
    this.propGeo = {};
    for (const key in this.propDefs) {
      const d = this.propDefs[key];
      const tex = loader.load('assets/img/' + d.file);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      this.propMats[key] = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true
      });
      this.propGeo[key] = new THREE.PlaneGeometry(d.height * (d.w / d.h), d.height);
    }
  }

  _addProps(group) {
    const types = this.propSet;
    for (const side of [-1, 1]) {
      let z = -TILE_LENGTH / 2 + 10;
      while (z < TILE_LENGTH / 2 - 6) {
        const type = types[Math.floor(Math.random() * types.length)];
        const def = this.propDefs[type];
        const plane = new THREE.Mesh(this.propGeo[type], this.propMats[type]);
        const x = side * (10.6 + Math.random() * 1.0); // against the building line, behind the people
        plane.position.set(x, def.height / 2, z);
        group.add(plane);
        this.props.push({ g: plane });
        z += 15 + Math.random() * 9;
      }
    }
  }

  // Photoreal billboard sprites for the street crowd (cut from Gemini art).
  // w/h are the source PNG pixel sizes; height is the in-world height in units.
  _initPeopleAssets() {
    this.personDefs = {
      walk:   { file: 'person-walk.png',    w: 463, h: 1096, height: 2.05 },
      stroll: { file: 'person-stroll.png',  w: 468, h: 1074, height: 2.00 },
      hawk:   { file: 'person-hawker.png',  w: 415, h: 1092, height: 2.05 },
      pram:   { file: 'person-pram.png',    w: 699, h: 1036, height: 1.95 },
      cycle:  { file: 'person-cyclist.png', w: 799, h:  980, height: 1.75 },
      talk:   { file: 'person-chat.png',    w: 593, h: 1047, height: 2.00 },
      // Adamawa crowd
      awoman: { file: 'ada-woman.png', w: 848, h: 1208, height: 2.05 },
      aman:   { file: 'ada-man.png',   w: 848, h: 1264, height: 2.10 },
    };
    const loader = new THREE.TextureLoader();
    this.personMats = {};
    this.personGeo = {};
    for (const key in this.personDefs) {
      const d = this.personDefs[key];
      const tex = loader.load('assets/img/' + d.file);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      this.personMats[key] = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true
      });
      const W = d.height * (d.w / d.h);
      this.personGeo[key] = new THREE.PlaneGeometry(W, d.height);
    }
  }

  _makeTextTexture(text, bg, fg = '#FFFFFF') {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10);
    let fs = 60; g.font = `bold ${fs}px Arial`;
    while (g.measureText(text).width > 470 && fs > 22) { fs -= 2; g.font = `bold ${fs}px Arial`; }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _makeBannerTexture(line1, line2) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 150;
    const g = c.getContext('2d');
    g.fillStyle = '#EAD9A8'; g.fillRect(0, 0, 1024, 150);
    g.strokeStyle = '#C2531B'; g.lineWidth = 8; g.strokeRect(4, 4, 1016, 142);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#13245C'; g.font = 'bold 76px Arial';
    g.fillText(line1, 512, line2 ? 58 : 80);
    if (line2) { g.fillStyle = '#B23A2A'; g.font = 'bold 34px Arial'; g.fillText(line2, 512, 116); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _buildSignAssets() {
    this.welcomeTex = this._makeBannerTexture('WELCOME', '');
    this.marketTex = this._makeBannerTexture('ARIARIA MARKET', 'ABA, NIGERIA');
    this.signTextures = SIGN_NAMES.map((n, i) => this._makeTextTexture(n, SIGN_BG[i % SIGN_BG.length]));
  }

  _createLighting() {
    this.sunLight = new THREE.DirectionalLight(0xFFF3D6, 1.6);
    this.sunLight.position.set(20, 36, 14);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.left = -40;
    this.sunLight.shadow.camera.right = 40;
    this.sunLight.shadow.camera.top = 50;
    this.sunLight.shadow.camera.bottom = -30;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 220;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    this.hemiLight = new THREE.HemisphereLight(0xCFE7F2, 0x9A8350, 0.75);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambientLight);
  }

  _createStaticElements() {
    // Big dusty ground covering the whole floor
    this.bigGround = new THREE.Mesh(
      new THREE.BoxGeometry(600, 0.2, 600),
      new THREE.MeshLambertMaterial({ color: 0xCBB489 })
    );
    this.bigGround.position.set(0, -0.35, 0);
    this.bigGround.receiveShadow = true;
    this.scene.add(this.bigGround);
  }

  _box(w, h, d, color, emissive = 0x000000) {
    return new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, emissive })
    );
  }
  _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  _initTiles() {
    for (let i = 0; i < TILE_COUNT; i++) {
      const tile = this._createTile();
      tile.group.position.z = TILE_LENGTH / 2 - i * TILE_LENGTH;
      this.tiles.push(tile);
      this.scene.add(tile.group);
    }
  }

  _createTile() {
    const group = new THREE.Group();

    // Road surface (worn dusty street)
    const road = this._box(ROAD_WIDTH, 0.2, TILE_LENGTH, 0x7A6E52);
    road.position.y = -0.1;
    road.receiveShadow = true;
    group.add(road);

    // Lane markings
    const dashGeo = new THREE.BoxGeometry(0.16, 0.05, 2.6);
    const dashMat = new THREE.MeshLambertMaterial({ color: 0xF5EACB });
    for (const laneX of [-2.25, 2.25]) {
      for (let z = -TILE_LENGTH / 2 + 5; z < TILE_LENGTH / 2; z += 8) {
        const dash = new THREE.Mesh(dashGeo, dashMat);
        dash.position.set(laneX, 0.01, z);
        group.add(dash);
      }
    }

    // Road edge kerbs
    [-ROAD_WIDTH / 2 + 0.1, ROAD_WIDTH / 2 - 0.1].forEach(x => {
      const edge = this._box(0.2, 0.06, TILE_LENGTH, 0xE8C84A);
      edge.position.set(x, 0.02, 0);
      group.add(edge);
    });

    // Sidewalks
    [-1, 1].forEach(s => {
      const swalk = this._box(SIDEWALK_WIDTH, 0.3, TILE_LENGTH, 0xC9BD9A);
      swalk.position.set(s * (ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2), 0.05, 0);
      swalk.receiveShadow = true;
      group.add(swalk);
    });

    // Risky lane (far left, unpaved dirt)
    const risky = this._box(3.5, 0.18, TILE_LENGTH, 0x6E5230);
    risky.position.set(RISKY_LANE_X, -0.01, 0);
    risky.receiveShadow = true;
    group.add(risky);
    const riskEdge = this._box(0.22, 0.07, TILE_LENGTH, 0xCC2222, 0x330000);
    riskEdge.position.set(RISKY_LANE_X + 1.75, 0.02, 0);
    group.add(riskEdge);

    // The market corridor (the two gateway arches are spawned separately)
    this._addCorridor(group);
    this._addPeople(group);
    this._addProps(group);

    return { group, road, envObjects: [] };
  }

  _addCorridor(group) {
    for (const side of [-1, 1]) {
      // Continuous shop-building wall right at the kerb
      let z = -TILE_LENGTH / 2 + 4;
      while (z < TILE_LENGTH / 2 - 4) {
        const w = 6 + Math.random() * 3;
        this._addShop(group, side, z + w / 2, w);
        z += w + 0.6 + Math.random() * 1.4;
      }
      // Taller skyline towers set back behind the shops (depth / parallax)
      for (let tz = -TILE_LENGTH / 2 + 8; tz < TILE_LENGTH / 2; tz += 15 + Math.random() * 9) {
        this._addTower(group, side, tz);
      }
      // Curb-side stalls, crates and the odd palm in front of the shops
      for (let sz = -TILE_LENGTH / 2 + 8; sz < TILE_LENGTH / 2 - 8; sz += 10 + Math.random() * 5) {
        const r = Math.random();
        if (r < 0.55) this._addStall(group, side, sz);
        else if (r < 0.72) this._addPalmTree(group, side * 10.5, sz);
        if (Math.random() < 0.5) this._addCrates(group, side, sz + 3.2);
      }
    }
    // Bunting strung across over both kerbs
    this._addBunting(group, 8.8);
    this._addBunting(group, -8.8);
  }

  // Colourful 1–3 storey market shop forming the corridor wall
  _addShop(group, side, z, w) {
    const h = 5 + Math.random() * 6;
    const d = 6 + Math.random() * 3;
    const nearX = 11.2;                       // kerb-side face distance from centre
    const cx = side * (nearX + w / 2);
    const faceX = -side * (w / 2);            // local x of the road-facing wall
    const protrude = (dx) => -side * (w / 2 + dx);
    const b = new THREE.Group();

    const wall = this._box(w, h, d, this._pick(this.shopColors || SHOP_COLORS));
    wall.position.y = h / 2;
    wall.castShadow = true;
    wall.receiveShadow = true;
    b.add(wall);

    // Signboard with a real Aba/Ariaria shop name
    const signW = Math.min(d * 0.9, 3.8);
    const backing = this._box(0.22, 1.3, signW, 0x111111);
    backing.position.set(protrude(0.1), h - 1.3, 0);
    b.add(backing);
    const signPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(signW, 1.15),
      new THREE.MeshBasicMaterial({ map: this._pick(this.signTextures), side: THREE.DoubleSide })
    );
    signPlane.position.set(protrude(0.22), h - 1.3, 0);
    signPlane.rotation.y = -side * Math.PI / 2;
    b.add(signPlane);

    // Ground-floor awning
    const awn = this._box(0.9, 0.18, d * 0.95, this._pick(AWN_COLORS));
    awn.position.set(protrude(0.55), 2.5, 0);
    awn.rotation.z = side * 0.22;
    b.add(awn);

    // Window grid on the road-facing wall
    const winMat = new THREE.MeshLambertMaterial({ color: 0x2C3A48, emissive: 0x10202A });
    const rows = Math.max(1, Math.floor((h - 3) / 2));
    const cols = Math.max(2, Math.floor(d / 2.2));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.85), winMat);
        win.position.set(protrude(0.04), 3.3 + r * 2,
          -d / 2 + 0.9 + c * ((d - 1.8) / Math.max(1, cols - 1)));
        b.add(win);
      }
    }

    // Doorway
    const door = this._box(0.08, 1.6, 1.0, 0x3A2A1A);
    door.position.set(protrude(0.05), 0.8, 0);
    b.add(door);

    // Flat zinc roof
    const roof = this._box(w + 0.3, 0.25, d + 0.3, 0x8A8F94);
    roof.position.y = h + 0.12;
    b.add(roof);

    b.position.set(cx, 0, z);
    group.add(b);
  }

  // One overhead gateway arch spanning the road (scrolls past once)
  _makeArch(z, tex) {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x55606E });
    [-8.8, 8.8].forEach(x => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 8.2, 8), poleMat);
      pole.position.set(x, 4.1, 0);
      pole.castShadow = true;
      g.add(pole);
    });
    const bar = this._box(18, 0.2, 0.2, 0x55606E);
    bar.position.set(0, 8.0, 0);
    g.add(bar);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(17.2, 2.2),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    banner.position.set(0, 6.8, 0);
    g.add(banner);
    g.position.z = z;
    this.scene.add(g);
    return g;
  }

  // Two gateway arches at the start of a run: WELCOME, then ARIARIA MARKET
  _spawnArches() {
    if (this.archs) this.archs.forEach(a => this.scene.remove(a));
    this.archs = [];
    this.archs.push(this._makeArch(-55, this.welcomeTex));
    this.archs.push(this._makeArch(-150, this.marketTex));
  }

  // Distant skyline tower for parallax depth
  _addTower(group, side, z) {
    const h = 12 + Math.random() * 14;
    const w = 6 + Math.random() * 4;
    const d = 6 + Math.random() * 4;
    const x = side * (26 + Math.random() * 8);
    const t = this._box(w, h, d, this._pick(TOWER_COLORS));
    t.position.set(x, h / 2, z);
    t.castShadow = true;
    group.add(t);
    // a few window strips
    const winMat = new THREE.MeshLambertMaterial({ color: 0x4A5A68 });
    for (let r = 0; r < Math.floor(h / 3); r++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, d * 0.7), winMat);
      strip.position.set(x - side * (w / 2), 2 + r * 3, z);
      group.add(strip);
    }
  }

  _addStall(group, side, z) {
    const s = new THREE.Group();
    const counter = this._box(2.4, 1.0, 1.4, 0x8B5A2B);
    counter.position.y = 0.5;
    counter.castShadow = true;
    s.add(counter);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5A3A1A });
    [[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]].forEach(([px, pz]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 5), postMat);
      p.position.set(px, 1.0, pz);
      s.add(p);
    });
    const stripes = [this._pick(AWN_COLORS), 0xFFFFFF];
    const n = 5, cw = 2.6 / n;
    for (let i = 0; i < n; i++) {
      const st = this._box(cw, 0.08, 1.7, stripes[i % 2]);
      st.position.set(-1.3 + (i + 0.5) * cw, 2.05, 0);
      st.rotation.x = -0.12;
      s.add(st);
    }
    const fruit = [0xFF7700, 0xCC2222, 0x33AA33, 0xFFDD00];
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.17, 6, 6),
        new THREE.MeshLambertMaterial({ color: fruit[i % 4] }));
      f.position.set(-0.9 + i * 0.36, 1.12, 0.2);
      s.add(f);
    }
    s.position.set(side * 9.6, 0, z);
    group.add(s);
  }

  _addCrates(group, side, z) {
    const g = new THREE.Group();
    const goods = [0xFF7700, 0xCC2222, 0x33AA33, 0xFFDD00, 0xAA5500, 0xE0457B];
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const crate = this._box(1.0, 0.8, 1.0, 0x9C6B3B);
      crate.position.set(i * 0.25, 0.4 + i * 0.82, i * 0.12);
      crate.castShadow = true;
      g.add(crate);
      for (let k = 0; k < 4; k++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6),
          new THREE.MeshLambertMaterial({ color: goods[Math.floor(Math.random() * goods.length)] }));
        f.position.set(-0.3 + k * 0.2 + i * 0.25, 0.85 + i * 0.82, i * 0.12);
        g.add(f);
      }
    }
    g.position.set(side * 9.4, 0, z);
    group.add(g);
  }

  _addPalmTree(group, x, z) {
    const palm = new THREE.Group();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x9A6B3F });
    const seg = 5, segH = 1.0;
    let cx = 0;
    for (let i = 0; i < seg; i++) {
      const r1 = 0.16 + (seg - i) * 0.02, r2 = 0.16 + (seg - i - 1) * 0.02;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, segH, 7), trunkMat);
      cx += 0.13;
      c.position.set(cx, i * segH + segH / 2, 0);
      c.castShadow = true;
      palm.add(c);
    }
    const topY = seg * segH, topX = cx;
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2E8B2E, side: THREE.DoubleSide });
    for (let a = 0; a < 7; a++) {
      const ang = (a / 7) * Math.PI * 2;
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.6, 4), frondMat);
      frond.position.set(topX + Math.cos(ang) * 0.9, topY + 0.15, Math.sin(ang) * 0.9);
      frond.rotation.set(-0.5, ang, Math.PI / 2);
      palm.add(frond);
    }
    palm.position.set(x, 0, z);
    palm.scale.setScalar(0.9 + Math.random() * 0.3);
    group.add(palm);
  }

  _addBunting(group, x) {
    const cols = [0xE53935, 0xFFB300, 0x1E88E5, 0x43A047, 0xFFFFFF, 0xAB47BC];
    const y = 5.0;
    const string = this._box(0.03, 0.03, TILE_LENGTH, 0x222222);
    string.position.set(x, y, 0);
    group.add(string);
    for (let z = -TILE_LENGTH / 2 + 1; z < TILE_LENGTH / 2; z += 1.5) {
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 3),
        new THREE.MeshLambertMaterial({ color: cols[Math.floor(Math.random() * cols.length)], side: THREE.DoubleSide }));
      flag.position.set(x, y - 0.22, z);
      flag.rotation.x = Math.PI;
      group.add(flag);
    }
  }

  // ── Street life (photoreal billboard sprites) ─────────────────
  _makePersonSprite(type) {
    const key = this.personGeo[type] ? type : 'walk';
    const plane = new THREE.Mesh(this.personGeo[key], this.personMats[key]);
    return plane;
  }

  _addPeople(group) {
    const types = this.peopleSet;
    for (const side of [-1, 1]) {
      let z = -TILE_LENGTH / 2 + 6;
      while (z < TILE_LENGTH / 2 - 6) {
        this._spawnPerson(group, this._pick(types), side, z);
        z += 8 + Math.random() * 6;
      }
    }
  }

  _spawnPerson(group, type, side, z) {
    const def = this.personDefs[type] || this.personDefs.walk;
    const x = side * (8.8 + Math.random() * 1.4);
    const baseY = def.height / 2;
    const p = this._makePersonSprite(type);
    p.position.set(x, baseY, z);
    // Mirror some of them so the crowd doesn't all face the same way
    if (Math.random() < 0.5) p.scale.x = -1;
    group.add(p);
    this.people.push({ type, g: p, phase: Math.random() * 6.28, baseY });
  }

  applyTheme(theme) {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    // Consistent bright daylight market look across all states.
  }

  update(delta, speed) {
    this.tiles.forEach(tile => {
      tile.group.position.z += speed * delta;
      if (tile.group.position.z > TILE_LENGTH / 2 + TILE_LENGTH * 0.5) {
        tile.group.position.z -= TILE_COUNT * TILE_LENGTH;
      }
    });
    if (this.archs) {
      for (let i = this.archs.length - 1; i >= 0; i--) {
        const a = this.archs[i];
        a.position.z += speed * delta;
        if (a.position.z > 22) { this.scene.remove(a); this.archs.splice(i, 1); }
      }
    }

    // Subtle life on the billboard crowd: a gentle walking bob (the bike and
    // pram bob less so they read as rolling rather than hopping), plus a
    // yaw-only billboard so each sprite pivots to face the camera (stays upright).
    const now = Date.now() * 0.001;
    const camX = this.camera ? this.camera.position.x : 0;
    const camZ = this.camera ? this.camera.position.z : 0;
    for (const p of this.people) {
      const amp = (p.type === 'cycle' || p.type === 'pram') ? 0.015 : 0.045;
      const sp = p.type === 'stroll' ? 4 : 6;
      p.g.position.y = p.baseY + Math.abs(Math.sin(now * sp + p.phase)) * amp;

      if (this.camera) {
        // Tiles only translate in z, so world pos = parent.z + local — no matrix math needed
        const pz = (p.g.parent ? p.g.parent.position.z : 0) + p.g.position.z;
        p.g.rotation.y = Math.atan2(camX - p.g.position.x, camZ - pz);
      }
    }

    // Billboard the static market props to face the camera too (no bob)
    if (this.camera) {
      for (const p of this.props) {
        const pz = (p.g.parent ? p.g.parent.position.z : 0) + p.g.position.z;
        p.g.rotation.y = Math.atan2(camX - p.g.position.x, camZ - pz);
      }
    }
  }

  reset() {
    this.tiles.forEach((tile, i) => {
      tile.group.position.z = TILE_LENGTH / 2 - i * TILE_LENGTH;
    });
    this._spawnArches();
  }
}
