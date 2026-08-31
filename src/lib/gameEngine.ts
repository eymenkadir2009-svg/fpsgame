import * as THREE from 'three';
import { GameConfig, InputState, CharacterState, CHARACTER_IMAGES, GROUND_IMAGE } from './gameTypes';

export class GameEngine {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;
  
  // Character system - multi-plane 3D module
  private characterGroup: THREE.Group;
  private charFront!: THREE.Mesh;
  private charBack!: THREE.Mesh;
  private charSideLeft!: THREE.Mesh;
  private charSideRight!: THREE.Mesh;
  private charDepthFront!: THREE.Mesh;
  private charDepthBack!: THREE.Mesh;
  private charMaterialFront!: THREE.ShaderMaterial;
  private charMaterialBack!: THREE.ShaderMaterial;
  private charMaterialSide!: THREE.ShaderMaterial;
  private charMaterialDepth!: THREE.ShaderMaterial;
  private charGlow!: THREE.Mesh;
  
  private groundMesh!: THREE.Mesh;
  private groundMaterial!: THREE.ShaderMaterial;
  private postQuad!: THREE.Mesh;
  private postMaterial!: THREE.ShaderMaterial;
  private renderTarget: THREE.WebGLRenderTarget;
  private postCamera: THREE.OrthographicCamera;
  private postScene: THREE.Scene;
  
  // Particle system for ASMR atmosphere
  private particles!: THREE.Points;
  private particleMaterial!: THREE.ShaderMaterial;
  
  // Ambient light orbs
  private ambientOrbs: THREE.Mesh[] = [];
  
  private config: GameConfig;
  private input: InputState;
  private characterState: CharacterState = 'idle';
  private yaw: number = 0;
  private pitch: number = 0;
  private walkTime: number = 0;
  private turnBlurAmount: number = 0;
  private prevYaw: number = 0;
  private animTime: number = 0;
  
  private container: HTMLElement;
  private animationId: number = 0;
  private isRunning: boolean = false;
  
  // Textures
  private charTextures: Record<string, THREE.Texture | null> = {
    forward: null,
    backward: null,
    shooting: null,
  };
  private groundTexture: THREE.Texture | null = null;
  private allTexturesLoaded: boolean = false;
  private textureLoader: THREE.TextureLoader;
  
  // Shooting effect
  private shootFlashTime: number = 0;
  private muzzleFlash!: THREE.PointLight;
  private shootRings: THREE.Mesh[] = [];
  
  // State callbacks
  private onStateChange?: (state: CharacterState) => void;
  private onReady?: () => void;
  
