import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/** How a hero model is set up; comes from the hero's content file (`presentation.model`). */
export interface HeroModelSpec {
  /** Paths relative to the client's assets folder. */
  file: string;
  weaponsFile?: string;
  /** Root node name in the weapons file to put in the right hand. */
  weapon?: string;
  /** Model height in its own units (the Alchemist is 1.81 m). */
  heightUnits: number;
  clips: { idle: string; run: string; attack: string };
}

/** One player to draw this frame, in world units (same space as the 2D renderer). */
export interface HeroDraw {
  id: string;
  x: number;
  y: number;
  connected: boolean;
  /** Changes whenever a new swing starts (local: predicted start time; remote: server tick). */
  swingKey: number | null;
}

/** World → screen mapping shared with the 2D renderer, in CSS pixels. */
export interface ScreenTransform {
  scale: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** Drawn height of a hero in world units (a player's collision circle is 32 across). */
const HERO_WORLD_HEIGHT = 58;
/** Camera looks down at the heroes from this angle above the horizon. */
const VIEW_TILT = THREE.MathUtils.degToRad(35);
const MOVING_SPEED = 20; // world units / s
const SWING_HOLD_MS = 550;

interface HeroInstance {
  root: THREE.Group; // positioned on screen
  yaw: THREE.Group; // turns to face movement
  mixer: THREE.AnimationMixer;
  actions: {
    idle: THREE.AnimationAction;
    run: THREE.AnimationAction;
    attack: THREE.AnimationAction;
  };
  current: THREE.AnimationAction;
  last: { x: number; y: number } | null;
  facing: number;
  swingKey: number | null;
  swingStartedAt: number;
  seenAt: number;
  connected: boolean;
  materials: THREE.Material[];
}

/**
 * Transparent WebGL layer that draws players as rigged 3D models on top of the 2D world canvas.
 * Purely visual: positions come from the same prediction/interpolation the 2D renderer uses.
 */
export class HeroLayer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, -5000, 5000);
  private template: THREE.Object3D | null = null;
  private weapon: THREE.Object3D | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private spec: HeroModelSpec | null = null;
  private readonly heroes = new Map<string, HeroInstance>();
  private failed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x403020, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-300, 600, 800);
    this.scene.add(sun);
  }

  /** True once the model is loaded; until then (or if loading failed) the 2D circles are drawn. */
  get ready(): boolean {
    return this.template !== null && !this.failed;
  }

  async load(spec: HeroModelSpec, assetBase: URL): Promise<void> {
    const loader = new GLTFLoader();
    try {
      const [hero, weapons] = await Promise.all([
        loader.loadAsync(new URL(spec.file, assetBase).href),
        spec.weaponsFile ? loader.loadAsync(new URL(spec.weaponsFile, assetBase).href) : null,
      ]);
      for (const clip of hero.animations) this.clips.set(clip.name, clip);
      for (const name of Object.values(spec.clips)) {
        if (!this.clips.has(name)) throw new Error(`model has no clip "${name}"`);
      }
      this.weapon = spec.weapon ? (weapons?.scene.getObjectByName(spec.weapon) ?? null) : null;
      this.template = hero.scene;
      this.spec = spec;
      // Compile shaders and upload textures now, while the player is still in the lobby, instead
      // of freezing the first in-game frames (seen as a ~0.5 s stall in the two-window test).
      const warm = this.create();
      warm.root.position.set(-10000, 0, 0);
      await this.renderer.compileAsync(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(warm.root);
      warm.mixer.stopAllAction();
    } catch (err) {
      this.failed = true;
      console.warn('hero model failed to load; drawing placeholders', err);
    }
  }

  private create(): HeroInstance {
    const spec = this.spec!;
    const model = cloneSkinned(this.template!);
    const unitsToWorld = HERO_WORLD_HEIGHT / spec.heightUnits;
    model.scale.setScalar(unitsToWorld);
    // Own material copies, so fading one disconnected player doesn't fade everyone.
    const materials: THREE.Material[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false; // skinned bounds are unreliable
      const own = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
      mesh.material = own;
      materials.push(...(Array.isArray(own) ? own : [own]));
    });
    if (this.weapon) {
      const hand = model.getObjectByName('hand_r');
      if (hand) hand.add(this.weapon.clone());
    }
    const yaw = new THREE.Group();
    yaw.add(model);
    const tilt = new THREE.Group();
    tilt.rotation.x = VIEW_TILT;
    tilt.add(yaw);
    const root = new THREE.Group();
    root.add(tilt);
    this.scene.add(root);

    const mixer = new THREE.AnimationMixer(model);
    const action = (name: string) => mixer.clipAction(this.clips.get(name)!);
    const actions = {
      idle: action(spec.clips.idle),
      run: action(spec.clips.run),
      attack: action(spec.clips.attack),
    };
    actions.attack.setLoop(THREE.LoopOnce, 1);
    actions.attack.clampWhenFinished = true;
    actions.idle.play();
    return {
      root,
      yaw,
      mixer,
      actions,
      current: actions.idle,
      last: null,
      facing: 0,
      swingKey: null,
      swingStartedAt: -Infinity,
      seenAt: 0,
      connected: true,
      materials,
    };
  }

  private switchTo(h: HeroInstance, next: THREE.AnimationAction, restart = false): void {
    if (h.current === next && !restart) return;
    next.reset().play();
    if (h.current !== next) h.current.crossFadeTo(next, 0.15, false);
    h.current = next;
  }

  /** Draws one frame. `t` is a monotonic time in ms. */
  update(players: HeroDraw[], view: ScreenTransform, t: number, dtMs: number): void {
    if (!this.ready) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(view.width * dpr);
    const h = Math.round(view.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(view.width, view.height, false);
    }
    // Screen-space orthographic camera: 1 unit = 1 CSS pixel, y up.
    Object.assign(this.camera, { left: 0, right: view.width, top: 0, bottom: -view.height });
    this.camera.updateProjectionMatrix();

    const dt = Math.min(0.1, dtMs / 1000);
    for (const p of players) {
      let hero = this.heroes.get(p.id);
      if (!hero) {
        hero = this.create();
        this.heroes.set(p.id, hero);
      }
      hero.seenAt = t;

      // Movement → facing and run/idle.
      let moving = false;
      if (hero.last && dt > 0) {
        const dx = p.x - hero.last.x;
        const dy = p.y - hero.last.y;
        if (Math.hypot(dx, dy) / dt > MOVING_SPEED) {
          moving = true;
          hero.facing = Math.atan2(dx, dy); // screen-down = facing the camera
        }
      }
      hero.last = { x: p.x, y: p.y };
      let delta = hero.facing - hero.yaw.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      hero.yaw.rotation.y += delta * Math.min(1, dt * 14);

      if (p.swingKey !== null && p.swingKey !== hero.swingKey) {
        hero.swingStartedAt = t;
        this.switchTo(hero, hero.actions.attack, true);
      }
      hero.swingKey = p.swingKey;
      if (t - hero.swingStartedAt > SWING_HOLD_MS) {
        this.switchTo(hero, moving ? hero.actions.run : hero.actions.idle);
      }

      const sx = view.originX + p.x * view.scale;
      const sy = view.originY + p.y * view.scale;
      hero.root.position.set(sx, -sy, sy); // lower on screen = in front
      hero.root.scale.setScalar(view.scale);
      if (hero.connected !== p.connected) {
        hero.connected = p.connected;
        for (const m of hero.materials) {
          m.transparent = !p.connected;
          m.opacity = p.connected ? 1 : 0.35;
        }
      }
      hero.mixer.update(dt);
    }

    // Players who left disappear.
    for (const [id, hero] of this.heroes) {
      if (hero.seenAt !== t) {
        this.scene.remove(hero.root);
        hero.mixer.stopAllAction();
        this.heroes.delete(id);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
