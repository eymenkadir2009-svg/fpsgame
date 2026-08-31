// Vertex Shader - Bloom Pass
export const bloomVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Fragment Shader - Bloom Pass
export const bloomFragmentShader = `
uniform sampler2D tDiffuse;
uniform float intensity;
varying vec2 vUv;

void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 bloom = color.rgb * max(0.0, brightness - 0.4) * intensity;
    gl_FragColor = vec4(bloom + color.rgb * 0.3, color.a);
}
`;

// Vertex Shader - Ground
export const groundVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

// Fragment Shader - Ground with Grid Effect
export const groundFragmentShader = `
uniform sampler2D tGround;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vec2 tiledUv = vUv * 50.0;
    vec4 groundColor = texture2D(tGround, tiledUv);
    
    float gridX = abs(fract(vWorldPos.x * 0.5) - 0.5);
    float gridZ = abs(fract(vWorldPos.z * 0.5) - 0.5);
    float grid = min(gridX, gridZ);
    float gridLine = 1.0 - smoothstep(0.0, 0.02, grid);
    
    vec3 finalColor = mix(groundColor.rgb, vec3(0.1, 0.3, 0.2), gridLine * 0.3);
    
    float dist = length(vWorldPos.xz) * 0.01;
    float fogFactor = 1.0 - exp(-dist * dist);
    finalColor = mix(finalColor, vec3(0.02, 0.04, 0.06), fogFactor);
    
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// Vertex Shader - Character Sprite
export const spriteVertexShader = `
uniform float uBounceY;
uniform float uSwayAngle;
uniform float uBlurAmount;
varying vec2 vUv;

void main() {
    vUv = uv;
    
    vec3 pos = position;
    pos.y += uBounceY;
    
    float sway = sin(uSwayAngle) * 0.02;
    mat3 swayMat = mat3(
        cos(sway), 0.0, sin(sway),
        0.0, 1.0, 0.0,
        -sin(sway), 0.0, cos(sway)
    );
    pos = swayMat * pos;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// Fragment Shader - Character with Motion Blur
export const spriteFragmentShader = `
uniform sampler2D tCharacter;
uniform float uBlurAmount;
uniform float uGlowIntensity;
varying vec2 vUv;

void main() {
    vec4 baseColor = texture2D(tCharacter, vUv);
    
    if (baseColor.a < 0.1) discard;
    
    vec4 blurColor = vec4(0.0);
    float totalWeight = 0.0;
    float samples = 8.0;
    
    if (uBlurAmount > 0.01) {
        for (float i = -samples; i <= samples; i += 1.0) {
            float weight = 1.0 - abs(i) / (samples + 1.0);
            weight = weight * weight;
            vec2 offset = vec2(i * uBlurAmount * 0.003, 0.0);
            blurColor += texture2D(tCharacter, vUv + offset) * weight;
            totalWeight += weight;
        }
        blurColor /= totalWeight;
    }
    
    vec4 finalColor = mix(baseColor, blurColor, uBlurAmount);
    
    vec3 glowColor = vec3(0.3, 0.6, 1.0) * uGlowIntensity;
    finalColor.rgb += glowColor * (1.0 - finalColor.a * 0.5) * 0.15;
    
    finalColor.rgb = pow(finalColor.rgb, vec3(0.95));
    
    gl_FragColor = finalColor;
}
`;

// Post-processing vignette + chromatic aberration
export const postVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const postFragmentShader = `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uVignetteIntensity;
uniform float uChromaticAberration;
varying vec2 vUv;

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    
    float r = texture2D(tDiffuse, vUv + center * uChromaticAberration).r;
    float g = texture2D(tDiffuse, vUv).g;
    float b = texture2D(tDiffuse, vUv - center * uChromaticAberration).b;
    vec3 color = vec3(r, g, b);
    
    float vignette = 1.0 - smoothstep(0.3, 0.9, dist * uVignetteIntensity);
    color *= mix(0.4, 1.0, vignette);
    
    float scanline = sin(vUv.y * 800.0 + uTime * 2.0) * 0.02;
    color -= scanline;
    
    color = pow(color, vec3(0.97));
    
    gl_FragColor = vec4(color, 1.0);
}
`;
