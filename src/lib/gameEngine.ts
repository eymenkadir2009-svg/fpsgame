import * as THREE from 'three';
import { GameConfig, InputState, CharacterState, CHARACTER_IMAGES, GROUND_IMAGE } from './gameTypes';

export class GameEngine {
  // ====== CORE ======
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  private container: HTMLElement;
  private animId: number = 0;
  private isRunning: boolean = false;

  // ====== POST PROCESSING ======
  private renderTarget: THREE.WebGLRenderTarget;
  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postQuad!: THREE.Mesh;
  private postMaterial!: THREE.ShaderMaterial;

  // ====== FPS CHARACTER OVERLAY (FIRST PERSON) ======
  private overlayScene: THREE.Scene;
  private overlayCamera: THREE.OrthographicCamera;
  private weaponMesh!: THREE.Mesh;
  private weaponMaterial!: THREE.ShaderMaterial;
  private weaponGlowMesh!: THREE.Mesh;
  private weaponGlowMat!: THREE.ShaderMaterial;

  // ====== GROUND ======
  private groundMesh!: THREE.Mesh;
  private groundMat!: THREE.MeshStandardMaterial;

  // ====== PARTICLES ======
  private particles!: THREE.Points;
  private particleMat!: THREE.ShaderMaterial;

  // ====== ENVIRONMENT ======
  private ambientOrbs: THREE.Mesh[] = [];

  // ====== STATE ======
  private config: GameConfig;
  private input: InputState;
  private charState: CharacterState = 'idle';
  private yaw = 0;
  private pitch = 0;
  private walkTime = 0;
  private animTime = 0;
  private turnBlur = 0;
  private prevYaw = 0;
  private shootTimer = 0;

  // ====== TEXTURES (HTML Image approach for CORS) ======
  private charImages: Record<string, HTMLImageElement | null> = {
    forward: null,
    backward: null,
    shooting: null,
  };
  private groundImage: HTMLImageElement | null = null;
  private texturesReady = false;

  // ====== CALLBACKS ======
  private onReady?: () => void;
  private onStateChange?: (s: CharacterState) => void;

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
    this.scene.fog = new THREE.FogExp2(0x080c14, 0.013);
    this.scene.background = new THREE.Color(0x080c14);

    // ---- Camera (FPS eye) ----
    const asp = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(72, asp, 0.1, 500);
    this.camera.position.set(0, 1.7, 0);

    // ---- Renderer ----
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    container.appendChild(this.renderer.domElement);

    // ---- Post-processing render target ----
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderTarget = new THREE.WebGLRenderTarget(
      container.clientWidth * pr, container.clientHeight * pr,
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
    );
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene = new THREE.Scene();

