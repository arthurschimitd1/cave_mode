import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';

type Account = { name: string; email: string; phone: string };
type Payload = Partial<Account> & { action?: 'register' | 'login' | 'migrate'; email?: string; pinHash?: string };

let pool: Pool | undefined;

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não configurada.');
  pool ??= new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return pool;
}

async function ensureUsersTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS cave_users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function validCredentials(data: Payload) {
  return Boolean(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email ?? '') &&
    /^[a-f0-9]{64}$/i.test(data.pinHash ?? ''),
  );
}

function user(row: Account) {
  return { name: row.name, email: row.email, phone: row.phone };
}

export async function POST(request: Request) {
  try {
    const data = await request.json() as Payload;
    if (!data.action || !validCredentials(data)) return NextResponse.json({ error: 'Dados de acesso inválidos.' }, { status: 400 });

    const email = normalizedEmail(data.email!);
    const account = { name: data.name?.trim() ?? '', email, phone: data.phone?.trim() ?? '' };
    await ensureUsersTable();

    if (data.action === 'register' || data.action === 'migrate') {
      if (!account.name || !account.phone) return NextResponse.json({ error: 'Dados de cadastro inválidos.' }, { status: 400 });
      const result = await getPool().query<Account>(
        'INSERT INTO cave_users (name, email, phone, pin_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING name, email, phone',
        [account.name, account.email, account.phone, data.pinHash!],
      );
      if (data.action === 'register' && !result.rowCount) return NextResponse.json({ error: 'Este e-mail já possui cadastro. Use Entrar.' }, { status: 409 });
      return NextResponse.json({ user: result.rows[0] ? user(result.rows[0]) : account }, { status: data.action === 'register' ? 201 : 200 });
    }

    const result = await getPool().query<Account>(
      'SELECT name, email, phone FROM cave_users WHERE email = $1 AND pin_hash = $2',
      [email, data.pinHash!],
    );
    if (!result.rowCount) return NextResponse.json({ error: 'E-mail ou PIN não conferem.' }, { status: 401 });
    return NextResponse.json({ user: user(result.rows[0]) });
  } catch (error) {
    console.error('Erro de autenticação Cave:', error);
    return NextResponse.json({ error: 'Não foi possível acessar sua conta agora. Tente novamente.' }, { status: 500 });
  }
}
