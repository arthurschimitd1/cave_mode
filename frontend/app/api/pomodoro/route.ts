import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
let pool: Pool | undefined;
const db = () => { const connectionString = process.env.DATABASE_URL; if (!connectionString) throw new Error('DATABASE_URL não configurada.'); pool ??= new Pool({ connectionString, ssl: { rejectUnauthorized: false } }); return pool; };
const defaults = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, sound: 'Chuva leve', soundEnabled: true };

async function ensureTables() {
  await db().query(`CREATE TABLE IF NOT EXISTS cave_users (email TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, pin_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_pomodoro_settings (email TEXT PRIMARY KEY REFERENCES cave_users(email) ON DELETE CASCADE, focus_minutes SMALLINT NOT NULL DEFAULT 25, short_break_minutes SMALLINT NOT NULL DEFAULT 5, long_break_minutes SMALLINT NOT NULL DEFAULT 15, sound TEXT NOT NULL DEFAULT 'Chuva leve', sound_enabled BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}
async function emailFrom(request: NextRequest) { const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); if (!token) return null; const r = await db().query<{email:string}>('SELECT email FROM cave_sessions WHERE token=$1 AND expires_at > NOW()', [token]); return r.rows[0]?.email ?? null; }
const invalid = () => NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });

export async function GET(request: NextRequest) {
  try { await ensureTables(); const email = await emailFrom(request); if (!email) return invalid(); const r = await db().query('SELECT focus_minutes AS "focusMinutes", short_break_minutes AS "shortBreakMinutes", long_break_minutes AS "longBreakMinutes", sound, sound_enabled AS "soundEnabled" FROM cave_pomodoro_settings WHERE email=$1', [email]); return NextResponse.json({ settings: r.rows[0] ?? defaults }); } catch { return NextResponse.json({ error: 'Não foi possível carregar suas preferências.' }, { status: 500 }); }
}
export async function PUT(request: NextRequest) {
  try { await ensureTables(); const email = await emailFrom(request); if (!email) return invalid(); const s = await request.json() as typeof defaults; const minutes = [s.focusMinutes, s.shortBreakMinutes, s.longBreakMinutes]; if (!minutes.every((value) => Number.isInteger(value) && value >= 1 && value <= 120) || !['Chuva leve','Ruído branco','Café'].includes(s.sound) || typeof s.soundEnabled !== 'boolean') return NextResponse.json({ error: 'Preferências inválidas.' }, { status: 400 }); await db().query(`INSERT INTO cave_pomodoro_settings (email,focus_minutes,short_break_minutes,long_break_minutes,sound,sound_enabled) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO UPDATE SET focus_minutes=$2,short_break_minutes=$3,long_break_minutes=$4,sound=$5,sound_enabled=$6,updated_at=NOW()`, [email,s.focusMinutes,s.shortBreakMinutes,s.longBreakMinutes,s.sound,s.soundEnabled]); return NextResponse.json({ settings:s }); } catch { return NextResponse.json({ error: 'Não foi possível salvar suas preferências.' }, { status: 500 }); }
}
