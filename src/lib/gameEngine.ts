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

  // ====== CAMERA (TPS orbit) ======
  private camDist = 6;
  private camHeight = 3.5;
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

  // ====== SHOOT FX ======
  private shootTimer = 0;
  private shootRings: THREE.Mesh[] = [];
  private muzzleLight!: THREE.PointLight;

  // ====== STATE ======
  private config: GameConfig;
  private input: InputState;
  private charState: CharacterState = 'idle';
  private yaw = Math.PI;
  private pitch = 0.3;
  private walkTime = 0;
  private t = 0;
  private turnBlur = 0;
  private prevYaw = 0;

  // ====== TEXTURES ======
  private groundImg: HTMLImageElement | null = null;
  private ready = false;
  private loadCount = 0;

  // ====== CALLBACKS ======
  private onReady?: () => void;
  private onState?: (s: CharacterState) => void;
  private onModelLoadProgress?: (pct: number) => void;

  constructor(container: HTMLElement, config: GameConfig) {
    this.container = container;
    this.config = config;
    this.input = {
      w: false, a: false, s: false, d: false,
      mouseX: 0, mouseY: 0, isMouseDown: false, isPointerLocked: false,
      touchStartX: null, touchStartY: null, touchDeltaX: 0, touchDeltaY: 0,
    };
    this.clock = new THREE.Clock();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e18);
    this.scene.fog = new THREE.FogExp2(0x0a0e18, 0.006);

    // Camera
    const asp = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, asp, 0.1, 500);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    const pr = Math.min(window.devicePixelRatio, 2);
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
    this.setupPlaceholderChar();
    this.setupParticles();
    this.setupEnvironment();
    this.setupPost();
    this.setupMuzzleFlash();
    this.loadGroundTexture();
    this.loadGLBModel();
  }

  // ==================== LIGHTING ====================
  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x556677, 1.8));

    const dir = new THREE.DirectionalLight(0x8899cc, 3.0);
    dir.position.set(8, 15, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 80;
    const s = 30;
    dir.shadow.camera.left = -s; dir.shadow.camera.right = s;
    dir.shadow.camera.top = s; dir.shadow.camera.bottom = -s;
    dir.shadow.bias = -0.001;
    this.scene.add(dir);

    this.scene.add(new THREE.DirectionalLight(0xff8855, 0.6).translateX(-5).translateY(4).translateZ(-8));
    this.scene.add(new THREE.HemisphereLight(0x5577aa, 0x334422, 0.8));

    // Spotlight on character
    const spot = new THREE.SpotLight(0xffffff, 4, 20, Math.PI / 4, 0.5, 1);
    spot.position.set(0, 10, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot);
    this.scene.add(spot.target);
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

  // ==================== PLACEHOLDER (before model loads) ====================
  private placeholderMeshes: THREE.Mesh[] = [];
  private setupPlaceholderChar() {
    // Simple capsule placeholder
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

  // ==================== LOAD GLB 3D MODEL ====================
  private loadGLBModel() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(
      '/character.glb',
      (gltf) => {
        console.log('GLB loaded:', gltf.scene, 'animations:', gltf.animations.length);

        const model = gltf.scene;

        // Auto-scale: fit model into ~2m height
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          this.charScale = 2.0 / maxDim;
        }
        model.scale.setScalar(this.charScale);

        // Center model on ground
        box.setFromObject(model);
        const bottom = box.min.y;
        model.position.y = -bottom;

        // Enable shadows on all meshes
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        // Remove placeholder
        this.removePlaceholder();

        // Add model to character group
        this.charGroup.add(model);
        this.charModel = model;
        this.modelLoaded = true;

        // Setup animations if available
        if (gltf.animations.length > 0) {
          this.charMixer = new THREE.AnimationMixer(model);

          // Categorize animations by name heuristics
          let idleAnim: THREE.AnimationClip | null = null;
          let walkAnim: THREE.AnimationClip | null = null;
          let walkBackAnim: THREE.AnimationClip | null = null;
          let shootAnim: THREE.AnimationClip | null = null;
          let runAnim: THREE.AnimationClip | null = null;

          for (const anim of gltf.animations) {
            const name = anim.name.toLowerCase();
            if (name.includes('idle') || name.includes('stand') || name.includes('breath')) {
              if (!idleAnim) idleAnim = anim;
            } else if (name.includes('walk') || name.includes('forward')) {
              if (!walkAnim) walkAnim = anim;
            } else if (name.includes('backward') || name.includes('back') || name.includes('retreat')) {
              if (!walkBackAnim) walkBackAnim = anim;
            } else if (name.includes('shoot') || name.includes('fire') || name.includes('attack') || name.includes('punch')) {
              if (!shootAnim) shootAnim = anim;
            } else if (name.includes('run')) {
              if (!runAnim) runAnim = anim;
            }
          }

          // Fallback: if no specific anims found, use first animations
          if (!idleAnim && gltf.animations.length > 0) idleAnim = gltf.animations[0];
          if (!walkAnim && gltf.animations.length > 1) walkAnim = gltf.animations[1];
          if (!shootAnim && gltf.animations.length > 2) shootAnim = gltf.animations[2];
          if (walkAnim) walkAnim = walkAnim || idleAnim;
          if (!walkBackAnim) walkBackAnim = walkAnim; // Use walk as fallback

          if (idleAnim) this.charAnims['idle'] = this.charMixer.clipAction(idleAnim);
          if (walkAnim) this.charAnims['walking_forward'] = this.charMixer.clipAction(walkAnim);
          if (walkBackAnim && walkBackAnim !== walkAnim) this.charAnims['walking_backward'] = this.charMixer.clipAction(walkBackAnim);
          else if (walkAnim) this.charAnims['walking_backward'] = this.charMixer.clipAction(walkAnim);
          if (shootAnim) this.charAnims['shooting'] = this.charMixer.clipAction(shootAnim);
          if (runAnim) this.charAnims['run'] = this.charMixer.clipAction(runAnim);

          // Play idle by default
          this.playAnim('idle');

          console.log('Available anims:', Object.keys(this.charAnims));
        }

        this.checkReady();
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          console.log('GLB load:', pct + '%');
        }
      },
      (err) => {
        console.error('GLB load error:', err);
        this.checkReady(); // Continue even if model fails
      }
    );
  }

  private playAnim(state: string) {
    if (!this.charMixer) return;
    const action = this.charAnims[state];
    if (!action) return;
    if (this.charCurrentAction === action) return;

    if (this.charCurrentAction) {
      this.charCurrentAction.fadeOut(0.2);
    }
    action.reset().fadeIn(0.2).play();
    this.charCurrentAction = action;
  }

  // ==================== PARTICLES ====================
  private setupParticles() {
    const N = 3000;
    const pos = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const alphas = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i*3]=(Math.random()-0.5)*120; pos[i*3+1]=Math.random()*20+0.3; pos[i*3+2]=(Math.random()-0.5)*120;
      sizes[i]=Math.random()*3.5+0.5; alphas[i]=Math.random();
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
      {x:8,y:3,z:-10,c:0x2266ff},{x:-10,y:4,z:-7,c:0xff4422},
      {x:5,y:2,z:-18,c:0x22ff88},{x:-6,y:5,z:-20,c:0x8844ff},
      {x:12,y:3,z:-25,c:0xffaa22},{x:-14,y:2,z:-15,c:0x44ddff},
      {x:0,y:6,z:-30,c:0xff2288},{x:-20,y:3,z:-25,c:0x22ffcc},
    ];
    orbData.forEach(({x,y,z,c})=>{
      const m=new THREE.Mesh(new THREE.SphereGeometry(0.2,12,12),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.7}));
      m.position.set(x,y,z); this.scene.add(m);
      const l=new THREE.PointLight(c,3,12); l.position.set(x,y,z); this.scene.add(l);
      const h=new THREE.Mesh(new THREE.SphereGeometry(0.6,8,8),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.08,side:THREE.BackSide}));
      h.position.set(x,y,z); this.scene.add(h);
      this.orbs.push(m);
    });

    const pp=[
      {x:10,z:-8},{x:-10,z:-8},{x:8,z:-20},{x:-8,z:-20},
      {x:15,z:-15},{x:-15,z:-15},{x:0,z:-30},{x:12,z:-35},{x:-12,z:-35},
      {x:20,z:-25},{x:-20,z:-25},
    ];
    pp.forEach(({x,z})=>{
      const p=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.6,6,8),new THREE.MeshStandardMaterial({color:0x1a2a3a,metalness:0.85,roughness:0.25}));
      p.position.set(x,3,z); p.castShadow=true; p.receiveShadow=true; this.scene.add(p);
      const t=new THREE.Mesh(new THREE.SphereGeometry(0.15,8,8),new THREE.MeshBasicMaterial({color:0x4488ff,transparent:true,opacity:0.8}));
      t.position.set(x,6.15,z); this.scene.add(t);
      const pl=new THREE.PointLight(0x4488ff,2,10); pl.position.set(x,6.15,z); this.scene.add(pl);
    });

    for(let i=0;i<40;i++){
      const w=Math.random()*5+1,h=Math.random()*10+3,d=Math.random()*5+1;
      const b=new THREE.Mesh(
        new THREE.BoxGeometry(w,h,d),
        new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(0.55+Math.random()*0.1,0.3,0.05+Math.random()*0.04),metalness:0.7,roughness:0.4})
      );
      const a=Math.random()*Math.PI*2,r=25+Math.random()*50;
      b.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r);
      b.castShadow=true; this.scene.add(b);
    }
  }

  // ==================== MUZZLE FLASH ====================
  private setupMuzzleFlash() {
    this.muzzleLight = new THREE.PointLight(0xffaa44, 0, 10);
    this.muzzleLight.position.set(0, 2.0, -0.5);
    this.charGroup.add(this.muzzleLight);
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
    if (this.loadCount >= 2 && !this.ready) { this.ready = true; this.onReady?.(); }
  }

  // ==================== PUBLIC API ====================
  setOnReady(cb: () => void) { this.onReady = cb; }
  setOnStateChange(cb: (s: CharacterState) => void) { this.onState = cb; }
  setOnModelLoadProgress(cb: (pct: number) => void) { this.onModelLoadProgress = cb; }
  updateInput(p: Partial<InputState>) { Object.assign(this.input, p); }

  triggerShoot() {
    if (this.charState === 'shooting') return;
    this.charState = 'shooting';
    this.shootTimer = 0.3;
    this.muzzleLight.intensity = 25;
    this.playAnim('shooting');
    this.onState?.('shooting');

    // Shoot ring FX
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), this.charRotation);
    ring.position.copy(this.charWorldPos).add(fwd.multiplyScalar(1.5)).add(new THREE.Vector3(0, 1.5, 0));
    ring.lookAt(ring.position.clone().add(fwd));
    this.scene.add(ring);
    this.shootRings.push(ring);

    setTimeout(() => {
      if (this.charState === 'shooting') {
        this.charState = 'idle'; this.playAnim('idle'); this.onState?.('idle');
      }
    }, 350);
  }

  // ==================== CAMERA ====================
  private updateCamera() {
    const targetPos = new THREE.Vector3(
      this.charWorldPos.x + Math.sin(this.yaw) * this.camDist,
      this.charWorldPos.y + this.camHeight - this.pitch * 3,
      this.charWorldPos.z + Math.cos(this.yaw) * this.camDist,
    );
    const targetLook = this.charWorldPos.clone().add(new THREE.Vector3(0, 1.2, 0));

    this.camSmoothPos.lerp(targetPos, 0.06);
    this.camSmoothLook.lerp(targetLook, 0.08);

    this.camera.position.copy(this.camSmoothPos);
    this.camera.lookAt(this.camSmoothLook);
  }

  // ==================== MOVEMENT ====================
  private updateMovement(dt: number) {
    const camFwd = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
    camFwd.y = 0; camFwd.normalize();
    const camRight = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), this.yaw);
    camRight.y = 0; camRight.normalize();

    const dir = new THREE.Vector3();
    if (this.input.w) dir.add(camFwd);
    if (this.input.s) dir.sub(camFwd);
    if (this.input.d) dir.add(camRight);
    if (this.input.a) dir.sub(camRight);
    const moving = dir.lengthSq() > 0;

    if (moving && this.charState !== 'shooting') {
      dir.normalize().multiplyScalar(this.config.moveSpeed);
      this.charWorldPos.add(dir);

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
    } else if (!moving && this.charState !== 'shooting') {
      if (this.charState !== 'idle') { this.charState = 'idle'; this.playAnim('idle'); this.onState?.('idle'); }
      this.walkTime *= 0.9;
    }

    // Update character transform
    this.charGroup.position.copy(this.charWorldPos);
    this.charGroup.rotation.y = this.charRotation;

    // If no animations, do manual bounce for placeholder
    if (!this.modelLoaded || !this.charMixer) {
      const bounce = moving ? Math.abs(Math.sin(this.walkTime)) * this.config.walkBounceHeight * 0.3 : 0;
      this.placeholderMeshes.forEach(m => { m.position.y = (m === this.placeholderMeshes[0] ? 1.0 : 1.95) + bounce; });
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

  // ==================== SHOOT FX ====================
  private updateShootFX(dt: number) {
    if (this.muzzleLight.intensity > 0) this.muzzleLight.intensity *= 0.85;
    for (let i = this.shootRings.length - 1; i >= 0; i--) {
      const ring = this.shootRings[i];
      ring.scale.multiplyScalar(1.1);
      (ring.material as THREE.MeshBasicMaterial).opacity *= 0.88;
      if ((ring.material as THREE.MeshBasicMaterial).opacity < 0.01) {
        this.scene.remove(ring); ring.geometry.dispose(); (ring.material as THREE.Material).dispose();
        this.shootRings.splice(i, 1);
      }
    }
  }

  // ==================== MAIN LOOP ====================
  private animate = () => {
    if (!this.isRunning) return;
    this.animId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;

    this.updateMovement(dt);
    this.updateLook();
    this.updateCamera();
    this.updateShootFX(dt);

    // Update animation mixer
    if (this.charMixer) this.charMixer.update(dt);

    // Spotlight follows character
    const spot = this.scene.children.find(c => c instanceof THREE.SpotLight) as THREE.SpotLight | undefined;
    if (spot) { spot.position.set(this.charWorldPos.x, 10, this.charWorldPos.z); spot.target.position.copy(this.charWorldPos); }

    this.ptsMat.uniforms.uTime.value = this.t;
    this.orbs.forEach((o, i) => {
      o.position.y += Math.sin(this.t*0.4+i*1.7)*0.004;
      (o.material as THREE.MeshBasicMaterial).opacity = 0.5+Math.sin(this.t*0.7+i*2.3)*0.2;
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

  start() { this.isRunning = true; this.clock.start(); this.animate(); }
  stop() { this.isRunning = false; cancelAnimationFrame(this.animId); }

  resize(w: number, h: number) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const pr = Math.min(window.devicePixelRatio, 2);
    this.rt.setSize(w * pr, h * pr);
    this.ptsMat.uniforms.uPR.value = pr;
  }

  dispose() {
    this.stop(); this.renderer.dispose(); this.rt.dispose();
    this.groundMat.dispose(); this.ptsMat.dispose(); this.postMat.dispose();
  }

  getIsReady() { return this.ready; }
  getModelLoaded() { return this.modelLoaded; }
}

function shortAngleDist(from: number, to: number): number {
  return ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}
