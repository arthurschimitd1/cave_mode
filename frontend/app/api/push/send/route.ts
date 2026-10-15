import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import webpush from 'web-push';
import { nextReminderTime, scheduleReminder, webPushConfigured } from '../../../../lib/push';

export const runtime = 'nodejs';
let pool: Pool | undefined;
const db = () => { const connectionString = process.env.DATABASE_URL; if (!connectionString) throw new Error('DATABASE_URL não configurada.'); pool ??= new Pool({ connectionString, ssl: { rejectUnauthorized: false } }); return pool; };
type Job = { taskId?: number; email?: string; scheduledFor?: string };
type TaskRow = { id: number; title: string; dueAt: string; repeat: string; done: boolean };
type SubscriptionRow = { endpoint: string; subscription: webpush.PushSubscription };

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.PUSH_JOB_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    if (!webPushConfigured()) return NextResponse.json({ error: 'Push não configurado.' }, { status: 503 });
    const job = await request.json() as Job;
    if (!job.taskId || !job.email || !job.scheduledFor) return NextResponse.json({ error: 'Lembrete inválido.' }, { status: 400 });
    const taskResult = await db().query<TaskRow>('SELECT id,title,due_at AS "dueAt",repeat_rule AS repeat,done FROM cave_tasks WHERE id=$1 AND email=$2', [job.taskId, job.email]);
    const task = taskResult.rows[0]; if (!task || task.done || new Date(task.dueAt).toISOString() !== new Date(job.scheduledFor).toISOString()) return NextResponse.json({ skipped: true });
    const dueAt = new Date(task.dueAt);
    if (dueAt.getTime() > Date.now() + 60_000) { await scheduleReminder({ taskId: task.id, email: job.email, scheduledFor: dueAt.toISOString() }); return NextResponse.json({ rescheduled: true }); }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    const subscriptions = await db().query<SubscriptionRow>('SELECT endpoint,subscription FROM cave_push_subscriptions WHERE email=$1', [job.email]);
    const payload = JSON.stringify({ title: 'Cave · lembrete', body: task.title, url: '/?tab=plan', tag: `cave-task-${task.id}` });
    await Promise.all(subscriptions.rows.map(async ({ endpoint, subscription }) => { try { await webpush.sendNotification(subscription, payload, { TTL: 60 }); } catch (error) { const status = (error as { statusCode?: number }).statusCode; if (status === 404 || status === 410) await db().query('DELETE FROM cave_push_subscriptions WHERE endpoint=$1', [endpoint]); else throw error; } }));
    const next = nextReminderTime(dueAt, task.repeat); if (next) await scheduleReminder({ taskId: task.id, email: job.email, scheduledFor: next.toISOString() });
    return NextResponse.json({ ok: true, delivered: subscriptions.rowCount });
  } catch (error) { console.error('Cave push:', error); return NextResponse.json({ error: 'Não foi possível enviar o lembrete.' }, { status: 500 }); }
}
