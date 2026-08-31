'use client';

import dynamic from 'next/dynamic';

const FPSGame = dynamic(() => import('@/components/game/FPSGame'), {
  ssr: false,
  loading: () => (
    <div className="w-screen h-screen bg-[#060a10] flex flex-col items-center justify-center">
      <div className="relative mb-6">
        <div className="w-16 h-16 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
      </div>
      <p className="text-slate-500 font-mono text-sm tracking-widest">MOTOR HAZIRLANIYOR</p>
    </div>
  ),
});

export default function Home() {
  return <FPSGame />;
}
