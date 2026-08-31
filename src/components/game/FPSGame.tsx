'use client';

import { useEffect, useRef, useState } from 'react';
import { GameEngine } from '@/lib/gameEngine';
import { DEFAULT_CONFIG, CharacterState } from '@/lib/gameTypes';

export default function FPSGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [charState, setCharState] = useState<CharacterState>('idle');
  const [showOverlay, setShowOverlay] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Hide controls hint after 8 seconds
  useEffect(() => {
    if (!showOverlay) {
      const timer = setTimeout(() => setShowControls(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [showOverlay]);

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new GameEngine(containerRef.current, DEFAULT_CONFIG);
    engineRef.current = engine;

    engine.setOnStateChange((state) => setCharState(state));
    engine.setOnReady(() => setIsLoaded(true));

    engine.start();

    // Keyboard state tracker
    const keyState = { w: false, a: false, s: false, d: false };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in keyState) {
        keyState[key as keyof typeof keyState] = true;
        engine.updateInput(keyState);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in keyState) {
        keyState[key as keyof typeof keyState] = false;
        engine.updateInput(keyState);
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

    // Click to lock pointer and shoot
    const handleClick = (e: MouseEvent) => {
      const canvas = containerRef.current?.querySelector('canvas');
      if (canvas && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        setShowOverlay(false);
      } else {
        engine.triggerShoot();
      }
    };

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === containerRef.current?.querySelector('canvas');
      engine.updateInput({ isPointerLocked: locked });
    };

    // Touch controls
    const touchState = { startX: 0, startY: 0, deltaX: 0, deltaY: 0, active: false };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        // Right half of screen = look, left half = move forward
        if (touch.clientX > window.innerWidth / 2) {
          touchState.active = true;
          touchState.startX = touch.clientX;
          touchState.startY = touch.clientY;
          touchState.deltaX = 0;
          touchState.deltaY = 0;
        } else {
          // Left side tap = move forward
          engine.updateInput({ ...keyState, w: true });
          keyState.w = true;
        }
        setShowOverlay(false);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchState.active && e.touches.length === 1) {
        const touch = e.touches[0];
        touchState.deltaX = touch.clientX - touchState.startX;
        touchState.deltaY = touch.clientY - touchState.startY;
        engine.updateInput({
          touchStartX: touchState.startX,
          touchStartY: touchState.startY,
          touchDeltaX: touchState.deltaX,
          touchDeltaY: touchState.deltaY,
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchState.active) {
        // If it was a quick tap (small movement), trigger shoot
        if (Math.abs(touchState.deltaX) < 10 && Math.abs(touchState.deltaY) < 10) {
          engine.triggerShoot();
        }
        touchState.active = false;
        engine.updateInput({
          touchStartX: null,
          touchStartY: null,
          touchDeltaX: 0,
          touchDeltaY: 0,
        });
      } else {
        // Release forward movement
        keyState.w = false;
        engine.updateInput(keyState);
      }
    };

    // Resize
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
  }, []);

  const stateLabel: Record<CharacterState, string> = {
    idle: 'HAZIR',
    walking_forward: 'İLERİ YÜRÜYOR',
    walking_backward: 'GERİ GİDİYOR',
    shooting: 'ATEŞ EDİYOR',
  };

  const stateColor: Record<CharacterState, string> = {
    idle: 'from-emerald-500/20 to-cyan-500/20 text-emerald-400',
    walking_forward: 'from-blue-500/20 to-cyan-500/20 text-blue-400',
    walking_backward: 'from-amber-500/20 to-orange-500/20 text-amber-400',
    shooting: 'from-red-500/30 to-yellow-500/20 text-red-400',
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
            3D Motor Başlatılıyor...
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
                FPS ARENA
              </h1>
              <div className="mt-2 h-px w-48 mx-auto bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
              <p className="mt-3 text-slate-400 text-sm font-mono tracking-widest uppercase">
                Gerçek Zamanlı 3D Deneyim
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
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">TIKLAMA</kbd>
                  <span>Ateş</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-slate-300 font-mono text-sm">
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Sol Taraf</span>
                  <span>İleri Yürü</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Sağ Taraf Sürükle</span>
                  <span>Bakış Yönü</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Hızlı Dokunma</span>
                  <span>Ateş</span>
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

      {/* HUD - Top Left */}
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

          {/* State Indicator - Top Left */}
          <div className="absolute top-4 left-4 z-30 pointer-events-none">
            <div className={`px-4 py-2 rounded-lg bg-gradient-to-r ${stateColor[charState]} border border-white/10 backdrop-blur-md`}
            >
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

          {/* Controls Hint - Bottom Center */}
          {showControls && !isMobile && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-fade-out">
              <div className="px-5 py-3 rounded-xl bg-black/50 border border-white/10 backdrop-blur-md">
                <p className="text-slate-400 text-xs font-mono text-center">
                  <span className="text-cyan-400">ESC</span> ile serbest bırak &middot; 
                  <span className="text-cyan-400">WASD</span> ile hareket et &middot; 
                  <span className="text-cyan-400">TIKLA</span> ile ateş et
                </p>
              </div>
            </div>
          )}

          {/* Mobile Touch Controls */}
          {isMobile && !showOverlay && (
            <>
              {/* Move Forward Zone - Left */}
              <div className="absolute left-0 bottom-0 w-1/2 h-1/3 z-20 flex items-end justify-center pb-8 pointer-events-none">
                <div className="text-slate-500/40 font-mono text-xs tracking-widest">
                  ↑ İLERİ
                </div>
              </div>
              {/* Look Zone - Right */}
              <div className="absolute right-0 bottom-0 w-1/2 h-1/3 z-20 flex items-end justify-center pb-8 pointer-events-none">
                <div className="text-slate-500/40 font-mono text-xs tracking-widest">
                  ↻ BAKIŞ
                </div>
              </div>
            </>
          )}

          {/* Bottom Left - Studio Credit */}
          <div className="absolute bottom-4 left-4 z-30 pointer-events-none">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              <span className="text-slate-600 font-mono text-[10px] tracking-[0.15em] uppercase">
                Ultra Engine v3.0
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
