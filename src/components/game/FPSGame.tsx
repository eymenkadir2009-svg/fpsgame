'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  const [showMountPrompt, setShowMountPrompt] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [diamonds, setDiamonds] = useState(0);
  const [showDiamondPopup, setShowDiamondPopup] = useState(false);

  useEffect(() => {
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (!showOverlay) {
      const timer = setTimeout(() => setShowControls(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [showOverlay]);

  const handleRightClickAction = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.handleRightClick();
      setIsMounted(engineRef.current.isOnMotorcycle());
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new GameEngine(containerRef.current, DEFAULT_CONFIG);
    engineRef.current = engine;

    engine.setOnStateChange((state) => setCharState(state));
    engine.setOnReady(() => setIsLoaded(true));
    engine.setOnMountChange((mounted) => setIsMounted(mounted));
    engine.setOnMountPrompt((show) => setShowMountPrompt(show));
    engine.setOnDiamondCollect((amount) => {
      setDiamonds(prev => prev + amount);
      setShowDiamondPopup(true);
      setTimeout(() => setShowDiamondPopup(false), 1500);
    });

    engine.start();

    const keyState = { w: false, a: false, s: false, d: false, space: false };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        keyState.space = true;
        engine.updateInput(keyState);
        return;
      }
      // E key = mount/dismount
      if (e.key.toLowerCase() === 'e') {
        engine.handleRightClick();
        setIsMounted(engine.isOnMotorcycle());
        return;
      }
      const key = e.key.toLowerCase();
      if (key in keyState) {
        (keyState as Record<string, boolean>)[key] = true;
        engine.updateInput(keyState);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        keyState.space = false;
        engine.updateInput(keyState);
        return;
      }
      const key = e.key.toLowerCase();
      if (key in keyState) {
        (keyState as Record<string, boolean>)[key] = false;
        engine.updateInput(keyState);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === containerRef.current?.querySelector('canvas')) {
        engine.updateInput({
          mouseX: e.movementX,
          mouseY: e.movementY,
          isPointerLocked: true,
        });
      }
    };

    const handleClick = (e: MouseEvent) => {
      const canvas = containerRef.current?.querySelector('canvas');
      if (document.pointerLockElement === canvas) {
        // Try crystal collection on left click when locked
        engine.tryCollectCrystal(e.clientX, e.clientY);
        return;
      }
      if (canvas && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        setShowOverlay(false);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      handleRightClickAction();
    };

    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === containerRef.current?.querySelector('canvas');
      engine.updateInput({ isPointerLocked: locked });
    };

    // Touch controls
    const touchState = { startX: 0, startY: 0, deltaX: 0, deltaY: 0, active: false, startTime: 0 };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (touch.clientX > window.innerWidth / 2) {
          touchState.active = true;
          touchState.startX = touch.clientX;
          touchState.startY = touch.clientY;
          touchState.deltaX = 0;
          touchState.deltaY = 0;
          touchState.startTime = Date.now();
        } else {
          keyState.w = true;
          engine.updateInput({ ...keyState });
        }
        setShowOverlay(false);
      }
      // Double touch = jump
      if (e.touches.length === 2) {
        engine.updateInput({ space: true });
        setTimeout(() => engine.updateInput({ space: false }), 100);
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
        // Quick tap on right side = mount/dismount (like right click)
        const elapsed = Date.now() - touchState.startTime;
        const dist = Math.sqrt(touchState.deltaX ** 2 + touchState.deltaY ** 2);
        if (elapsed < 300 && dist < 20) {
          engine.handleRightClick();
          setIsMounted(engine.isOnMotorcycle());
        }
        touchState.active = false;
        engine.updateInput({
          touchStartX: null, touchStartY: null, touchDeltaX: 0, touchDeltaY: 0,
        });
      } else {
        keyState.w = false;
        engine.updateInput(keyState);
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
    window.addEventListener('contextmenu', handleContextMenu);
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
      window.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('resize', handleResize);
    };
  }, [handleRightClickAction]);

  const stateLabel: Record<CharacterState, string> = {
    idle: 'HAZIR',
    walking_forward: 'YÜRÜYOR',
    walking_backward: 'GERI GIDIYOR',
    jumping: 'ZIPLIYOR',
    riding: 'MOTORDA',
    riding_forward: 'SURUYOR',
    riding_backward: 'GERI GIDIYOR',
  };

  const stateColor: Record<CharacterState, string> = {
    idle: 'from-emerald-500/20 to-cyan-500/20 text-emerald-400',
    walking_forward: 'from-blue-500/20 to-cyan-500/20 text-blue-400',
    walking_backward: 'from-amber-500/20 to-orange-500/20 text-amber-400',
    jumping: 'from-purple-500/20 to-pink-500/20 text-purple-400',
    riding: 'from-orange-500/20 to-red-500/20 text-orange-400',
    riding_forward: 'from-red-500/20 to-yellow-500/20 text-red-400',
    riding_backward: 'from-amber-500/20 to-orange-500/20 text-amber-400',
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none">
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
            Oyuncu + 5 NPC + 8 Motosiklet
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
                Kesfet & Kesfedil
              </p>
            </div>

            {!isMobile ? (
              <div className="space-y-3 text-slate-300 font-mono text-sm">
                <div className="flex items-center gap-3 justify-center">
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">W A S D</kbd>
                  <span>Hareket / Sur</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">MOUSE</kbd>
                  <span>Bakis Yönü</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">SPACE</kbd>
                  <span>Zipla</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <kbd className="px-2 py-1 bg-slate-800 rounded border border-slate-600 text-xs">SAG TIK / E</kbd>
                  <span>Motor / In</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-slate-300 font-mono text-sm">
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Sol Taraf</span>
                  <span>Ileri / Sur</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Sag Dokun</span>
                  <span>Motor / In</span>
                </div>
                <div className="flex items-center gap-3 justify-center">
                  <span className="px-3 py-1 bg-slate-800 rounded border border-slate-600">Cift Dokunma</span>
                  <span>Zipla</span>
                </div>
              </div>
            )}

            <div className="mt-8 animate-pulse">
              <p className="text-cyan-400 font-mono text-lg tracking-wider">
                {isMobile ? 'DOKUNARAK BASLA' : 'TIKLARAK BASLA'}
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

          {/* Mount Prompt */}
          {showMountPrompt && !isMounted && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-8 z-30 pointer-events-none animate-pulse">
              <div className="px-4 py-2 rounded-lg bg-orange-500/20 border border-orange-500/40 backdrop-blur-md">
                <p className="text-orange-400 font-mono text-xs text-center">
                  {isMobile ? 'DOKUN > Motora Bin' : 'SAG TIK / E > Motora Bin'}
                </p>
              </div>
            </div>
          )}

          {/* Dismount prompt when mounted */}
          {isMounted && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-8 z-30 pointer-events-none">
              <div className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 backdrop-blur-md">
                <p className="text-red-400 font-mono text-xs text-center">
                  {isMobile ? 'DOKUN > In' : 'SAG TIK / E > In'}
                </p>
              </div>
            </div>
          )}

          {/* Diamond Counter - Top Center */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div className="px-4 py-2 rounded-lg bg-purple-500/15 border border-purple-500/30 backdrop-blur-md flex items-center gap-2">
              <span className="text-purple-400 text-lg">\u2666</span>
              <span className="font-mono font-bold text-sm text-purple-300">{diamonds}</span>
            </div>
            {showDiamondPopup && (
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
                <span className="text-purple-400 font-mono text-xs font-bold">+10 \u2666</span>
              </div>
            )}
          </div>

          {/* State Indicator - Top Left */}
          <div className="absolute top-4 left-4 z-30 pointer-events-none">
            <div className={`px-4 py-2 rounded-lg bg-gradient-to-r ${stateColor[charState]} border border-white/10 backdrop-blur-md`}>
              <div className="text-[10px] uppercase tracking-[0.2em] opacity-60 mb-0.5">Durum</div>
              <div className="font-mono font-bold text-sm tracking-wider">{stateLabel[charState]}</div>
            </div>
          </div>

          {/* Motorcycle indicator when mounted - Top Right */}
          {isMounted && (
            <div className="absolute top-4 right-4 z-30 pointer-events-none">
              <div className="px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 backdrop-blur-md">
                <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400/60 mb-0.5">Arac</div>
                <div className="font-mono font-bold text-sm text-orange-400">MOTOSIKLET</div>
              </div>
            </div>
          )}

          {/* Controls Hint - Bottom Center */}
          {showControls && !isMobile && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-fade-out">
              <div className="px-5 py-3 rounded-xl bg-black/50 border border-white/10 backdrop-blur-md">
                <p className="text-slate-400 text-xs font-mono text-center">
                  <span className="text-cyan-400">ESC</span> serbest birak &middot;
                  <span className="text-cyan-400">WASD</span> hareket &middot;
                  <span className="text-cyan-400">SPACE</span> zipla &middot;
                  <span className="text-orange-400">SAG TIK/E</span> motor
                </p>
              </div>
            </div>
          )}

          {/* Mobile Touch Controls */}
          {isMobile && !showOverlay && (
            <>
              <div className="absolute left-0 bottom-0 w-1/2 h-1/3 z-20 flex items-end justify-center pb-8 pointer-events-none">
                <div className="text-slate-500/40 font-mono text-xs tracking-widest">
                  {isMounted ? 'GAZ' : 'ILERI'}
                </div>
              </div>
              <div className="absolute right-0 bottom-0 w-1/2 h-1/3 z-20 flex items-end justify-center pb-8 pointer-events-none">
                <div className="text-slate-500/40 font-mono text-xs tracking-widest">
                  BAKIS
                </div>
              </div>
            </>
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
