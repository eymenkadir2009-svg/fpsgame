import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory diamonds storage (no external DB needed)
const diamondsStore = new Map<string, number>();

// GET - Retrieve diamonds for a player
export async function GET(request: NextRequest) {
  const playerId = request.nextUrl.searchParams.get('playerId');
  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }
  const diamonds = diamondsStore.get(playerId) || 0;
  return NextResponse.json({ playerId, diamonds });
}

// POST - Add diamonds for a player
export async function POST(request: NextRequest) {
  try {
    const { playerId, diamonds } = await request.json();
    if (!playerId || typeof diamonds !== 'number') {
      return NextResponse.json({ error: 'playerId and diamonds required' }, { status: 400 });
    }
    const current = diamondsStore.get(playerId) || 0;
    diamondsStore.set(playerId, current + diamonds);
    return NextResponse.json({ playerId, diamonds: current + diamonds });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
