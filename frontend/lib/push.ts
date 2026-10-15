import { Client } from '@upstash/qstash';

type ReminderJob = { taskId: number; email: string; scheduledFor: string };

function appUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

export function webPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export async function scheduleReminder(job: ReminderJob) {
  const token = process.env.QSTASH_TOKEN;
  const secret = process.env.PUSH_JOB_SECRET;
  const target = appUrl();
  const dueAt = new Date(job.scheduledFor).getTime();
  if (!token || !secret || !target || !Number.isFinite(dueAt) || dueAt <= Date.now()) return;

  // QStash free messages can wait seven days. Wake once before that limit and
  // schedule the remaining time, rather than dropping a reminder in the future.
  const wakeAt = Math.min(dueAt, Date.now() + 6 * 24 * 60 * 60 * 1000);
  const client = new Client({ token });
  await client.publishJSON({
    url: `${target}/api/push/send`,
    body: job,
    notBefore: Math.floor(wakeAt / 1000),
    retries: 2,
    headers: { Authorization: `Bearer ${secret}` },
    deduplicationId: `cave-reminder:${job.taskId}:${job.scheduledFor}:${Math.floor(wakeAt / 1000)}`,
  });
}

export function nextReminderTime(dueAt: Date, repeat: string) {
  if (repeat === 'none') return null;
  const next = new Date(dueAt);
  if (repeat === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else {
    next.setUTCDate(next.getUTCDate() + 1);
    if (repeat === 'weekdays') while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}
