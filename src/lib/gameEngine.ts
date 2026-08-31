import * as THREE from 'three';
import { GameConfig, InputState, CharacterState, CHARACTER_IMAGES, GROUND_IMAGE } from './gameTypes';

export class GameEngine {
  // ====== CORE ======
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  private container: HTMLElement;
  private animId = 0;
  private isRunning = false;

  // ====== POST PROCESSING ======
  private rt: THREE.WebGLRenderTarget;
  private postScene: THREE.Scene;
  private postCam: THREE.OrthographicCamera;
  private postMat!: THREE.ShaderMaterial;

  // ====== FPS WEAPON OVERLAY ======
  private weaponScene: THREE.Scene;
  private weaponCam: THREE.OrthographicCamera;
  private weaponMesh!: THREE.Mesh;
  private weaponMat!: THREE.ShaderMaterial;
  private glowMesh!: THREE.Mesh;
  private glowMat!: THREE.ShaderMaterial;

  // ====== GROUND ======
  private groundMesh!: THREE.Mesh;
  private groundMat!: THREE.MeshStandardMaterial;

  // ====== PARTICLES ======
  private pts!: THREE.Points;
  private ptsMat!: THREE.ShaderMaterial;

  // ====== ENVIRONMENT ======
  private orbs: THREE.Mesh[] = [];

  // ====== STATE ======
  private config: GameConfig;
  private input: InputState;
  private charState: CharacterState = 'idle';
  private yaw = 0;
  private pitch = 0;
  private walkTime = 0;
  private t = 0;
  private turnBlur = 0;
  private prevYaw = 0;
  private shootTimer = 0;

  // ====== TEXTURES ======
  private charImgs: Record<string, HTMLImageElement | null> = { forward: null, backward: null, shooting: null };
  private groundImg: HTMLImageElement | null = null;
  private ready = false;
  private loadCount = 0;

  // ====== CALLBACKS ======
  private onReady?: () => void;
  private onState?: (s: CharacterState) => void;

  constructor(container: HTMLElement, config: GameConfig) {
    this.container = container;
    this.config = config;
    this.input = {
      w: false, a: false, s: false, d: false,
      mouseX: 0, mouseY: 0,
      isMouseDown: false, isPointerLocked: false,
      touchStartX: null, touchStartY: null,
      touchDeltaX: 0, touchDeltaY: 0,
    };
    this.clock = new THREE.Clock();

    // ---- Scene ----
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c14);
    this.scene.fog = new THREE.FogExp2(0x080c14, 0.012);

    // ---- Camera ----
    const asp = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(72, asp, 0.1, 500);
    this.camera.position.set(0, 1.7, 0);

    // ---- Renderer ----
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    // CRITICAL: disable auto-clear so overlay doesn't erase screen
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    const pr = Math.min(window.devicePixelRatio, 2);
    this.rt = new THREE.WebGLRenderTarget(container.clientWidth * pr, container.clientHeight * pr);

    // ---- Post camera/scene ----
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene = new THREE.Scene();

    // ---- Weapon overlay scene/camera ----
    // Frustum: -2..2 horizontal, -2..2 vertical — weapon at (-1.5, -2..2) visible
    this.weaponCam = new THREE.OrthographicCamera(-2, 2, -2, 2, 0.1, 50);
    this.weaponCam.position.set(0, 0, 5);
    this.weaponCam.lookAt(0, 0, 0);
    this.weaponScene = new THREE.Scene();