    // ---- FPS Overlay scene (weapon/character at screen bottom) ----
    this.overlayScene = new THREE.Scene();
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, -1, 1, 0.1, 100);
    this.overlayCamera.position.set(0, 0, 5);

    // Build everything
    this.setupLighting();
    this.setupGround();
    this.setupWeaponOverlay();
    this.setupParticles();
    this.setupEnvironment();
    this.setupPostProcessing();
    this.loadAllTextures();
  }

  // ============================================================
  //  LIGHTING
  // ============================================================

  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x334466, 1.0));

    const dir = new THREE.DirectionalLight(0x6699cc, 1.8);
    dir.position.set(5, 12, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 60;
    const s = 20;
    dir.shadow.camera.left = -s;
    dir.shadow.camera.right = s;
    dir.shadow.camera.top = s;
    dir.shadow.camera.bottom = -s;
    this.scene.add(dir);

    this.scene.add(new THREE.DirectionalLight(0xff7744, 0.4).translateX(-3).translateY(3).translateZ(-5));
    this.scene.add(new THREE.HemisphereLight(0x4466aa, 0x223311, 0.5));
  }

  // ============================================================
  //  GROUND  (MeshStandardMaterial + map — reliable texture display)
  // ============================================================

  private setupGround() {
    const geo = new THREE.PlaneGeometry(200, 200);
    this.groundMat = new THREE.MeshStandardMaterial({
      color: 0x335544,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.groundMesh = new THREE.Mesh(geo, this.groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
  }

  // ============================================================
  //  FPS WEAPON / CHARACTER OVERLAY (screen-space, first person)
  // ============================================================

  private setupWeaponOverlay() {
    // ---- Main weapon plane ----
    const geo = new THREE.PlaneGeometry(1.4, 1.4);

    this.weaponMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tChar: { value: new THREE.Texture() },
        uBounceY: { value: 0.0 },
        uBounceZ: { value: 0.0 },
        uSway: { value: 0.0 },
        uBlur: { value: 0.0 },
        uGlow: { value: 0.0 },
        uShootFlash: { value: 0.0 },
        uTime: { value: 0.0 },
      },
      vertexShader: `
        uniform float uBounceY;
        uniform float uBounceZ;
        uniform float uSway;
        uniform float uBlur;
        uniform float uShootFlash;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 pos = position;
          // Walk bounce — realistic up/down
          pos.y += uBounceY;
          pos.z += uBounceZ;
          // Sway rotation
          float sw = uSway * 0.03;
          float c = cos(sw); float s = sin(sw);
          pos.xz = mat2(c, -s, s, c) * pos.xz;
          // Shoot recoil kick
          pos.y += uShootFlash * 0.15;
          pos.z += uShootFlash * 0.3;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tChar;
        uniform float uBlur;
        uniform float uGlow;
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
          // Shoot flash tint
          col.rgb += vec3(1.0, 0.7, 0.3) * uShootFlash * 0.5;
          // Edge glow
          float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x)
                     * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
          float glowEdge = 1.0 - edge;
          vec3 glowColor = mix(vec3(0.15, 0.5, 1.0), vec3(0.0, 1.0, 0.5), sin(uTime * 0.8) * 0.5 + 0.5);
          col.rgb += glowColor * glowEdge * (0.3 + uGlow) * 0.4;
          // Subtle color enhance
          col.rgb = pow(col.rgb, vec3(0.96));
          gl_FragColor = col;
        }
      `,
      transparent: true,
      depthWrite: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    this.weaponMesh = new THREE.Mesh(geo, this.weaponMaterial);
    this.weaponMesh.position.set(0.15, -1.2, 0);
    this.weaponMesh.scale.set(1.0, 1.0, 1.0);
    this.weaponMesh.rotation.set(0, 0, 0);
    this.overlayScene.add(this.weaponMesh);

    // ---- Glow behind weapon ----
    const glowGeo = new THREE.PlaneGeometry(2.0, 2.0);
    this.weaponGlowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float d = length(c);
          float g = exp(-d * 4.0) * 0.25;
          g *= 0.85 + 0.15 * sin(uTime * 2.0);
          vec3 col = mix(vec3(0.1,0.4,1.0), vec3(0.0,0.9,0.5), sin(uTime*0.4)*0.5+0.5);
          gl_FragColor = vec4(col, g);
        }
      `,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.weaponGlowMesh = new THREE.Mesh(glowGeo, this.weaponGlowMat);
    this.weaponGlowMesh.position.set(0.15, -1.2, -0.1);
    this.overlayScene.add(this.weaponGlowMesh);
  }

  // ============================================================
  //  PARTICLES
  // ============================================================

  private setupParticles() {
    const N = 3500;
    const pos = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const alphas = new Float32Array(N);
    const speeds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i*3]   = (Math.random()-0.5)*80;
      pos[i*3+1] = Math.random()*16 + 0.3;
      pos[i*3+2] = (Math.random()-0.5)*80;
      sizes[i] = Math.random()*3.5 + 0.5;
      alphas[i] = Math.random();
      speeds[i] = 0.3 + Math.random()*0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

    this.particleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: `
        attribute float size; attribute float aAlpha; attribute float aSpeed;
        uniform float uTime; uniform float uPR;
        varying float vAlpha; varying float vDist;
        void main() {
          vAlpha = aAlpha;
          vec3 p = position;
          p.y += sin(uTime*0.3*aSpeed + p.x*0.5)*0.4;
          p.x += sin(uTime*0.15*aSpeed + p.z*0.3)*0.3;
          p.z += cos(uTime*0.2*aSpeed + p.y*0.2)*0.2;
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          vDist = -mv.z;
          gl_PointSize = size * uPR * (90.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha; varying float vDist; uniform float uTime;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d) * vAlpha * 0.35;
          a *= 0.6 + 0.4*sin(uTime*1.5 + vAlpha*6.28);
          a *= clamp(1.0 - vDist*0.008, 0.0, 1.0);
          vec3 c = mix(vec3(0.2,0.5,1.0), vec3(0.0,0.9,0.5), vAlpha);
          gl_FragColor = vec4(c, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(geo, this.particleMat);
    this.scene.add(this.particles);
  }

  // ============================================================
  //  ENVIRONMENT
  // ============================================================

  private setupEnvironment() {
    const orbs = [
      {x:5,y:2,z:-8,c:0x2266ff}, {x:-7,y:3,z:-5,c:0xff4422},
      {x:3,y:1.5,z:-12,c:0x22ff88}, {x:-4,y:4,z:-15,c:0x8844ff},
      {x:8,y:2.5,z:-20,c:0xffaa22}, {x:-10,y:1,z:-10,c:0x44ddff},
    ];
    orbs.forEach(({x,y,z,c}) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 12),
        new THREE.MeshBasicMaterial({color: c, transparent: true, opacity: 0.7})
      );
      m.position.set(x,y,z); this.scene.add(m);
      const l = new THREE.PointLight(c, 2.5, 10); l.position.set(x,y,z); this.scene.add(l);
      this.ambientOrbs.push(m);
    });

    // Pillars
    const pp = [
      {x:8,z:-6},{x:-8,z:-6},{x:6,z:-15},{x:-6,z:-15},
      {x:12,z:-10},{x:-12,z:-10},{x:0,z:-20},{x:10,z:-25},
    ];
    pp.forEach(({x,z}) => {
      const p = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.45, 5, 8),
        new THREE.MeshStandardMaterial({color:0x1a2a3a, metalness:0.85, roughness:0.25})
      );
      p.position.set(x,2.5,z); p.castShadow=true; p.receiveShadow=true; this.scene.add(p);
      const t = new THREE.Mesh(
        new THREE.SphereGeometry(0.12,8,8),
        new THREE.MeshBasicMaterial({color:0x4488ff,transparent:true,opacity:0.8})
      );
      t.position.set(x,5.15,z); this.scene.add(t);
      const pl = new THREE.PointLight(0x4488ff, 1.5, 8); pl.position.set(x,5.15,z); this.scene.add(pl);
    });

    // Distant buildings
    for (let i = 0; i < 25; i++) {
      const w=Math.random()*4+1, h=Math.random()*8+3, d=Math.random()*4+1;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w,h,d),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(0.55+Math.random()*0.1, 0.3, 0.06+Math.random()*0.04),
          metalness:0.7, roughness:0.4,
        })
      );
      const a = Math.random()*Math.PI*2, r = 22+Math.random()*30;
      b.position.set(Math.cos(a)*r, h/2, Math.sin(a)*r);
      b.castShadow=true; this.scene.add(b);
    }
  }

  // ============================================================
  //  POST PROCESSING
  // ============================================================

  private setupPostProcessing() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        uTime: { value: 0 },
        uVignette: { value: 1.5 },
        uChroma: { value: 0.003 },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uChroma;
        varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5;
          float d = length(c);
          float r = texture2D(tDiffuse, vUv + c*uChroma).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - c*uChroma).b;
          vec3 col = vec3(r,g,b);
          float v = 1.0 - smoothstep(0.2, 0.9, d*uVignette);
          col *= mix(0.3, 1.0, v);
          col -= sin(vUv.y*700.0 + uTime*1.2)*0.012;
          col += (fract(sin(dot(vUv*uTime,vec2(12.9898,78.233)))*43758.5453)-0.5)*0.018;
          col = pow(max(col,vec3(0.0)),vec3(0.97));
          gl_FragColor = vec4(col,1.0);
        }
      `,
      depthWrite: false, depthTest: false,
    });
    this.postQuad = new THREE.Mesh(geo, this.postMaterial);
    this.postScene.add(this.postQuad);
  }

  // ============================================================
  //  TEXTURE LOADING — HTML Image with CORS first, then → Three.js Texture
  // ============================================================

  private loadImageWithCORS(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed: ' + url));
      img.src = url;
    });
  }

  private textureFromImage(img: HTMLImageElement, wrap = true): THREE.Texture {
    const tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    if (wrap) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    return tex;
  }

  private applyCharTexture(key: string) {
    const img = this.charImages[key];
    if (!img) return;
    const tex = this.textureFromImage(img, false);
    this.weaponMaterial.uniforms.tChar.value.dispose();
    this.weaponMaterial.uniforms.tChar.value = tex;
  }

  private loadAllTextures() {
    // Load character images
    this.loadImageWithCORS(CHARACTER_IMAGES.forward).then(img => {
      this.charImages.forward = img;
      this.applyCharTexture('forward');
      this.checkReady();
    }).catch(e => { console.warn('Forward texture failed:', e); this.checkReady(); });

    this.loadImageWithCORS(CHARACTER_IMAGES.backward).then(img => {
      this.charImages.backward = img;
      this.checkReady();
    }).catch(e => { console.warn('Backward texture failed:', e); this.checkReady(); });

    this.loadImageWithCORS(CHARACTER_IMAGES.shooting).then(img => {
      this.charImages.shooting = img;
      this.checkReady();
    }).catch(e => { console.warn('Shooting texture failed:', e); this.checkReady(); });

    // Load ground image
    this.loadImageWithCORS(GROUND_IMAGE).then(img => {
      this.groundImage = img;
      const tex = this.textureFromImage(img);
      tex.repeat.set(30, 30);
      this.groundMat.map = tex;
      this.groundMat.needsUpdate = true;
      this.checkReady();
    }).catch(e => { console.warn('Ground texture failed:', e); this.checkReady(); });
  }

  private loadedCount = 0;
  private checkReady() {
    this.loadedCount++;
    if (this.loadedCount >= 4 && !this.texturesReady) {
      this.texturesReady = true;
      this.onReady?.();
    }
  }

  // ============================================================
  //  PUBLIC API
  // ============================================================

  setOnReady(cb: () => void) { this.onReady = cb; }
  setOnStateChange(cb: (s: CharacterState) => void) { this.onStateChange = cb; }

  updateInput(partial: Partial<InputState>) {
    Object.assign(this.input, partial);
  }

  triggerShoot() {
    if (this.charState === 'shooting') return;
    this.charState = 'shooting';
    this.shootTimer = 0.25;
    this.applyCharTexture('shooting');
    this.onStateChange?.('shooting');

    setTimeout(() => {
      if (this.charState === 'shooting') {
        this.charState = 'idle';
        this.applyCharTexture('forward');
        this.onStateChange?.('idle');
      }
    }, 250);
  }

  // ============================================================
  //  UPDATE — MOVEMENT
  // ============================================================

  private updateMovement(dt: number) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
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

      const isFwd = this.input.w && !this.input.s;
      const isBack = this.input.s && !this.input.w;

      if (isFwd && this.charState !== 'walking_forward') {
        this.charState = 'walking_forward';
        this.applyCharTexture('forward');
        this.onStateChange?.('walking_forward');
      } else if (isBack && this.charState !== 'walking_backward') {
        this.charState = 'walking_backward';
        this.applyCharTexture('backward');
        this.onStateChange?.('walking_backward');
      } else if (!isFwd && !isBack && this.charState !== 'walking_forward') {
        this.charState = 'walking_forward';
        this.applyCharTexture('forward');
        this.onStateChange?.('walking_forward');
      }
      this.walkTime += dt * this.config.walkBounceSpeed;
    } else if (!moving && this.charState !== 'shooting') {
      if (this.charState !== 'idle') {
        this.charState = 'idle';
        this.applyCharTexture('forward');
        this.onStateChange?.('idle');
      }
      this.walkTime *= 0.9;
    }

    // ---- Weapon overlay animation ----
    const bounceY = moving ? Math.abs(Math.sin(this.walkTime)) * this.config.walkBounceHeight * 0.6 : 0;
    const bounceZ = moving ? Math.sin(this.walkTime * 2) * 0.015 : 0;
    const sway = moving ? this.walkTime * 2 : 0;
    const blur = moving ? Math.abs(Math.sin(this.walkTime)) * this.config.blurIntensity * 0.5 : 0;

    const u = this.weaponMaterial.uniforms;
    u.uBounceY.value += (bounceY - u.uBounceY.value) * 0.18;
    u.uBounceZ.value += (bounceZ - u.uBounceZ.value) * 0.18;
    u.uSway.value = sway;
    u.uBlur.value += (blur - u.uBlur.value) * 0.12;
    u.uTime.value = this.animTime;
    u.uGlow.value = moving ? 0.8 : 0.3;

    // Shoot flash decay
    if (this.shootTimer > 0) {
      this.shootTimer -= dt;
      u.uShootFlash.value = Math.max(0, this.shootTimer * 4);
    } else {
      u.uShootFlash.value *= 0.85;
    }

    // Glow
    this.weaponGlowMat.uniforms.uTime.value = this.animTime;

    // ---- Camera head bob ----
    if (moving) {
      const bobY = Math.sin(this.walkTime) * 0.04;
      const bobRoll = Math.sin(this.walkTime) * 0.003;
      this.camera.position.y += (1.7 + bobY - this.camera.position.y) * 0.25;
      this.camera.rotation.z += (bobRoll - this.camera.rotation.z) * 0.2;
    } else {
      this.camera.position.y += (1.7 - this.camera.position.y) * 0.08;
      this.camera.rotation.z *= 0.9;
    }
  }

  // ============================================================
  //  UPDATE — LOOK
  // ============================================================

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

    // Weapon subtle tilt with look direction
    this.weaponMesh.rotation.z = -this.pitch * 0.15;
    this.weaponMesh.rotation.x = -this.pitch * 0.08;
    // Weapon sway with yaw
    this.weaponMesh.position.x = 0.15 + Math.sin(this.yaw * 0.5) * 0.02;

    this.postMaterial.uniforms.uChroma.value = 0.003 + this.turnBlur * 0.01;
    this.postMaterial.uniforms.uVignette.value = 1.5 + this.turnBlur * 0.4;
  }

  // ============================================================
  //  MAIN LOOP
  // ============================================================

  private animate = () => {
    if (!this.isRunning) return;
    this.animId = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.animTime += dt;

    this.updateMovement(dt);
    this.updateLook();

    // Particle & orb update
    this.particleMat.uniforms.uTime.value = this.animTime;
    this.ambientOrbs.forEach((o, i) => {
      o.position.y += Math.sin(this.animTime*0.4 + i*1.7) * 0.004;
      (o.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(this.animTime*0.7+i*2.3)*0.2;
    });

    this.postMaterial.uniforms.uTime.value = this.animTime;

    // ---- Render pipeline ----
    // 1) Main scene → renderTarget
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);

    // 2) Post-process: renderTarget → screen
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);

    // 3) FPS weapon overlay on top (no post-processing, direct to screen)
    this.renderer.render(this.overlayScene, this.overlayCamera);
  };

  start() { this.isRunning = true; this.clock.start(); this.animate(); }
  stop() { this.isRunning = false; cancelAnimationFrame(this.animId); }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderTarget.setSize(w * pr, h * pr);
    this.particleMat.uniforms.uPR.value = pr;
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
    this.renderTarget.dispose();
    this.weaponMaterial.dispose();
    this.weaponGlowMat.dispose();
    this.groundMat.dispose();
    this.particleMat.dispose();
    this.postMaterial.dispose();
  }

  getIsReady() { return this.texturesReady; }
}
