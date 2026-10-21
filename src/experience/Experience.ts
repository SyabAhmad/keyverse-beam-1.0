import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { KEY_ROWS, WORLD_NAMES } from './keys';
import { AudioEngine } from './audio';

// ---------- easing ----------
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeInOutQuart = (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) => out.set(lerp(a.x,b.x,t), lerp(a.y,b.y,t), lerp(a.z,b.z,t));

export interface KeyData {
  id: string;
  label: string;
  world: string;
  row: number;
  col: number;
  width: number;
  x: number; y: number; z: number;
  mesh: THREE.Mesh;
  cap: THREE.Mesh;
  labelPlane: THREE.Mesh;
  hoverLabel: THREE.Sprite;
  glow: THREE.Mesh;
  baseColor: THREE.Color;
  emissiveBase: THREE.Color;
  pressed: number; // 0..1
  hoverAmount: number;
}

interface World {
  scene: THREE.Scene;
  entryPos: THREE.Vector3;
  entryTarget: THREE.Vector3;
  defaultPos: THREE.Vector3;
  defaultTarget: THREE.Vector3;
  update: (dt: number, elapsed: number) => void;
  dispose?: () => void;
}

export type AppState = 'loading' | 'intro' | 'ready' | 'transitionIn' | 'world' | 'transitionOut';

export class Experience {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  keyboardScene: THREE.Scene;
  keyboardGroup: THREE.Group;
  keys: KeyData[] = [];
  dust!: THREE.Points;
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  audio = new AudioEngine();

  state: AppState = 'loading';
  stateStart = 0;
  now = 0;
  currentWorld: string | null = null;
  selectedKey: KeyData | null = null;
  hoverKey: KeyData | null = null;

  worlds = new Map<string, World>();
  worldElapsed = 0;

  // camera saved
  defaultCamPos = new THREE.Vector3(0, 4.2, 7.5);
  defaultCamTarget = new THREE.Vector3(0, 0, 0);
  currentCamTarget = new THREE.Vector3(0, 0, 0);

  // transition data
  transitionStartCamPos = new THREE.Vector3();
  transitionStartCamTarget = new THREE.Vector3();
  keyWorldPos = new THREE.Vector3();

  reducedMotion = false;
  onStateChange?: (s: AppState, world: string | null) => void;
  onHoverLabel?: (key: KeyData | null) => void;

