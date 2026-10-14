import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
let pool: Pool | undefined;
const db = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não configurada.');
  pool ??= new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return pool;
};

async function ensureTables() {
  await db().query(`CREATE TABLE IF NOT EXISTS cave_users (email TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, pin_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_follows (follower_email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, following_email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (follower_email, following_email), CHECK (follower_email <> following_email))`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_posts (id BIGSERIAL PRIMARY KEY, author_email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_comments (id BIGSERIAL PRIMARY KEY, post_id BIGINT NOT NULL REFERENCES cave_posts(id) ON DELETE CASCADE, author_email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_likes (post_id BIGINT NOT NULL REFERENCES cave_posts(id) ON DELETE CASCADE, user_email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (post_id, user_email))`);
  await db().query(`CREATE TABLE IF NOT EXISTS cave_messages (id BIGSERIAL PRIMARY KEY, sender_email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, recipient_email TEXT NOT NULL REFERENCES cave_users(email) ON DELETE CASCADE, body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK (sender_email <> recipient_email))`);
}

async function viewer(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const result = await db().query<{ email: string; name: string }>('SELECT u.email, u.name FROM cave_sessions s JOIN cave_users u ON u.email = s.email WHERE s.token = $1 AND s.expires_at > NOW()', [token]);
  return result.rows[0] ?? null;
}
const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

async function feed(email: string, followingOnly: boolean) {
  const result = await db().query(`SELECT p.id, p.body, p.created_at, u.name, u.email, COUNT(DISTINCT l.user_email)::int AS likes, COUNT(DISTINCT c.id)::int AS comments, BOOL_OR(l.user_email = $1) AS liked
    FROM cave_posts p JOIN cave_users u ON u.email = p.author_email
    LEFT JOIN cave_likes l ON l.post_id = p.id LEFT JOIN cave_comments c ON c.post_id = p.id
    WHERE ($2::boolean = false OR p.author_email IN (SELECT following_email FROM cave_follows WHERE follower_email = $1))
    GROUP BY p.id, u.name, u.email ORDER BY p.created_at DESC LIMIT 50`, [email, followingOnly]);
  return result.rows;
}

export async function GET(request: NextRequest) {
  try {
    await ensureTables(); const me = await viewer(request); if (!me) return bad('Sua sessão expirou. Entre novamente.', 401);
    const mode = request.nextUrl.searchParams.get('mode') ?? 'feed';
    if (mode === 'feed') return NextResponse.json({ posts: await feed(me.email, request.nextUrl.searchParams.get('following') === '1') });
    if (mode === 'people') {
      const q = `%${(request.nextUrl.searchParams.get('q') ?? '').trim()}%`;
      const result = await db().query(`SELECT u.name, u.email, EXISTS(SELECT 1 FROM cave_follows f WHERE f.follower_email = $1 AND f.following_email = u.email) AS following, (SELECT COUNT(*)::int FROM cave_follows f WHERE f.following_email = u.email) AS followers FROM cave_users u WHERE u.email <> $1 AND (u.name ILIKE $2 OR u.email ILIKE $2) ORDER BY u.name LIMIT 30`, [me.email, q]);
      return NextResponse.json({ people: result.rows });
    }
    if (mode === 'comments') { const id = Number(request.nextUrl.searchParams.get('post')); const result = await db().query('SELECT c.id, c.body, c.created_at, u.name, u.email FROM cave_comments c JOIN cave_users u ON u.email = c.author_email WHERE c.post_id = $1 ORDER BY c.created_at ASC', [id]); return NextResponse.json({ comments: result.rows }); }
    if (mode === 'messages') { const withEmail = request.nextUrl.searchParams.get('with'); if (!withEmail) return bad('Escolha uma conversa.'); const result = await db().query(`SELECT m.id,m.body,m.created_at,m.sender_email,m.recipient_email,u.name AS sender_name FROM cave_messages m JOIN cave_users u ON u.email=m.sender_email WHERE (m.sender_email=$1 AND m.recipient_email=$2) OR (m.sender_email=$2 AND m.recipient_email=$1) ORDER BY m.created_at ASC`, [me.email, withEmail]); return NextResponse.json({ messages: result.rows }); }
    return bad('Consulta não reconhecida.');
  } catch (error) { console.error('Social Cave:', error); return bad('Não foi possível carregar a comunidade.', 500); }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTables(); const me = await viewer(request); if (!me) return bad('Sua sessão expirou. Entre novamente.', 401);
    const data = await request.json() as { action?: string; body?: string; email?: string; postId?: number };
    const body = data.body?.trim();
    if (data.action === 'follow') { if (!data.email || data.email === me.email) return bad('Usuário inválido.'); await db().query('INSERT INTO cave_follows (follower_email, following_email) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me.email, data.email]); return NextResponse.json({ ok: true }); }
    if (data.action === 'unfollow') { await db().query('DELETE FROM cave_follows WHERE follower_email=$1 AND following_email=$2', [me.email, data.email]); return NextResponse.json({ ok: true }); }
    if (data.action === 'post' && body) { const result = await db().query('INSERT INTO cave_posts (author_email, body) VALUES ($1,$2) RETURNING id', [me.email, body]); return NextResponse.json({ id: result.rows[0].id }, { status: 201 }); }
    if (data.action === 'comment' && body && data.postId) { await db().query('INSERT INTO cave_comments (post_id, author_email, body) VALUES ($1,$2,$3)', [data.postId, me.email, body]); return NextResponse.json({ ok: true }, { status: 201 }); }
    if (data.action === 'like' && data.postId) { await db().query('INSERT INTO cave_likes (post_id,user_email) VALUES ($1,$2) ON CONFLICT DO NOTHING', [data.postId, me.email]); return NextResponse.json({ ok: true }); }
    if (data.action === 'unlike' && data.postId) { await db().query('DELETE FROM cave_likes WHERE post_id=$1 AND user_email=$2', [data.postId, me.email]); return NextResponse.json({ ok: true }); }
    if (data.action === 'message' && data.email && body && data.email !== me.email) { await db().query('INSERT INTO cave_messages (sender_email,recipient_email,body) VALUES ($1,$2,$3)', [me.email, data.email, body]); return NextResponse.json({ ok: true }, { status: 201 }); }
    return bad('Dados incompletos.');
  } catch (error) { console.error('Social Cave:', error); return bad('Não foi possível salvar esta ação.', 500); }
}
