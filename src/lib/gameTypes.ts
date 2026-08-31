export type CharacterState = 'idle' | 'walking_forward' | 'walking_backward' | 'shooting';

export interface GameConfig {
  moveSpeed: number;
  lookSensitivity: number;
  walkBounceHeight: number;
  walkBounceSpeed: number;
  blurIntensity: number;
  turnBlurIntensity: number;
  asmrIntensity: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  moveSpeed: 0.12,
  lookSensitivity: 0.002,
  walkBounceHeight: 0.08,
  walkBounceSpeed: 8,
  blurIntensity: 1.2,
  turnBlurIntensity: 2.0,
  asmrIntensity: 0.8,
};

export interface InputState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  mouseX: number;
  mouseY: number;
  isMouseDown: boolean;
  isPointerLocked: boolean;
  touchStartX: number | null;
  touchStartY: number | null;
  touchDeltaX: number;
  touchDeltaY: number;
}

// Local textures — no CORS issues
export const CHARACTER_IMAGES = {
  forward: '/character.png',
  backward: '/character.png',
  shooting: '/character.png',
} as const;

export const GROUND_IMAGE = '/ground.webp';