  // flash overlay element
  flashEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 200);
    this.camera.position.copy(this.defaultCamPos);
    this.camera.lookAt(this.defaultCamTarget);

    this.keyboardScene = new THREE.Scene();
    this.keyboardScene.background = new THREE.Color(0x05060f);
    this.keyboardScene.fog = new THREE.Fog(0x05060f, 8, 22);

    this.keyboardGroup = new THREE.Group();
    this.keyboardScene.add(this.keyboardGroup);

    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#fff;opacity:0;transition:none;z-index:5;';
    document.body.appendChild(this.flashEl);

    this.buildLights();
    this.buildKeyboard();
    this.buildDust();

    this.bindEvents();
    window.addEventListener('resize', this.onResize);

    // loading -> intro
    setTimeout(() => this.setState('intro'), 600);
  }

  private buildLights() {
    const amb = new THREE.AmbientLight(0x334466, 0.4);
    this.keyboardScene.add(amb);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(5, 8, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 50;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    this.keyboardScene.add(keyLight);

    // colored rim lights
    const rim1 = new THREE.PointLight(0x00ffff, 1.2, 20);
    rim1.position.set(-6, 3, -4);
    this.keyboardScene.add(rim1);
    const rim2 = new THREE.PointLight(0xff00ff, 1.0, 20);
    rim2.position.set(6, 2, -3);
    this.keyboardScene.add(rim2);
    const rim3 = new THREE.PointLight(0xffaa00, 0.8, 20);
    rim3.position.set(0, 2, 6);
    this.keyboardScene.add(rim3);
  }

  private buildKeyboard() {
    // plate
    const plateW = 18;
    const plateH = 6.5;
    const plateGeo = new THREE.BoxGeometry(plateW, 0.4, plateH);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.85, roughness: 0.35 });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.y = -0.2;
    plate.receiveShadow = true;
    this.keyboardGroup.add(plate);

    // frame border
    const frameGeo = new THREE.BoxGeometry(plateW + 0.3, 0.5, plateH + 0.3);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f1020, metalness: 0.9, roughness: 0.2, emissive: 0x0a0a1f, emissiveIntensity: 0.3 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = -0.25;
    this.keyboardGroup.add(frame);

    // layout positions
    const unit = 1.0;
    const gap = 0.12;
    let y = plateH / 2 - 0.7;
    KEY_ROWS.forEach((row, ri) => {
      // compute row width
      let totalW = 0;
      row.keys.forEach(k => { totalW += (k.width || 1) * unit + gap; });
      totalW -= gap;
      let x = -totalW / 2;
      row.keys.forEach((k, ci) => {
        const w = (k.width || 1) * unit;
        const cx = x + w / 2;
        this.createKey(k.label, k.world || 'void', ri, ci, w, cx, y);
        x += w + gap;
      });
      y -= 1.05;
    });
  }

  private createKey(label: string, world: string, row: number, col: number, width: number, x: number, y: number) {
    const depth = 1.0;
    const capH = 0.32;
    const geo = new RoundedBoxGeometry(width - 0.08, capH, depth - 0.08, 4, 0.08);
    // color gradient
    const xn = (x / 9);
    const yn = (row / 5);
    // map to cyan/purple/pink/orange/blue: use hue ranges
    const h = (0.55 + xn * 0.35 + yn * 0.2) % 1;
    const color = new THREE.Color().setHSL(h, 0.75, 0.55);
    const emissive = new THREE.Color().setHSL(h, 0.9, 0.35);

    const mat = new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: 0.35,
      metalness: 0.25, roughness: 0.4,
    });
    const cap = new THREE.Mesh(geo, mat);
    cap.position.set(x, 0.18, y);
    cap.castShadow = true;
    cap.receiveShadow = true;
    this.keyboardGroup.add(cap);

    // glow shell
    const glowGeo = new RoundedBoxGeometry(width - 0.04, capH + 0.06, depth - 0.04, 4, 0.1);
    const glowMat = new THREE.MeshBasicMaterial({ color: emissive, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(cap.position);
    this.keyboardGroup.add(glow);

    // label plane on top
    const labelTex = makeLabelTexture(label);
    const labelGeo = new THREE.PlaneGeometry(width * 0.7, 0.35);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, opacity: 0.9, depthWrite: false });
    const labelPlane = new THREE.Mesh(labelGeo, labelMat);
    labelPlane.rotation.x = -Math.PI / 2;
    labelPlane.position.set(x, 0.18 + capH / 2 + 0.01, y);
    this.keyboardGroup.add(labelPlane);

    // hover world label sprite
    const hoverTex = makeHoverTexture(WORLD_NAMES[world] || world);
    const spriteMat = new THREE.SpriteMaterial({ map: hoverTex, transparent: true, opacity: 0, depthWrite: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.set(x, 0.9, y);
    this.keyboardGroup.add(sprite);

    const key: KeyData = {
      id: label + '_' + row + '_' + col,
      label, world, row, col, width, x, y, z: 0,
      mesh: cap, cap, labelPlane, hoverLabel: sprite, glow,
      baseColor: color.clone(), emissiveBase: emissive.clone(),
      pressed: 0, hoverAmount: 0,
    };
    cap.userData.key = key;
    glow.userData.key = key;
    this.keys.push(key);
  }

  private buildDust() {
    const count = 600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x88aaff, size: 0.03, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.dust = new THREE.Points(geo, mat);
    this.keyboardScene.add(this.dust);
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('click', this.onClick);
  }

  onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  onPointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (this.state === 'ready' || this.state === 'intro') {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const meshes = this.keys.map(k => k.cap);
      const hits = this.raycaster.intersectObjects(meshes);
      const newHover = hits.length ? (hits[0].object.userData.key as KeyData) : null;
      if (newHover !== this.hoverKey) {
        if (newHover) this.audio.hover();
        this.hoverKey = newHover;
        this.onHoverLabel?.(newHover);
      }
    }
  };

  onPointerDown = (_e: PointerEvent) => {
    this.audio.ensure();
  };

  onClick = (e: MouseEvent) => {
    if (this.state !== 'ready' && this.state !== 'intro') return;
    // allow after intro
    if (this.state === 'intro') return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.keys.map(k => k.cap);
    const hits = this.raycaster.intersectObjects(meshes);
    if (hits.length) {
      const key = hits[0].object.userData.key as KeyData;
      this.startTransitionIn(key);
    }
  };

  setState(s: AppState) {
    this.state = s;
    this.stateStart = this.now;
    if (s === 'world') this.worldElapsed = 0;
    this.onStateChange?.(s, this.currentWorld);
  }

  startTransitionIn(key: KeyData) {
    this.selectedKey = key;
    this.currentWorld = key.world === 'void' ? 'void' : key.world;
    if (key.world === 'void') this.currentWorld = 'void';
    // ensure world built
    if (!this.worlds.has(this.currentWorld)) {
      const w = this.buildWorld(this.currentWorld);
      this.worlds.set(this.currentWorld, w);
    }
    this.audio.ensure();
    this.audio.click();
    this.audio.whoosh();
    // key world pos
    const kp = key.cap.position.clone();
    this.keyboardGroup.localToWorld(kp);
    this.keyWorldPos.copy(kp);
    // transition start cam
    this.transitionStartCamPos.copy(this.camera.position);
    this.transitionStartCamTarget.copy(this.currentCamTarget);
    this.setState('transitionIn');
  }

  startTransitionOut() {
    this.audio.returnSound();
    const w = this.currentWorld ? this.worlds.get(this.currentWorld) : null;
    if (w) {
      this.transitionStartCamPos.copy(this.camera.position);
      this.transitionStartCamTarget.copy(this.currentCamTarget);
    }
    this.setState('transitionOut');
  }

  update = (dt: number) => {
    this.now += dt;
    const t = this.now - this.stateStart;

    // idle float for keyboard
    if (this.state === 'intro' || this.state === 'ready') {
      const s = this.now;
      this.keyboardGroup.position.y = Math.sin(s * 0.6) * 0.08;
      this.keyboardGroup.rotation.x = Math.sin(s * 0.4) * 0.03;
      this.keyboardGroup.rotation.y = Math.sin(s * 0.25) * 0.06;
      this.dust.rotation.y = s * 0.02;
    }

    // hover handling visual
    this.keys.forEach(k => {
      const targetHover = (this.hoverKey === k) ? 1 : 0;
      k.hoverAmount += (targetHover - k.hoverAmount) * Math.min(1, dt * 12);
      // pressed
      const targetPressed = (this.selectedKey === k && (this.state === 'transitionIn' && t < 0.4)) ? 1 : 0;
      // during transitionIn press; reset later
      // We'll handle pressed in transition
    });

    switch (this.state) {
      case 'loading':
        break;
      case 'intro': {
        const dur = this.reducedMotion ? 0.8 : 3.0;
        const p = clamp01(t / dur);
        const e = easeInOutCubic(p);
        const start = new THREE.Vector3(0, 10, 16);
        lerpV(start, this.defaultCamPos, e, this.camera.position);
        const tgt = new THREE.Vector3(0, 0, 0);
        lerpV(tgt, this.defaultCamTarget, e, this.currentCamTarget);
        this.camera.lookAt(this.currentCamTarget);
        if (p >= 1) this.setState('ready');
        break;
      }
      case 'ready': {
        // hover visuals
        this.keys.forEach(k => {
          const h = k.hoverAmount;
          const lift = h * 0.15;
          k.cap.position.y = 0.18 + lift;
          k.glow.position.y = 0.18 + lift;
          k.labelPlane.position.y = 0.18 + 0.16 + lift;
          k.hoverLabel.position.y = 0.9 + lift;
          const mat = k.cap.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.35 + h * 0.9;
          (k.glow.material as THREE.MeshBasicMaterial).opacity = h * 0.5;
          (k.hoverLabel.material as THREE.SpriteMaterial).opacity = h * 0.95;
        });
        // light travel across rows (subtle emissive pulse)
        const pulse = (Math.sin(this.now * 1.2) + 1) * 0.5;
        // apply to a few keys? skip heavy
        break;
      }
      case 'transitionIn': {
        const dur = this.reducedMotion ? 1.2 : 2.6;
        // Phase 0-0.4: key press + illuminate + ripple
        // Phase 0.2-0.9: camera push
        // Phase 0.8-1.1: keycap separate + portal
        // Phase 1.0-1.1: flash + swap
        // Phase 1.05-2.0: world entry
        // After dur: world
        const p = clamp01(t / dur);

        // key press
        const pressT = clamp01(t / 0.35);
        const pressE = easeOutCubic(pressT);
        if (this.selectedKey) {
          const k = this.selectedKey;
          const baseY = 0.18;
          const pressedY = 0.05;
          k.cap.position.y = lerp(baseY, pressedY, pressE) + (pressT >= 1 ? 0 : 0);
          k.glow.position.y = k.cap.position.y;
          const mat = k.cap.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.35 + pressE * 2.5;
          (k.glow.material as THREE.MeshBasicMaterial).opacity = 0.3 + pressE * 0.7;
          // ripple to neighbors
          const kx = k.x, ky = k.y;
          this.keys.forEach(other => {
            if (other === k) return;
            const dist = Math.hypot(other.x - kx, other.y - ky);
            const ripple = Math.max(0, 1 - dist / 6);
            const wave = Math.sin((t * 8) - dist * 1.5) * 0.5 + 0.5;
            const amt = ripple * wave * Math.max(0, 1 - t / 0.8);
            const om = other.cap.material as THREE.MeshStandardMaterial;
            om.emissiveIntensity = 0.35 + amt * 1.5;
          });
          // keycap separation after 0.8
          if (t > 0.8) {
            const sepT = clamp01((t - 0.8) / 0.3);
            const sepE = easeOutCubic(sepT);
            k.cap.position.y = lerp(0.05, 0.9, sepE);
            k.cap.scale.setScalar(1 + sepE * 0.2);
            (k.cap.material as THREE.MeshStandardMaterial).opacity = 1 - sepE * 0.6;
            (k.cap.material as THREE.MeshStandardMaterial).transparent = true;
          }
        }

        // camera push 0.15 -> 1.0
        if (t > 0.15) {
          const camT = clamp01((t - 0.15) / 0.9);
          const camE = easeInOutQuart(camT);
          const targetPos = this.keyWorldPos.clone().add(new THREE.Vector3(0, 0.6, 1.2));
          lerpV(this.transitionStartCamPos, targetPos, camE, this.camera.position);
          const targetTgt = this.keyWorldPos.clone();
          lerpV(this.transitionStartCamTarget, targetTgt, camE, this.currentCamTarget);
          this.camera.lookAt(this.currentCamTarget);
        }

        // flash + swap at ~1.0
        if (t > 0.95 && t < 0.96 + dt * 2) {
          this.flashEl.style.opacity = '1';
          // swap to world scene handling in render via activeScene flag
          this.activeWorldScene = true;
          // set camera to world entry
          const w = this.worlds.get(this.currentWorld!)!;
          this.camera.position.copy(w.entryPos);
          this.currentCamTarget.copy(w.entryTarget);
          this.camera.lookAt(this.currentCamTarget);
          // ambient
          this.audio.startAmbient(this.currentWorld!);
          this.audio.portal();
        }
        // fade flash out
        if (t > 0.96) {
          const f = clamp01((t - 0.96) / 0.4);
          this.flashEl.style.opacity = String(1 - easeOutCubic(f));
        }
        // world camera move after swap
        if (t > 1.05) {
          const w = this.worlds.get(this.currentWorld!)!;
          const wt = clamp01((t - 1.05) / 1.2);
          const we = easeInOutCubic(wt);
          const curPos = this.camera.position.clone();
          // lerp from entry to default
          const newPos = new THREE.Vector3();
          lerpV(w.entryPos, w.defaultPos, we, newPos);
          this.camera.position.copy(newPos);
          const newTgt = new THREE.Vector3();
          lerpV(w.entryTarget, w.defaultTarget, we, newTgt);
          this.currentCamTarget.copy(newTgt);
          this.camera.lookAt(this.currentCamTarget);
        }

        if (t >= dur) {
          // finalize
          this.activeWorldScene = true;
          const w = this.worlds.get(this.currentWorld!)!;
          this.camera.position.copy(w.defaultPos);
          this.currentCamTarget.copy(w.defaultTarget);
          this.camera.lookAt(this.currentCamTarget);
          // reset selected key visuals partially
          if (this.selectedKey) {
            const k = this.selectedKey;
            (k.cap.material as THREE.MeshStandardMaterial).transparent = false;
            (k.cap.material as THREE.MeshStandardMaterial).opacity = 1;
          }
          this.setState('world');
        }
        break;
      }
      case 'world': {
        this.worldElapsed += dt;
        const w = this.currentWorld ? this.worlds.get(this.currentWorld) : null;
        if (w) w.update(dt, this.worldElapsed);
        // gentle camera drift
        // (worlds handle their own)
        break;
      }
      case 'transitionOut': {
        const dur = this.reducedMotion ? 1.0 : 2.2;
        const p = clamp01(t / dur);
        const w = this.currentWorld ? this.worlds.get(this.currentWorld) : null;
        // camera pull back to entry/portal
        if (t < 0.7) {
          const pt = clamp01(t / 0.7);
          const pe = easeInOutCubic(pt);
          if (w) {
            const curPos = this.camera.position.clone();
            // lerp current -> entry
            const newPos = new THREE.Vector3();
            lerpV(this.transitionStartCamPos, w.entryPos, pe, newPos);
            this.camera.position.copy(newPos);
            const newTgt = new THREE.Vector3();
            lerpV(this.transitionStartCamTarget, w.entryTarget, pe, newTgt);
            this.currentCamTarget.copy(newTgt);
            this.camera.lookAt(this.currentCamTarget);
          }
        }
        // flash + swap at 0.65
        if (t > 0.6 && t < 0.62 + dt * 2) {
          this.flashEl.style.opacity = '1';
        }
        if (t > 0.62 && t < 0.64 + dt * 2) {
          this.activeWorldScene = false;
          // camera at key closeup
          if (this.selectedKey) {
            const targetPos = this.keyWorldPos.clone().add(new THREE.Vector3(0, 0.6, 1.2));
            this.camera.position.copy(targetPos);
            this.currentCamTarget.copy(this.keyWorldPos);
            this.camera.lookAt(this.currentCamTarget);
          }
          this.audio.stopAmbient();
        }
        if (t > 0.62) {
          const f = clamp01((t - 0.62) / 0.35);
          this.flashEl.style.opacity = String(1 - easeOutCubic(f));
        }
        // keycap descend + camera pull back 0.62 -> end
        if (t > 0.62 && this.selectedKey) {
          const k = this.selectedKey;
          const dt2 = clamp01((t - 0.62) / (dur - 0.62));
          const de = easeInOutCubic(dt2);
          k.cap.position.y = lerp(0.9, 0.18, de);
          k.cap.scale.setScalar(1 + (1 - de) * 0.2);
          const mat = k.cap.material as THREE.MeshStandardMaterial;
          mat.opacity = 1;
          mat.transparent = false;
          mat.emissiveIntensity = 0.35 + (1 - de) * 2;
          (k.glow.material as THREE.MeshBasicMaterial).opacity = (1 - de) * 0.6;
          // camera pull back
          const start = this.keyWorldPos.clone().add(new THREE.Vector3(0, 0.6, 1.2));
          lerpV(start, this.defaultCamPos, de, this.camera.position);
          const tgt = new THREE.Vector3(0, 0, 0);
          // lerp from key to default target
          const curTgt = this.keyWorldPos.clone();
          lerpV(curTgt, this.defaultCamTarget, de, this.currentCamTarget);
          this.camera.lookAt(this.currentCamTarget);
        }
        if (t >= dur) {
          // restore keyboard transforms
          if (this.selectedKey) {
            const k = this.selectedKey;
            k.cap.position.y = 0.18;
            k.glow.position.y = 0.18;
            (k.cap.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
            (k.glow.material as THREE.MeshBasicMaterial).opacity = 0;
          }
          this.keys.forEach(k => {
            const om = k.cap.material as THREE.MeshStandardMaterial;
            om.emissiveIntensity = 0.35;
          });
          this.selectedKey = null;
          this.currentWorld = null;
          this.setState('ready');
        }
        break;
      }
    }

    // update worlds if active (for ambient particles even when not viewing? only active scene)
    if (this.state === 'world' || this.state === 'transitionIn' || this.state === 'transitionOut') {
      // update current world animations during transitions too
      if (this.currentWorld) {
        const w = this.worlds.get(this.currentWorld);
        if (w) {
          // only update if scene active or transitioning
          w.update(dt, this.worldElapsed || t);
        }
      }
    }

    // dust animate
    this.dust.rotation.y += dt * 0.02;

    this.render();
  };

  activeWorldScene = false;

  render() {
    if (this.activeWorldScene && this.currentWorld) {
      const w = this.worlds.get(this.currentWorld);
      if (w) this.renderer.render(w.scene, this.camera);
      else this.renderer.render(this.keyboardScene, this.camera);
    } else {
      this.renderer.render(this.keyboardScene, this.camera);
    }
  }

  // ---------- world builders ----------
  buildWorld(id: string): World {
    switch (id) {
      case 'galaxy': return this.buildGalaxy();
      case 'ocean': return this.buildOcean();
      case 'cyber': return this.buildCyber();
      case 'forest': return this.buildForest();
      case 'lava': return this.buildLava();
      case 'hyperspace': return this.buildHyperspace();
      default: return this.buildVoid();
    }
  }

  // ---- Galaxy ----
  buildGalaxy(): World {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02020a);
    scene.fog = new THREE.Fog(0x02020a, 40, 120);
    // stars layers
    const makeStars = (count: number, size: number, spread: number, color: number) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i*3] = (Math.random()-0.5)*spread;
        pos[i*3+1] = (Math.random()-0.5)*spread;
        pos[i*3+2] = (Math.random()-0.5)*spread;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos,3));
      const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
      const p = new THREE.Points(g, m);
      scene.add(p);
      return p;
    };
    const s1 = makeStars(2000, 0.06, 60, 0xffffff);
    const s2 = makeStars(800, 0.1, 80, 0x88ccff);
    const s3 = makeStars(300, 0.15, 100, 0xffaadd);

    // nebula clouds (sprites)
    const nebulaColors = [0x4400aa, 0x0044aa, 0xaa0066];
    nebulaColors.forEach((c, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createRadialGradient(128,128,0,128,128,128);
      grad.addColorStop(0, 'rgba(255,255,255,0.6)');
      grad.addColorStop(0.4, 'rgba(180,120,255,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,256,256);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(40, 40, 1);
      sp.position.set((i-1)*15, (i%2)*8 - 4, -20 - i*8);
      scene.add(sp);
    });

    // planet
    const planetGeo = new THREE.SphereGeometry(4, 64, 64);
    const planetMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, emissive: 0x112244, emissiveIntensity: 0.4, roughness: 0.6, metalness: 0.1 });
    const planet = new THREE.Mesh(planetGeo, planetMat);
    planet.position.set(8, -2, -12);
    scene.add(planet);
    // planet glow
    const glowGeo = new THREE.SphereGeometry(4.6, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, side: THREE.BackSide });
    const planetGlow = new THREE.Mesh(glowGeo, glowMat);
    planetGlow.position.copy(planet.position);
    scene.add(planetGlow);

    // satellites
    const sats: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const sg = new THREE.SphereGeometry(0.25, 16, 16);
      const sm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88ccff, emissiveIntensity: 0.8 });
      const sat = new THREE.Mesh(sg, sm);
      scene.add(sat);
      sats.push(sat);
    }

    // distant galaxy (spiral sprite)
    const gCanvas = document.createElement('canvas');
    gCanvas.width = 256; gCanvas.height = 256;
    const gctx = gCanvas.getContext('2d')!;
    for (let i = 0; i < 2000; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.5) * 100;
      const x = 128 + Math.cos(ang) * r * 0.3 + (Math.random()-0.5)*4;
      const y = 128 + Math.sin(ang) * r * 0.3 + (Math.random()-0.5)*4;
      gctx.fillStyle = `rgba(200,180,255,${Math.random()*0.8})`;
      gctx.fillRect(x, y, 1, 1);
    }
    const gTex = new THREE.CanvasTexture(gCanvas);
    const gMat = new THREE.SpriteMaterial({ map: gTex, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
    const galaxySprite = new THREE.Sprite(gMat);
    galaxySprite.scale.set(30, 30, 1);
    galaxySprite.position.set(-25, 10, -50);
    scene.add(galaxySprite);

    // lights
    const pl = new THREE.PointLight(0x4488ff, 2, 40);
    pl.position.copy(planet.position);
    scene.add(pl);
    scene.add(new THREE.AmbientLight(0x223355, 0.3));

    const entryPos = new THREE.Vector3(0, 0, 6);
    const entryTarget = new THREE.Vector3(0, 0, -10);
    const defaultPos = new THREE.Vector3(0, 2, 8);
    const defaultTarget = new THREE.Vector3(0, 0, -5);

    let elapsed = 0;
    const update = (dt: number, t: number) => {
      elapsed = t;
      s1.rotation.y += dt * 0.02;
      s2.rotation.y -= dt * 0.015;
      s3.rotation.z += dt * 0.01;
      planet.rotation.y += dt * 0.15;
      planetGlow.rotation.y -= dt * 0.1;
      galaxySprite.rotation.z += dt * 0.05;
      sats.forEach((sat, i) => {
        const ang = t * (0.6 + i * 0.2) + i * 1.5;
        const r = 5.5 + i * 0.6;
        sat.position.set(
          planet.position.x + Math.cos(ang) * r,
          planet.position.y + Math.sin(ang * 0.7) * 1.5,
          planet.position.z + Math.sin(ang) * r
        );
      });
    };

    return { scene, entryPos, entryTarget, defaultPos, defaultTarget, update };
  }

  // ---- Ocean ----
  buildOcean(): World {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x001a2e);
    scene.fog = new THREE.Fog(0x001a2e, 15, 60);

    // seafloor
    const floorGeo = new THREE.PlaneGeometry(60, 60, 40, 40);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a3a2a, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -6;
    floor.receiveShadow = true;
    scene.add(floor);

    // coral formations
    const coralColors = [0xff6688, 0xff9944, 0x88ffaa, 0xff44aa];
    for (let i = 0; i < 18; i++) {
      const h = 1 + Math.random() * 2.5;
      const cg = new THREE.ConeGeometry(0.3 + Math.random() * 0.4, h, 8);
      const cm = new THREE.MeshStandardMaterial({ color: coralColors[i % coralColors.length], emissive: coralColors[i % coralColors.length], emissiveIntensity: 0.25, roughness: 0.6 });
      const coral = new THREE.Mesh(cg, cm);
      coral.position.set((Math.random()-0.5)*30, -6 + h/2, (Math.random()-0.5)*30);
      scene.add(coral);
    }

    // light shafts
    const shafts: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const sg = new THREE.ConeGeometry(1.2, 18, 16, 1, true);
      const sm = new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
      const shaft = new THREE.Mesh(sg, sm);
      shaft.position.set((i-3)*4 + (Math.random()-0.5)*2, 3, (Math.random()-0.5)*10);
      shaft.rotation.x = Math.PI;
      scene.add(shaft);
      shafts.push(shaft);
    }

    // bubbles
    const bCount = 400;
    const bPos = new Float32Array(bCount * 3);
    for (let i = 0; i < bCount; i++) {
      bPos[i*3] = (Math.random()-0.5)*30;
      bPos[i*3+1] = (Math.random()-0.5)*12;
      bPos[i*3+2] = (Math.random()-0.5)*30;
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    const bMat = new THREE.PointsMaterial({ color: 0xaaddff, size: 0.08, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    const bubbles = new THREE.Points(bGeo, bMat);
    scene.add(bubbles);

    // jellyfish
    const jellies: { mesh: THREE.Group; phase: number; base: THREE.Vector3 }[] = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 24, 0, Math.PI*2, 0, Math.PI/2), new THREE.MeshStandardMaterial({ color: 0xff88cc, emissive: 0xff44aa, emissiveIntensity: 0.6, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      bell.rotation.x = Math.PI;
      g.add(bell);
      // tentacles
      for (let t = 0; t < 6; t++) {
        const tg = new THREE.CylinderGeometry(0.02, 0.01, 2, 6);
        const tm = new THREE.MeshBasicMaterial({ color: 0xffaadd, transparent: true, opacity: 0.5 });
        const tent = new THREE.Mesh(tg, tm);
        tent.position.set(Math.cos(t)*0.5, -1, Math.sin(t)*0.5);
        g.add(tent);
      }
      const base = new THREE.Vector3((Math.random()-0.5)*20, (Math.random()-0.5)*6, (Math.random()-0.5)*20);
      g.position.copy(base);
      scene.add(g);
      jellies.push({ mesh: g, phase: Math.random()*Math.PI*2, base });
    }

    // whale (elongated)
    const whaleGeo = new THREE.CapsuleGeometry(1.2, 8, 16, 32);
    const whaleMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.7, emissive: 0x112233, emissiveIntensity: 0.15 });
    const whale = new THREE.Mesh(whaleGeo, whaleMat);
    whale.rotation.z = Math.PI / 2;
    scene.add(whale);

    // lights
    const sun = new THREE.DirectionalLight(0xaaddff, 1.2);
    sun.position.set(0, 15, 5);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x224466, 0.5));

    const entryPos = new THREE.Vector3(0, 0, 5);
    const entryTarget = new THREE.Vector3(0, -2, -8);
    const defaultPos = new THREE.Vector3(0, 2, 8);
    const defaultTarget = new THREE.Vector3(0, -1, -4);

    let wAngle = 0;
    const update = (dt: number, t: number) => {
      // bubbles rise
      const arr = bubbles.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < bCount; i++) {
        arr[i*3+1] += dt * 0.6;
        if (arr[i*3+1] > 8) arr[i*3+1] = -8;
      }
      bubbles.geometry.attributes.position.needsUpdate = true;
      // jellyfish drift
      jellies.forEach(j => {
        j.mesh.position.x = j.base.x + Math.sin(t*0.3 + j.phase)*2;
        j.mesh.position.y = j.base.y + Math.sin(t*0.5 + j.phase)*1.2;
        j.mesh.position.z = j.base.z + Math.cos(t*0.25 + j.phase)*2;
        j.mesh.rotation.y += dt * 0.2;
      });
      // whale swim
      wAngle += dt * 0.3;
      whale.position.set(Math.cos(wAngle)*18, -2 + Math.sin(wAngle*2)*0.5, Math.sin(wAngle)*18 - 10);
      whale.rotation.y = -wAngle + Math.PI/2;
      // light shafts shimmer
      shafts.forEach((s, i) => {
        (s.material as THREE.MeshBasicMaterial).opacity = 0.04 + Math.sin(t*0.7 + i)*0.03;
      });
    };

    return { scene, entryPos, entryTarget, defaultPos, defaultTarget, update };
  }

  // ---- Cyberpunk ----
  buildCyber(): World {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050010);
    scene.fog = new THREE.Fog(0x050010, 20, 80);

    // buildings
    const neonColors = [0x00ffff, 0xff00ff, 0xaa00ff, 0x00ffaa];
    const buildings: THREE.Mesh[] = [];
    for (let i = 0; i < 30; i++) {
      const w = 1.5 + Math.random() * 2;
      const h = 8 + Math.random() * 22;
      const d = 1.5 + Math.random() * 2;
      const bg = new THREE.BoxGeometry(w, h, d);
      const bm = new THREE.MeshStandardMaterial({ color: 0x0a0a1a, metalness: 0.6, roughness: 0.4, emissive: neonColors[i % neonColors.length], emissiveIntensity: 0.05 });
      const b = new THREE.Mesh(bg, bm);
      const side = i % 2 === 0 ? -1 : 1;
      b.position.set(side * (4 + Math.random() * 8), h / 2 - 6, (Math.random()-0.5)*40);
      scene.add(b);
      buildings.push(b);
      // window strips
      for (let j = 0; j < 4; j++) {
        const wg = new THREE.PlaneGeometry(w * 0.8, 0.15);
        const wm = new THREE.MeshBasicMaterial({ color: neonColors[(i+j)%neonColors.length], transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
        const win = new THREE.Mesh(wg, wm);
        win.position.set(b.position.x, b.position.y - h/2 + (j+1)*(h/5), b.position.z + d/2 + 0.01);
        scene.add(win);
      }
    }

    // ground (wet)
    const groundGeo = new THREE.PlaneGeometry(80, 80);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x050510, metalness: 0.9, roughness: 0.15, emissive: 0x110022, emissiveIntensity: 0.1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -6;
    scene.add(ground);

    // holographic ads
    const ads: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const ag = new THREE.PlaneGeometry(4, 2.5);
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 160;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = neonColors[i % neonColors.length].toString(16).padStart(6,'0');
      ctx.fillStyle = '#' + neonColors[i % neonColors.length].toString(16).padStart(6,'0');
      ctx.fillRect(0,0,256,160);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AD', 128, 90);
      const tex = new THREE.CanvasTexture(canvas);
      const am = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const ad = new THREE.Mesh(ag, am);
      ad.position.set((i%2===0?-1:1)*(6+Math.random()*4), 4 + Math.random()*6, (Math.random()-0.5)*20);
      scene.add(ad);
      ads.push(ad);
    }

    // rain
    const rCount = 1200;
    const rPos = new Float32Array(rCount * 3);
    for (let i = 0; i < rCount; i++) {
      rPos[i*3] = (Math.random()-0.5)*60;
      rPos[i*3+1] = Math.random()*30;
      rPos[i*3+2] = (Math.random()-0.5)*60;
    }
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
    const rMat = new THREE.PointsMaterial({ color: 0xaabbff, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false });
    const rain = new THREE.Points(rGeo, rMat);
    scene.add(rain);

    // flying vehicles
    const vehicles: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const vg = new THREE.BoxGeometry(0.6, 0.2, 0.3);
      const vm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00ffff, emissiveIntensity: 0.8 });
      const v = new THREE.Mesh(vg, vm);
      v.position.set((Math.random()-0.5)*20, 2 + Math.random()*8, (Math.random()-0.5)*30);
      scene.add(v);
      vehicles.push(v);
    }

    // lights
    scene.add(new THREE.AmbientLight(0x221133, 0.4));
    const pl1 = new THREE.PointLight(0x00ffff, 2, 30); pl1.position.set(-8, 5, 0); scene.add(pl1);
    const pl2 = new THREE.PointLight(0xff00ff, 2, 30); pl2.position.set(8, 5, 0); scene.add(pl2);

    const entryPos = new THREE.Vector3(0, 2, 6);
    const entryTarget = new THREE.Vector3(0, 0, -10);
    const defaultPos = new THREE.Vector3(0, 3, 10);
    const defaultTarget = new THREE.Vector3(0, 0, -5);

    const update = (dt: number, t: number) => {
      // rain fall
      const arr = rain.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < rCount; i++) {
        arr[i*3+1] -= dt * 12;
        if (arr[i*3+1] < -6) arr[i*3+1] = 24;
      }
      rain.geometry.attributes.position.needsUpdate = true;
      // ads flicker
      ads.forEach((a, i) => {
        (a.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(t*3 + i)*0.25;
        a.rotation.y = Math.sin(t*0.5 + i)*0.1;
      });
      // vehicles move
      vehicles.forEach((v, i) => {
        v.position.x += (i%2===0?1:-1) * dt * (2 + i*0.3);
        if (v.position.x > 20) v.position.x = -20;
        if (v.position.x < -20) v.position.x = 20;
        v.position.y += Math.sin(t*2 + i)*dt*0.5;
      });
      // buildings subtle emissive pulse
      buildings.forEach((b, i) => {
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05 + Math.sin(t*0.5 + i*0.3)*0.03;
      });
    };

    return { scene, entryPos, entryTarget, defaultPos, defaultTarget, update };
  }

  // ---- Forest ----
  buildForest(): World {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03100a);
    scene.fog = new THREE.Fog(0x03100a, 12, 50);

    // ground
    const gGeo = new THREE.PlaneGeometry(60, 60);
    const gMat = new THREE.MeshStandardMaterial({ color: 0x0a1f0a, roughness: 0.95 });
    const ground = new THREE.Mesh(gGeo, gMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -4;
    scene.add(ground);

    // trees (cylinders + cones)
    const trees: THREE.Group[] = [];
    for (let i = 0; i < 24; i++) {
      const tg = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 3, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }));
      trunk.position.y = 1.5;
      tg.add(trunk);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0x1a4a2a, emissive: 0x0a2a10, emissiveIntensity: 0.2, roughness: 0.8 }));
      leaves.position.y = 5;
      tg.add(leaves);
      tg.position.set((Math.random()-0.5)*30, -4, (Math.random()-0.5)*30);
      scene.add(tg);
      trees.push(tg);
    }

    // giant mushrooms
    const mushrooms: THREE.Group[] = [];
    const mColors = [0x88ffaa, 0xaa88ff, 0xffaa88];
    for (let i = 0; i < 8; i++) {
      const mg = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.5, 12), new THREE.MeshStandardMaterial({ color: 0xeeeedd, roughness: 0.7 }));
      stem.position.y = 0.75;
      mg.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 24, 0, Math.PI*2, 0, Math.PI/2), new THREE.MeshStandardMaterial({ color: mColors[i % mColors.length], emissive: mColors[i % mColors.length], emissiveIntensity: 0.5, roughness: 0.5 }));
      cap.rotation.x = Math.PI;
      cap.position.y = 1.5;
      mg.add(cap);
      mg.position.set((Math.random()-0.5)*18, -4, (Math.random()-0.5)*18);
      const s = 0.7 + Math.random() * 1.2;
      mg.scale.setScalar(s);
      scene.add(mg);
      mushrooms.push(mg);
    }

    // glowing plants (react to pointer - simple pulse)
    const plants: THREE.Mesh[] = [];
    for (let i = 0; i < 20; i++) {
      const pg = new THREE.SphereGeometry(0.15, 12, 12);
      const pm = new THREE.MeshStandardMaterial({ color: 0x44ff88, emissive: 0x44ff88, emissiveIntensity: 0.8 });
      const p = new THREE.Mesh(pg, pm);
      p.position.set((Math.random()-0.5)*24, -3.8, (Math.random()-0.5)*24);
      scene.add(p);
      plants.push(p);
    }

    // fireflies
    const fCount = 300;
    const fPos = new Float32Array(fCount * 3);
    for (let i = 0; i < fCount; i++) {
      fPos[i*3] = (Math.random()-0.5)*30;
      fPos[i*3+1] = (Math.random())*8 - 2;
      fPos[i*3+2] = (Math.random()-0.5)*30;
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    const fMat = new THREE.PointsMaterial({ color: 0xffff88, size: 0.08, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const fireflies = new THREE.Points(fGeo, fMat);
    scene.add(fireflies);

    // light stream (curve of particles)
    const curvePts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      curvePts.push(new THREE.Vector3(Math.sin(i*0.3)*4, (i/40)*6 - 2, i*0.8 - 16));
    }
    const curve = new THREE.CatmullRomCurve3(curvePts);
    const tubeGeo = new THREE.TubeGeometry(curve, 80, 0.08, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0x88ffcc, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const stream = new THREE.Mesh(tubeGeo, tubeMat);
    scene.add(stream);

    // floating particles
    const pCount = 200;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i*3] = (Math.random()-0.5)*30;
      pPos[i*3+1] = (Math.random())*8 - 2;
      pPos[i*3+2] = (Math.random()-0.5)*30;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0x88ffcc, size: 0.05, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    scene.add(new THREE.AmbientLight(0x112211, 0.4));
    const pl = new THREE.PointLight(0x44ff88, 1.5, 25); pl.position.set(0, 5, 0); scene.add(pl);

    const entryPos = new THREE.Vector3(0, 1, 5);
    const entryTarget = new THREE.Vector3(0, 1, -8);
    const defaultPos = new THREE.Vector3(0, 3, 9);
    const defaultTarget = new THREE.Vector3(0, 1, -3);

    const update = (dt: number, t: number) => {
      fireflies.rotation.y += dt * 0.05;
      const arr = fireflies.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < fCount; i++) {
        arr[i*3+1] += Math.sin(t*0.5 + i)*dt*0.1;
      }
      fireflies.geometry.attributes.position.needsUpdate = true;
      mushrooms.forEach((m, i) => {
        m.rotation.y += dt * 0.1;
        const pulse = 0.5 + Math.sin(t*1.2 + i)*0.3;
        ((m.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
      });
      plants.forEach((p, i) => {
        (p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(t*2 + i)*0.4;
      });
      (stream.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(t)*0.1;
    };

    return { scene, entryPos, entryTarget, defaultPos, defaultTarget, update };
  }

  // ---- Lava ----
  buildLava(): World {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0200);
    scene.fog = new THREE.Fog(0x0a0200, 10, 40);

    // core sphere
    const coreGeo = new THREE.SphereGeometry(3, 64, 64);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff2200, emissiveIntensity: 2.0, roughness: 0.4, metalness: 0.1 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);
    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(3.8, 32, 32), new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
    scene.add(coreGlow);

    // cracks on a surrounding shell
    const shellGeo = new THREE.SphereGeometry(6, 32, 32);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x1a0a05, roughness: 0.9, metalness: 0.2, emissive: 0x331100, emissiveIntensity: 0.2 });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    scene.add(shell);

    // lava cracks lines
    const cracks: THREE.Line[] = [];
    for (let i = 0; i < 20; i++) {
      const pts: THREE.Vector3[] = [];
      let ang = Math.random() * Math.PI * 2;
      let lat = (Math.random()-0.5)*Math.PI;
      for (let j = 0; j < 12; j++) {
        const r = 6.0;
        const x = r * Math.cos(lat) * Math.cos(ang);
        const y = r * Math.sin(lat);
        const z = r * Math.cos(lat) * Math.sin(ang);
        pts.push(new THREE.Vector3(x, y, z));
        ang += 0.3 + Math.random()*0.2;
        lat += (Math.random()-0.5)*0.3;
      }
      const cg = new THREE.BufferGeometry().setFromPoints(pts);
      const cm = new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.9 });
      const line = new THREE.Line(cg, cm);
      scene.add(line);
      cracks.push(line);
    }

    // floating rocks
    const rocks: THREE.Mesh[] = [];
    for (let i = 0; i < 15; i++) {
      const rg = new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.6, 0);
      const rm = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 });
      const rock = new THREE.Mesh(rg, rm);
      const r = 8 + Math.random() * 4;
      const ang = Math.random() * Math.PI * 2;
      const lat = (Math.random()-0.5)*Math.PI;
      rock.position.set(r*Math.cos(lat)*Math.cos(ang), r*Math.sin(lat), r*Math.cos(lat)*Math.sin(ang));
      rock.userData = { ang, lat, r, speed: 0.2 + Math.random()*0.3 };
      scene.add(rock);
      rocks.push(rock);
    }

    // sparks
    const spCount = 600;
    const spPos = new Float32Array(spCount * 3);
    for (let i = 0; i < spCount; i++) {
      spPos[i*3] = (Math.random()-0.5)*20;
      spPos[i*3+1] = (Math.random()-0.5)*20;
      spPos[i*3+2] = (Math.random()-0.5)*20;
    }
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
    const spMat = new THREE.PointsMaterial({ color: 0xffaa33, size: 0.06, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const sparks = new THREE.Points(spGeo, spMat);
    scene.add(sparks);

    scene.add(new THREE.AmbientLight(0x220800, 0.3));
    const pl = new THREE.PointLight(0xff4400, 3, 30); pl.position.set(0,0,0); scene.add(pl);

    const entryPos = new THREE.Vector3(0, 0, 8);
    const entryTarget = new THREE.Vector3(0, 0, 0);
    const defaultPos = new THREE.Vector3(6, 4, 8);
    const defaultTarget = new THREE.Vector3(0, 0, 0);

    const update = (dt: number, t: number) => {
      core.rotation.y += dt * 0.3;
      coreGlow.scale.setScalar(1 + Math.sin(t*2)*0.05);
      (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.0 + Math.sin(t*3)*0.5;
      shell.rotation.y -= dt * 0.1;
      cracks.forEach((c, i) => {
        (c.material as THREE.LineBasicMaterial).opacity = 0.6 + Math.sin(t*2 + i)*0.3;
      });
      rocks.forEach(rk => {
        const d = rk.userData;
        d.ang += dt * d.speed;
        const radius = d.r;
        rk.position.set(radius*Math.cos(d.lat)*Math.cos(d.ang), radius*Math.sin(d.lat), radius*Math.cos(d.lat)*Math.sin(d.ang));
        rk.rotation.x += dt*0.5; rk.rotation.y += dt*0.3;
      });
      sparks.rotation.y += dt * 0.1;
      const arr = sparks.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < spCount; i++) {
        arr[i*3+1] += (Math.random()-0.3)*dt*2;
        if (arr[i*3+1] > 10) arr[i*3+1] = -10;
      }
      sparks.geometry.attributes.position.needsUpdate = true;
    };

    return { scene, entryPos, entryTarget, defaultPos, defaultTarget, update };
  }

  // ---- Hyperspace ----
  buildHyperspace(): World {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000010);

    // star tunnel: many points along z
    const count = 3000;
    const pos = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 6;
      pos[i*3] = Math.cos(ang) * r;
      pos[i*3+1] = Math.sin(ang) * r;
      pos[i*3+2] = -Math.random() * 80;
      speeds[i] = 0.5 + Math.random() * 1.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const stars = new THREE.Points(geo, mat);
    scene.add(stars);

    // concentric rings
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const rg = new THREE.TorusGeometry(2 + i * 1.5, 0.08, 8, 64);
      const rm = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x8844ff : 0x00ffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
      const ring = new THREE.Mesh(rg, rm);
      ring.position.z = -i * 6;
      scene.add(ring);
      rings.push(ring);
    }

    // gates (octagons)
    const gates: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const gg = new THREE.TorusGeometry(5, 0.15, 8, 8);
      const gm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending });
      const gate = new THREE.Mesh(gg, gm);
      gate.position.z = -15 - i * 12;
      scene.add(gate);
      gates.push(gate);
    }

    // final structure
    const struct = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8844ff, emissiveIntensity: 1.5, metalness: 0.3, roughness: 0.2, wireframe: true }));
    struct.position.z = -90;
    scene.add(struct);
    const structCore = new THREE.Mesh(new THREE.SphereGeometry(2, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    structCore.position.z = -90;
    scene.add(structCore);

    scene.add(new THREE.AmbientLight(0x222244, 0.3));
    const pl = new THREE.PointLight(0x8844ff, 2, 40); pl.position.z = -30; scene.add(pl);

    const entryPos = new THREE.Vector3(0, 0, 5);
    const entryTarget = new THREE.Vector3(0, 0, -20);
    const defaultPos = new THREE.Vector3(0, 0, 4);
    const defaultTarget = new THREE.Vector3(0, 0, -40);

    let speedMult = 1;
    const update = (dt: number, t: number) => {
      speedMult = 1 + Math.min(t / 3, 3);
      const arr = stars.geometry.attributes.position.array as Float32Array;
      const spd = stars.geometry.attributes.speed.array as Float32Array;
      for (let i = 0; i < count; i++) {
        arr[i*3+2] += dt * 20 * speedMult * spd[i];
        if (arr[i*3+2] > 5) {
          arr[i*3+2] = -80;
          const ang = Math.random() * Math.PI * 2;
          const r = 1 + Math.random() * 6;
          arr[i*3] = Math.cos(ang) * r;
          arr[i*3+1] = Math.sin(ang) * r;
        }
      }
      stars.geometry.attributes.position.needsUpdate = true;
      rings.forEach((r, i) => {
        r.position.z += dt * 15 * speedMult;
        if (r.position.z > 5) r.position.z = -50;
        r.rotation.z += dt * 0.5;
      });
      gates.forEach((g, i) => {
        g.position.z += dt * 15 * speedMult;
        if (g.position.z > 5) g.position.z = -70;
        g.rotation.z += dt * 1.0;
      });
      struct.rotation.y += dt * 0.5;
      structCore.scale.setScalar(1 + Math.sin(t*4)*0.1);
    };

    return { scene, entryPos, entryTarget, defaultPos, defaultTarget, update };
  }

  // ---- Void ----
  buildVoid(): World {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    const count = 500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random()-0.5)*40;
      pos[i*3+1] = (Math.random()-0.5)*40;
      pos[i*3+2] = (Math.random()-0.5)*40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x94a3b8, size: 0.06, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    scene.add(new THREE.Points(geo, mat));
    scene.add(new THREE.AmbientLight(0x333344, 0.4));
    const entryPos = new THREE.Vector3(0, 0, 6);
    const entryTarget = new THREE.Vector3(0, 0, 0);
    const defaultPos = new THREE.Vector3(0, 0, 8);
    const defaultTarget = new THREE.Vector3(0, 0, 0);
    return { scene, entryPos, entryTarget, defaultPos, defaultTarget, update: () => {} };
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.flashEl.remove();
  }
}

// ---------- texture helpers ----------
function makeLabelTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(label, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function makeHoverTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(10,10,30,0.7)';
  roundRect(ctx, 4, 8, 248, 48, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,200,255,0.8)';
  ctx.lineWidth = 2;
  roundRect(ctx, 4, 8, 248, 48, 12);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