  // Character texture transition
  private currentTexture: string = 'forward';
  private textureBlend: number = 1.0;
  private pendingTexture: string | null = null;
  
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
    this.textureLoader = new THREE.TextureLoader();
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0e14, 0.012);
    this.scene.background = new THREE.Color(0x0a0e14);
    
    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1000);
    this.camera.position.set(0, 1.7, 0);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    container.appendChild(this.renderer.domElement);
    
    // Post-processing
    this.renderTarget = new THREE.WebGLRenderTarget(
      container.clientWidth * Math.min(window.devicePixelRatio, 2),
      container.clientHeight * Math.min(window.devicePixelRatio, 2),
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
    );
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene = new THREE.Scene();
    
    // Character
    this.characterGroup = new THREE.Group();
    this.scene.add(this.characterGroup);
    
    this.setupLighting();
    this.setupCharacter();
    this.setupGround();
    this.setupParticles();
    this.setupAmbientOrbs();
    this.setupPostProcessing();
    this.setupMuzzleFlash();
    this.loadTextures();
    this.setupEnvironment();
  }
  
  private setupLighting() {
    const ambient = new THREE.AmbientLight(0x2a3a5a, 0.8);
    this.scene.add(ambient);
    
    const dirLight = new THREE.DirectionalLight(0x6699cc, 1.5);
    dirLight.position.set(5, 12, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    this.scene.add(dirLight);
    
    const rimLight = new THREE.DirectionalLight(0xff7744, 0.5);
    rimLight.position.set(-3, 3, -5);
    this.scene.add(rimLight);
    
    const hemiLight = new THREE.HemisphereLight(0x4466aa, 0x223311, 0.6);
    this.scene.add(hemiLight);
    
    // Character spotlight from above
    const spotLight = new THREE.SpotLight(0xaaccff, 1.5, 8, Math.PI / 6, 0.5, 1);
    spotLight.position.set(0, 4, -0.8);
    spotLight.target.position.set(0, 0, -0.8);
    this.scene.add(spotLight);
    this.scene.add(spotLight.target);
  }
  
  // ========== CHARACTER SYSTEM - 3D MODULE WITH TEXTURES ==========
  
  private createCharMaterial(type: 'front' | 'back' | 'side' | 'depth'): THREE.ShaderMaterial {
    const defaultTex = new THREE.DataTexture(
      new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat
    );
    defaultTex.needsUpdate = true;
    
    const isFront = type === 'front';
    const isSide = type === 'side';
    const isDepth = type === 'depth';
    
    return new THREE.ShaderMaterial({
      uniforms: {
        tCharacter: { value: defaultTex },
        tCharacterNext: { value: defaultTex },
        uBlend: { value: 1.0 },
        uBounceY: { value: 0.0 },
        uSwayAngle: { value: 0.0 },
        uBlurAmount: { value: 0.0 },
        uGlowIntensity: { value: 0.4 },
        uTime: { value: 0.0 },
        uIsFront: { value: isFront ? 1.0 : 0.0 },
        uOpacity: { value: isDepth ? 0.5 : 1.0 },
      },
      vertexShader: `
        uniform float uBounceY;
        uniform float uSwayAngle;
        uniform float uTime;
        uniform float uBlurAmount;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec3 pos = position;
          pos.y += uBounceY;
          
          float sway = sin(uSwayAngle) * 0.025;
          float lean = cos(uSwayAngle * 0.7) * 0.008;
          mat3 swayMat = mat3(
            cos(sway), lean, sin(sway),
            -lean * 0.5, 1.0, lean * 0.3,
            -sin(sway), lean * 0.3, cos(sway)
          );
          pos = swayMat * pos;
          
          vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D tCharacter;
        uniform sampler2D tCharacterNext;
        uniform float uBlend;
        uniform float uBlurAmount;
        uniform float uGlowIntensity;
        uniform float uTime;
        uniform float uIsFront;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
          // Sample current and next texture for smooth transition
          vec4 baseColor = texture2D(tCharacter, vUv);
          if (uBlend < 1.0) {
            vec4 nextColor = texture2D(tCharacterNext, vUv);
            baseColor = mix(nextColor, baseColor, uBlend);
          }
          
          if (baseColor.a < 0.08) discard;
          
          // Motion blur effect
          vec4 blurColor = vec4(0.0);
          float totalWeight = 0.0;
          if (uBlurAmount > 0.01) {
            for (float i = -8.0; i <= 8.0; i += 1.0) {
              float weight = 1.0 - abs(i) / 9.0;
              weight = weight * weight * weight;
              vec2 offset = vec2(i * uBlurAmount * 0.005, i * uBlurAmount * 0.001);
              blurColor += texture2D(tCharacter, clamp(vUv + offset, 0.0, 1.0)) * weight;
              totalWeight += weight;
            }
            blurColor /= totalWeight;
          }
          vec4 finalColor = mix(baseColor, blurColor, min(uBlurAmount, 1.0));
          
          // Edge glow / rim lighting
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float rim = 1.0 - max(dot(vNormal, viewDir), 0.0);
          rim = pow(rim, 3.0);
          vec3 rimColor = mix(vec3(0.2, 0.5, 1.0), vec3(0.1, 1.0, 0.6), sin(uTime * 0.5) * 0.5 + 0.5);
          finalColor.rgb += rimColor * rim * uGlowIntensity;
          
          // Subtle pulsing glow
          float pulse = 0.95 + 0.05 * sin(uTime * 2.0);
          finalColor.rgb *= pulse;
          
          // Slight color grading
          finalColor.rgb = pow(finalColor.rgb, vec3(0.97, 0.98, 1.0));
          
          gl_FragColor = vec4(finalColor.rgb, finalColor.a * uOpacity);
        }
      `,
      transparent: true,
      side: isDepth ? THREE.FrontSide : THREE.DoubleSide,
      depthWrite: !isDepth,
    });
  }
  
  private setupCharacter() {
    const CHAR_W = 1.0;
    const CHAR_H = 1.8;
    const DEPTH = 0.15;
    
    // ---- Front face (main character image) ----
    this.charMaterialFront = this.createCharMaterial('front');
    const frontGeo = new THREE.PlaneGeometry(CHAR_W, CHAR_H, 1, 1);
    this.charFront = new THREE.Mesh(frontGeo, this.charMaterialFront);
    this.charFront.position.set(0, CHAR_H / 2, -DEPTH / 2);
    this.charFront.castShadow = true;
    this.characterGroup.add(this.charFront);
    
    // ---- Back face (slightly darker version of character) ----
    this.charMaterialBack = this.createCharMaterial('back');
    const backGeo = new THREE.PlaneGeometry(CHAR_W, CHAR_H, 1, 1);
    this.charBack = new THREE.Mesh(backGeo, this.charMaterialBack);
    this.charBack.position.set(0, CHAR_H / 2, DEPTH / 2);
    this.charBack.rotation.y = Math.PI;
    this.charBack.castShadow = true;
    this.characterGroup.add(this.charBack);
    
    // ---- Side panels (depth illusion) ----
    this.charMaterialSide = this.createCharMaterial('side');
    
    // Left side
    const sideGeo = new THREE.PlaneGeometry(DEPTH, CHAR_H, 1, 1);
    this.charSideLeft = new THREE.Mesh(sideGeo, this.charMaterialSide);
    this.charSideLeft.position.set(-CHAR_W / 2, CHAR_H / 2, 0);
    this.charSideLeft.rotation.y = -Math.PI / 2;
    this.characterGroup.add(this.charSideLeft);
    
    // Right side
    this.charSideRight = new THREE.Mesh(sideGeo.clone(), this.charMaterialSide);
    this.charSideRight.position.set(CHAR_W / 2, CHAR_H / 2, 0);
    this.charSideRight.rotation.y = Math.PI / 2;
    this.characterGroup.add(this.charSideRight);
    
    // ---- Depth planes (inner faces for 3D box effect) ----
    this.charMaterialDepth = this.createCharMaterial('depth');
    
    this.charDepthFront = new THREE.Mesh(
      new THREE.PlaneGeometry(CHAR_W, CHAR_H),
      this.charMaterialDepth
    );
    this.charDepthFront.position.set(0, CHAR_H / 2, DEPTH / 2 - 0.01);
    this.characterGroup.add(this.charDepthFront);
    
    this.charDepthBack = new THREE.Mesh(
      new THREE.PlaneGeometry(CHAR_W, CHAR_H),
      this.charMaterialDepth
    );
    this.charDepthBack.position.set(0, CHAR_H / 2, -DEPTH / 2 + 0.01);
    this.charDepthBack.rotation.y = Math.PI;
    this.characterGroup.add(this.charDepthBack);
    
    // ---- Top cap ----
    const topGeo = new THREE.PlaneGeometry(CHAR_W, DEPTH);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0x223344,
      metalness: 0.7,
      roughness: 0.4,
      transparent: true,
      opacity: 0.6,
    });
    const topCap = new THREE.Mesh(topGeo, topMat);
    topCap.position.set(0, CHAR_H, 0);
    topCap.rotation.x = -Math.PI / 2;
    this.characterGroup.add(topCap);
    
    // ---- Bottom cap ----
    const bottomCap = new THREE.Mesh(topGeo.clone(), topMat.clone());
    bottomCap.position.set(0, 0, 0);
    bottomCap.rotation.x = Math.PI / 2;
    this.characterGroup.add(bottomCap);
    
    // ---- Character glow aura ----
    const glowGeo = new THREE.PlaneGeometry(CHAR_W * 1.6, CHAR_H * 1.3);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(0.1, 0.4, 0.8) },
        uColor2: { value: new THREE.Color(0.0, 0.8, 0.4) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        varying vec2 vUv;
        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center * vec2(1.0, 0.75));
          float glow = exp(-dist * 3.5) * 0.35;
          glow *= 0.8 + 0.2 * sin(uTime * 1.5);
          vec3 color = mix(uColor1, uColor2, sin(uTime * 0.3) * 0.5 + 0.5);
          gl_FragColor = vec4(color, glow);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.charGlow = new THREE.Mesh(glowGeo, glowMat);
    this.charGlow.position.set(0, CHAR_H / 2, -DEPTH);
    this.characterGroup.add(this.charGlow);
    
    // ---- Ground shadow ----
    const shadowGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.01, 0);
    this.characterGroup.add(shadow);
    
    // Position the whole character group in front of camera
    this.characterGroup.position.set(0, 0, -1.2);
  }
  
  private setCharacterTexture(textureKey: string, blend: boolean = true) {
    if (textureKey === this.currentTexture) return;
    
    const tex = this.charTextures[textureKey];
    if (!tex) return;
    
    if (blend && this.charMaterialFront.uniforms.tCharacter.value !== tex) {
      // Store current as "next" for blending
      this.charMaterialFront.uniforms.tCharacterNext.value = 
        this.charMaterialFront.uniforms.tCharacter.value;
      this.charMaterialBack.uniforms.tCharacterNext.value = 
        this.charMaterialBack.uniforms.tCharacter.value;
      this.charMaterialSide.uniforms.tCharacterNext.value = 
        this.charMaterialSide.uniforms.tCharacter.value;
      
      this.charMaterialFront.uniforms.tCharacter.value = tex;
      this.charMaterialBack.uniforms.tCharacter.value = tex;
      this.charMaterialSide.uniforms.tCharacter.value = tex;
      this.charMaterialDepth.uniforms.tCharacter.value = tex;
      
      this.textureBlend = 0.0;
      this.pendingTexture = textureKey;
    } else {
      // Instant switch (no blend)
      this.charMaterialFront.uniforms.tCharacter.value = tex;
      this.charMaterialBack.uniforms.tCharacter.value = tex;
      this.charMaterialSide.uniforms.tCharacter.value = tex;
      this.charMaterialDepth.uniforms.tCharacter.value = tex;
      this.charMaterialFront.uniforms.tCharacterNext.value = tex;
      this.charMaterialBack.uniforms.tCharacterNext.value = tex;
      this.charMaterialSide.uniforms.tCharacterNext.value = tex;
      this.charMaterialDepth.uniforms.tCharacterNext.value = tex;
      this.textureBlend = 1.0;
      this.currentTexture = textureKey;
    }
  }
  
  private updateTextureBlend(delta: number) {
    if (this.textureBlend < 1.0) {
      this.textureBlend = Math.min(1.0, this.textureBlend + delta * 8.0);
      this.charMaterialFront.uniforms.uBlend.value = this.textureBlend;
      this.charMaterialBack.uniforms.uBlend.value = this.textureBlend;
      this.charMaterialSide.uniforms.uBlend.value = this.textureBlend;
      this.charMaterialDepth.uniforms.uBlend.value = this.textureBlend;
      
      if (this.textureBlend >= 1.0 && this.pendingTexture) {
        this.currentTexture = this.pendingTexture;
        this.pendingTexture = null;
      }
    }
  }
  
  // ========== GROUND SYSTEM WITH TEXTURE ==========
  
  private setupGround() {
    // High-detail ground for close range
    const groundGeo = new THREE.PlaneGeometry(200, 200, 64, 64);
    
    const defaultTex = new THREE.DataTexture(
      new Uint8Array([60, 80, 60, 255]), 1, 1, THREE.RGBAFormat
    );
    defaultTex.needsUpdate = true;
    
    this.groundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tGround: { value: defaultTex },
        uTime: { value: 0.0 },
        uCameraPos: { value: new THREE.Vector3() },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vDistFromCamera;
        
        void main() {
          vUv = uv;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPosition.xyz;
          
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vDistFromCamera = -mvPos.z;
          
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D tGround;
        uniform float uTime;
        uniform vec3 uCameraPos;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying float vDistFromCamera;
        
        void main() {
          // Tile the ground texture based on world position
          vec2 worldUv = vWorldPos.xz * 0.15;
          
          // Sample ground texture with tiling
          vec4 groundColor = texture2D(tGround, worldUv);
          
          // Second layer - larger tiles for variety
          vec2 worldUv2 = vWorldPos.xz * 0.05 + 3.7;
          vec4 groundColor2 = texture2D(tGround, worldUv2);
          
          // Mix two tile layers
          vec3 baseColor = mix(groundColor.rgb, groundColor2.rgb * 0.7, 0.3);
          
          // Grid overlay - subtle tech lines
          float gridX = abs(fract(vWorldPos.x * 0.5) - 0.5);
          float gridZ = abs(fract(vWorldPos.z * 0.5) - 0.5);
          float grid = min(gridX, gridZ);
          float gridLine = 1.0 - smoothstep(0.0, 0.02, grid);
          
          // Fine grid
          float fineGridX = abs(fract(vWorldPos.x * 2.0) - 0.5);
          float fineGridZ = abs(fract(vWorldPos.z * 2.0) - 0.5);
          float fineGrid = min(fineGridX, fineGridZ);
          float fineGridLine = 1.0 - smoothstep(0.0, 0.005, fineGrid);
          
          vec3 gridColor = vec3(0.05, 0.2, 0.15);
          vec3 fineGridColor = vec3(0.03, 0.12, 0.1);
          
          baseColor = mix(baseColor, gridColor, gridLine * 0.4);
          baseColor = mix(baseColor, fineGridColor, fineGridLine * 0.15);
          
          // Distance-based detail - more detail close, less far
          float detailFactor = clamp(1.0 - vDistFromCamera * 0.02, 0.3, 1.0);
          baseColor = mix(vec3(0.03, 0.06, 0.08), baseColor, detailFactor);
          
          // Atmospheric fog
          float dist = length(vWorldPos.xz - uCameraPos.xz) * 0.006;
          float fogFactor = 1.0 - exp(-dist * dist * 2.0);
          baseColor = mix(baseColor, vec3(0.04, 0.06, 0.1), fogFactor);
          
          // Subtle animated pulse on the ground
          float pulse = sin(uTime * 0.5 + length(vWorldPos.xz) * 0.1) * 0.02;
          baseColor += pulse;
          
          gl_FragColor = vec4(baseColor, 1.0);
        }
      `,
    });
    
    this.groundMesh = new THREE.Mesh(groundGeo, this.groundMaterial);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
  }
  
  // ========== PARTICLES ==========
  
  private setupParticles() {
    const count = 4000;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const speeds = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 18 + 0.3;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
      sizes[i] = Math.random() * 4 + 0.5;
      alphas[i] = Math.random();
      speeds[i] = 0.3 + Math.random() * 0.7;
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute float aAlpha;
        attribute float aSpeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vDist;
        
        void main() {
          vAlpha = aAlpha;
          vec3 pos = position;
          pos.y += sin(uTime * 0.3 * aSpeed + position.x * 0.5) * 0.4;
          pos.x += sin(uTime * 0.15 * aSpeed + position.z * 0.3) * 0.3;
          pos.z += cos(uTime * 0.2 * aSpeed + position.y * 0.2) * 0.2;
          
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          vDist = -mvPosition.z;
          gl_PointSize = size * uPixelRatio * (100.0 / max(-mvPosition.z, 1.0));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vDist;
        uniform float uTime;
        
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          
          // Soft circle
          float alpha = smoothstep(0.5, 0.1, d) * vAlpha * 0.35;
          alpha *= 0.6 + 0.4 * sin(uTime * 1.5 + vAlpha * 6.28);
          
          // Fade with distance
          alpha *= clamp(1.0 - vDist * 0.008, 0.0, 1.0);
          
          // Color variation
          vec3 color1 = vec3(0.2, 0.5, 1.0);
          vec3 color2 = vec3(0.0, 0.9, 0.5);
          vec3 color3 = vec3(0.6, 0.3, 1.0);
          
          float t = vAlpha;
          vec3 color = t < 0.5 
            ? mix(color1, color2, t * 2.0) 
            : mix(color2, color3, (t - 0.5) * 2.0);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    
    this.particles = new THREE.Points(geo, this.particleMaterial);
    this.scene.add(this.particles);
  }
  
  // ========== AMBIENT ORBS ==========
  
  private setupAmbientOrbs() {
    const orbData = [
      { x: 5, y: 2, z: -8, color: 0x2266ff, size: 0.15 },
      { x: -7, y: 3, z: -5, color: 0xff4422, size: 0.12 },
      { x: 3, y: 1.5, z: -12, color: 0x22ff88, size: 0.18 },
      { x: -4, y: 4, z: -15, color: 0x8844ff, size: 0.1 },
      { x: 8, y: 2.5, z: -20, color: 0xffaa22, size: 0.14 },
      { x: -10, y: 1, z: -10, color: 0x44ddff, size: 0.13 },
      { x: 15, y: 3.5, z: -14, color: 0xff2288, size: 0.11 },
      { x: -15, y: 2, z: -18, color: 0x22ffcc, size: 0.16 },
    ];
    
    orbData.forEach(({ x, y, z, color, size }) => {
      const geo = new THREE.SphereGeometry(size, 16, 16);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
      const orb = new THREE.Mesh(geo, mat);
      orb.position.set(x, y, z);
      this.scene.add(orb);
      
      // Glow halo
      const haloGeo = new THREE.SphereGeometry(size * 3, 16, 16);
      const haloMat = new THREE.MeshBasicMaterial({ 
        color, transparent: true, opacity: 0.08, 
        depthWrite: false, side: THREE.BackSide 
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(orb.position);
      this.scene.add(halo);
      
      const light = new THREE.PointLight(color, 2.5, 10);
      light.position.copy(orb.position);
      this.scene.add(light);
      
      this.ambientOrbs.push(orb);
    });
  }
  
  // ========== POST PROCESSING ==========
  
  private setupPostProcessing() {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        uTime: { value: 0 },
        uVignetteIntensity: { value: 1.5 },
        uChromaticAberration: { value: 0.003 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uVignetteIntensity;
        uniform float uChromaticAberration;
        varying vec2 vUv;
        
        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center);
          
          // Chromatic aberration
          float r = texture2D(tDiffuse, vUv + center * uChromaticAberration).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - center * uChromaticAberration).b;
          vec3 color = vec3(r, g, b);
          
          // Vignette
          float vignette = 1.0 - smoothstep(0.2, 0.9, dist * uVignetteIntensity);
          color *= mix(0.3, 1.0, vignette);
          
          // Subtle scanlines
          float scanline = sin(vUv.y * 700.0 + uTime * 1.2) * 0.012;
          color -= scanline;
          
          // Film grain
          float grain = (fract(sin(dot(vUv * uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02;
          color += grain;
          
          // Final tonal adjustment
          color = pow(max(color, vec3(0.0)), vec3(0.97));
          
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthWrite: false,
      depthTest: false,
    });
    
    this.postQuad = new THREE.Mesh(geo, this.postMaterial);
    this.postScene.add(this.postQuad);
  }
  
  // ========== MUZZLE FLASH ==========
  
  private setupMuzzleFlash() {
    this.muzzleFlash = new THREE.PointLight(0xffaa44, 0, 8);
    this.muzzleFlash.position.set(0, 1.4, -0.3);
    this.characterGroup.add(this.muzzleFlash);
    
    // Muzzle flash mesh
    const flashGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ 
      color: 0xffdd66, transparent: true, opacity: 0 
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(0, 1.4, -0.5);
    flash.name = 'muzzleFlashMesh';
    this.characterGroup.add(flash);
  }
  
  // ========== ENVIRONMENT ==========
  
  private setupEnvironment() {
    const pillarPositions = [
      { x: 8, z: -6 }, { x: -8, z: -6 },
      { x: 6, z: -15 }, { x: -6, z: -15 },
      { x: 12, z: -10 }, { x: -12, z: -10 },
      { x: 0, z: -20 }, { x: 10, z: -25 },
      { x: -10, z: -25 }, { x: 15, z: -18 },
    ];
    
    pillarPositions.forEach(({ x, z }) => {
      const pillarGeo = new THREE.CylinderGeometry(0.3, 0.45, 5, 8);
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x1a2a3a,
        metalness: 0.85,
        roughness: 0.25,
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(x, 2.5, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);
      
      // Base ring
      const baseGeo = new THREE.TorusGeometry(0.5, 0.05, 8, 16);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x334455, metalness: 0.9, roughness: 0.2,
        emissive: 0x112233, emissiveIntensity: 0.3,
      });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.set(x, 0.05, z);
      base.rotation.x = -Math.PI / 2;
      this.scene.add(base);
      
      // Top light
      const topGeo = new THREE.SphereGeometry(0.12, 12, 12);
      const topMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.8 });
      const topSphere = new THREE.Mesh(topGeo, topMat);
      topSphere.position.set(x, 5.15, z);
      this.scene.add(topSphere);
      
      const pLight = new THREE.PointLight(0x4488ff, 1.5, 8);
      pLight.position.set(x, 5.15, z);
      this.scene.add(pLight);
    });
    
    // Distant structures
    for (let i = 0; i < 30; i++) {
      const w = Math.random() * 4 + 1;
      const h = Math.random() * 8 + 3;
      const d = Math.random() * 4 + 1;
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.3, 0.06 + Math.random() * 0.04),
        metalness: 0.7,
        roughness: 0.4,
      });
      const building = new THREE.Mesh(geo, mat);
      const angle = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 30;
      building.position.set(
        Math.cos(angle) * dist,
        h / 2,
        Math.sin(angle) * dist
      );
      building.castShadow = true;
      this.scene.add(building);
      
      // Window lights on buildings
      if (Math.random() > 0.4) {
        const windowCount = Math.floor(Math.random() * 4) + 1;
        for (let w2 = 0; w2 < windowCount; w2++) {
          const wGeo = new THREE.PlaneGeometry(0.2, 0.3);
          const wMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.1 + Math.random() * 0.15, 0.8, 0.6),
            transparent: true,
            opacity: 0.5 + Math.random() * 0.3,
          });
          const win = new THREE.Mesh(wGeo, wMat);
          win.position.set(
            building.position.x + (Math.random() - 0.5) * w * 0.8,
            Math.random() * h * 0.6 + h * 0.2,
            building.position.z + (Math.random() > 0.5 ? d / 2 + 0.01 : -d / 2 - 0.01)
          );
          win.lookAt(this.camera.position);
          this.scene.add(win);
        }
      }
    }
  }
  
  // ========== TEXTURE LOADING ==========
  
  private loadTextures() {
    const loadImage = (url: string): Promise<THREE.Texture> => {
      return new Promise((resolve, reject) => {
        this.textureLoader.load(
          url,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            resolve(texture);
          },
          undefined,
          reject
        );
      });
    };
    
    // Load all textures in parallel
    const loadPromises = [
      loadImage(CHARACTER_IMAGES.forward).then(tex => { this.charTextures.forward = tex; }),
      loadImage(CHARACTER_IMAGES.backward).then(tex => { this.charTextures.backward = tex; }),
      loadImage(CHARACTER_IMAGES.shooting).then(tex => { this.charTextures.shooting = tex; }),
      loadImage(GROUND_IMAGE).then(tex => { this.groundTexture = tex; }),
    ];
    
    // Set forward texture as soon as it loads (don't wait for all)
    loadImage(CHARACTER_IMAGES.forward).then(tex => {
      this.setCharacterTexture('forward', false);
    });
    
    Promise.all(loadPromises).then(() => {
      // Apply ground texture
      if (this.groundTexture) {
        this.groundMaterial.uniforms.tGround.value = this.groundTexture;
      }
      this.allTexturesLoaded = true;
      this.onReady?.();
    }).catch((err) => {
      console.warn('Texture loading partial failure:', err);
      this.allTexturesLoaded = true;
      this.onReady?.();
    });
  }
  
  // ========== PUBLIC API ==========
  
  setOnStateChange(cb: (state: CharacterState) => void) {
    this.onStateChange = cb;
  }
  
  setOnReady(cb: () => void) {
    this.onReady = cb;
  }
  
  updateInput(partial: Partial<InputState>) {
    Object.assign(this.input, partial);
  }
  
  triggerShoot() {
    if (this.characterState !== 'shooting') {
      this.characterState = 'shooting';
      this.shootFlashTime = 0.2;
      this.muzzleFlash.intensity = 20;
      
      // Muzzle flash mesh
      const flashMesh = this.characterGroup.getObjectByName('muzzleFlashMesh') as THREE.Mesh | undefined;
      if (flashMesh) {
        (flashMesh.material as THREE.MeshBasicMaterial).opacity = 1.0;
      }
      
      // Shoot ring
      const ringGeo = new THREE.RingGeometry(0.05, 0.18, 32);
      const ringMat = new THREE.MeshBasicMaterial({ 
        color: 0xffcc44, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(0, 1.4, -1.6);
      const dir = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(this.camera.position);
      ring.lookAt(dir);
      this.characterGroup.add(ring);
      this.shootRings.push(ring);
      
      // Set shooting texture
      this.setCharacterTexture('shooting', true);
      this.onStateChange?.('shooting');
      
      setTimeout(() => {
        if (this.characterState === 'shooting') {
          this.characterState = 'idle';
          this.setCharacterTexture('forward', true);
          this.onStateChange?.('idle');
        }
      }, 250);
    }
  }
  
  // ========== UPDATE SYSTEMS ==========
  
  private updateMovement(delta: number) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0;
    right.normalize();
    
    const moveDir = new THREE.Vector3();
    if (this.input.w) moveDir.add(forward);
    if (this.input.s) moveDir.sub(forward);
    if (this.input.d) moveDir.add(right);
    if (this.input.a) moveDir.sub(right);
    
    const isMoving = moveDir.length() > 0;
    
    if (isMoving && this.characterState !== 'shooting') {
      moveDir.normalize().multiplyScalar(this.config.moveSpeed);
      this.camera.position.add(moveDir);
      
      const isForward = this.input.w && !this.input.s;
      const isBackward = this.input.s && !this.input.w;
      
      if (isForward && this.characterState !== 'walking_forward') {
        this.characterState = 'walking_forward';
        this.setCharacterTexture('forward', true);
        this.onStateChange?.('walking_forward');
      } else if (isBackward && this.characterState !== 'walking_backward') {
        this.characterState = 'walking_backward';
        this.setCharacterTexture('backward', true);
        this.onStateChange?.('walking_backward');
      } else if (!isForward && !isBackward && this.characterState !== 'walking_forward') {
        this.characterState = 'walking_forward';
        this.setCharacterTexture('forward', true);
        this.onStateChange?.('walking_forward');
      }
      
      this.walkTime += delta * this.config.walkBounceSpeed;
    } else if (!isMoving && this.characterState !== 'shooting') {
      if (this.characterState !== 'idle') {
        this.characterState = 'idle';
        this.setCharacterTexture('forward', true);
        this.onStateChange?.('idle');
      }
      this.walkTime *= 0.9;
    }
    
    // 3D character bounce & sway animation
    const bounce = isMoving 
      ? Math.abs(Math.sin(this.walkTime)) * this.config.walkBounceHeight
      : 0;
    const sway = isMoving ? this.walkTime * 2 : 0;
    const blur = isMoving 
      ? Math.abs(Math.sin(this.walkTime)) * this.config.blurIntensity * 0.6
      : 0;
    
    // Update all character material uniforms
    const allMats = [this.charMaterialFront, this.charMaterialBack, this.charMaterialSide, this.charMaterialDepth];
    allMats.forEach(mat => {
      mat.uniforms.uBounceY.value += (bounce - mat.uniforms.uBounceY.value) * 0.2;
      mat.uniforms.uSwayAngle.value = sway;
      mat.uniforms.uBlurAmount.value += (blur - mat.uniforms.uBlurAmount.value) * 0.15;
      mat.uniforms.uTime.value = this.animTime;
    });
    
    // Glow pulse
    const glowMat = this.charGlow.material as THREE.ShaderMaterial;
    glowMat.uniforms.uTime.value = this.animTime;
    
    // Smooth texture blend
    this.updateTextureBlend(delta);
    
    // Camera head bob (realistic walking feel)
    if (isMoving) {
      const bobY = Math.sin(this.walkTime) * 0.045;
      const bobX = Math.cos(this.walkTime * 0.5) * 0.008;
      const bobRoll = Math.sin(this.walkTime) * 0.003;
      
      this.camera.position.y += (1.7 + bobY - this.camera.position.y) * 0.3;
      this.camera.rotation.z += (bobRoll - this.camera.rotation.z) * 0.2;
    } else {
      this.camera.position.y += (1.7 - this.camera.position.y) * 0.08;
      this.camera.rotation.z *= 0.9;
    }
  }
  
  private updateLook(delta: number) {
    if (this.input.isPointerLocked) {
      this.yaw -= this.input.mouseX * this.config.lookSensitivity;
      this.pitch -= this.input.mouseY * this.config.lookSensitivity;
    }
    
    if (this.input.touchStartX !== null) {
      this.yaw -= this.input.touchDeltaX * this.config.lookSensitivity * 0.5;
      this.pitch -= this.input.touchDeltaY * this.config.lookSensitivity * 0.5;
    }
    
    this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
    
    // Turn blur
    const yawDelta = Math.abs(this.yaw - this.prevYaw);
    this.turnBlurAmount += (yawDelta * 35 - this.turnBlurAmount) * 0.12;
    this.turnBlurAmount = Math.min(this.turnBlurAmount, this.config.turnBlurIntensity);
    this.prevYaw = this.yaw;
    
    // Apply camera rotation
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    
    // Character follows camera Y rotation
    this.characterGroup.rotation.y = this.yaw;
    
    // Post-processing reacts to turning
    this.postMaterial.uniforms.uChromaticAberration.value = 
      0.003 + this.turnBlurAmount * 0.01;
    this.postMaterial.uniforms.uVignetteIntensity.value = 
      1.5 + this.turnBlurAmount * 0.4;
  }
  
  private updateShootEffects(delta: number) {
    if (this.shootFlashTime > 0) {
      this.shootFlashTime -= delta;
      this.muzzleFlash.intensity = Math.max(0, this.shootFlashTime * 80);
      
      const flashMesh = this.characterGroup.getObjectByName('muzzleFlashMesh') as THREE.Mesh | undefined;
      if (flashMesh) {
        (flashMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.shootFlashTime * 5);
      }
    }
    
    for (let i = this.shootRings.length - 1; i >= 0; i--) {
      const ring = this.shootRings[i];
      ring.scale.multiplyScalar(1.12);
      ring.position.z -= 0.05;
      (ring.material as THREE.MeshBasicMaterial).opacity *= 0.88;
      if ((ring.material as THREE.MeshBasicMaterial).opacity < 0.01) {
        this.characterGroup.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        this.shootRings.splice(i, 1);
      }
    }
  }
  
  private updateParticles(time: number) {
    this.particleMaterial.uniforms.uTime.value = time;
    
    this.ambientOrbs.forEach((orb, i) => {
      orb.position.y += Math.sin(time * 0.4 + i * 1.7) * 0.004;
      orb.position.x += Math.cos(time * 0.3 + i * 2.1) * 0.002;
      (orb.material as THREE.MeshBasicMaterial).opacity = 
        0.5 + Math.sin(time * 0.7 + i * 2.3) * 0.2;
    });
  }
  
  // ========== MAIN LOOP ==========
  
  private animate = () => {
    if (!this.isRunning) return;
    this.animationId = requestAnimationFrame(this.animate);
    
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.animTime += delta;
    
    this.updateMovement(delta);
    this.updateLook(delta);
    this.updateShootEffects(delta);
    this.updateParticles(this.animTime);
    
    // Update ground uniforms
    this.groundMaterial.uniforms.uTime.value = this.animTime;
    this.groundMaterial.uniforms.uCameraPos.value.copy(this.camera.position);
    
    // Post time
    this.postMaterial.uniforms.uTime.value = this.animTime;
    
    // Render to target
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    
    // Post-process pass
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  };
  
  start() {
    this.isRunning = true;
    this.clock.start();
    this.animate();
  }
  
  stop() {
    this.isRunning = false;
    cancelAnimationFrame(this.animationId);
  }
  
  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderTarget.setSize(width * pr, height * pr);
    this.particleMaterial.uniforms.uPixelRatio.value = pr;
  }
  
  dispose() {
    this.stop();
    this.renderer.dispose();
    this.renderTarget.dispose();
    Object.values(this.charTextures).forEach(t => t?.dispose());
    this.groundTexture?.dispose();
    this.charMaterialFront.dispose();
    this.charMaterialBack.dispose();
    this.charMaterialSide.dispose();
    this.charMaterialDepth.dispose();
    this.groundMaterial.dispose();
    this.particleMaterial.dispose();
    this.postMaterial.dispose();
  }
  
  getIsReady() {
    return this.allTexturesLoaded;
  }
}