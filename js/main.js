import * as THREE from 'three';
import { GameManager } from './core/GameManager.js';
import { InputManager } from './core/InputManager.js';
import { AudioManager } from './core/AudioManager.js';
import { Player } from './entities/Player.js';
import { PoliceChaser } from './entities/PoliceChaser.js';
import { Road } from './world/Road.js';
import { ObstacleManager } from './managers/ObstacleManager.js';
import { CoinManager } from './managers/CoinManager.js';
import { PowerUpManager } from './managers/PowerUpManager.js';
import { ShopManager } from './managers/ShopManager.js';
import { MissionManager } from './managers/MissionManager.js';
import { UIManager } from './ui/UIManager.js';

// ─── Three.js Setup ────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8FC4E8);
scene.fog = new THREE.Fog(0xDCCBA6, 80, 230);

// ─── Gradient sky dome (bright tropical sky) ───────────────────
const skyGeo = new THREE.SphereGeometry(320, 24, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    top:      { value: new THREE.Color(0x4FA3DD) },
    middle:   { value: new THREE.Color(0xA4D6F2) },
    bottom:   { value: new THREE.Color(0xF1F8FC) },
    offset:   { value: 25.0 },
    exponent: { value: 0.8 }
  },
  vertexShader: `
    varying vec3 vW;
    void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    varying vec3 vW; uniform vec3 top; uniform vec3 middle; uniform vec3 bottom;
    uniform float offset; uniform float exponent;
    void main(){
      float h = normalize(vW + vec3(0.0, offset, 0.0)).y;
      float t = pow(clamp(h, 0.0, 1.0), exponent);
      vec3 col = h < 0.5 ? mix(bottom, middle, smoothstep(0.0,0.5,h+0.5))
                         : mix(middle, top, smoothstep(0.5,1.0,t));
      gl_FragColor = vec4(col, 1.0);
    }`
});
const skyDome = new THREE.Mesh(skyGeo, skyMat);
scene.add(skyDome);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 7, 14);
camera.lookAt(0, 1, -8);

const clock = new THREE.Clock();

// ─── Game Systems ───────────────────────────────────────────────
const gm      = new GameManager();
const input   = new InputManager();
const audio   = new AudioManager();
const road    = new Road(scene, camera);
const player  = new Player(scene, gm, audio);
const police  = new PoliceChaser(scene, gm, audio);
const obsMgr  = new ObstacleManager(scene, gm, audio);
const coinMgr = new CoinManager(scene, gm, audio);
const puMgr   = new PowerUpManager(scene, gm, audio);
const shopMgr = new ShopManager(scene, gm);
const missions = new MissionManager(gm);
const ui      = new UIManager(gm, audio, missions);

gm.loadProgress();

// ─── Input → Player ────────────────────────────────────────────
input.on('swipeLeft',    () => { if (gm.state === 'PLAYING') player.swipeLeft(); });
input.on('swipeRight',   () => { if (gm.state === 'PLAYING') player.swipeRight(); });
input.on('swipeUp',      () => { if (gm.state === 'PLAYING') player.jump(); });
input.on('swipeDown',    () => { if (gm.state === 'PLAYING') player.slide(); });
input.on('swipeFarLeft', () => { if (gm.state === 'PLAYING') player.swipeFarLeft(); });
input.on('swipeFarRight',() => { if (gm.state === 'PLAYING') player.swipeFarRight(); });
input.on('pause',        () => { if (gm.state === 'PLAYING') gm.pause(); else if (gm.state === 'PAUSED') gm.resume(); });

// ─── State change → Reset world ────────────────────────────────
gm.on('stateChanged', (state) => {
  audio.playStateMusic(state.music);
  road.reset();
  obsMgr.reset();
  coinMgr.reset();
  puMgr.reset();
  shopMgr.reset();
  police.reset();
});

// Swap roadside art set + skyline to the entered state (Adamawa etc.)
gm.on('stateChanged', (s) => road.setState(s));

gm.on('gameStarted', () => {
  road.reset();
  obsMgr.reset();
  coinMgr.reset();
  puMgr.reset();
  shopMgr.reset();
  police.reset();
  player.currentLane = 1;
  player.targetX = 0;
  player.currentX = 0;
  player.group.position.set(0, 0.6, 0);
  player.setVehicle(gm.vehicle); // swap to the equipped vehicle's art
  // Wider vehicles (danfo, bolekaja) get a wider hitbox; slim okada a narrower one
  player.hitboxSize.x = 1.2 * (gm.vehicleData.width / 0.9);
  audio.playStateMusic(gm.currentState.music);
});

