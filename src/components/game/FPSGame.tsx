'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from '@/lib/gameEngine';
import { DEFAULT_CONFIG, CharacterState } from '@/lib/gameTypes';

const STORAGE_KEY = 'fps_game_player';

function getPlayerId(): string {
  if (typeof window === 'undefined') return '';
  let data = localStorage.getItem(STORAGE_KEY);
  if (data) {
    try { return JSON.parse(data).id; } catch { /* fall through */ }
  }
  const id = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, diamonds: 0 }));
  return id;
}

function getLocalDiamonds(): number {
  if (typeof window === 'undefined') return 0;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return 0;
  try { return JSON.parse(data).diamonds || 0; } catch { return 0; }
}

function setLocalDiamonds(count: number) {
  if (typeof window === 'undefined') return;
  const data = localStorage.getItem(STORAGE_KEY);
  const parsed = data ? JSON.parse(data) : { id: getPlayerId() };
  parsed.diamonds = count;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
}

export default function FPSGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [charState, setCharState] = useState<CharacterState>('idle');
  const [showOverlay, setShowOverlay] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [diamonds, setDiamonds] = useState(0);
  const [showDiamondPopup, setShowDiamondPopup] = useState(false);

  // Joystick state
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const joyActive = useRef(false);
   const joyCenter = useRef({ x: 0, y: 0 });
  const joyInput = useRef({ w: false, a: false, s: false, d: false });

  useEffect(() => {
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (!showOverlay) {
      const timer = setTimeout(() => setShowControls(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [showOverlay]);

  const updateJoystickInput = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.updateInput({ ...joyInput.current });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new GameEngine(containerRef.current, DEFAULT_CONFIG);
    engineRef.current = engine;

    engine.setOnStateChange((state) => setCharState(state));
    engine.setOnReady(() => setIsLoaded(true));
    engine.setOnDiamondCollected((amount) => handleDiamondCollect(amount));

    // Load diamonds from localStorage
    setDiamonds(getLocalDiamonds());
    // Try sync from server
    fetchDiamondsFromServer();

    engine.start();

    // Keyboard state tracker
    const keyState = { w: false, a: false, s: false, d: false, space: false };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // Map space bar to 'space' keyState property
      if (key === ' ') {
        keyState.space = true;
        engine.updateInput({ space: true });
        e.preventDefault();
        return;
      }
      if (key in keyState) {
        (keyState as Record<string, boolean>)[key] = true;
        engine.updateInput(keyState as Partial<typeof keyState>);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === ' ') {
        keyState.space = false;
        engine.updateInput({ space: false });
        return;
      }
      if (key in keyState) {
        (keyState as Record<string, boolean>)[key] = false;
        engine.updateInput(keyState as Partial<typeof keyState>);
      }
    };

    // Mouse look
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === containerRef.current?.querySelector('canvas')) {
        engine.updateInput({
          mouseX: e.movementX,
          mouseY: e.movementY,
          isPointerLocked: true,
        });
      }
    };

    const handleClick = () => {
      const canvas = containerRef.current?.querySelector('canvas');
      if (canvas && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        setShowOverlay(false);
      }
    };

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === containerRef.current?.querySelector('canvas');
      engine.updateInput({ isPointerLocked: locked });
    };

    // Right-side touch look
    const touchState = { startX: 0, startY: 0, deltaX: 0, deltaY: 0, active: false, id: -1 };

    const handleTouchStart = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        // Right half = look
        if (touch.clientX > window.innerWidth / 2 && !touchState.active) {
          touchState.active = true;
          touchState.id = touch.identifier;
          touchState.startX = touch.clientX;
          touchState.startY = touch.clientY;
          touchState.deltaX = 0;
          touchState.deltaY = 0;
        }
      }
      // Double touch = jump
      if (e.touches.length >= 2) {
        engine.updateInput({ space: true });
        setTimeout(() => engine.updateInput({ space: false }), 100);
      }
      setShowOverlay(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Joystick is handled by its own listeners
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === touchState.id && touchState.active) {
          touchState.deltaX = touch.clientX - touchState.startX;
          touchState.deltaY = touch.clientY - touchState.startY;
          engine.updateInput({
            touchStartX: touchState.startX,
            touchStartY: touchState.startY,
            touchDeltaX: touchState.deltaX,
            touchDeltaY: touchState.deltaY,
          });
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === touchState.id) {
          touchState.active = false;
          touchState.id = -1;
          engine.updateInput({
            touchStartX: null,
            touchStartY: null,
            touchDeltaX: 0,
            touchDeltaY: 0,
          });
        }
      }
    };

    const handleResize = () => {
      if (containerRef.current) {
        engine.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('resize', handleResize);

    return () => {
      engine.dispose();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('resize', handleResize);
    };
  }, [updateJoystickInput]);

  // ====== JOYSTICK TOUCH HANDLERS ======
  const JOY_RADIUS = 50;
  const JOY_DEADZONE = 12;

  const onJoyStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const rect = joystickRef.current?.getBoundingClientRect();
    if (!rect) return;
    joyActive.current = true;
    joyCenter.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    e.stopPropagation();
  }, []);

  const onJoyMove = useCallback((e: React.TouchEvent) => {
    if (!joyActive.current || !knobRef.current) return;
    const touch = e.touches[0];
    let dx = touch.clientX - joyCenter.current.x;
    let dy = touch.clientY - joyCenter.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > JOY_RADIUS) {
      dx = (dx / dist) * JOY_RADIUS;
      dy = (dy / dist) * JOY_RADIUS;
    }

    knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;

    const ji = joyInput.current;
    ji.w = false; ji.a = false; ji.s = false; ji.d = false;

    if (dist > JOY_DEADZONE) {
      const nx = dx / JOY_RADIUS;
      const ny = dy / JOY_RADIUS;
      if (ny < -0.3) ji.w = true;  // up = forward
      if (ny > 0.3) ji.s = true;   // down = backward
      if (nx < -0.3) ji.a = true;  // left
      if (nx > 0.3) ji.d = true;   // right
    }

    updateJoystickInput();
    e.stopPropagation();
  }, [updateJoystickInput]);

  const onJoyEnd = useCallback(() => {
    joyActive.current = false;
    if (knobRef.current) {
      knobRef.current.style.transform = 'translate(0px, 0px)';
    }
    joyInput.current = { w: false, a: false, s: false, d: false };
    updateJoystickInput();
  }, [updateJoystickInput]);

  // ====== DIAMOND SYSTEM ======
  const handleDiamondCollect = useCallback(async (amount: number) => {
    const newTotal = diamonds + amount;
    setDiamonds(newTotal);
    setLocalDiamonds(newTotal);
    setShowDiamondPopup(true);
    setTimeout(() => setShowDiamondPopup(false), 1500);

    // Send to server (fire and forget)
    try {
      const playerId = getPlayerId();
      await fetch('/api/diamonds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, amount }),
      });
    } catch { /* server sync failed, localStorage is the fallback */ }
  }, [diamonds]);

  const fetchDiamondsFromServer = useCallback(async () => {
    try {
      const playerId = getPlayerId();
      const res = await fetch(`/api/diamonds?player_id=${playerId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.diamonds !== undefined && data.error !== 'db_not_configured') {
          // Server has data — use the higher of server vs local
          const local = getLocalDiamonds();
          const server = data.diamonds as number;
          const maxDiamonds = Math.max(local, server);
          setDiamonds(maxDiamonds);
          setLocalDiamonds(maxDiamonds);
        }
      }
    } catch { /* server unavailable, use localStorage */ }
  }, []);

  const stateLabel: Record<CharacterState, string> = {
    idle: 'HAZIR',
    walking_forward: 'YÜRÜYOR',
    walking_backward: 'GERİ GİDİYOR',
    jumping: 'ZIPLIYOR',
  };

  const stateColor: Record<CharacterState, string> = {
    idle: 'from-emerald-500/20 to-cyan-500/20 text-emerald-400',
    walking_forward: 'from-blue-500/20 to-cyan-500/20 text-blue-400',
    walking_backward: 'from-amber-500/20 to-orange-500/20 text-amber-400',
    jumping: 'from-purple-500/20 to-pink-500/20 text-purple-400',
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none">
      {/* Game Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Loading Screen */}
      {!isLoaded && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#060a10]">
          <div className="relative mb-8">
            <div className="w-20 h-20 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
            <div className="absolute inset-2 rounded-full border-2 border-blue-500/20 border-b-blue-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          </div>
          <h2 className="text-cyan-400 text-xl font-mono tracking-[0.3em] uppercase mb-3">
            YÜKLENIYOR
          </h2>
          <p className="text-slate-500 text-sm font-mono">
            3D Modeller Yükleniyor...
          </p>
          <p className="text-slate-600 text-xs font-mono mt-2">
            Oyuncu + 5 NPC + Kaykay (~14MB toplam)
          </p>
          <div className="mt-6 w-48 h-0.5 bg-slate-800 rounded overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Start Overlay */}
      {showOverlay && isLoaded && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer"
          onClick={() => {
            const canvas = containerRef.current?.querySelector('canvas');
            if (canvas && !isMobile) {
              canvas.requestPointerLock();
            }
            setShowOverlay(false);
          }}
        >
          <div className="text-center">
            <div className="mb-6">
              <h1 className="text-5xl font-bold bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent tracking-tight">
                3D DÜNYA
              </h1>
              <div className="mt-2 h-px w-48 mx-auto bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
              <p className="mt-3 text-slate-400 text-sm font-mono tracking-widest uppercase">
                Keşfet & Keşfedil
              </p>
            </div>

            {!isMobile ? (
              <div className="space-y-3 text-slate-300 font-mono text-sm">
                <div className="flex items-center gap-3 justify-center">
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">W A S D</kbd>
                  <span>Hareket</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">MOUSE</kbd>
                  <span>Bakış Yönü</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">SPACE</kbd>
                  <span>Zıpla</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-slate-300 font-mono text-sm">
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Sol Joystick</span>
                  <span>Hareket</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Sağ Sürükle</span>
                  <span>Bakış Yönü</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Çift Dokunma</span>
                  <span>Zıpla</span>
                </div>
              </div>
            )}

            <div className="mt-8 animate-pulse">
              <p className="text-cyan-400 font-mono text-lg tracking-wider">
                {isMobile ? 'DOKUNARAK BAŞLA' : 'TIKLARAK BAŞLA'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* HUD */}
      {isLoaded && !showOverlay && (
        <>
          {/* Crosshair */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="relative w-8 h-8">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-2.5 bg-cyan-400/60" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-px h-2.5 bg-cyan-400/60" />
              <div className="absolute left-0 top-1/2 -translate-y-1/2 h-px w-2.5 bg-cyan-400/60" />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 h-px w-2.5 bg-cyan-400/60" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-cyan-400/40" />
            </div>
          </div>

          {/* Diamond Counter - Top Center */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div className="px-5 py-2.5 rounded-xl bg-black/50 border border-cyan-500/20 backdrop-blur-md flex items-center gap-3">
              <div className="text-2xl" style={{ filter: 'drop-shadow(0 0 6px rgba(68,221,255,0.6))' }}>
                &#x2666;
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/60">Elmas</div>
                <div className="font-mono font-bold text-lg text-cyan-300">{diamonds}</div>
              </div>
            </div>
          </div>

          {/* Diamond Collect Popup */}
          {showDiamondPopup && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-bounce">
              <div className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-400/40 backdrop-blur-md">
                <span className="text-cyan-300 font-mono font-bold text-sm">+10 ELMAS</span>
              </div>
            </div>
          )}

          {/* State Indicator - Top Left */}
          <div className="absolute top-4 left-4 z-30 pointer-events-none">
            <div className={`px-4 py-2 rounded-lg bg-gradient-to-r ${stateColor[charState]} border border-white/10 backdrop-blur-md`}>
              <div className="text-[10px] uppercase tracking-[0.2em] opacity-60 mb-0.5">Durum</div>
              <div className="font-mono font-bold text-sm tracking-wider">{stateLabel[charState]}</div>
            </div>
          </div>

          {/* FPS Counter - Top Right */}
          <div className="absolute top-4 right-4 z-30 pointer-events-none">
            <div className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 backdrop-blur-md">
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-0.5">Performans</div>
              <div className="font-mono font-bold text-sm text-emerald-400">60 FPS</div>
            </div>
          </div>

          {/* Controls Hint - Desktop */}
          {showControls && !isMobile && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-fade-out">
              <div className="px-5 py-3 rounded-xl bg-black/50 border border-white/10 backdrop-blur-md">
                <p className="text-slate-400 text-xs font-mono text-center">
                  <span className="text-cyan-400">ESC</span> serbest bırak &middot;
                  <span className="text-cyan-400">WASD</span> hareket &middot;
                  <span className="text-cyan-400">SPACE</span> zıpla
                </p>
              </div>
            </div>
          )}

          {/* Mobile Joystick - Left Side */}
          {isMobile && !showOverlay && (
            <div
              ref={joystickRef}
              onTouchStart={onJoyStart}
              onTouchMove={onJoyMove}
              onTouchEnd={onJoyEnd}
              onTouchCancel={onJoyEnd}
              className="absolute z-30"
              style={{ left: '24px', top: 'calc(50% - 70px)', width: '120px', height: '120px' }}
            >
              {/* Outer ring */}
              <div className="absolute inset-0 rounded-full border-2 border-cyan-400/25 bg-black/20 backdrop-blur-sm" />
              {/* Direction labels */}
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-cyan-400/50 font-mono text-[10px]">W</div>
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-cyan-400/50 font-mono text-[10px]">S</div>
              <div className="absolute top-1/2 -left-4 -translate-y-1/2 text-cyan-400/50 font-mono text-[10px]">A</div>
              <div className="absolute top-1/2 -right-4 -translate-y-1/2 text-cyan-400/50 font-mono text-[10px]">D</div>
              {/* Inner knob */}
              <div
                ref={knobRef}
                className="absolute rounded-full bg-cyan-400/30 border border-cyan-400/50"
                style={{
                  left: '50%',
                  top: '50%',
                  width: '48px',
                  height: '48px',
                  marginLeft: '-24px',
                  marginTop: '-24px',
                  transition: joyActive.current ? 'none' : 'transform 0.15s ease-out',
                }}
              />
            </div>
          )}

          {/* Mobile: Right side look hint */}
          {isMobile && !showOverlay && (
            <div className="absolute right-4 bottom-6 z-20 pointer-events-none">
              <div className="text-slate-500/30 font-mono text-[10px] tracking-widest">
                SAĞ TARAF SÜRÜKLE → BAKIŞ
              </div>
            </div>
          )}

          {/* Bottom Left - Credit */}
          <div className="absolute bottom-4 left-4 z-30 pointer-events-none">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              <span className="text-slate-600 font-mono text-[10px] tracking-[0.15em] uppercase">
                Ultra Engine v5.0
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
