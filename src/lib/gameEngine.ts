import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GameConfig, InputState, CharacterState, GROUND_IMAGE } from './gameTypes';

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

  // ====== HOVERCARS ======
  private hovercars: { mesh: THREE.Group; angle: number; radius: number; height: number; speed: number; offsetX: number; offsetZ: number }[] = [];

  // ====== SKATEBOARD ======
  private skateboardTemplate: THREE.Group | null = null;
  private playerSkateboard: THREE.Group | null = null;

  // ====== CAMERA (TPS orbit) ======
  private camDist = 3.5;
  private camHeight = 2.2;
  private camSmoothPos = new THREE.Vector3();
  private camSmoothLook = new THREE.Vector3();

  // ====== POST PROCESSING ======
  private rt: THREE.WebGLRenderTarget;
  private postScene: THREE.Scene;
  private postCam: THREE.OrthographicCamera;
  private postMat!: THREE.ShaderMaterial;

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

  // ====== ARM SWING ======
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
  private turnBlur = 0;
  private prevYaw = 0;

  // ====== BUILDINGS ======
  private buildingModels: THREE.Group[] = [];

  // ====== COLLISION BOXES (XZ ground plane) ======
  private obstacleBoxes: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];

  // ====== CRYSTAL GENERATORS ======
  private crystalModels: THREE.Group[] = [];
  private crystalCooldowns: Map<THREE.Group, number> = new Map();
  private onDiamondCollected?: (amount: number) => void;

  // ====== SKY DOME ======
  private skyDome: THREE.Mesh | null = null;

  // ====== TEXTURES ======
  private ready = false;
  private loadCount = 0;
  private totalLoads = 8; // ground + player + npc + skateboard + hovercar + building + crystal + skyscraper

  // ====== CALLBACKS ======
  private onReady?: () => void;
  private onState?: (s: CharacterState) => void;

  constructor(container: HTMLElement, config: GameConfig) {
    this.container = container;
    this.config = config;
    this.input = {
      w: false, a: false, s: false, d: false, space: false,
      mouseX: 0, mouseY: 0, isMouseDown: false, isPointerLocked: false,
      touchStartX: null, touchStartY: null, touchDeltaX: 0, touchDeltaY: 0,
    };
    this.clock = new THREE.Clock();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e18);
    this.scene.fog = new THREE.FogExp2(0x0a0e18, 0.004);

    // Camera
    const asp = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(55, asp, 0.1, 500);

    // Renderer — lower pixel ratio for faster initial load
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    const pr = Math.min(window.devicePixelRatio, 1.5);
    this.rt = new THREE.WebGLRenderTarget(container.clientWidth * pr, container.clientHeight * pr);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene = new THREE.Scene();

    // Character group
    this.charGroup = new THREE.Group();
    this.scene.add(this.charGroup);

    // Init camera positions
    this.camSmoothPos.set(0, this.camHeight, this.camDist);
    this.camSmoothLook.set(0, 1.2, 0);

    // Build everything
    this.setupLighting();
    this.setupGround();
    this.setupContactShadow();
    this.setupPlaceholderChar();
    this.setupParticles();
    this.setupEnvironment();
    this.setupPost();
    this.loadSkyTexture();
    this.loadGroundTexture();
    this.loadGLBModel();
    this.loadNPCModel();
    this.loadSkateboardModel();
    this.loadHovercarModel();
    this.loadBuildingModel();
    this.loadCrystalModel();
    this.loadSkyscraperModel();
  }

  // ==================== LIGHTING ====================
  private dirLight!: THREE.DirectionalLight;
  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x556677, 1.5));

    this.dirLight = new THREE.DirectionalLight(0x8899cc, 3.5);
    this.dirLight.position.set(8, 18, 8);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 80;
    const s = 30;
    this.dirLight.shadow.camera.left = -s;
    this.dirLight.shadow.camera.right = s;
    this.dirLight.shadow.camera.top = s;
    this.dirLight.shadow.camera.bottom = -s;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);

    const dir2 = new THREE.DirectionalLight(0xff8855, 0.8);
    dir2.position.set(-5, 4, -8);
    this.scene.add(dir2);

    this.scene.add(new THREE.HemisphereLight(0x5577aa, 0x334422, 1.0));

    // Spotlight on character
    const spot = new THREE.SpotLight(0xeeeeff, 5, 25, Math.PI / 4, 0.5, 1);
    spot.position.set(0, 12, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0003;
    spot.shadow.normalBias = 0.02;
    this.scene.add(spot);
    this.scene.add(spot.target);

    // Soft fill light from below-behind for better shadow contrast
    const fill = new THREE.PointLight(0x445566, 1.5, 15);
    fill.position.set(0, 0.5, 3);
    this.scene.add(fill);
  }

  // ==================== GROUND ====================
  private setupGround() {
    const geo = new THREE.PlaneGeometry(300, 300);
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x446655, roughness: 0.75, metalness: 0.1 });
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
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uShadowPos;
        uniform float uShadowScale;
        uniform float uHeight;
        varying vec2 vUv;
        void main() {
          vec2 centered = vUv - 0.5;
          float dist = length(centered);
          // Soft elliptical shadow
          float shadow = smoothstep(0.5 * uShadowScale, 0.1 * uShadowScale, dist);
          // Height-based fade (shadow shrinks/fades when jumping)
          float heightFade = 1.0 - clamp(uHeight / 2.0, 0.0, 0.85);
          shadow *= heightFade;
          // Walking pulse — shadow slightly stretches when moving
          shadow *= 0.55;
          gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.contactShadow = new THREE.Mesh(geo, this.contactShadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.01;
    this.contactShadow.renderOrder = -1;
    this.scene.add(this.contactShadow);
  }

  // ==================== PLACEHOLDER (before model loads) ====================
  private placeholderMeshes: THREE.Mesh[] = [];
  private setupPlaceholderChar() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x22aa66, roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.2, 8, 16), mat);
    body.position.y = 1.0; body.castShadow = true;
    this.charGroup.add(body);
    this.placeholderMeshes.push(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), mat.clone());
    head.position.y = 1.95; head.castShadow = true;
    this.charGroup.add(head);
    this.placeholderMeshes.push(head);
  }

  private removePlaceholder() {
    this.placeholderMeshes.forEach(m => {
      this.charGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.placeholderMeshes = [];
  }

  // ==================== LOAD GLB 3D MODEL (Player) ====================
  private loadGLBModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/character.glb',
      (gltf) => {
        console.log('Player GLB loaded, animations:', gltf.animations.length);
        const model = gltf.scene;

        // Auto-scale: fit model into ~2m height
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) this.charScale = 2.0 / maxDim;
        model.scale.setScalar(this.charScale);

        // Center on ground
        box.setFromObject(model);
        model.position.y = -box.min.y;

        // Enable shadows on all meshes
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Find arm/leg bones for procedural animation
        this.findBones(model);

        this.removePlaceholder();
        this.charGroup.add(model);
        this.charModel = model;
        this.modelLoaded = true;

        // Setup animations
        if (gltf.animations.length > 0) {
          this.charMixer = new THREE.AnimationMixer(model);
          let idleAnim: THREE.AnimationClip | null = null;
          let walkAnim: THREE.AnimationClip | null = null;
          let walkBackAnim: THREE.AnimationClip | null = null;

          for (const anim of gltf.animations) {
            const name = anim.name.toLowerCase();
            if (name.includes('idle') || name.includes('stand') || name.includes('breath')) {
              if (!idleAnim) idleAnim = anim;
            } else if (name.includes('walk') || name.includes('forward')) {
              if (!walkAnim) walkAnim = anim;
            } else if (name.includes('backward') || name.includes('back') || name.includes('retreat')) {
              if (!walkBackAnim) walkBackAnim = anim;
            }
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
      },
      undefined,
      (err) => {
        console.error('Player GLB load error:', err);
        this.checkReady();
      }
    );
  }

  // ==================== LOAD SKATEBOARD ====================
  private loadSkateboardModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/skateboard.glb',
      (gltf) => {
        console.log('Skateboard GLB loaded');
        const src = gltf.scene;

        // Auto-scale to ~0.15m tall (typical skateboard)
        const box = new THREE.Box3().setFromObject(src);
        const size = box.getSize(new THREE.Vector3());
        const height = size.y;
        const sScale = height > 0 ? 0.15 / height : 1.0;
        src.scale.setScalar(sScale);

        // Center horizontally, keep bottom at y=0
        box.setFromObject(src);
        const cx = (box.min.x + box.max.x) / 2;
        const cz = (box.min.z + box.max.z) / 2;
        src.position.set(-cx, -box.min.y, -cz);

        src.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        this.skateboardTemplate = src;

        // Attach to player
        this.attachSkateboard(src);
        // Attach to NPCs
        this.npcModels.forEach(npc => this.attachSkateboard(src, npc));

        this.checkReady();
      },
      undefined,
      (err) => {
        console.error('Skateboard load error:', err);
        this.checkReady();
      }
    );
  }

  private attachSkateboard(template: THREE.Group, parent?: THREE.Group) {
    const sb = template.clone();
    sb.name = 'skateboard';

    if (parent) {
      // NPC: skateboard at y=0 in parent local space (feet level)
      sb.position.y = 0;
      parent.add(sb);
    } else {
      // Player: add to charGroup at ground level
      sb.position.y = 0;
      this.charGroup.add(sb);
      this.playerSkateboard = sb;
    }
  }

  // ==================== FIND BONES FOR PROCEDURAL ANIMATION ====================
  private findBones(model: THREE.Object3D) {
    model.traverse((child) => {
      if (!(child instanceof THREE.Bone)) return;
      const n = child.name.toLowerCase();
      // Arms
      if ((n.includes('upperarm') || n.includes('arm_upper') || n.includes('shoulder')) && n.includes('left') && !this.leftArm) {
        this.leftArm = child;
      } else if ((n.includes('upperarm') || n.includes('arm_upper') || n.includes('shoulder')) && (n.includes('right') || n.includes('_r')) && !this.rightArm) {
        this.rightArm = child;
      }
      if ((n.includes('lowerarm') || n.includes('forearm') || n.includes('arm_lower')) && n.includes('left') && !this.leftForearm) {
        this.leftForearm = child;
      } else if ((n.includes('lowerarm') || n.includes('forearm') || n.includes('arm_lower')) && (n.includes('right') || n.includes('_r')) && !this.rightForearm) {
        this.rightForearm = child;
      }
      // Legs
      if ((n.includes('upperleg') || n.includes('thigh') || n.includes('leg_upper')) && n.includes('left') && !this.leftLeg) {
        this.leftLeg = child;
      } else if ((n.includes('upperleg') || n.includes('thigh') || n.includes('leg_upper')) && (n.includes('right') || n.includes('_r')) && !this.rightLeg) {
        this.rightLeg = child;
      }
      if ((n.includes('lowerleg') || n.includes('calf') || n.includes('shin') || n.includes('leg_lower')) && n.includes('left') && !this.leftCalf) {
        this.leftCalf = child;
      } else if ((n.includes('lowerleg') || n.includes('calf') || n.includes('shin') || n.includes('leg_lower')) && (n.includes('right') || n.includes('_r')) && !this.rightCalf) {
        this.rightCalf = child;
      }
    });
    console.log('Bones found:', {
      leftArm: this.leftArm?.name, rightArm: this.rightArm?.name,
      leftForearm: this.leftForearm?.name, rightForearm: this.rightForearm?.name,
      leftLeg: this.leftLeg?.name, rightLeg: this.rightLeg?.name,
      leftCalf: this.leftCalf?.name, rightCalf: this.rightCalf?.name,
    });
  }

  // ==================== PROCEDURAL ARM/LEG ANIMATION ====================
  private applyProceduralAnimation(speed: number) {
    if (speed <= 0) return;
    const swing = 0.6; // Max swing angle
    const forearmSwing = 0.4;
    const legSwing = 0.5;
    const calfSwing = 0.7;

    const phase = this.walkTime;

    // Left arm swings forward when right leg goes forward (natural cross-pattern)
    if (this.leftArm) this.leftArm.rotation.x = Math.sin(phase) * swing;
    if (this.rightArm) this.rightArm.rotation.x = Math.sin(phase + Math.PI) * swing;
    if (this.leftForearm) this.leftForearm.rotation.x = -Math.abs(Math.sin(phase)) * forearmSwing - 0.2;
    if (this.rightForearm) this.rightForearm.rotation.x = -Math.abs(Math.sin(phase + Math.PI)) * forearmSwing - 0.2;

    // Legs
    if (this.leftLeg) this.leftLeg.rotation.x = Math.sin(phase + Math.PI) * legSwing;
    if (this.rightLeg) this.rightLeg.rotation.x = Math.sin(phase) * legSwing;
    if (this.leftCalf) this.leftCalf.rotation.x = Math.max(0, Math.sin(phase + Math.PI + 0.5)) * calfSwing;
    if (this.rightCalf) this.rightCalf.rotation.x = Math.max(0, Math.sin(phase + 0.5)) * calfSwing;
  }

  private resetProceduralAnimation() {
    const lerp = 0.1;
    [this.leftArm, this.rightArm, this.leftForearm, this.rightForearm,
     this.leftLeg, this.rightLeg, this.leftCalf, this.rightCalf].forEach(bone => {
      if (bone) bone.rotation.x *= (1 - lerp);
    });
  }

  // ==================== LOAD NPC MODEL ====================
  private loadNPCModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/npc.glb',
      (gltf) => {
        console.log('NPC GLB loaded');
        const sourceModel = gltf.scene;

        // Auto-scale NPC to ~2m
        const box = new THREE.Box3().setFromObject(sourceModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const npcScale = maxDim > 0 ? 2.0 / maxDim : 1.0;

        // 5 NPC positions — clear of building zones
        const positions = [
          { x: 8, z: -5, ry: 0.5 },
          { x: -8, z: -8, ry: 2.0 },
          { x: 5, z: -15, ry: 3.5 },
          { x: -6, z: -42, ry: 1.2 },
          { x: 12, z: -35, ry: 4.8 },
        ];

        positions.forEach((pos, i) => {
          const wrapper = new THREE.Group();
          const npc = sourceModel.clone();
          npc.scale.setScalar(npcScale);

          // Re-center model on ground within wrapper (local y=0 = feet)
          const b = new THREE.Box3().setFromObject(npc);
          npc.position.y = -b.min.y;

          npc.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          wrapper.add(npc);
          wrapper.position.set(pos.x, 0, pos.z);
          wrapper.rotation.y = pos.ry;
          this.scene.add(wrapper);
          this.npcModels.push(wrapper);

          // NPC collision box (1.5m radius)
          this.obstacleBoxes.push({
            minX: pos.x - 1.5, minZ: pos.z - 1.5,
            maxX: pos.x + 1.5, maxZ: pos.z + 1.5,
          });

          // If skateboard already loaded, attach at wrapper y=0 (feet)
          if (this.skateboardTemplate) {
            this.attachSkateboard(this.skateboardTemplate, wrapper);
          }
        });

        this.checkReady();
      },
      undefined,
      (err) => {
        console.error('NPC GLB load error:', err);
        this.checkReady();
      }
    );
  }

  private playAnim(state: string) {
    if (!this.charMixer) return;
    const action = this.charAnims[state];
    if (!action) return;
    if (this.charCurrentAction === action) return;
    if (this.charCurrentAction) this.charCurrentAction.fadeOut(0.2);
    action.reset().fadeIn(0.2).play();
    this.charCurrentAction = action;
  }

  // ==================== PARTICLES ====================
  private setupParticles() {
    const N = 1200;
    const pos = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const alphas = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 20 + 0.3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      sizes[i] = Math.random() * 3.5 + 0.5;
      alphas[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.ptsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: `
        attribute float size; attribute float aAlpha;
        uniform float uTime; uniform float uPR;
        varying float vAlpha; varying float vD;
        void main(){
          vAlpha=aAlpha; vec3 p=position;
          p.y+=sin(uTime*0.3+p.x*0.5)*0.4;
          p.x+=sin(uTime*0.15+p.z*0.3)*0.3;
          vec4 mv=modelViewMatrix*vec4(p,1.0); vD=-mv.z;
          gl_PointSize=size*uPR*(90.0/max(-mv.z,1.0));
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `
        varying float vAlpha; varying float vD; uniform float uTime;
        void main(){
          float d=length(gl_PointCoord-0.5); if(d>0.5)discard;
          float a=smoothstep(0.5,0.05,d)*vAlpha*0.3;
          a*=0.6+0.4*sin(uTime*1.5+vAlpha*6.28);
          a*=clamp(1.0-vD*0.005,0.0,1.0);
          vec3 c=mix(vec3(0.2,0.5,1.0),vec3(0.0,0.9,0.5),vAlpha);
          gl_FragColor=vec4(c,a);
        }`,
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
      { x: 12, y: 3, z: -25, c: 0xffaa22 }, { x: -14, y: 2, z: -15, c: 0x44ddff },
    ];
    orbData.forEach(({ x, y, z, c }) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7 }));
      m.position.set(x, y, z); this.scene.add(m);
      const l = new THREE.PointLight(c, 3, 12); l.position.set(x, y, z); this.scene.add(l);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.08, side: THREE.BackSide }));
      h.position.set(x, y, z); this.scene.add(h);
      this.orbs.push(m);
    });

    const pp = [
      { x: 10, z: -8 }, { x: -10, z: -8 }, { x: 8, z: -20 }, { x: -8, z: -20 },
      { x: 15, z: -15 }, { x: -15, z: -15 },
    ];
    pp.forEach(({ x, z }) => {
      const p = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.6, 6, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.85, roughness: 0.25 })
      );
      p.position.set(x, 3, z); p.castShadow = true; p.receiveShadow = true; this.scene.add(p);
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.8 }));
      t.position.set(x, 6.15, z); this.scene.add(t);
      const pl = new THREE.PointLight(0x4488ff, 2, 10); pl.position.set(x, 6.15, z); this.scene.add(pl);
    });

    // Buildings are now loaded from GLB (loadBuildingModel)
    // Kept only orbs and poles here for decoration
  }

  // ==================== POST PROCESSING ====================
  private setupPost() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.postMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, uTime: { value: 0 }, uVignette: { value: 1.3 }, uChroma: { value: 0.002 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uChroma;
        varying vec2 vUv;
        void main(){
          vec2 c=vUv-0.5; float d=length(c);
          float r=texture2D(tDiffuse,vUv+c*uChroma).r;
          float g=texture2D(tDiffuse,vUv).g;
          float b=texture2D(tDiffuse,vUv-c*uChroma).b;
          vec3 col=vec3(r,g,b);
          float v=1.0-smoothstep(0.2,0.85,d*uVignette);
          col*=mix(0.35,1.0,v);
          col-=sin(vUv.y*700.0+uTime*1.2)*0.01;
          col=pow(max(col,vec3(0.0)),vec3(0.97));
          gl_FragColor=vec4(col,1.0);
        }`,
      depthWrite: false, depthTest: false,
    });
    this.postScene.add(new THREE.Mesh(geo, this.postMat));
  }

  // ==================== LOAD BUILDING ====================
  private loadBuildingModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/office_building.glb',
      (gltf) => {
        console.log('Building GLB loaded');
        const sourceModel = gltf.scene;

        // Auto-scale building to ~45m tall (large realistic office building)
        const box = new THREE.Box3().setFromObject(sourceModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const bScale = maxDim > 0 ? 45.0 / maxDim : 1.0;

        // Building positions — well spread out, no overlaps
        const positions = [
          { x: 30, z: -20, ry: 0.3, s: bScale },
          { x: -30, z: -30, ry: 1.8, s: bScale * 0.85 },
          { x: 40, z: -55, ry: 0.9, s: bScale * 1.15 },
          { x: -40, z: -15, ry: 2.5, s: bScale * 0.75 },
          { x: 20, z: -65, ry: 4.2, s: bScale * 0.95 },
          { x: -25, z: -60, ry: 1.1, s: bScale * 1.05 },
          { x: 50, z: -10, ry: 3.0, s: bScale * 0.65 },
          { x: -50, z: -50, ry: 0.5, s: bScale * 1.2 },
        ];

        positions.forEach((pos) => {
          const wrapper = new THREE.Group();
          const bld = sourceModel.clone();
          bld.scale.setScalar(pos.s);

          // Center on ground within wrapper
          const b = new THREE.Box3().setFromObject(bld);
          bld.position.y = -b.min.y;

          bld.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          wrapper.add(bld);
          wrapper.position.set(pos.x, 0, pos.z);
          wrapper.rotation.y = pos.ry;
          this.scene.add(wrapper);
          this.buildingModels.push(wrapper);

          // Add collision box (XZ footprint with 1m padding)
          const bb = new THREE.Box3().setFromObject(wrapper);
          this.obstacleBoxes.push({
            minX: bb.min.x - 1, minZ: bb.min.z - 1,
            maxX: bb.max.x + 1, maxZ: bb.max.z + 1,
          });
        });

        this.checkReady();
      },
      undefined,
      (err) => {
        console.error('Building GLB load error:', err);
        this.checkReady();
      }
    );
  }

  // ==================== HOVERCARS (flying in sky) ====================
  private loadHovercarModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/hovercar.glb',
      (gltf) => {
        const src = gltf.scene;

        // Auto-scale to ~4m wide (more visible from ground)
        const box = new THREE.Box3().setFromObject(src);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const carScale = maxDim > 0 ? 4.0 / maxDim : 0.1;
        src.scale.setScalar(carScale);

        // Make all materials emissive so hovercars glow against dark sky + exempt from fog
        src.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.emissive = new THREE.Color(0x114466);
                m.emissiveIntensity = 1.5;
              }
              m.fog = false;
            });
          }
        });

        // 4 hovercars in orderly formation centered near player
        const configs = [
          { radius: 12, height: 10, speed: 0.15, cx: 0, cz: -8, startAngle: 0 },
          { radius: 12, height: 12, speed: 0.15, cx: 0, cz: -8, startAngle: Math.PI / 2 },
          { radius: 12, height: 10, speed: 0.15, cx: 0, cz: -8, startAngle: Math.PI },
          { radius: 12, height: 12, speed: 0.15, cx: 0, cz: -8, startAngle: Math.PI * 1.5 },
        ];

        configs.forEach((cfg) => {
          const car = src.clone();
          car.position.set(cfg.cx, cfg.height, cfg.cz);
          // Exempt cloned meshes from fog
          car.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach(m => { m.fog = false; });
            }
          });

          // Strong point light underneath for visible glow
          const glow = new THREE.PointLight(0x00ccff, 8, 15);
          glow.position.set(0, -1, 0);
          car.add(glow);

          // Secondary orange tail light
          const tail = new THREE.PointLight(0xff6600, 3, 6);
          tail.position.set(0, 0, 1.5);
          car.add(tail);

          this.scene.add(car);
          this.hovercars.push({
            mesh: car,
            angle: cfg.startAngle,
            radius: cfg.radius,
            height: cfg.height,
            speed: cfg.speed,
            offsetX: cfg.cx,
            offsetZ: cfg.cz,
          });
        });

        this.checkReady();
      },
      undefined,
      (err) => {
        console.error('Hovercar load error:', err);
        this.checkReady();
      }
    );
  }

  private updateHovercars(dt: number) {
    this.hovercars.forEach((hc) => {
      hc.angle += hc.speed * dt;
      const x = hc.offsetX + Math.cos(hc.angle) * hc.radius;
      const z = hc.offsetZ + Math.sin(hc.angle) * hc.radius;
      // Gentle bobbing
      const y = hc.height + Math.sin(this.t * 0.6 + hc.angle * 2) * 0.4;
      hc.mesh.position.set(x, y, z);
      // Face tangent direction of the circle
      const nextAngle = hc.angle + 0.01;
      const nx = hc.offsetX + Math.cos(nextAngle) * hc.radius;
      const nz = hc.offsetZ + Math.sin(nextAngle) * hc.radius;
      hc.mesh.lookAt(nx, y, nz);
      // Slight roll/bank
      hc.mesh.rotation.z = Math.sin(this.t * 0.6 + hc.angle * 2) * 0.03;
    });
  }

  // ==================== LOAD CRYSTAL GENERATOR ====================
  private loadCrystalModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/crystal.glb',
      (gltf) => {
        console.log('Crystal GLB loaded');
        const sourceModel = gltf.scene;

        // Auto-scale to ~1.5m tall
        const box = new THREE.Box3().setFromObject(sourceModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const cScale = maxDim > 0 ? 1.5 / maxDim : 1.0;

        // Crystal generator positions scattered around the map
        const positions = [
          { x: 5, z: -8 },
          { x: -8, z: -12 },
          { x: 15, z: -20 },
          { x: -12, z: -25 },
          { x: 3, z: -35 },
          { x: -20, z: -8 },
          { x: 18, z: -30 },
          { x: -5, z: -45 },
          { x: 28, z: -12 },
          { x: -25, z: -35 },
        ];

        positions.forEach((pos, idx) => {
          const wrapper = new THREE.Group();
          const crystal = sourceModel.clone();
          crystal.scale.setScalar(cScale);

          // Center on ground
          const b = new THREE.Box3().setFromObject(crystal);
          crystal.position.y = -b.min.y;

          crystal.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              // Make crystals glow with emissive purple-pink
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach(m => {
                if (m instanceof THREE.MeshStandardMaterial) {
                  m.emissive = new THREE.Color(0xcc44ff);
                  m.emissiveIntensity = 1.2;
                }
              });
            }
          });

          wrapper.add(crystal);
          wrapper.position.set(pos.x, 0, pos.z);
          wrapper.rotation.y = Math.random() * Math.PI * 2;
          this.scene.add(wrapper);
          this.crystalModels.push(wrapper);

          // Add a point light above each crystal for glow effect
          const glow = new THREE.PointLight(0xcc44ff, 5, 8);
          glow.position.set(0, 2, 0);
          wrapper.add(glow);

          // Add a floating diamond indicator above
          const indicatorGeo = new THREE.OctahedronGeometry(0.15, 0);
          const indicatorMat = new THREE.MeshBasicMaterial({ color: 0xdd66ff, transparent: true, opacity: 0.8 });
          const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
          indicator.position.y = 2.5;
          indicator.name = 'diamond_indicator';
          wrapper.add(indicator);
        });

        this.checkReady();
      },
      undefined,
      (err) => {
        console.error('Crystal GLB load error:', err);
        this.checkReady();
      }
    );
  }

  // ==================== CRYSTAL ANIMATION ====================
  private updateCrystals() {
    this.crystalModels.forEach((wrapper, i) => {
      // Slow rotation
      wrapper.rotation.y += 0.003;
      // Floating diamond indicator bob
      const indicator = wrapper.getObjectByName('diamond_indicator');
      if (indicator) {
        indicator.position.y = 2.5 + Math.sin(this.t * 2 + i * 1.5) * 0.3;
        indicator.rotation.y = this.t * 1.5;
        const indMesh = indicator as THREE.Mesh;
        const indMat = indMesh.material as THREE.MeshBasicMaterial;
        // Pulse opacity when ready to collect
        const lastCollect = this.crystalCooldowns.get(wrapper) || 0;
        const elapsed = Date.now() - lastCollect;
        if (elapsed >= 120000) {
          // Ready - bright purple-pink pulse
          indMat.opacity = 0.6 + Math.sin(this.t * 4) * 0.3;
          indMat.color.set(0xff44cc);
        } else {
          // On cooldown - dim
          indMat.opacity = 0.2;
          indMat.color.set(0x553355);
        }
      }
    });
  }

  // ==================== LOAD SKYSCRAPER ====================
  private loadSkyscraperModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/skyscraper.glb',
      (gltf) => {
        console.log('Skyscraper GLB loaded');
        const sourceModel = gltf.scene;

        // Same scale as office_building (~45m tall)
        const box = new THREE.Box3().setFromObject(sourceModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const sScale = maxDim > 0 ? 45.0 / maxDim : 1.0;

        const positions = [
          { x: -20, z: -20, ry: 0.8 },
          { x: 45, z: -35, ry: 2.1 },
          { x: -50, z: -40, ry: 3.7 },
          { x: 15, z: -80, ry: 5.2 },
          { x: -15, z: -85, ry: 1.5 },
        ];

        positions.forEach((pos) => {
          const wrapper = new THREE.Group();
          const bld = sourceModel.clone();
          bld.scale.setScalar(sScale);

          const b = new THREE.Box3().setFromObject(bld);
          bld.position.y = -b.min.y;

          bld.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          wrapper.add(bld);
          wrapper.position.set(pos.x, 0, pos.z);
          wrapper.rotation.y = pos.ry;
          this.scene.add(wrapper);
          this.buildingModels.push(wrapper);

          // Add collision box
          const bb = new THREE.Box3().setFromObject(wrapper);
          this.obstacleBoxes.push({
            minX: bb.min.x - 1, minZ: bb.min.z - 1,
            maxX: bb.max.x + 1, maxZ: bb.max.z + 1,
          });
        });

        this.checkReady();
      },
      undefined,
      (err) => {
        console.error('Skyscraper GLB load error:', err);
        this.checkReady();
      }
    );
  }

  // ==================== SKY DOME ====================
  private loadSkyTexture() {
    const loader = new THREE.TextureLoader();
    loader.load('/sky.webp',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;

        // Create a large inverted sphere as sky dome — always visible, no mapping tricks
        const skyGeo = new THREE.SphereGeometry(200, 64, 32);
        const skyMat = new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.BackSide, // Render inside of sphere
          fog: false,           // Never affected by fog
          depthWrite: false,    // Always behind everything
        });
        this.skyDome = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(this.skyDome);

        // Also generate PMREM for environment reflections on metallic surfaces
        const equirectTex = tex.clone();
        equirectTex.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();
        const envRT = pmrem.fromEquirectangular(equirectTex);
        this.scene.environment = envRT.texture;
        pmrem.dispose();
        equirectTex.dispose();

        console.log('Sky dome created successfully');
      },
      undefined,
      (err) => console.warn('Sky texture failed to load:', err)
    );
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
      tex.repeat.set(40, 40);
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
  setOnDiamondCollected(cb: (amount: number) => void) { this.onDiamondCollected = cb; }
  updateInput(p: Partial<InputState>) { Object.assign(this.input, p); }

  // ==================== CLICK / RAYCAST FOR CRYSTALS ====================
  private raycaster = new THREE.Raycaster();
  private clickHandler = (e: MouseEvent) => {
    if (!this.input.isPointerLocked) return;
    const mouse = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const allMeshes: THREE.Object3D[] = [];
    this.crystalModels.forEach(g => g.traverse(c => { if (c instanceof THREE.Mesh) allMeshes.push(c); }));
    const intersects = this.raycaster.intersectObjects(allMeshes, false);
    if (intersects.length > 0) {
      // Find which crystal group this belongs to
      let hitObj: THREE.Object3D | null = intersects[0].object;
      while (hitObj && !this.crystalModels.includes(hitObj as THREE.Group)) {
        hitObj = hitObj.parent;
      }
      if (hitObj && this.crystalModels.includes(hitObj as THREE.Group)) {
        this.tryCollectCrystal(hitObj as THREE.Group);
      }
    }
  };

  private tryCollectCrystal(crystal: THREE.Group) {
    // Check distance
    const playerPos = this.charWorldPos.clone();
    playerPos.y = 0;
    const crystalPos = crystal.position.clone();
    crystalPos.y = 0;
    const dist = playerPos.distanceTo(crystalPos);
    if (dist > 5) return; // Must be within 5m

    // Check cooldown (120 seconds = 2 minutes)
    const now = Date.now();
    const lastCollect = this.crystalCooldowns.get(crystal) || 0;
    if (now - lastCollect < 120000) return;

    // Collect!
    this.crystalCooldowns.set(crystal, now);
    this.onDiamondCollected?.(10);

    // Visual feedback - flash the crystal
    crystal.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (m instanceof THREE.MeshStandardMaterial) {
            const origEmissive = m.emissive.clone();
            m.emissive.set(0xffffff);
            m.emissiveIntensity = 3;
            setTimeout(() => {
              m.emissive.copy(origEmissive);
              m.emissiveIntensity = 1.0;
            }, 400);
          }
        });
      }
    });
  }


  // ==================== CAMERA ====================
  private updateCamera() {
    const targetPos = new THREE.Vector3(
      this.charWorldPos.x + Math.sin(this.yaw) * this.camDist,
      this.charWorldPos.y + this.camHeight - this.pitch * 2,
      this.charWorldPos.z + Math.cos(this.yaw) * this.camDist,
    );
    const targetLook = this.charWorldPos.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.camSmoothPos.lerp(targetPos, 0.08);
    this.camSmoothLook.lerp(targetLook, 0.1);
    this.camera.position.copy(this.camSmoothPos);
    this.camera.lookAt(this.camSmoothLook);
  }

  // ==================== JUMP PHYSICS ====================
  private updateJump(dt: number) {
    if (this.input.space && this.isGrounded) {
      this.velocityY = this.config.jumpForce;
      this.isGrounded = false;
      if (this.charState !== 'walking_forward' && this.charState !== 'walking_backward') {
        this.charState = 'jumping';
        this.onState?.('jumping');
      }
    }

    if (!this.isGrounded) {
      this.velocityY -= this.config.gravity;
      this.charWorldPos.y += this.velocityY;

      if (this.charWorldPos.y <= 0) {
        this.charWorldPos.y = 0;
        this.velocityY = 0;
        this.isGrounded = true;
        // Return to previous state
        const moving = this.input.w || this.input.a || this.input.s || this.input.d;
        if (!moving) {
          this.charState = 'idle';
          this.playAnim('idle');
          this.onState?.('idle');
        }
      }
    }
  }

  // ==================== MOVEMENT ====================
  private updateMovement(dt: number) {
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
      const newX = this.charWorldPos.x + dir.x;
      const newZ = this.charWorldPos.z + dir.z;

      // Collision check — try X and Z independently for wall sliding
      const R = 0.5; // player radius
      let canX = true, canZ = true;
      for (const ob of this.obstacleBoxes) {
        // Check X movement
        if (newX + R > ob.minX && newX - R < ob.maxX && this.charWorldPos.z + R > ob.minZ && this.charWorldPos.z - R < ob.maxZ) {
          canX = false;
        }
        // Check Z movement
        if (this.charWorldPos.x + R > ob.minX && this.charWorldPos.x - R < ob.maxX && newZ + R > ob.minZ && newZ - R < ob.maxZ) {
          canZ = false;
        }
      }
      if (canX) this.charWorldPos.x = newX;
      if (canZ) this.charWorldPos.z = newZ;

      const targetRot = Math.atan2(dir.x, dir.z);
      this.charRotation += shortAngleDist(this.charRotation, targetRot) * 0.15;

      const isF = this.input.w && !this.input.s;
      const isB = this.input.s && !this.input.w;
      if (isF && this.charState !== 'walking_forward') {
        this.charState = 'walking_forward'; this.playAnim('walking_forward'); this.onState?.('walking_forward');
      } else if (isB && this.charState !== 'walking_backward') {
        this.charState = 'walking_backward'; this.playAnim('walking_backward'); this.onState?.('walking_backward');
      } else if (!isF && !isB && this.charState !== 'walking_forward') {
        this.charState = 'walking_forward'; this.playAnim('walking_forward'); this.onState?.('walking_forward');
      }
      this.walkTime += dt * this.config.walkBounceSpeed;
    } else if (!moving && this.isGrounded) {
      if (this.charState !== 'idle') { this.charState = 'idle'; this.playAnim('idle'); this.onState?.('idle'); }
      this.walkTime *= 0.9;
    }

    // Update character transform
    this.charGroup.position.copy(this.charWorldPos);
    this.charGroup.rotation.y = this.charRotation;

    // If no animations, do manual bounce for placeholder
    if (!this.modelLoaded || !this.charMixer) {
      const bounce = moving && this.isGrounded ? Math.abs(Math.sin(this.walkTime)) * this.config.walkBounceHeight * 0.3 : 0;
      this.placeholderMeshes.forEach(m => {
        m.position.y = (m === this.placeholderMeshes[0] ? 1.0 : 1.95) + bounce;
      });
    }

    // Procedural arm/leg swing
    if (this.modelLoaded && moving && this.isGrounded) {
      this.applyProceduralAnimation(this.config.moveSpeed);
    } else if (this.modelLoaded) {
      this.resetProceduralAnimation();
    }
  }

  // ==================== CONTACT SHADOW UPDATE ====================
  private updateContactShadow() {
    this.contactShadow.position.x = this.charWorldPos.x;
    this.contactShadow.position.z = this.charWorldPos.z;
    this.contactShadow.rotation.z = this.charRotation;

    const height = this.charWorldPos.y;
    const moving = this.input.w || this.input.a || this.input.s || this.input.d;
    const walkPulse = moving && this.isGrounded ? 1.0 + Math.sin(this.walkTime * 2) * 0.08 : 1.0;

    this.contactShadowMat.uniforms.uShadowPos.value.set(this.charWorldPos.x, 0.01, this.charWorldPos.z);
    this.contactShadowMat.uniforms.uShadowScale.value = walkPulse;
    this.contactShadowMat.uniforms.uHeight.value = height;
  }

  // ==================== DYNAMIC SHADOW LIGHT FOLLOW ====================
  private updateShadowLight() {
    // Main directional light follows player for better shadow quality
    this.dirLight.position.set(
      this.charWorldPos.x + 8,
      18,
      this.charWorldPos.z + 8
    );
    this.dirLight.target.position.copy(this.charWorldPos);
    this.dirLight.target.updateMatrixWorld();

    // Spotlight follows player
    const spot = this.scene.children.find(c => c instanceof THREE.SpotLight) as THREE.SpotLight | undefined;
    if (spot) {
      spot.position.set(this.charWorldPos.x, 12, this.charWorldPos.z);
      spot.target.position.copy(this.charWorldPos);
      spot.target.updateMatrixWorld();
    }
  }

  // ==================== LOOK ====================
  private updateLook() {
    if (this.input.isPointerLocked) {
      this.yaw -= this.input.mouseX * this.config.lookSensitivity;
      this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + this.input.mouseY * this.config.lookSensitivity * 0.5));
    }
    if (this.input.touchStartX !== null) {
      this.yaw -= this.input.touchDeltaX * this.config.lookSensitivity * 0.5;
      this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + this.input.touchDeltaY * this.config.lookSensitivity * 0.25));
    }
    const yd = Math.abs(this.yaw - this.prevYaw);
    this.turnBlur += (yd * 30 - this.turnBlur) * 0.1;
    this.turnBlur = Math.min(this.turnBlur, this.config.turnBlurIntensity);
    this.prevYaw = this.yaw;
    this.postMat.uniforms.uChroma.value = 0.002 + this.turnBlur * 0.008;
    this.postMat.uniforms.uVignette.value = 1.3 + this.turnBlur * 0.3;
  }

  // ==================== SKY DOME FOLLOW CAMERA ====================
  private updateSkyDome() {
    if (!this.skyDome) return;
    // Sky dome always centered on camera position so it never clips
    this.skyDome.position.copy(this.camera.position);
  }

  // ==================== MAIN LOOP ====================
  private animate = () => {
    if (!this.isRunning) return;
    this.animId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;

    this.updateJump(dt);
    this.updateMovement(dt);
    this.updateLook();
    this.updateCamera();
    this.updateContactShadow();
    this.updateShadowLight();
    this.updateHovercars(dt);
    this.updateSkyDome();
    this.updateCrystals();

    // Update animation mixer
    if (this.charMixer) this.charMixer.update(dt);

    this.ptsMat.uniforms.uTime.value = this.t;
    this.orbs.forEach((o, i) => {
      o.position.y += Math.sin(this.t * 0.4 + i * 1.7) * 0.004;
      (o.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(this.t * 0.7 + i * 2.3) * 0.2;
    });
    this.postMat.uniforms.uTime.value = this.t;

    // Render
    this.renderer.clear();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.clearDepth();
    this.renderer.render(this.postScene, this.postCam);
  };

  start() {
    this.isRunning = true;
    this.clock.start();
    this.animate();
    window.addEventListener('click', this.clickHandler);
  }
  stop() {
    this.isRunning = false;
    cancelAnimationFrame(this.animId);
    window.removeEventListener('click', this.clickHandler);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const pr = Math.min(window.devicePixelRatio, 2);
    this.rt.setSize(w * pr, h * pr);
    this.ptsMat.uniforms.uPR.value = pr;
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
    this.rt.dispose();
    this.groundMat.dispose();
    this.ptsMat.dispose();
    this.postMat.dispose();
    this.contactShadowMat.dispose();
  }

  getIsReady() { return this.ready; }
  getModelLoaded() { return this.modelLoaded; }
}

function shortAngleDist(from: number, to: number): number {
  return ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}
