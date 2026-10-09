import * as THREE from 'three';

// A Nigerian police van that chases the keke after two hits — siren + flashing lights.
export class PoliceChaser {
  constructor(scene, gameManager, audioManager) {
    this.scene = scene;
    this.gm = gameManager;
    this.audio = audioManager;

    this.active = false;
    this.z = 8.4;           // distance behind the keke (toward the camera)
    this.startZ = 8.4;
    this.catchZ = 3.6;
    this.catchTime = 15;    // seconds to fully catch up if undisturbed

    this.group = this._build();
    this.group.visible = false;
    this.scene.add(this.group);
  }

  _build() {
    const g = new THREE.Group();
    const navy = new THREE.MeshLambertMaterial({ color: 0x14245C });
    const white = new THREE.MeshLambertMaterial({ color: 0xEFEFEF });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.7, 3.8), navy);
    body.position.y = 1.25; body.castShadow = true; g.add(body);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.42, 3.84), white);
    stripe.position.y = 1.05; g.add(stripe);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.0, 1.5),
      new THREE.MeshLambertMaterial({ color: 0x0A1530 }));
    cab.position.set(0, 2.0, -1.0); g.add(cab);

    const wind = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.72, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x9BC4DE, transparent: true, opacity: 0.85 }));
    wind.position.set(0, 2.0, -1.76); g.add(wind);

    [-0.85, 0.85].forEach(x => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.1),
        new THREE.MeshBasicMaterial({ color: 0xFFFFCC }));
      hl.position.set(x, 0.95, -1.92); g.add(hl);
    });

    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    [[-1.15, -1.1], [1.15, -1.1], [-1.15, 1.3], [1.15, 1.3]].forEach(([x, z]) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.32, 10), wheelMat);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.52, z); g.add(w);
    });

    // Light bar
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.26, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x202020 }));
    bar.position.set(0, 2.25, 0); g.add(bar);
    this.redLight = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.24, 0.56),
      new THREE.MeshBasicMaterial({ color: 0xFF2222 }));
    this.redLight.position.set(-0.48, 2.25, 0); g.add(this.redLight);
    this.blueLight = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.24, 0.56),
      new THREE.MeshBasicMaterial({ color: 0x2233FF }));
    this.blueLight.position.set(0.48, 2.25, 0); g.add(this.blueLight);

    return g;
  }

  activate(player) {
    if (this.active) return;
    this.active = true;
    this.z = this.startZ;
    this.group.position.set(player ? player.currentX * 0.7 : 0, 0, this.z);
    this.group.visible = true;
    if (this.audio.startSiren) this.audio.startSiren();
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
    if (this.audio.stopSiren) this.audio.stopSiren();
  }

  // Getting hit lets you gain a little ground on the police
  onPlayerHit() {
    if (this.active) this.z = Math.min(this.z + 2.2, this.startZ);
  }

  update(delta, player) {
    if (!this.active) return;

    // Flashing red/blue light bar
    const phase = Math.floor(Date.now() / 170) % 2;
    this.redLight.material.color.setHex(phase ? 0x5A0000 : 0xFF3030);
    this.blueLight.material.color.setHex(phase ? 0x000060 : 0x3344FF);

    // Close the gap over time; weave to the player's lane
    this.z -= ((this.startZ - this.catchZ) / this.catchTime) * delta;
    const targetX = player.currentX * 0.7;
    this.group.position.x += (targetX - this.group.position.x) * Math.min(1, delta * 3);
    this.group.position.z = this.z;
    this.group.position.y = Math.sin(Date.now() * 0.02) * 0.04;
    this.group.rotation.y = (targetX - this.group.position.x) * 0.04;

    // Caught!
    if (this.z <= this.catchZ) {
      this.deactivate();
      this.gm.caughtByPoliceChaser();
    }
  }

  reset() {
    this.deactivate();
  }
}