// ─── Police chase (after two hits) ─────────────────────────────
// Equipping a vehicle in the garage updates the player art immediately
gm.on('vehicleSelected', () => player.setVehicle(gm.vehicle));

gm.on('policeChaseStarted', () => { police.activate(player); document.body.classList.add('police-chase'); });
gm.on('policeChaseEnded',   () => { police.deactivate(); document.body.classList.remove('police-chase'); });
gm.on('playerHurt',         () => { police.onPlayerHit(); });
gm.on('playerCaught',       () => { police.deactivate(); document.body.classList.remove('police-chase'); });
gm.on('gameOver',           () => { police.deactivate(); document.body.classList.remove('police-chase'); });

// ─── Camera controller (with screen shake) ────────────────────
let camTargetX = 0;
let shakeMag = 0;
const CAM_HEIGHT = 7;
const CAM_Z_OFFSET = 14;
function addShake(m) { shakeMag = Math.min(shakeMag + m, 1.4); }

function updateCamera(delta) {
  camTargetX += (player.currentX - camTargetX) * delta * 6;
  camera.position.x += (camTargetX - camera.position.x) * delta * 5;
  camera.position.y = CAM_HEIGHT;
  camera.position.z = CAM_Z_OFFSET;
  if (shakeMag > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shakeMag;
    camera.position.y += (Math.random() - 0.5) * shakeMag;
    shakeMag = Math.max(0, shakeMag - delta * 4.5);
  }
  camera.lookAt(player.currentX * 0.5, 1.5, -8);
}

// ─── Juice: screen shake + red hit flash on damage ────────────
function hitFlash() {
  document.body.classList.add('hit-flash');
  setTimeout(() => document.body.classList.remove('hit-flash'), 260);
}
gm.on('playerHurt',   () => { addShake(0.55); hitFlash(); });
gm.on('playerCaught', () => { addShake(1.1);  hitFlash(); });

// ─── Particle System (coin collect sparks) ─────────────────────
const particleGeo = new THREE.BufferGeometry();
const particleCount = 200;
const positions = new Float32Array(particleCount * 3);
const particleGeoAttr = particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particleMat = new THREE.PointsMaterial({ color: 0xFFD700, size: 0.15, transparent: true, opacity: 0.8 });
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

let particleData = Array.from({ length: particleCount }, () => ({
  active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0
}));

function spawnParticles(x, y, z) {
  for (let i = 0; i < 8; i++) {
    const p = particleData.find(p => !p.active);
    if (!p) return;
    p.active = true;
    p.pos.set(x, y, z);
    p.vel.set((Math.random() - 0.5) * 3, Math.random() * 4 + 1, (Math.random() - 0.5) * 2);
    p.life = 0.5 + Math.random() * 0.3;
  }
}

function updateParticles(delta) {
  particleData.forEach((p, i) => {
    if (!p.active) {
      positions[i * 3] = 999; positions[i * 3 + 1] = 999; positions[i * 3 + 2] = 999;
      return;
    }
    p.vel.y -= 8 * delta;
    p.pos.addScaledVector(p.vel, delta);
    p.life -= delta;
    if (p.life <= 0) p.active = false;
    positions[i * 3] = p.pos.x;
    positions[i * 3 + 1] = p.pos.y;
    positions[i * 3 + 2] = p.pos.z;
  });
  particleGeo.attributes.position.needsUpdate = true;
}

gm.on('coinCollected', () => {
  spawnParticles(player.currentX, player.currentY + 0.5, 0);
});

// ─── Near-miss juice: speed-line pulse + spark + tiny shake ─────
let nearMissBoost = 0;
gm.on('nearMiss', ({ intensity }) => {
  nearMissBoost = Math.min(0.55, nearMissBoost + 0.4 * intensity);
  addShake(0.14 * intensity);
  spawnParticles(player.currentX, player.currentY + 0.4, 0);
});

// ─── Special Effects: Tunnel / Blackout ────────────────────────
let blackoutTimer = 0;
const blackoutOverlay = document.getElementById('blackout-overlay');

