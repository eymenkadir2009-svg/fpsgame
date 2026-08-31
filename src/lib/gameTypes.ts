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

export const CHARACTER_IMAGES = {
  forward: 'https://wad.nyc3.digitaloceanspaces.com/yourfiles/uploads/adc4b9ea187b712329c130c1eea26dc1/Gemini_Generated_Image_qi61pfqi61pfqi61.png',
  backward: 'https://wad.nyc3.digitaloceanspaces.com/yourfiles/uploads/6fc92db67ea6a0405de4d64531f64935/Gemini_Generated_Image_l2i71nl2i71nl2i7-1-1.png',
  shooting: 'https://wad.nyc3.digitaloceanspaces.com/yourfiles/uploads/5cd03dd6564172f029c46246779088ca/Gemini_Generated_Image_ewdkppewdkppewdk-1-1.png',
} as const;

export const GROUND_IMAGE = 'https://wad.nyc3.digitaloceanspaces.com/yourfiles/uploads/adc4b9ea187b712329c130c1eea26dc1/Gemini_Generated_Image_qi61pfqi61pfqi61.png';
