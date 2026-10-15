import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { scheduleReminder } from '../../../lib/push';

export const runtime = 'nodejs';
let pool: Pool | undefined;
const db = () => { const connectionString = process.env.DATABASE_URL; if (!connectionString) throw new Error('DATABASE_URL não configurada.'); pool ??= new Pool({ connectionString, ssl: { rejectUnauthorized: false } }); return pool; };

async function ensureTables() {
  await db().query(`CREATE TABLE IF NOT EXISTS cave_push_subscriptions (endpoint TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db().query(`CREATE INDEX IF NOT EXISTS cave_push_subscriptions_email_idx ON cave_push_subscriptions(email)`);
}
async function emailFrom(request: NextRequest) { const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); if (!token) return null; const result = await db().query<{ email: string }>('SELECT email FROM cave_sessions WHERE token=$1 AND expires_at > NOW()', [token]); return result.rows[0]?.email ?? null; }
const unavailable = () => NextResponse.json({ enabled: false, error: 'Notificações push ainda não foram configuradas.' }, { status: 503 });

export async function GET(request: NextRequest) {
  try {
    await ensureTables(); const email = await emailFrom(request); if (!email) return NextResponse.json({ error: 'Sua sessão expirou. Entre novamente.' }, { status: 401 });
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) return unavailable();
    const result = await db().query<{ count: string }>('SELECT COUNT(*)::text AS count FROM cave_push_subscriptions WHERE email=$1', [email]);
    return NextResponse.json({ enabled: true, publicKey, subscriptions: Number(result.rows[0]?.count ?? 0) });
  } catch { return NextResponse.json({ error: 'Não foi possível preparar as notificações.' }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTables(); const email = await emailFrom(request); if (!email) return NextResponse.json({ error: 'Sua sessão expirou. Entre novamente.' }, { status: 401 });
    if (!process.env.VAPID_PUBLIC_KEY) return unavailable();
    const data = await request.json() as { action?: string; subscription?: { endpoint?: string } };
    const endpoint = data.subscription?.endpoint;
    if (data.action === 'subscribe' && endpoint && endpoint.length < 3000) {
      await db().query(`INSERT INTO cave_push_subscriptions (endpoint,email,subscription) VALUES ($1,$2,$3::jsonb) ON CONFLICT (endpoint) DO UPDATE SET email=EXCLUDED.email,subscription=EXCLUDED.subscription,updated_at=NOW()`, [endpoint, email, JSON.stringify(data.subscription)]);
      const tasks = await db().query<{ id: number; dueAt: string }>('SELECT id,due_at AS "dueAt" FROM cave_tasks WHERE email=$1 AND done=false AND due_at > NOW()', [email]);
      await Promise.all(tasks.rows.map((task) => scheduleReminder({ taskId: task.id, email, scheduledFor: new Date(task.dueAt).toISOString() }).catch(() => undefined)));
      return NextResponse.json({ ok: true });
    }
    if (data.action === 'unsubscribe' && endpoint) { await db().query('DELETE FROM cave_push_subscriptions WHERE endpoint=$1 AND email=$2', [endpoint, email]); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 400 });
  } catch { return NextResponse.json({ error: 'Não foi possível salvar a assinatura.' }, { status: 500 }); }
}
