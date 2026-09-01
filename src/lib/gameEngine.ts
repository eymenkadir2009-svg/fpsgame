import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GameConfig, InputState, CharacterState, GROUND_IMAGE } from './gameTypes';

interface Motorcycle {
  group: THREE.Group;
  position: THREE.Vector3;
  rotation: number;
  scale: number;
  isOccupied: boolean;
  modelHeight: number;
  frontWheel: THREE.Object3D | null;
  rearWheel: THREE.Object3D | null;
}

interface CrystalGenerator {
  group: THREE.Group;
  position: THREE.Vector3;
  lastCollect: number;
  ready: boolean;
  glowMesh: THREE.Mesh;
  indicatorY: number;
}

export class GameEngine {
  // ====== CORE ======
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  private container: HTMLElement;
  private animId = 0;
  private isRunning = false;

  // ====== 3D CHARACTER MODEL ======
  private charGroup: THREE.Group;
  private charModel: THREE.Group | null = null;
  private charMixer: THREE.AnimationMixer | null = null;
  private charAnims: Record<string, THREE.AnimationAction> = {};
  private charCurrentAction: THREE.AnimationAction | null = null;
  private charScale = 1.0;
  private charWorldPos = new THREE.Vector3(0, 0, 0);
  private charRotation = 0;
  private modelLoaded = false;

  // ====== NPC CHARACTERS ======
  private npcModels: THREE.Group[] = [];

  // ====== SKATEBOARDS ======
  private skateboardModel: THREE.Group | null = null;

  // ====== MOTORCYCLES ======
  private motorcycles: Motorcycle[] = [];
  private mountedMotorcycle: Motorcycle | null = null;
  private motorcycleScale = 1.0;
  private motorcycleWheelRotation = 0;
  private motorcycleTilt = 0;
  private motorcycleEngineSound = 0;
  private exhaustParticles: THREE.Points | null = null;
  private exhaustPositions: Float32Array | null = null;
  private exhaustAlphas: Float32Array | null = null;
  private exhaustIdx = 0;
  private exhaustGeo!: THREE.BufferGeometry;
  private exhaustMat!: THREE.ShaderMaterial;
  private mountPromptVisible = false;

  // ====== SKY DOME ======
  private skyDome!: THREE.Mesh;

  // ====== HOVERCARS ======
  private hovercars: THREE.Group[] = [];
  private hovercarSourceModel: THREE.Group | null = null;

  // ====== BUILDINGS ======
  private buildingSourceModels: Map<string, THREE.Group> = new Map();

  // ====== CRYSTAL GENERATORS ======
  private crystals: CrystalGenerator[] = [];
  private crystalSourceModel: THREE.Group | null = null;
  private onDiamondCollect?: (amount: number) => void;

  // ====== CAMERA ======
  private camDist = 3.5;
  private camHeight = 2.2;
  private camSmoothPos = new THREE.Vector3();
  private camSmoothLook = new THREE.Vector3();

  // ====== GROUND ======
  private groundMesh!: THREE.Mesh;
  private groundMat!: THREE.MeshStandardMaterial;

  // ====== PARTICLES ======
  private pts!: THREE.Points;
  private ptsMat!: THREE.ShaderMaterial;

  // ====== ENVIRONMENT ======
  private orbs: THREE.Mesh[] = [];

  // ====== CONTACT SHADOW ======
  private contactShadow!: THREE.Mesh;
  private contactShadowMat!: THREE.ShaderMaterial;

  // ====== JUMP PHYSICS ======
  private velocityY = 0;
  private isGrounded = true;

  // ====== BONES ======
  private leftArm: THREE.Bone | null = null;
  private rightArm: THREE.Bone | null = null;
  private leftForearm: THREE.Bone | null = null;
  private rightForearm: THREE.Bone | null = null;
  private leftLeg: THREE.Bone | null = null;
  private rightLeg: THREE.Bone | null = null;
  private leftCalf: THREE.Bone | null = null;
  private rightCalf: THREE.Bone | null = null;

  // ====== STATE ======
  private config: GameConfig;
  private input: InputState;
  private charState: CharacterState = 'idle';
  private yaw = Math.PI;
  private pitch = 0.25;
  private walkTime = 0;
  private t = 0;

  // ====== RAYCASTER ======
  private raycaster = new THREE.Raycaster();

  // ====== LOADING ======
  private ready = false;
  private loadCount = 0;
  private totalLoads = 7; // ground + player + npc + motorcycle + office + skyscraper + crystal

  // ====== CALLBACKS ======
  private onReady?: () => void;
  private onState?: (s: CharacterState) => void;
  private onMountChange?: (mounted: boolean) => void;
  private onMountPrompt?: (show: boolean) => void;

  // ====== LIGHTS ======
  private dirLight!: THREE.DirectionalLight;

  constructor(container: HTMLElement, config: GameConfig) {
    this.container = container;
    this.config = config;
    this.input = {
      w: false, a: false, s: false, d: false, space: false,
      mouseX: 0, mouseY: 0, isMouseDown: false, isPointerLocked: false,
      rightClick: false,
      touchStartX: null, touchStartY: null, touchDeltaX: 0, touchDeltaY: 0,
    };
    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e18);
    // No fog — sky dome handles atmosphere

    const asp = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(55, asp, 0.5, 300);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    container.appendChild(this.renderer.domElement);

    this.charGroup = new THREE.Group();
    this.scene.add(this.charGroup);

    this.camSmoothPos.set(0, this.camHeight, this.camDist);
    this.camSmoothLook.set(0, 1.2, 0);

