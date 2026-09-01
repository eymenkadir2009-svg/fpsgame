import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// Ensure table exists
async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS player_diamonds (
      player_id VARCHAR(64) PRIMARY KEY,
      diamonds INTEGER NOT NULL DEFAULT 0,
      last_collect TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

// GET /api/diamonds?player_id=xxx — fetch diamonds
export async function GET(req: NextRequest) {
  try {
    const playerId = req.nextUrl.searchParams.get('player_id');
    if (!playerId) {
      return NextResponse.json({ error: 'player_id required' }, { status: 400 });
    }

    await ensureTable();

    const result = await sql`
      SELECT diamonds, last_collect, created_at
      FROM player_diamonds
      WHERE player_id = ${playerId}
    `;

    if (result.rows.length === 0) {
      return NextResponse.json({ player_id: playerId, diamonds: 0 });
    }

    return NextResponse.json({
      player_id: playerId,
      diamonds: result.rows[0].diamonds,
      last_collect: result.rows[0].last_collect,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    // If Postgres not configured, return fallback
    if (msg.includes('POSTGRES_URL') || msg.includes('connection')) {
      return NextResponse.json({ error: 'db_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/diamonds — add diamonds
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { player_id, amount } = body;

    if (!player_id || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'player_id and positive amount required' }, { status: 400 });
    }

    await ensureTable();

    // Upsert: insert if not exists, otherwise add to existing
    await sql`
      INSERT INTO player_diamonds (player_id, diamonds, last_collect)
      VALUES (${player_id}, ${amount}, NOW())
      ON CONFLICT (player_id)
      DO UPDATE SET
        diamonds = player_diamonds.diamonds + ${amount},
        last_collect = NOW()
    `;

    // Return updated total
    const result = await sql`
      SELECT diamonds FROM player_diamonds WHERE player_id = ${player_id}
    `;

    return NextResponse.json({
      player_id,
      diamonds: result.rows[0]?.diamonds ?? amount,
      added: amount,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('POSTGRES_URL') || msg.includes('connection')) {
      return NextResponse.json({ error: 'db_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