gm.on('stateChanged', (state) => {
  if (state.special?.type === 'dark_tunnel') {
    blackoutTimer = 5;
    if (blackoutOverlay) {
      blackoutOverlay.style.opacity = '1';
      setTimeout(() => { blackoutOverlay.style.opacity = '0'; }, 5000);
    }
  }
  if (state.special?.type === 'power_outage') {
    blackoutTimer = 3;
    if (blackoutOverlay) {
      blackoutOverlay.style.opacity = '0.95';
      setTimeout(() => { blackoutOverlay.style.opacity = '0'; }, 3000);
    }
  }
});

// ─── Multiplier display ────────────────────────────────────────
let lastMult = 1;
function checkMultiplier() {
  if (gm.multiplier !== lastMult) {
    lastMult = gm.multiplier;
    gm.emit('multiplierChanged', gm.multiplier);
  }
}

// ─── Main Game Loop ────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (gm.state === 'PLAYING') {
    gm.update(delta);
    player.update(delta);
    road.update(delta, gm.speed, gm.currentState.theme);
    obsMgr.update(delta, gm.speed, player, gm.currentState);
    coinMgr.update(delta, gm.speed, player);
    puMgr.update(delta, gm.speed, player);
    shopMgr.update(delta, gm.speed, player);
    police.update(delta, player);
    updateCamera(delta);
    updateParticles(delta);
    checkMultiplier();
    if (nearMissBoost > 0) nearMissBoost = Math.max(0, nearMissBoost - delta * 1.6);
    if (speedLinesEl) {
      const fromSpeed = Math.max(0, Math.min(0.5, (gm.speed - 30) / 130));
      speedLinesEl.style.opacity = Math.min(0.7, fromSpeed + nearMissBoost).toFixed(2);
    }
  } else if (speedLinesEl) {
    speedLinesEl.style.opacity = '0';
  }

  renderer.render(scene, camera);
}
const speedLinesEl = document.getElementById('speed-lines');

// ─── Resize handler ────────────────────────────────────────────
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ─── Volume control (menu) ─────────────────────────────────────
const volSlider = document.getElementById('volume-slider');
const muteBtn = document.getElementById('btn-mute');
function updateMuteIcon() {
  if (!muteBtn) return;
  const lvl = audio.muted ? 0 : audio.masterVolume;
  muteBtn.textContent = lvl === 0 ? '🔇' : (lvl < 0.5 ? '🔉' : '🔊');
}
if (volSlider) {
  volSlider.value = Math.round(audio.masterVolume * 100);
  updateMuteIcon();
  volSlider.addEventListener('input', () => {
    audio.resume();
    audio.setMasterVolume(volSlider.value / 100);
    updateMuteIcon();
  });
}
if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    audio.resume();
    audio.toggleMute();
    updateMuteIcon();
  });
}

// ─── Flashing service banner (tap to enter the service) ───────
const serviceBanner = document.getElementById('service-banner');
shopMgr.onApproach = (type, shop) => {
  serviceBanner.innerHTML =
    `${shop.icon} ${shop.name} ahead &nbsp;<span class="sb-cta">TAP TO ENTER ›</span>`;
  serviceBanner.style.display = 'flex';
};
shopMgr.onPass = () => { serviceBanner.style.display = 'none'; };
serviceBanner.addEventListener('click', () => shopMgr.enterActiveShop());
window.shopMgr = shopMgr; window.gm = gm; window.player = player; window.police = police; window.obsMgr = obsMgr; window.road = road; window.input = input; window.ui = ui; // debug/testing hooks

// ─── Unlock audio + start lively menu music on first interaction ─
function startAudio() {
  audio.resume();
  if (gm.state !== 'PLAYING' && !audio.currentMusic) audio.playStateMusic('afrobeats_lagos');
}
document.addEventListener('click', startAudio, { once: true });
document.addEventListener('touchstart', startAudio, { once: true });

// ─── Start ─────────────────────────────────────────────────────
animate();
console.log('%c🏍️ MONKEY KEKE DASH LOADED!', 'color:#FFD700;font-size:20px;font-weight:bold;background:#111;padding:8px 16px;');
console.log('%cSwipe Left/Right to change lane | W/↑ Jump | S/↓ Slide | Q = Risky Lane', 'color:#FFFFFF;background:#333;padding:4px 8px;');
