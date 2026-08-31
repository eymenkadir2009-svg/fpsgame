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

  // ====== CHARACTER (3rd person, in world) ======
  private charGroup: THREE.Group;
  private charMesh!: THREE.Mesh;
  private charMat!: THREE.ShaderMaterial;
  private charGlowMesh!: THREE.Mesh;
  private charGlowMat!: THREE.ShaderMaterial;
  private charShadow!: THREE.Mesh;
  private charWorldPos = new THREE.Vector3(0, 0, 0);
  private charRotation = 0;

  // ====== CAMERA (follows character from behind) ======
  private camOffset = new THREE.Vector3(0, 3.5, 6);
  private camLookOffset = new THREE.Vector3(0, 1.2, 0);

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
  private yaw = Math.PI; // camera orbits around character
  private pitch = 0.3;
  private walkTime = 0;
  private t = 0;
  private turnBlur = 0;
  private prevYaw = 0;

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
      mouseX: 0, mouseY: 0, isMouseDown: false, isPointerLocked: false,
      touchStartX: null, touchStartY: null, touchDeltaX: 0, touchDeltaY: 0,
    };
    this.clock = new THREE.Clock();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c14);
    this.scene.fog = new THREE.FogExp2(0x080c14, 0.008);

    // Camera
    const asp = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(55, asp, 0.1, 500);

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

    // Build
    this.setupLighting();
    this.setupGround();
    this.setupCharacter();
    this.setupParticles();
    this.setupEnvironment();
    this.setupPost();
    this.setupMuzzleFlash();
    this.loadTextures();

    // Initial camera position
    this.updateCameraPosition();
  }

  // ==================== LIGHTING ====================
  private setupLighting() {
    this.scene.add(new THREE.AmbientLight(0x556677, 1.5));

    const dir = new THREE.DirectionalLight(0x8899cc, 2.5);
    dir.position.set(8, 15, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5; dir.shadow.camera.far = 80;
    const s = 30;
    dir.shadow.camera.left = -s; dir.shadow.camera.right = s;
    dir.shadow.camera.top = s; dir.shadow.camera.bottom = -s;
    this.scene.add(dir);

    this.scene.add(new THREE.DirectionalLight(0xff8855, 0.6).translateX(-5).translateY(4).translateZ(-8));
    this.scene.add(new THREE.HemisphereLight(0x5577aa, 0x334422, 0.7));

    // Character spotlight
    const spot = new THREE.SpotLight(0xaaccff, 3, 15, Math.PI / 5, 0.6, 1);
    spot.position.set(0, 8, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot);
    this.scene.add(spot.target);
  }

  // ==================== GROUND ====================
  private setupGround() {
    const geo = new THREE.PlaneGeometry(200, 200);
    this.groundMat = new THREE.MeshStandardMaterial({ color: 0x446655, roughness: 0.8, metalness: 0.1 });
    this.groundMesh = new THREE.Mesh(geo, this.groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // Grid helper
    const grid = new THREE.GridHelper(100, 100, 0x1a3a2a, 0x0d1f15);
    grid.position.y = 0.005;
    this.scene.add(grid);
  }

  // ==================== CHARACTER (3D BILLBOARD IN WORLD) ====================
  private setupCharacter() {
    const W = 2.0, H = 3.0, D = 0.25;

    const placeholderTex = this.makePlaceholder(0x22aa66, 'KARAKTER');

    // Main character shader material
    this.charMat = new THREE.ShaderMaterial({
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
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vec3 pos = position;
          pos.y += uBounceY;
          float sw = sin(uSway) * 0.025;
          float lean = cos(uSway * 0.7) * 0.008;
          mat3 rot = mat3(
            cos(sw), lean, sin(sw),
            -lean*0.5, 1.0, lean*0.3,
            -sin(sw), lean*0.3, cos(sw)
          );
          pos = rot * pos;
          pos.y += uShootFlash * 0.1;
          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform sampler2D tChar;
        uniform float uBlur;
        uniform float uShootFlash;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec4 col = texture2D(tChar, vUv);
          if (col.a < 0.05) discard;
          // Motion blur
          vec4 blurred = vec4(0.0);
          float tw = 0.0;
          if (uBlur > 0.01) {
            for (float i = -8.0; i <= 8.0; i += 1.0) {
              float w = 1.0 - abs(i) / 9.0;
              w *= w * w;
              blurred += texture2D(tChar, clamp(vUv + vec2(i * uBlur * 0.004, 0.0), 0.0, 1.0)) * w;
              tw += w;
            }
            blurred /= tw;
            col = mix(col, blurred, min(uBlur, 1.0));
          }
          // Shoot flash
          col.rgb += vec3(1.0, 0.7, 0.3) * uShootFlash * 0.4;
          // Rim lighting
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float rim = 1.0 - max(dot(vNormal, viewDir), 0.0);
          rim = pow(rim, 2.5);
          vec3 rimCol = mix(vec3(0.2,0.5,1.0), vec3(0.0,1.0,0.5), sin(uTime*0.8)*0.5+0.5);
          col.rgb += rimCol * rim * 0.35;
          // Edge glow
          float ex = smoothstep(0.0,0.04,vUv.x)*smoothstep(1.0,0.96,vUv.x);
          float ey = smoothstep(0.0,0.04,vUv.y)*smoothstep(1.0,0.96,vUv.y);
          float edge = 1.0 - ex * ey;
          col.rgb += rimCol * edge * 0.6;
          col.rgb = pow(col.rgb, vec3(0.96));
          gl_FragColor = vec4(col.rgb, col.a);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    // Front face
    const frontGeo = new THREE.PlaneGeometry(W, H);
    this.charMesh = new THREE.Mesh(frontGeo, this.charMat);
    this.charMesh.position.set(0, H / 2, -D / 2);
    this.charMesh.castShadow = true;
    this.charGroup.add(this.charMesh);

    // Back face
    const backMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      this.charMat
    );
    backMesh.position.set(0, H / 2, D / 2);
    backMesh.rotation.y = Math.PI;
    this.charGroup.add(backMesh);

    // Side panels for 3D depth
    const sideGeo = new THREE.PlaneGeometry(D, H);
    const leftSide = new THREE.Mesh(sideGeo, this.charMat);
    leftSide.position.set(-W / 2, H / 2, 0);
    leftSide.rotation.y = -Math.PI / 2;
    this.charGroup.add(leftSide);

    const rightSide = new THREE.Mesh(sideGeo.clone(), this.charMat);
    rightSide.position.set(W / 2, H / 2, 0);
    rightSide.rotation.y = Math.PI / 2;
    this.charGroup.add(rightSide);

    // Top/bottom caps
    const capGeo = new THREE.PlaneGeometry(W, D);
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x334455, metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.6,
    });
    const topCap = new THREE.Mesh(capGeo, capMat);
    topCap.position.set(0, H, 0);
    topCap.rotation.x = -Math.PI / 2;
    this.charGroup.add(topCap);

    const bottomCap = new THREE.Mesh(capGeo.clone(), capMat.clone());
    bottomCap.position.set(0, 0, 0);
    bottomCap.rotation.x = Math.PI / 2;
    this.charGroup.add(bottomCap);

    // Glow aura behind character
    const glowGeo = new THREE.PlaneGeometry(W * 2, H * 1.4);
    this.charGlowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 c=vUv-0.5; float d=length(c);
          float g=exp(-d*3.5)*0.3*(0.85+0.15*sin(uTime*2.0));
          vec3 col=mix(vec3(0.1,0.4,1.0),vec3(0.0,0.9,0.5),sin(uTime*0.4)*0.5+0.5);
          gl_FragColor=vec4(col,g);
        }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.charGlowMesh = new THREE.Mesh(glowGeo, this.charGlowMat);
    this.charGlowMesh.position.set(0, H / 2, -D - 0.1);
    this.charGroup.add(this.charGlowMesh);

    // Ground shadow (fake blob)
    const shadowGeo = new THREE.PlaneGeometry(2.0, 2.0);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
    });
    this.charShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.charShadow.rotation.x = -Math.PI / 2;
    this.charShadow.position.set(0, 0.01, 0);
    this.charGroup.add(this.charShadow);
  }

  // ==================== PARTICLES ====================
  private setupParticles() {
    const N = 3000;
    const pos = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    const alphas = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i*3]=(Math.random()-0.5)*100; pos[i*3+1]=Math.random()*20+0.3; pos[i*3+2]=(Math.random()-0.5)*100;
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
          float a=smoothstep(0.5,0.05,d)*vAlpha*0.3;
          a*=0.6+0.4*sin(uTime*1.5+vAlpha*6.28);
          a*=clamp(1.0-vD*0.006,0.0,1.0);
          vec3 c=mix(vec3(0.2,0.5,1.0),vec3(0.0,0.9,0.5),vAlpha);
          gl_FragColor=vec4(c,a);
        }
      `,
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
      // Halo
      const h=new THREE.Mesh(new THREE.SphereGeometry(0.6,8,8),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0.08,side:THREE.BackSide}));
      h.position.set(x,y,z); this.scene.add(h);
      this.orbs.push(m);
    });

    // Pillars
    const pp=[
      {x:10,z:-8},{x:-10,z:-8},{x:8,z:-20},{x:-8,z:-20},
      {x:15,z:-15},{x:-15,z:-15},{x:0,z:-30},{x:12,z:-35},{x:-12,z:-35},
      {x:20,z:-25},{x:-20,z:-25},
    ];
    pp.forEach(({x,z})=>{
      const p=new THREE.Mesh(
        new THREE.CylinderGeometry(0.4,0.6,6,8),
        new THREE.MeshStandardMaterial({color:0x1a2a3a,metalness:0.85,roughness:0.25})
      );
      p.position.set(x,3,z); p.castShadow=true; p.receiveShadow=true; this.scene.add(p);
      const t=new THREE.Mesh(new THREE.SphereGeometry(0.15,8,8),new THREE.MeshBasicMaterial({color:0x4488ff,transparent:true,opacity:0.8}));
      t.position.set(x,6.15,z); this.scene.add(t);
      const pl=new THREE.PointLight(0x4488ff,2,10); pl.position.set(x,6.15,z); this.scene.add(pl);
    });

    // Distant buildings
    for(let i=0;i<35;i++){
      const w=Math.random()*5+1,h=Math.random()*10+3,d=Math.random()*5+1;
      const b=new THREE.Mesh(
        new THREE.BoxGeometry(w,h,d),
        new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL(0.55+Math.random()*0.1,0.3,0.05+Math.random()*0.04),metalness:0.7,roughness:0.4})
      );
      const a=Math.random()*Math.PI*2,r=25+Math.random()*40;
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
      uniforms: {
        tDiffuse: { value: this.rt.texture }, uTime: { value: 0 },
        uVignette: { value: 1.3 }, uChroma: { value: 0.002 },
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
          float v=1.0-smoothstep(0.2,0.85,d*uVignette);
          col*=mix(0.35,1.0,v);
          col-=sin(vUv.y*700.0+uTime*1.2)*0.01;
          col=pow(max(col,vec3(0.0)),vec3(0.97));
          gl_FragColor=vec4(col,1.0);
        }
      `,
      depthWrite: false, depthTest: false,
    });
    this.postScene.add(new THREE.Mesh(geo, this.postMat));
  }

  // ==================== PLACEHOLDER ====================
  private makePlaceholder(color: number, text: string): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const ctx = c.getContext('2d')!;
    const r2 = (color >> 16) & 0xff, g2 = (color >> 8) & 0xff, b2 = color & 0xff;
    const sz = 32;
    for (let y = 0; y < 512; y += sz) for (let x = 0; x < 512; x += sz) {
      ctx.fillStyle = ((x/sz+y/sz)%2===0) ? `rgb(${r2},${g2},${b2})` : `rgb(${r2>>1},${g2>>1},${b2>>1})`;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.fillStyle = 'white'; ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
    ctx.fillText(text, 256, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ==================== TEXTURE LOADING ====================
  private loadImg(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed: ' + url));
      img.src = url;
    });
  }

  private texFromImg(img: HTMLImageElement, wrap = true): THREE.Texture {
    const tex = new THREE.Texture(img); tex.needsUpdate = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    if (wrap) { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
    return tex;
  }

  private setCharTex(key: string) {
    const img = this.charImgs[key]; if (!img) return;
    const tex = this.texFromImg(img, false);
    const old = this.charMat.uniforms.tChar.value;
    this.charMat.uniforms.tChar.value = tex;
    if (old && old !== tex) old.dispose();
  }

  private loadTextures() {
    // Character textures
    this.loadImg(CHARACTER_IMAGES.forward).then(img => { this.charImgs.forward = img; this.setCharTex('forward'); this.incLoad(); })
      .catch(() => { console.warn('Char forward failed'); this.incLoad(); });
    this.loadImg(CHARACTER_IMAGES.backward).then(img => { this.charImgs.backward = img; this.incLoad(); })
      .catch(() => { console.warn('Char backward failed'); this.incLoad(); });
    this.loadImg(CHARACTER_IMAGES.shooting).then(img => { this.charImgs.shooting = img; this.incLoad(); })
      .catch(() => { console.warn('Char shooting failed'); this.incLoad(); });
    // Ground texture
    this.loadImg(GROUND_IMAGE).then(img => {
      this.groundImg = img;
      const tex = this.texFromImg(img); tex.repeat.set(40, 40);
      this.groundMat.map = tex; this.groundMat.needsUpdate = true;
      this.incLoad();
    }).catch(() => { console.warn('Ground failed'); this.incLoad(); });
  }

  private incLoad() { this.loadCount++; if (this.loadCount >= 4 && !this.ready) { this.ready = true; this.onReady?.(); } }

  // ==================== PUBLIC API ====================
  setOnReady(cb: () => void) { this.onReady = cb; }
  setOnStateChange(cb: (s: CharacterState) => void) { this.onState = cb; }
  updateInput(p: Partial<InputState>) { Object.assign(this.input, p); }

  triggerShoot() {
    if (this.charState === 'shooting') return;
    this.charState = 'shooting';
    this.shootTimer = 0.25;
    this.muzzleLight.intensity = 20;
    if (this.charImgs.shooting) this.setCharTex('shooting');
    this.onState?.('shooting');
    // Shoot ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.set(0, 2.0, -1.5);
    ring.lookAt(this.charWorldPos.clone().add(new THREE.Vector3(0, 2, -10)));
    this.charGroup.add(ring);
    this.shootRings.push(ring);
    setTimeout(() => {
      if (this.charState === 'shooting') { this.charState = 'idle'; this.setCharTex('forward'); this.onState?.('idle'); }
    }, 300);
  }

  // ==================== CAMERA FOLLOW ====================
  private updateCameraPosition() {
    // Orbit camera around character based on yaw/pitch
    const dist = this.camOffset.z;
    const height = this.camOffset.y;
    const targetX = this.charWorldPos.x + Math.sin(this.yaw) * dist;
    const targetZ = this.charWorldPos.z + Math.cos(this.yaw) * dist;
    const targetY = this.charWorldPos.y + height - this.pitch * 3;

    this.camera.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.08);

    const lookAt = this.charWorldPos.clone().add(this.camLookOffset);
    this.camera.lookAt(lookAt);
  }

  // ==================== UPDATE MOVEMENT ====================
  private updateMovement(dt: number) {
    // Movement direction relative to camera facing
    const camForward = new THREE.Vector3(0, 0, -1);
    camForward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    camForward.y = 0; camForward.normalize();
    const camRight = new THREE.Vector3(1, 0, 0);
    camRight.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    camRight.y = 0; camRight.normalize();

    const dir = new THREE.Vector3();
    if (this.input.w) dir.add(camForward);
    if (this.input.s) dir.sub(camForward);
    if (this.input.d) dir.add(camRight);
    if (this.input.a) dir.sub(camRight);
    const moving = dir.lengthSq() > 0;

    if (moving && this.charState !== 'shooting') {
      dir.normalize().multiplyScalar(this.config.moveSpeed);
      this.charWorldPos.add(dir);

      // Character faces movement direction
      const targetRot = Math.atan2(dir.x, dir.z);
      this.charRotation += shortAngleDist(this.charRotation, targetRot) * 0.15;

      const isF = this.input.w && !this.input.s;
      const isB = this.input.s && !this.input.w;
      if (isF && this.charState !== 'walking_forward') { this.charState = 'walking_forward'; if (this.charImgs.forward) this.setCharTex('forward'); this.onState?.('walking_forward'); }
      else if (isB && this.charState !== 'walking_backward') { this.charState = 'walking_backward'; if (this.charImgs.backward) this.setCharTex('backward'); this.onState?.('walking_backward'); }
      else if (!isF && !isB && this.charState !== 'walking_forward') { this.charState = 'walking_forward'; if (this.charImgs.forward) this.setCharTex('forward'); this.onState?.('walking_forward'); }

      this.walkTime += dt * this.config.walkBounceSpeed;
    } else if (!moving && this.charState !== 'shooting') {
      if (this.charState !== 'idle') { this.charState = 'idle'; if (this.charImgs.forward) this.setCharTex('forward'); this.onState?.('idle'); }
      this.walkTime *= 0.9;
    }

    // Update character group transform
    this.charGroup.position.copy(this.charWorldPos);
    this.charGroup.rotation.y = this.charRotation;

    // Character animation uniforms
    const bounceY = moving ? Math.abs(Math.sin(this.walkTime)) * this.config.walkBounceHeight : 0;
    const sway = moving ? this.walkTime * 2 : 0;
    const blur = moving ? Math.abs(Math.sin(this.walkTime)) * this.config.blurIntensity * 0.5 : 0;
    const u = this.charMat.uniforms;
    u.uBounceY.value += (bounceY - u.uBounceY.value) * 0.18;
    u.uSway.value = sway;
    u.uBlur.value += (blur - u.uBlur.value) * 0.12;
    u.uTime.value = this.t;
    if (this.shootTimer > 0) { this.shootTimer -= dt; u.uShootFlash.value = Math.max(0, this.shootTimer * 4); }
    else { u.uShootFlash.value *= 0.85; }
    this.charGlowMat.uniforms.uTime.value = this.t;

    // Shadow scale (smaller when bouncing up)
    const shadowScale = 1.0 - (u.uBounceY.value / this.config.walkBounceHeight) * 0.2;
    this.charShadow.scale.set(shadowScale, shadowScale, shadowScale);
  }

  // ==================== UPDATE LOOK ====================
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

  // ==================== UPDATE SHOOT FX ====================
  private updateShootFX(dt: number) {
    if (this.muzzleLight.intensity > 0) this.muzzleLight.intensity *= 0.85;
    for (let i = this.shootRings.length - 1; i >= 0; i--) {
      const ring = this.shootRings[i];
      ring.scale.multiplyScalar(1.1); ring.position.z -= 0.08;
      (ring.material as THREE.MeshBasicMaterial).opacity *= 0.88;
      if ((ring.material as THREE.MeshBasicMaterial).opacity < 0.01) {
        this.charGroup.remove(ring); ring.geometry.dispose(); (ring.material as THREE.Material).dispose();
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
    this.updateCameraPosition();
    this.updateShootFX(dt);

    // Update spotlight to follow character
    const spot = this.scene.children.find(c => c instanceof THREE.SpotLight) as THREE.SpotLight | undefined;
    if (spot) { spot.position.set(this.charWorldPos.x, 8, this.charWorldPos.z); spot.target.position.copy(this.charWorldPos); }

    this.ptsMat.uniforms.uTime.value = this.t;
    this.orbs.forEach((o, i) => {
      o.position.y += Math.sin(this.t * 0.4 + i * 1.7) * 0.004;
      (o.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(this.t * 0.7 + i * 2.3) * 0.2;
    });
    this.postMat.uniforms.uTime.value = this.t;

    // Render pipeline
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
    this.charMat.dispose(); this.charGlowMat.dispose();
    this.groundMat.dispose(); this.ptsMat.dispose(); this.postMat.dispose();
  }

  getIsReady() { return this.ready; }
}

// Utility: shortest angle distance
function shortAngleDist(from: number, to: number): number {
  const d = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return d;
}