    // Build
    this.setupLighting();
    this.setupGround();
    this.setupWeapon();
    this.setupParticles();
    this.setupEnvironment();
    this.setupPost();
    this.loadTextures();
  }

  // ========== LIGHTING ==========
  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x445566, 1.2));
    const dir = new THREE.DirectionalLight(0x7799cc, 2.0);
    dir.position.set(5, 12, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 60;
    const s = 20;
    dir.shadow.camera.left = -s; dir.shadow.camera.right = s;
    dir.shadow.camera.top = s; dir.shadow.camera.bottom = -s;
    this.scene.add(dir);
    this.scene.add(new THREE.DirectionalLight(0xff7744, 0.4).translateX(-3).translateY(3).translateZ(-5));
    this.scene.add(new THREE.HemisphereLight(0x4466aa, 0x223311, 0.5));
  }

  // ========== GROUND ==========
  private setupGround() {
    const geo = new THREE.PlaneGeometry(200, 200);
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x446655, roughness: 0.8, metalness: 0.1 });
    this.groundMesh = new THREE.Mesh(geo, this.groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // Extra: grid helper for visual reference
    const grid = new THREE.GridHelper(80, 80, 0x1a3a2a, 0x0d1f15);
    grid.position.y = 0.005;
    this.scene.add(grid);
  }

  // ========== WEAPON OVERLAY (FIRST PERSON) ==========
  private setupWeapon() {
    // Weapon plane — positioned bottom-right, like FPS weapon view
    const geo = new THREE.PlaneGeometry(2.2, 2.2);

    // Create a visible placeholder texture (green checkerboard)
    const placeholderTex = this.makePlaceholderTexture(0x22aa66, 'KARAKTER');

    this.weaponMat = new THREE.ShaderMaterial({
      uniforms: {
        tChar: { value: placeholderTex },
        uBounceY: { value: 0.0 },
        uSway: { value: 0.0 },
        uBlur: { value: 0.0 },
        uShootFlash: { value: 0.0 },
        uTime: { value: 0.0 },
      },
      vertexShader: `
        uniform float uBounceY;
        uniform float uSway;
        uniform float uShootFlash;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 pos = position;
          pos.y += uBounceY;
          float sw = uSway * 0.03;
          float c = cos(sw); float ss = sin(sw);
          pos.xz = mat2(c, -ss, ss, c) * pos.xz;
          pos.y += uShootFlash * 0.2;
          pos.z += uShootFlash * 0.4;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tChar;
        uniform float uBlur;
        uniform float uShootFlash;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec4 col = texture2D(tChar, vUv);
          if (col.a < 0.05) discard;
          // Motion blur
          vec4 blurred = vec4(0.0);
          float tw = 0.0;
          if (uBlur > 0.01) {
            for (float i = -6.0; i <= 6.0; i += 1.0) {
              float w = 1.0 - abs(i) / 7.0;
              w *= w;
              blurred += texture2D(tChar, clamp(vUv + vec2(i * uBlur * 0.004, 0.0), 0.0, 1.0)) * w;
              tw += w;
            }
            blurred /= tw;
            col = mix(col, blurred, min(uBlur, 1.0));
          }
          col.rgb += vec3(1.0, 0.7, 0.3) * uShootFlash * 0.5;
          // Edge glow
          float edgeX = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
          float edgeY = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
          float edge = 1.0 - edgeX * edgeY;
          vec3 glowCol = mix(vec3(0.15,0.5,1.0), vec3(0.0,1.0,0.5), sin(uTime*0.8)*0.5+0.5);
          col.rgb += glowCol * edge * 0.5;
          col.rgb = pow(col.rgb, vec3(0.96));
          gl_FragColor = vec4(col.rgb, col.a);
        }
      `,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });

    this.weaponMesh = new THREE.Mesh(geo, this.weaponMat);
    // Position: bottom-right of screen (FPS weapon position)
    this.weaponMesh.position.set(0.6, -1.6, 0);
    this.weaponMesh.scale.set(1.1, 1.1, 1.1);
    this.weaponScene.add(this.weaponMesh);

    // Glow behind weapon
    const glowGeo = new THREE.PlaneGeometry(3.0, 3.0);
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 c=vUv-0.5; float d=length(c);
          float g=exp(-d*3.0)*0.3*(0.85+0.15*sin(uTime*2.0));
          vec3 col=mix(vec3(0.1,0.4,1.0),vec3(0.0,0.9,0.5),sin(uTime*0.4)*0.5+0.5);
          gl_FragColor=vec4(col,g);
        }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.glowMesh = new THREE.Mesh(glowGeo, this.glowMat);
    this.glowMesh.position.set(0.6, -1.6, -0.1);
    this.weaponScene.add(this.glowMesh);
  }

  // ========== PARTICLES ==========
  private setupParticles() {
    const N = 3000;
    const pos = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const alphas = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i*3]=(Math.random()-0.5)*80; pos[i*3+1]=Math.random()*16+0.3; pos[i*3+2]=(Math.random()-0.5)*80;
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
        }
      `,
      fragmentShader: `
        varying float vAlpha; varying float vD; uniform float uTime;
        void main(){
          float d=length(gl_PointCoord-0.5); if(d>0.5)discard;
          float a=smoothstep(0.5,0.05,d)*vAlpha*0.35;
          a*=0.6+0.4*sin(uTime*1.5+vAlpha*6.28);
          a*=clamp(1.0-vD*0.008,0.0,1.0);
          vec3 c=mix(vec3(0.2,0.5,1.0),vec3(0.0,0.9,0.5),vAlpha);
          gl_FragColor=vec4(c,a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.pts = new THREE.Points(geo, this.ptsMat);
    this.scene.add(this.pts);
  }

  // ========== ENVIRONMENT ==========
  private setupEnvironment() {
    const orbData = [
      {x:5,y:2,z:-8,c:0x2266ff},{x:-7,y:3,z:-5,c:0xff4422},
      {x:3,y:1.5,z:-12,c:0x22ff88},{x:-4,y:4,z:-15,c:0x8844ff},
      {x:8,y:2.5,z:-20,c:0xffaa22},{x:-10,y:1,z:-10,c:0x44ddff},
    ];
    orbData.forEach(({x,y,z,c})=>{
      const m=new THREE.Mesh(
        new THREE.SphereGeometry(0.15,12,12),
        new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.7})
      );
      m.position.set(x,y,z); this.scene.add(m);
      const l=new THREE.PointLight(c,2.5,10); l.position.set(x,y,z); this.scene.add(l);
      this.orbs.push(m);
    });

    const pp=[
      {x:8,z:-6},{x:-8,z:-6},{x:6,z:-15},{x:-6,z:-15},
      {x:12,z:-10},{x:-12,z:-10},{x:0,z:-20},{x:10,z:-25},
    ];
    pp.forEach(({x,z})=>{
      const p=new THREE.Mesh(
        new THREE.CylinderGeometry(0.3,0.45,5,8),
        new THREE.MeshStandardMaterial({color:0x1a2a3a,metalness:0.85,roughness:0.25})
      );
      p.position.set(x,2.5,z); p.castShadow=true; p.receiveShadow=true; this.scene.add(p);
      const t=new THREE.Mesh(
        new THREE.SphereGeometry(0.12,8,8),
        new THREE.MeshBasicMaterial({color:0x4488ff,transparent:true,opacity:0.8})
      );
      t.position.set(x,5.15,z); this.scene.add(t);
      const pl=new THREE.PointLight(0x4488ff,1.5,8); pl.position.set(x,5.15,z); this.scene.add(pl);
    });

    for(let i=0;i<25;i++){
      const w=Math.random()*4+1,h=Math.random()*8+3,d=Math.random()*4+1;
      const b=new THREE.Mesh(
        new THREE.BoxGeometry(w,h,d),
        new THREE.MeshStandardMaterial({
          color:new THREE.Color().setHSL(0.55+Math.random()*0.1,0.3,0.06+Math.random()*0.04),
          metalness:0.7,roughness:0.4,
        })
      );
      const a=Math.random()*Math.PI*2,r=22+Math.random()*30;
      b.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r);
      b.castShadow=true; this.scene.add(b);
    }
  }

  // ========== POST PROCESSING ==========
  private setupPost() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uTime: { value: 0 },
        uVignette: { value: 1.5 },
        uChroma: { value: 0.003 },
      },
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
          float v=1.0-smoothstep(0.2,0.9,d*uVignette);
          col*=mix(0.3,1.0,v);
          col-=sin(vUv.y*700.0+uTime*1.2)*0.012;
          col=pow(max(col,vec3(0.0)),vec3(0.97));
          gl_FragColor=vec4(col,1.0);
        }
      `,
      depthWrite: false, depthTest: false,
    });
    const quad = new THREE.Mesh(geo, this.postMat);
    this.postScene.add(quad);
  }

  // ========== PLACEHOLDER TEXTURE ==========
  private makePlaceholderTexture(color: number, text: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d')!;
    const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    // Checkerboard
    const sz = 32;
    for (let y = 0; y < 512; y += sz) {
      for (let x = 0; x < 512; x += sz) {
        const dark = ((x / sz + y / sz) % 2 === 0);
        ctx.fillStyle = dark ? `rgb(${r},${g},${b})` : `rgb(${r >> 1},${g >> 1},${b >> 1})`;
        ctx.fillRect(x, y, sz, sz);
      }
    }
    ctx.fillStyle = 'white';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ========== TEXTURE LOADING ==========
  private loadImg(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('CORS failed: ' + url));
      img.src = url;
    });
  }

  private texFromImg(img: HTMLImageElement, wrap = true): THREE.Texture {
    const tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    if (wrap) { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
    return tex;
  }

  private setWeaponTex(key: string) {
    const img = this.charImgs[key];
    if (!img) return;
    const tex = this.texFromImg(img, false);
    const old = this.weaponMat.uniforms.tChar.value;
    this.weaponMat.uniforms.tChar.value = tex;
    if (old && old !== tex) old.dispose();
  }

  private loadTextures() {
    const fwd = this.loadImg(CHARACTER_IMAGES.forward).then(img => {
      this.charImgs.forward = img;
      this.setWeaponTex('forward');
      this.incLoad();
    }).catch(() => { console.warn('Forward texture CORS blocked — using placeholder'); this.incLoad(); });

    const bck = this.loadImg(CHARACTER_IMAGES.backward).then(img => {
      this.charImgs.backward = img; this.incLoad();
    }).catch(() => { console.warn('Backward texture CORS blocked'); this.incLoad(); });

    const sht = this.loadImg(CHARACTER_IMAGES.shooting).then(img => {
      this.charImgs.shooting = img; this.incLoad();
    }).catch(() => { console.warn('Shooting texture CORS blocked'); this.incLoad(); });

    const gnd = this.loadImg(GROUND_IMAGE).then(img => {
      this.groundImg = img;
      const tex = this.texFromImg(img);
      tex.repeat.set(30, 30);
      this.groundMat.map = tex;
      this.groundMat.needsUpdate = true;
      this.incLoad();
    }).catch(() => { console.warn('Ground texture CORS blocked — grid visible'); this.incLoad(); });
  }

  private incLoad() {
    this.loadCount++;
    if (this.loadCount >= 4 && !this.ready) {
      this.ready = true;
      this.onReady?.();
    }
  }

  // ========== PUBLIC API ==========
  setOnReady(cb: () => void) { this.onReady = cb; }
  setOnStateChange(cb: (s: CharacterState) => void) { this.onState = cb; }
  updateInput(p: Partial<InputState>) { Object.assign(this.input, p); }

  triggerShoot() {
    if (this.charState === 'shooting') return;
    this.charState = 'shooting';
    this.shootTimer = 0.25;
    if (this.charImgs.shooting) this.setWeaponTex('shooting');
    this.onState?.('shooting');
    setTimeout(() => {
      if (this.charState === 'shooting') {
        this.charState = 'idle';
        this.setWeaponTex('forward');
        this.onState?.('idle');
      }
    }, 250);
  }

  // ========== UPDATE MOVEMENT ==========
  private updateMovement(dt: number) {
    const fwd = new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion);
    right.y = 0; right.normalize();
    const dir = new THREE.Vector3();
    if (this.input.w) dir.add(fwd);
    if (this.input.s) dir.sub(fwd);
    if (this.input.d) dir.add(right);
    if (this.input.a) dir.sub(right);
    const moving = dir.lengthSq() > 0;

    if (moving && this.charState !== 'shooting') {
      dir.normalize().multiplyScalar(this.config.moveSpeed);
      this.camera.position.add(dir);
      const isF = this.input.w && !this.input.s;
      const isB = this.input.s && !this.input.w;
      if (isF && this.charState !== 'walking_forward') {
        this.charState = 'walking_forward';
        if (this.charImgs.forward) this.setWeaponTex('forward');
        this.onState?.('walking_forward');
      } else if (isB && this.charState !== 'walking_backward') {
        this.charState = 'walking_backward';
        if (this.charImgs.backward) this.setWeaponTex('backward');
        this.onState?.('walking_backward');
      } else if (!isF && !isB && this.charState !== 'walking_forward') {
        this.charState = 'walking_forward';
        if (this.charImgs.forward) this.setWeaponTex('forward');
        this.onState?.('walking_forward');
      }
      this.walkTime += dt * this.config.walkBounceSpeed;
    } else if (!moving && this.charState !== 'shooting') {
      if (this.charState !== 'idle') {
        this.charState = 'idle';
        if (this.charImgs.forward) this.setWeaponTex('forward');
        this.onState?.('idle');
      }
      this.walkTime *= 0.9;
    }

    // Weapon animation
    const bounceY = moving ? Math.abs(Math.sin(this.walkTime)) * this.config.walkBounceHeight * 0.6 : 0;
    const sway = moving ? this.walkTime * 2 : 0;
    const blur = moving ? Math.abs(Math.sin(this.walkTime)) * this.config.blurIntensity * 0.5 : 0;
    const u = this.weaponMat.uniforms;
    u.uBounceY.value += (bounceY - u.uBounceY.value) * 0.18;
    u.uSway.value = sway;
    u.uBlur.value += (blur - u.uBlur.value) * 0.12;
    u.uTime.value = this.t;
    if (this.shootTimer > 0) { this.shootTimer -= dt; u.uShootFlash.value = Math.max(0, this.shootTimer * 4); }
    else { u.uShootFlash.value *= 0.85; }
    this.glowMat.uniforms.uTime.value = this.t;

    // Camera head bob
    if (moving) {
      const by = Math.sin(this.walkTime) * 0.04;
      this.camera.position.y += (1.7 + by - this.camera.position.y) * 0.25;
      this.camera.rotation.z += (Math.sin(this.walkTime) * 0.003 - this.camera.rotation.z) * 0.2;
    } else {
      this.camera.position.y += (1.7 - this.camera.position.y) * 0.08;
      this.camera.rotation.z *= 0.9;
    }
  }

  // ========== UPDATE LOOK ==========
  private updateLook() {
    if (this.input.isPointerLocked) {
      this.yaw -= this.input.mouseX * this.config.lookSensitivity;
      this.pitch -= this.input.mouseY * this.config.lookSensitivity;
    }
    if (this.input.touchStartX !== null) {
      this.yaw -= this.input.touchDeltaX * this.config.lookSensitivity * 0.5;
      this.pitch -= this.input.touchDeltaY * this.config.lookSensitivity * 0.5;
    }
    this.pitch = Math.max(-Math.PI/3, Math.min(Math.PI/3, this.pitch));
    const yd = Math.abs(this.yaw - this.prevYaw);
    this.turnBlur += (yd * 35 - this.turnBlur) * 0.12;
    this.turnBlur = Math.min(this.turnBlur, this.config.turnBlurIntensity);
    this.prevYaw = this.yaw;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    // Weapon tilt with look
    this.weaponMesh.rotation.z = -this.pitch * 0.15;
    this.weaponMesh.rotation.x = -this.pitch * 0.08;
    this.weaponMesh.position.x = 0.6 + Math.sin(this.yaw * 0.5) * 0.02;
    this.postMat.uniforms.uChroma.value = 0.003 + this.turnBlur * 0.01;
    this.postMat.uniforms.uVignette.value = 1.5 + this.turnBlur * 0.4;
  }

  // ========== MAIN LOOP ==========
  private animate = () => {
    if (!this.isRunning) return;
    this.animId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;
    this.updateMovement(dt);
    this.updateLook();
    this.ptsMat.uniforms.uTime.value = this.t;
    this.orbs.forEach((o,i) => {
      o.position.y += Math.sin(this.t*0.4+i*1.7)*0.004;
      (o.material as THREE.MeshBasicMaterial).opacity = 0.5+Math.sin(this.t*0.7+i*2.3)*0.2;
    });
    this.postMat.uniforms.uTime.value = this.t;

    // ---- RENDER PIPELINE (manual clear control) ----
    // 1) Clear everything
    this.renderer.clear();

    // 2) Main 3D scene → renderTarget
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // 3) Post-process → screen (keep what's there)
    this.renderer.setRenderTarget(null);
    this.renderer.clearDepth(); // only clear depth, preserve color
    this.renderer.render(this.postScene, this.postCam);

    // 4) Weapon overlay on top (only clear depth)
    this.renderer.clearDepth();
    this.renderer.render(this.weaponScene, this.weaponCam);
  };

  start() { this.isRunning = true; this.clock.start(); this.animate(); }
  stop() { this.isRunning = false; cancelAnimationFrame(this.animId); }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const pr = Math.min(window.devicePixelRatio, 2);
    this.rt.setSize(w * pr, h * pr);
    this.ptsMat.uniforms.uPR.value = pr;
  }

  dispose() {
    this.stop(); this.renderer.dispose(); this.rt.dispose();
    this.weaponMat.dispose(); this.glowMat.dispose();
    this.groundMat.dispose(); this.ptsMat.dispose(); this.postMat.dispose();
  }

  getIsReady() { return this.ready; }
}