    this.setupLighting();
    this.setupSkyDome();
    this.setupGround();
    this.setupContactShadow();
    this.setupPlaceholderChar();
    this.setupSkateboard();
    this.setupParticles();
    this.setupExhaustSystem();
    this.setupEnvironment();
    this.loadGroundTexture();
    this.loadGLBModel();
    this.loadNPCModel();
    this.loadMotorcycleModel();
    this.loadBuildingModels();
    this.loadHovercarModel();
    this.loadCrystalModel();
  }

  // ==================== LIGHTING ====================
  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x667788, 2.5));

    this.dirLight = new THREE.DirectionalLight(0xffeedd, 3.5);
    this.dirLight.position.set(20, 30, 15);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 100;
    const s = 40;
    this.dirLight.shadow.camera.left = -s;
    this.dirLight.shadow.camera.right = s;
    this.dirLight.shadow.camera.top = s;
    this.dirLight.shadow.camera.bottom = -s;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);

    const fill = new THREE.DirectionalLight(0x8899cc, 1.0);
    fill.position.set(-10, 8, -15);
    this.scene.add(fill);

    this.scene.add(new THREE.HemisphereLight(0x88aacc, 0x445533, 1.2));
  }

  // ==================== SKY DOME ====================
  private setupSkyDome() {
    // Procedural gradient sky
    const skyGeo = new THREE.SphereGeometry(250, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x0a1628) },
        uMid: { value: new THREE.Color(0x1a3050) },
        uBot: { value: new THREE.Color(0x2a4060) },
        uSunColor: { value: new THREE.Color(0xff8844) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.15, -0.8).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTop, uMid, uBot, uSunColor;
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = dir.y;
          vec3 col = h > 0.0 ? mix(uMid, uTop, pow(h, 0.6)) : mix(uMid, uBot, pow(-h, 0.4));
          float sunDot = max(dot(dir, uSunDir), 0.0);
          col += uSunColor * pow(sunDot, 64.0) * 2.0;
          col += uSunColor * pow(sunDot, 8.0) * 0.15;
          // Horizon glow
          float horizonGlow = exp(-abs(h) * 4.0) * 0.3;
          col += uSunColor * horizonGlow;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.skyDome);
  }

  // ==================== GROUND ====================
  private setupGround() {
    const geo = new THREE.PlaneGeometry(300, 300);
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x446655, roughness: 0.8, metalness: 0.1 });
    this.groundMesh = new THREE.Mesh(geo, this.groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    const grid = new THREE.GridHelper(150, 150, 0x1a3a2a, 0x0d1f15);
    grid.position.y = 0.005;
    this.scene.add(grid);
  }

  // ==================== CONTACT SHADOW ====================
  private setupContactShadow() {
    const geo = new THREE.PlaneGeometry(3, 3);
    this.contactShadowMat = new THREE.ShaderMaterial({
      uniforms: {
        uShadowPos: { value: new THREE.Vector3(0, 0.01, 0) },
        uShadowScale: { value: 1.0 },
        uHeight: { value: 0.0 },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uShadowScale; uniform float uHeight; varying vec2 vUv;
        void main() {
          float dist = length(vUv - 0.5);
          float sh = smoothstep(0.5 * uShadowScale, 0.1 * uShadowScale, dist);
          sh *= (1.0 - clamp(uHeight / 2.0, 0.0, 0.85)) * 0.55;
          gl_FragColor = vec4(0.0, 0.0, 0.0, sh);
        }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.contactShadow = new THREE.Mesh(geo, this.contactShadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.01;
    this.contactShadow.renderOrder = -1;
    this.scene.add(this.contactShadow);
  }

  // ==================== PLACEHOLDER ====================
  private placeholderMeshes: THREE.Mesh[] = [];
  private setupPlaceholderChar() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x22aa66, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.2, 6, 8), mat);
    body.position.y = 1.0; body.castShadow = true;
    this.charGroup.add(body);
    this.placeholderMeshes.push(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), mat.clone());
    head.position.y = 1.95; head.castShadow = true;
    this.charGroup.add(head);
    this.placeholderMeshes.push(head);
  }

  private removePlaceholder() {
    this.placeholderMeshes.forEach(m => {
      this.charGroup.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose();
    });
    this.placeholderMeshes = [];
  }

  // ==================== PROCEDURAL SKATEBOARD ====================
  private setupSkateboard() {
    const sb = new THREE.Group();

    // Board deck
    const deckGeo = new THREE.BoxGeometry(0.3, 0.05, 0.8);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6, metalness: 0.1 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = 0.025;
    sb.add(deck);

    // Grip tape
    const gripGeo = new THREE.BoxGeometry(0.28, 0.01, 0.78);
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.y = 0.055;
    sb.add(grip);

    // Trucks
    const truckMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.3 });
    const truckGeo = new THREE.BoxGeometry(0.25, 0.04, 0.06);
    const truck1 = new THREE.Mesh(truckGeo, truckMat);
    truck1.position.set(0, 0.0, -0.25);
    sb.add(truck1);
    const truck2 = new THREE.Mesh(truckGeo, truckMat);
    truck2.position.set(0, 0.0, 0.25);
    sb.add(truck2);

    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.7 });
    const wheelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8);
    [[-0.13, -0.02, -0.25], [0.13, -0.02, -0.25], [-0.13, -0.02, 0.25], [0.13, -0.02, 0.25]].forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x, y, z);
      wheel.rotation.z = Math.PI / 2;
      sb.add(wheel);
    });

    sb.position.y = 0.02;
    sb.castShadow = true;
    this.skateboardModel = sb;
    this.charGroup.add(sb);
  }

  // ==================== LOAD GLB 3D MODEL (Player) ====================
  private loadGLBModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load('/character.glb', (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) this.charScale = 2.0 / maxDim;
      model.scale.setScalar(this.charScale);

      // Re-center: shift so bottom of bounding box sits on Y=0
      box.setFromObject(model);
      const yOffset = -box.min.y;
      model.position.y = yOffset;

      model.traverse((child) => {
        if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
      });

      this.findBones(model);
      this.removePlaceholder();
      // Re-add skateboard after placeholder removed (it stays under feet)
      this.charGroup.add(this.skateboardModel!);
      this.charGroup.add(model);
      this.charModel = model;
      this.modelLoaded = true;

      if (gltf.animations.length > 0) {
        this.charMixer = new THREE.AnimationMixer(model);
        let idleAnim: THREE.AnimationClip | null = null;
        let walkAnim: THREE.AnimationClip | null = null;
        let walkBackAnim: THREE.AnimationClip | null = null;
        for (const anim of gltf.animations) {
          const name = anim.name.toLowerCase();
          if ((name.includes('idle') || name.includes('stand')) && !idleAnim) idleAnim = anim;
          else if (name.includes('walk') && !walkAnim) walkAnim = anim;
          else if ((name.includes('back') || name.includes('retreat')) && !walkBackAnim) walkBackAnim = anim;
        }
        if (!idleAnim && gltf.animations.length > 0) idleAnim = gltf.animations[0];
        if (!walkAnim && gltf.animations.length > 1) walkAnim = gltf.animations[1];
        if (!walkBackAnim) walkBackAnim = walkAnim;
        if (idleAnim) this.charAnims['idle'] = this.charMixer.clipAction(idleAnim);
        if (walkAnim) this.charAnims['walking_forward'] = this.charMixer.clipAction(walkAnim);
        if (walkBackAnim && walkBackAnim !== walkAnim) this.charAnims['walking_backward'] = this.charMixer.clipAction(walkBackAnim);
        else if (walkAnim) this.charAnims['walking_backward'] = this.charMixer.clipAction(walkAnim);
        this.playAnim('idle');
      }
      this.checkReady();
    }, undefined, () => this.checkReady());
  }

  // ==================== FIND BONES ====================
  private findBones(model: THREE.Object3D) {
    model.traverse((child) => {
      if (!(child instanceof THREE.Bone)) return;
      const n = child.name.toLowerCase();
      if ((n.includes('upperarm') || n.includes('arm_upper') || n.includes('shoulder')) && n.includes('left') && !this.leftArm) this.leftArm = child;
      else if ((n.includes('upperarm') || n.includes('arm_upper') || n.includes('shoulder')) && (n.includes('right') || n.includes('_r')) && !this.rightArm) this.rightArm = child;
      if ((n.includes('lowerarm') || n.includes('forearm') || n.includes('arm_lower')) && n.includes('left') && !this.leftForearm) this.leftForearm = child;
      else if ((n.includes('lowerarm') || n.includes('forearm') || n.includes('arm_lower')) && (n.includes('right') || n.includes('_r')) && !this.rightForearm) this.rightForearm = child;
      if ((n.includes('upperleg') || n.includes('thigh') || n.includes('leg_upper')) && n.includes('left') && !this.leftLeg) this.leftLeg = child;
      else if ((n.includes('upperleg') || n.includes('thigh') || n.includes('leg_upper')) && (n.includes('right') || n.includes('_r')) && !this.rightLeg) this.rightLeg = child;
      if ((n.includes('lowerleg') || n.includes('calf') || n.includes('shin') || n.includes('leg_lower')) && n.includes('left') && !this.leftCalf) this.leftCalf = child;
      else if ((n.includes('lowerleg') || n.includes('calf') || n.includes('shin') || n.includes('leg_lower')) && (n.includes('right') || n.includes('_r')) && !this.rightCalf) this.rightCalf = child;
    });
  }

  // ==================== PROCEDURAL ANIMATION ====================
  private applyProceduralAnimation(speed: number) {
    if (speed <= 0) return;
    const phase = this.walkTime;
    if (this.leftArm) this.leftArm.rotation.x = Math.sin(phase) * 0.6;
    if (this.rightArm) this.rightArm.rotation.x = Math.sin(phase + Math.PI) * 0.6;
    if (this.leftForearm) this.leftForearm.rotation.x = -Math.abs(Math.sin(phase)) * 0.4 - 0.2;
    if (this.rightForearm) this.rightForearm.rotation.x = -Math.abs(Math.sin(phase + Math.PI)) * 0.4 - 0.2;
    if (this.leftLeg) this.leftLeg.rotation.x = Math.sin(phase + Math.PI) * 0.5;
    if (this.rightLeg) this.rightLeg.rotation.x = Math.sin(phase) * 0.5;
    if (this.leftCalf) this.leftCalf.rotation.x = Math.max(0, Math.sin(phase + Math.PI + 0.5)) * 0.7;
    if (this.rightCalf) this.rightCalf.rotation.x = Math.max(0, Math.sin(phase + 0.5)) * 0.7;
  }

  private resetProceduralAnimation() {
    [this.leftArm, this.rightArm, this.leftForearm, this.rightForearm,
     this.leftLeg, this.rightLeg, this.leftCalf, this.rightCalf].forEach(bone => {
      if (bone) { bone.rotation.x *= 0.85; bone.rotation.z *= 0.85; }
    });
  }

  private applyRidingPose() {
    if (this.leftArm) this.leftArm.rotation.x = -1.2;
    if (this.rightArm) this.rightArm.rotation.x = -1.2;
    if (this.leftForearm) this.leftForearm.rotation.x = -0.3;
    if (this.rightForearm) this.rightForearm.rotation.x = -0.3;
    if (this.leftLeg) { this.leftLeg.rotation.x = -0.8; this.leftLeg.rotation.z = 0.4; }
    if (this.rightLeg) { this.rightLeg.rotation.x = -0.8; this.rightLeg.rotation.z = -0.4; }
    if (this.leftCalf) this.leftCalf.rotation.x = -1.2;
    if (this.rightCalf) this.rightCalf.rotation.x = -1.2;
  }

  private resetRidingPose() {
    [this.leftArm, this.rightArm, this.leftForearm, this.rightForearm,
     this.leftLeg, this.rightLeg, this.leftCalf, this.rightCalf].forEach(b => {
      if (b) { b.rotation.x *= 0.85; b.rotation.z *= 0.85; }
    });
  }

  // ==================== LOAD NPC MODEL ====================
  private loadNPCModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load('/npc.glb', (gltf) => {
      const sourceModel = gltf.scene;
      const box = new THREE.Box3().setFromObject(sourceModel);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const npcScale = maxDim > 0 ? 2.0 / maxDim : 1.0;

      const positions = [
        { x: 8, z: -5, ry: 0.5 }, { x: -6, z: -10, ry: 2.0 },
        { x: 4, z: -18, ry: 3.5 }, { x: -10, z: -22, ry: 1.2 }, { x: 14, z: -15, ry: 4.8 },
      ];

      positions.forEach((pos) => {
        const npc = sourceModel.clone();
        npc.scale.setScalar(npcScale);
        const b = new THREE.Box3().setFromObject(npc);
        npc.position.y = -b.min.y; // Fix ground placement
        npc.traverse((child) => {
          if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        npc.position.set(pos.x, 0, pos.z);
        npc.rotation.y = pos.ry;
        this.scene.add(npc);
        this.npcModels.push(npc);

        // Add skateboard under each NPC
        if (this.skateboardModel) {
          const sbClone = this.skateboardModel.clone();
          sbClone.position.y = 0.02;
          npc.add(sbClone);
        }
      });
      this.checkReady();
    }, undefined, () => this.checkReady());
  }

  // ==================== LOAD MOTORCYCLE ====================
  private loadMotorcycleModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load('/motorcycle.glb', (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) this.motorcycleScale = 3.5 / maxDim; // Natural motorcycle size
      model.scale.setScalar(this.motorcycleScale);
      box.setFromObject(model);
      const modelHeight = box.max.y - box.min.y;

      model.visible = false;
      this.scene.add(model);

      const mcPositions = [
        { x: 20, z: -5, ry: 0.3 }, { x: -18, z: -3, ry: 1.8 },
        { x: 25, z: -20, ry: -0.5 }, { x: -22, z: -18, ry: 2.5 },
        { x: 15, z: -35, ry: 0.8 }, { x: -15, z: -35, ry: 3.2 },
        { x: 30, z: -10, ry: -1.2 }, { x: -28, z: -28, ry: 1.5 },
      ];

      mcPositions.forEach((pos) => {
        const mc = model.clone(); mc.visible = true;
        mc.scale.setScalar(this.motorcycleScale);
        const b = new THREE.Box3().setFromObject(mc);
        mc.position.y = -b.min.y;
        mc.traverse((child) => {
          if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        mc.position.set(pos.x, 0, pos.z);
        mc.rotation.y = pos.ry;
        this.scene.add(mc);

        let fw: THREE.Object3D | null = null;
        let rw: THREE.Object3D | null = null;
        mc.traverse((child) => {
          const n = child.name.toLowerCase();
          if (n.includes('wheel') && n.includes('front') && !fw) fw = child;
          if (n.includes('wheel') && (n.includes('rear') || n.includes('back')) && !rw) rw = child;
        });

        this.motorcycles.push({
          group: mc, position: new THREE.Vector3(pos.x, 0, pos.z),
          rotation: pos.ry, scale: this.motorcycleScale, isOccupied: false,
          modelHeight, frontWheel: fw, rearWheel: rw,
        });
      });
      this.checkReady();
    }, undefined, () => this.checkReady());
  }

  // ==================== LOAD BUILDING MODELS ====================
  private loadBuildingModels() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    let loaded = 0;
    const onLoad = () => { loaded++; if (loaded >= 2) this.checkReady(); };

    // Office buildings
    gltfLoader.load('/office_building.glb', (gltf) => {
      this.buildingSourceModels.set('office', gltf.scene);
      this.placeBuildings('office', [
        { x: 35, z: -15, ry: 0 }, { x: -35, z: -12, ry: 1.2 },
        { x: 40, z: -40, ry: 0.5 }, { x: -38, z: -38, ry: 2.8 },
        { x: 50, z: -25, ry: 0.8 }, { x: -45, z: -30, ry: 1.5 },
        { x: 30, z: -55, ry: 3.0 }, { x: -30, z: -50, ry: 0.3 },
      ]);
      onLoad();
    }, undefined, onLoad);

    // Skyscrapers
    gltfLoader.load('/skyscraper.glb', (gltf) => {
      this.buildingSourceModels.set('skyscraper', gltf.scene);
      this.placeBuildings('skyscraper', [
        { x: 60, z: -20, ry: 0.2 }, { x: -60, z: -25, ry: 1.8 },
        { x: 55, z: -50, ry: 0.7 }, { x: -55, z: -55, ry: 2.2 },
        { x: 70, z: -35, ry: 3.5 },
      ]);
      onLoad();
    }, undefined, onLoad);
  }

  private placeBuildings(type: string, positions: { x: number; z: number; ry: number }[]) {
    const source = this.buildingSourceModels.get(type);
    if (!source) return;

    const box = new THREE.Box3().setFromObject(source);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 45 / maxDim : 1; // 45m tall buildings

    positions.forEach((pos) => {
      const bld = source.clone();
      bld.scale.setScalar(scale);
      const b = new THREE.Box3().setFromObject(bld);
      bld.position.y = -b.min.y;
      bld.traverse((child) => {
        if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
      });
      bld.position.set(pos.x, 0, pos.z);
      bld.rotation.y = pos.ry;
      this.scene.add(bld);
    });
  }

  // ==================== LOAD HOVERCAR ====================
  private loadHovercarModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load('/hovercar.glb', (gltf) => {
      const model = gltf.scene;
      this.hovercarSourceModel = model;
      model.visible = false;
      this.scene.add(model);

      // 4 hovercars flying in circle at radius ~12, height 10-12
      for (let i = 0; i < 4; i++) {
        const hc = model.clone(); hc.visible = true;
        const box = new THREE.Box3().setFromObject(hc);
        const size = box.getSize(new THREE.Vector3());
        const s = 2.5 / Math.max(size.x, size.y, size.z, 0.1);
        hc.scale.setScalar(s);

        // Add emissive glow
        hc.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.emissive) {
              mat.emissive.setHex(0x2244ff);
              mat.emissiveIntensity = 0.5;
            }
          }
        });

        this.hovercars.push(hc);
        this.scene.add(hc);
      }
      this.checkReady();
    }, undefined, () => this.checkReady());
  }

  // ==================== LOAD CRYSTAL GENERATORS ====================
  private loadCrystalModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load('/crystal.glb', (gltf) => {
      const model = gltf.scene;
      this.crystalSourceModel = model;
      model.visible = false;
      this.scene.add(model);

      // 10 crystal positions spread around the map
      const crystalPositions = [
        { x: 5, z: -8 }, { x: -12, z: -6 }, { x: 18, z: -12 },
        { x: -20, z: -14 }, { x: 8, z: -28 }, { x: -8, z: -30 },
        { x: 25, z: -5 }, { x: -25, z: -20 }, { x: 15, z: -42 },
        { x: -15, z: -45 },
      ];

      crystalPositions.forEach((pos) => {
        const cr = model.clone();
        cr.visible = true;

        // Auto-scale to ~2m
        const box = new THREE.Box3().setFromObject(cr);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) cr.scale.setScalar(2.0 / maxDim);

        // Ground placement
        const b = new THREE.Box3().setFromObject(cr);
        cr.position.y = -b.min.y;

        cr.traverse((child) => {
          if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
        });

        cr.position.set(pos.x, 0, pos.z);
        this.scene.add(cr);

        // Purple-pink glow sphere above crystal
        const b2 = new THREE.Box3().setFromObject(cr);
        const height = b2.max.y - b2.min.y;
        const glowMesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.4, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xcc44ff, transparent: true, opacity: 0.6 })
        );
        glowMesh.position.y = height + 1.2;
        cr.add(glowMesh);

        // Diamond indicator (small floating diamond shape)
        const indicatorGeo = new THREE.OctahedronGeometry(0.15, 0);
        const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xff44cc, transparent: true, opacity: 0.8 });
        const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
        indicator.position.y = height + 2.0;
        cr.add(indicator);

        this.crystals.push({
          group: cr,
          position: new THREE.Vector3(pos.x, 0, pos.z),
          lastCollect: 0,
          ready: true,
          glowMesh,
          indicatorY: height + 2.0,
        });
      });
      this.checkReady();
    }, undefined, () => this.checkReady());
  }

  private updateCrystals() {
    this.crystals.forEach((cr, i) => {
      if (!cr.ready) return;
      // Glow pulse
      const pulse = 0.4 + Math.sin(this.t * 2 + i * 1.5) * 0.3;
      cr.glowMesh.scale.setScalar(1 + pulse * 0.3);
      (cr.glowMesh.material as THREE.MeshBasicMaterial).opacity = 0.4 + pulse * 0.4;
      // Rotate indicator
      const indicator = cr.group.children.find(c => c instanceof THREE.Mesh && c.geometry instanceof THREE.OctahedronGeometry);
      if (indicator) {
        indicator.rotation.y = this.t * 2;
        indicator.position.y = cr.indicatorY + Math.sin(this.t * 1.5 + i) * 0.2;
      }
      // Slight float on whole group
      cr.group.position.y = Math.sin(this.t * 0.8 + i * 0.7) * 0.03;
    });
  }

  // ==================== EXHAUST PARTICLE SYSTEM ====================
  private setupExhaustSystem() {
    const N = 40;
    this.exhaustPositions = new Float32Array(N * 3);
    this.exhaustAlphas = new Float32Array(N);
    this.exhaustGeo = new THREE.BufferGeometry();
    this.exhaustGeo.setAttribute('position', new THREE.BufferAttribute(this.exhaustPositions, 3));
    this.exhaustGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.exhaustAlphas, 1));
    this.exhaustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aAlpha; varying float vAlpha;
        void main() { vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=max(1.0,aAlpha*8.0*(50.0/max(-mv.z,1.0))); gl_Position=projectionMatrix*mv; }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() { float d=length(gl_PointCoord-0.5); if(d>0.5)discard; float a=smoothstep(0.5,0.1,d)*vAlpha*0.5; vec3 c=mix(vec3(0.4,0.4,0.5),vec3(0.2,0.2,0.25),vAlpha); gl_FragColor=vec4(c,a); }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.exhaustParticles = new THREE.Points(this.exhaustGeo, this.exhaustMat);
    this.exhaustParticles.visible = false;
    this.scene.add(this.exhaustParticles);
  }

  private updateExhaust(dt: number) {
    if (!this.mountedMotorcycle || !this.exhaustPositions || !this.exhaustAlphas) return;
    const mc = this.mountedMotorcycle;
    const moving = this.input.w || this.input.s;
    if (!moving) {
      for (let i = 0; i < this.exhaustAlphas.length; i++) this.exhaustAlphas[i] *= 0.92;
      this.exhaustGeo.attributes.aAlpha.needsUpdate = true;
      return;
    }
    const exhaustWorld = new THREE.Vector3();
    mc.group.getWorldPosition(exhaustWorld);
    const rearOffset = new THREE.Vector3(0, mc.modelHeight * 0.35, 0.5);
    rearOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), mc.rotation);
    exhaustWorld.add(rearOffset);
    for (let e = 0; e < 3; e++) {
      const idx = this.exhaustIdx % this.exhaustAlphas.length;
      this.exhaustPositions[idx * 3] = exhaustWorld.x + (Math.random() - 0.5) * 0.15;
      this.exhaustPositions[idx * 3 + 1] = exhaustWorld.y + Math.random() * 0.1;
      this.exhaustPositions[idx * 3 + 2] = exhaustWorld.z + (Math.random() - 0.5) * 0.15;
      this.exhaustAlphas[idx] = 0.8 + Math.random() * 0.2;
      this.exhaustIdx++;
    }
    for (let i = 0; i < this.exhaustAlphas.length; i++) {
      this.exhaustPositions[i * 3 + 1] += dt * (1.0 + Math.random() * 0.5);
      this.exhaustPositions[i * 3] += (Math.random() - 0.5) * dt * 0.8;
      this.exhaustPositions[i * 3 + 2] += (Math.random() - 0.5) * dt * 0.8;
      this.exhaustAlphas[i] *= 0.96;
    }
    this.exhaustGeo.attributes.aAlpha.needsUpdate = true;
    this.exhaustGeo.attributes.position.needsUpdate = true;
  }

  // ==================== MOUNT / DISMOUNT ====================
  private tryMount() {
    if (this.mountedMotorcycle || !this.isGrounded) return;
    let nearest: Motorcycle | null = null;
    let nearestDist = Infinity;
    for (const mc of this.motorcycles) {
      if (mc.isOccupied) continue;
      const dx = this.charWorldPos.x - mc.position.x;
      const dz = this.charWorldPos.z - mc.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 3.5 && dist < nearestDist) { nearest = mc; nearestDist = dist; }
    }
    if (!nearest) return;
    this.mountedMotorcycle = nearest;
    nearest.isOccupied = true;
    if (this.charModel) this.charModel.visible = true;
    this.applyRidingPose();
    this.camDist = 5.0; this.camHeight = 2.8;
    if (this.exhaustParticles) this.exhaustParticles.visible = true;
    this.charState = 'riding'; this.onState?.('riding'); this.onMountChange?.(true);
  }

  private dismount() {
    if (!this.mountedMotorcycle) return;
    const mc = this.mountedMotorcycle;
    mc.isOccupied = false;
    const sideOffset = new THREE.Vector3(1.5, 0, 0);
    sideOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), mc.rotation);
    this.charWorldPos.set(mc.position.x + sideOffset.x, 0, mc.position.z + sideOffset.z);
    this.charRotation = mc.rotation;
    this.charGroup.position.copy(this.charWorldPos);
    this.charGroup.rotation.y = this.charRotation;
    this.camDist = 3.5; this.camHeight = 2.2;
    if (this.exhaustParticles) this.exhaustParticles.visible = false;
    this.resetRidingPose();
    this.mountedMotorcycle = null;
    this.motorcycleTilt = 0; this.motorcycleEngineSound = 0;
    this.charState = 'idle'; this.playAnim('idle'); this.onState?.('idle'); this.onMountChange?.(false);
  }

  // ==================== MOTORCYCLE MOVEMENT ====================
  private updateMotorcycleMovement(dt: number) {
    const mc = this.mountedMotorcycle;
    if (!mc) return;
    const speed = this.config.motorcycleSpeed;
    const turnSpeed = this.config.motorcycleTurnSpeed;
    let currentSpeed = 0;
    let turning = 0;
    if (this.input.w) currentSpeed = speed;
    else if (this.input.s) currentSpeed = -speed * 0.5;
    if (Math.abs(currentSpeed) > 0.01) {
      if (this.input.a) turning = turnSpeed * Math.sign(currentSpeed);
      if (this.input.d) turning = -turnSpeed * Math.sign(currentSpeed);
    }
    if (Math.abs(currentSpeed) > 0.01) {
      mc.rotation += turning;
      mc.position.x += Math.sin(mc.rotation) * currentSpeed;
      mc.position.z += Math.cos(mc.rotation) * currentSpeed;
    }
    mc.group.position.set(mc.position.x, 0, mc.position.z);
    mc.group.rotation.y = mc.rotation;
    this.motorcycleWheelRotation += currentSpeed * 3;
    if (mc.frontWheel) mc.frontWheel.rotation.x = this.motorcycleWheelRotation;
    if (mc.rearWheel) mc.rearWheel.rotation.x = this.motorcycleWheelRotation;
    const targetTilt = -turning * 12;
    this.motorcycleTilt += (targetTilt - this.motorcycleTilt) * 0.1;
    mc.group.rotation.z = this.motorcycleTilt * 0.015;
    this.motorcycleEngineSound += ((Math.abs(currentSpeed) > 0.01 ? 1 : 0) - this.motorcycleEngineSound) * 0.1;
    if (this.motorcycleEngineSound > 0.01) mc.group.position.y = Math.sin(this.t * 30) * 0.003 * this.motorcycleEngineSound;
    this.charWorldPos.set(mc.position.x, 0, mc.position.z);
    this.charRotation = mc.rotation;
    this.charGroup.position.copy(this.charWorldPos);
    this.charGroup.rotation.y = this.charRotation;
    this.yaw += (mc.rotation - this.yaw) * 0.06;
    if (currentSpeed > 0.01 && this.charState !== 'riding_forward') { this.charState = 'riding_forward'; this.onState?.('riding_forward'); }
    else if (currentSpeed < -0.01 && this.charState !== 'riding_backward') { this.charState = 'riding_backward'; this.onState?.('riding_backward'); }
    else if (Math.abs(currentSpeed) <= 0.01 && this.charState !== 'riding') { this.charState = 'riding'; this.onState?.('riding'); }
  }

  private checkNearbyMotorcycle() {
    if (this.mountedMotorcycle) { if (this.mountPromptVisible) { this.mountPromptVisible = false; this.onMountPrompt?.(false); } return; }
    let nearest: Motorcycle | null = null;
    let nearestDist = Infinity;
    for (const mc of this.motorcycles) {
      if (mc.isOccupied) continue;
      const dx = this.charWorldPos.x - mc.position.x;
      const dz = this.charWorldPos.z - mc.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 3.5 && dist < nearestDist) { nearest = mc; nearestDist = dist; }
    }
    const shouldShow = !!nearest;
    if (shouldShow !== this.mountPromptVisible) { this.mountPromptVisible = shouldShow; this.onMountPrompt?.(shouldShow); }
  }

  // ==================== HOVERCAR ANIMATION ====================
  private updateHovercars() {
    this.hovercars.forEach((hc, i) => {
      const angle = this.t * 0.15 + (i * Math.PI * 2) / this.hovercars.length;
      const radius = 12 + Math.sin(this.t * 0.1 + i) * 3;
      const height = 10 + Math.sin(this.t * 0.3 + i * 1.5) * 2 + i * 0.8;
      hc.position.set(
        this.charWorldPos.x + Math.cos(angle) * radius,
        height,
        this.charWorldPos.z + Math.sin(angle) * radius,
      );
      // Face direction of travel
      const nextAngle = angle + 0.01;
      hc.lookAt(
        this.charWorldPos.x + Math.cos(nextAngle) * radius,
        height,
        this.charWorldPos.z + Math.sin(nextAngle) * radius,
      );
    });
  }

  private playAnim(state: string) {
    if (!this.charMixer) return;
    const action = this.charAnims[state];
    if (!action || this.charCurrentAction === action) return;
    if (this.charCurrentAction) this.charCurrentAction.fadeOut(0.2);
    action.reset().fadeIn(0.2).play();
    this.charCurrentAction = action;
  }

  // ==================== PARTICLES ====================
  private setupParticles() {
    const N = 150;
    const pos = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const alphas = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 15 + 0.3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
      sizes[i] = Math.random() * 3 + 0.5;
      alphas[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.ptsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 } },
      vertexShader: `
        attribute float size; attribute float aAlpha;
        uniform float uTime; uniform float uPR;
        varying float vAlpha; varying float vD;
        void main(){ vAlpha=aAlpha; vec3 p=position; p.y+=sin(uTime*0.3+p.x*0.5)*0.4; p.x+=sin(uTime*0.15+p.z*0.3)*0.3;
        vec4 mv=modelViewMatrix*vec4(p,1.0); vD=-mv.z; gl_PointSize=size*uPR*(90.0/max(-mv.z,1.0)); gl_Position=projectionMatrix*mv; }
      `,
      fragmentShader: `
        varying float vAlpha; varying float vD; uniform float uTime;
        void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5)discard; float a=smoothstep(0.5,0.05,d)*vAlpha*0.3; a*=0.6+0.4*sin(uTime*1.5+vAlpha*6.28); a*=clamp(1.0-vD*0.008,0.0,1.0);
        vec3 c=mix(vec3(0.2,0.5,1.0),vec3(0.0,0.9,0.5),vAlpha); gl_FragColor=vec4(c,a); }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.pts = new THREE.Points(geo, this.ptsMat);
    this.scene.add(this.pts);
  }

  // ==================== ENVIRONMENT ====================
  private setupEnvironment() {
    const orbData = [
      { x: 8, y: 3, z: -10, c: 0x2266ff }, { x: -10, y: 4, z: -7, c: 0xff4422 },
      { x: 5, y: 2, z: -18, c: 0x22ff88 }, { x: -6, y: 5, z: -20, c: 0x8844ff },
    ];
    orbData.forEach(({ x, y, z, c }) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8 }));
      m.position.set(x, y, z); this.scene.add(m); this.orbs.push(m);
    });
    const pp = [
      { x: 10, z: -8 }, { x: -10, z: -8 }, { x: 8, z: -20 },
      { x: -8, z: -20 }, { x: 0, z: -30 },
    ];
    pp.forEach(({ x, z }) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 6, 6), new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.85, roughness: 0.25 }));
      p.position.set(x, 3, z); p.castShadow = true; this.scene.add(p);
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), new THREE.MeshBasicMaterial({ color: 0x4488ff }));
      t.position.set(x, 6.15, z); this.scene.add(t);
    });
  }

  // ==================== GROUND TEXTURE ====================
  private loadGroundTexture() {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = new THREE.Texture(img); tex.needsUpdate = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(30, 30);
      this.groundMat.map = tex; this.groundMat.needsUpdate = true;
      this.checkReady();
    };
    img.onerror = () => { console.warn('Ground texture failed'); this.checkReady(); };
    img.src = GROUND_IMAGE;
  }

  private checkReady() {
    this.loadCount++;
    if (this.loadCount >= this.totalLoads && !this.ready) { this.ready = true; this.onReady?.(); }
  }

  // ==================== PUBLIC API ====================
  setOnReady(cb: () => void) { this.onReady = cb; }
  setOnStateChange(cb: (s: CharacterState) => void) { this.onState = cb; }
  setOnMountChange(cb: (mounted: boolean) => void) { this.onMountChange = cb; }
  setOnMountPrompt(cb: (show: boolean) => void) { this.onMountPrompt = cb; }
  setOnDiamondCollect(cb: (amount: number) => void) { this.onDiamondCollect = cb; }
  updateInput(p: Partial<InputState>) { Object.assign(this.input, p); }
  handleRightClick() { if (this.mountedMotorcycle) this.dismount(); else this.tryMount(); }
  isOnMotorcycle() { return !!this.mountedMotorcycle; }

  // ====== CRYSTAL CLICK DETECTION ======
  tryCollectCrystal(screenX: number, screenY: number) {
    if (this.mountedMotorcycle) return;
    const mouse = new THREE.Vector2(
      (screenX / this.container.clientWidth) * 2 - 1,
      -(screenY / this.container.clientHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    for (const cr of this.crystals) {
      if (!cr.ready) continue;
      const dist = this.charWorldPos.distanceTo(cr.position);
      if (dist > 5) continue;
      const hits = this.raycaster.intersectObject(cr.group, true);
      if (hits.length > 0) {
        cr.lastCollect = Date.now();
        cr.ready = false;
        cr.glowMesh.material = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 });
        this.onDiamondCollect?.(10);
        // Reset after 2 min cooldown
        setTimeout(() => {
          cr.ready = true;
          cr.glowMesh.material = new THREE.MeshBasicMaterial({ color: 0xcc44ff, transparent: true, opacity: 0.6 });
        }, 120000);
        return;
      }
    }
  }

  // ==================== CAMERA ====================
  private updateCamera() {
    const targetPos = new THREE.Vector3(
      this.charWorldPos.x + Math.sin(this.yaw) * this.camDist,
      this.charWorldPos.y + this.camHeight - this.pitch * 2,
      this.charWorldPos.z + Math.cos(this.yaw) * this.camDist,
    );
    const targetLook = this.charWorldPos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const sf = this.mountedMotorcycle ? 0.06 : 0.08;
    this.camSmoothPos.lerp(targetPos, sf);
    this.camSmoothLook.lerp(targetLook, sf + 0.02);
    this.camera.position.copy(this.camSmoothPos);
    this.camera.lookAt(this.camSmoothLook);
  }

  // ==================== JUMP ====================
  private updateJump() {
    if (this.mountedMotorcycle) { this.velocityY = 0; this.isGrounded = true; return; }
    if (this.input.space && this.isGrounded) {
      this.velocityY = this.config.jumpForce;
      this.isGrounded = false;
      if (this.charState !== 'walking_forward' && this.charState !== 'walking_backward') { this.charState = 'jumping'; this.onState?.('jumping'); }
    }
    if (!this.isGrounded) {
      this.velocityY -= this.config.gravity;
      this.charWorldPos.y += this.velocityY;
      if (this.charWorldPos.y <= 0) {
        this.charWorldPos.y = 0; this.velocityY = 0; this.isGrounded = true;
        if (!(this.input.w || this.input.a || this.input.s || this.input.d)) { this.charState = 'idle'; this.playAnim('idle'); this.onState?.('idle'); }
      }
    }
  }

  // ==================== MOVEMENT ====================
  private updateMovement(dt: number) {
    if (this.mountedMotorcycle) return;
    const camFwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    camFwd.y = 0; camFwd.normalize();
    const camRight = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    camRight.y = 0; camRight.normalize();
    const dir = new THREE.Vector3();
    if (this.input.w) dir.add(camFwd);
    if (this.input.s) dir.sub(camFwd);
    if (this.input.d) dir.add(camRight);
    if (this.input.a) dir.sub(camRight);
    const moving = dir.lengthSq() > 0;
    if (moving && this.isGrounded) {
      dir.normalize().multiplyScalar(this.config.moveSpeed);
      this.charWorldPos.x += dir.x;
      this.charWorldPos.z += dir.z;
      const targetRot = Math.atan2(dir.x, dir.z);
      this.charRotation += shortAngleDist(this.charRotation, targetRot) * 0.15;
      const isF = this.input.w && !this.input.s;
      const isB = this.input.s && !this.input.w;
      if (isF && this.charState !== 'walking_forward') { this.charState = 'walking_forward'; this.playAnim('walking_forward'); this.onState?.('walking_forward'); }
      else if (isB && this.charState !== 'walking_backward') { this.charState = 'walking_backward'; this.playAnim('walking_backward'); this.onState?.('walking_backward'); }
      else if (!isF && !isB && this.charState !== 'walking_forward') { this.charState = 'walking_forward'; this.playAnim('walking_forward'); this.onState?.('walking_forward'); }
      this.walkTime += dt * this.config.walkBounceSpeed;
    } else if (!moving && this.isGrounded) {
      if (this.charState !== 'idle') { this.charState = 'idle'; this.playAnim('idle'); this.onState?.('idle'); }
      this.walkTime *= 0.9;
    }
    this.charGroup.position.copy(this.charWorldPos);
    this.charGroup.rotation.y = this.charRotation;
    if (!this.modelLoaded || !this.charMixer) {
      const bounce = moving && this.isGrounded ? Math.abs(Math.sin(this.walkTime)) * this.config.walkBounceHeight * 0.3 : 0;
      this.placeholderMeshes.forEach(m => { m.position.y = (m === this.placeholderMeshes[0] ? 1.0 : 1.95) + bounce; });
    }
    if (this.modelLoaded && moving && this.isGrounded) this.applyProceduralAnimation(this.config.moveSpeed);
    else if (this.modelLoaded && !this.mountedMotorcycle) this.resetProceduralAnimation();
  }

  // ==================== SHADOW & LOOK UPDATES ====================
  private updateContactShadow() {
    this.contactShadow.position.x = this.charWorldPos.x;
    this.contactShadow.position.z = this.charWorldPos.z;
    this.contactShadow.rotation.z = this.charRotation;
    const moving = this.input.w || this.input.a || this.input.s || this.input.d;
    const wp = moving && this.isGrounded ? 1.0 + Math.sin(this.walkTime * 2) * 0.08 : 1.0;
    this.contactShadowMat.uniforms.uShadowScale.value = this.mountedMotorcycle ? 1.5 : wp;
    this.contactShadowMat.uniforms.uHeight.value = this.charWorldPos.y;
  }

  private updateShadowLight() {
    this.dirLight.position.set(this.charWorldPos.x + 20, 30, this.charWorldPos.z + 15);
    this.dirLight.target.position.copy(this.charWorldPos);
    this.dirLight.target.updateMatrixWorld();
  }

  private updateLook() {
    if (this.input.isPointerLocked) {
      const sens = this.mountedMotorcycle ? this.config.lookSensitivity * 0.7 : this.config.lookSensitivity;
      this.yaw -= this.input.mouseX * sens;
      this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + this.input.mouseY * sens * 0.5));
    }
    if (this.input.touchStartX !== null) {
      this.yaw -= this.input.touchDeltaX * this.config.lookSensitivity * 0.5;
      this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + this.input.touchDeltaY * this.config.lookSensitivity * 0.25));
    }
  }

  // ==================== MAIN LOOP ====================
  private animate = () => {
    if (!this.isRunning) return;
    this.animId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;

    this.updateJump();
    this.updateMovement(dt);
    this.updateMotorcycleMovement(dt);
    this.updateLook();
    this.updateCamera();
    this.updateContactShadow();
    this.updateShadowLight();
    this.checkNearbyMotorcycle();
    this.updateExhaust(dt);
    this.updateHovercars();
    this.updateCrystals();

    // Sky dome follows camera
    this.skyDome.position.copy(this.camera.position);

    if (this.charMixer && !this.mountedMotorcycle) this.charMixer.update(dt);
    this.ptsMat.uniforms.uTime.value = this.t;
    this.exhaustMat.uniforms.uTime.value = this.t;
    for (let i = 0; i < this.orbs.length; i++) this.orbs[i].position.y += Math.sin(this.t * 0.4 + i * 1.7) * 0.003;

    this.renderer.render(this.scene, this.camera);
  };

  start() { this.isRunning = true; this.clock.start(); this.animate(); }
  stop() { this.isRunning = false; cancelAnimationFrame(this.animId); }

  resize(w: number, h: number) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.renderer.setPixelRatio(1);
  }

  dispose() {
    this.stop(); this.renderer.dispose();
    this.groundMat.dispose(); this.ptsMat.dispose();
    this.contactShadowMat.dispose(); this.exhaustMat.dispose();
  }

  getIsReady() { return this.ready; }
  getModelLoaded() { return this.modelLoaded; }
}

function shortAngleDist(from: number, to: number): number {
  return ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}
