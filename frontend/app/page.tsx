'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Routine = 'morning' | 'afternoon' | 'night';
type Task = { id: number; title: string; note: string; dueAt: string | null; repeat: 'none' | 'daily' | 'weekdays' | 'weekly'; priority: 'low' | 'medium' | 'high'; estimateMinutes: number; meta: string; color: string; done: boolean; routine: Routine; position: number; planned: boolean };
type Goal = { id: number; title: string; target: number; currentValue: number; period: 'daily' | 'weekly' };
type Tab = 'today' | 'plan' | 'focus' | 'studies' | 'community' | 'profile';
type Panel = { title: string; body: string } | null;
type Account = { name: string; email: string; phone: string; sessionToken?: string };
type LegacyAccount = Account & { pinHash: string };
type AuthScreen = 'choice' | 'register-details' | 'register-pin' | 'login-email' | 'login-pin';

const initialTasks: Task[] = [];

const navItems: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Hoje', icon: '⌂' },
  { id: 'plan', label: 'Planejar', icon: '▤' },
  { id: 'focus', label: 'Foco', icon: '◷' },
  { id: 'studies', label: 'Estudos', icon: '▧' },
  { id: 'community', label: 'Comunidade', icon: '♧' },
  { id: 'profile', label: 'Perfil', icon: '◉' },
];

const soundOptions = [
  { icon: '☁', name: 'Chuva leve', description: 'Relaxante' },
  { icon: '⌁', name: 'Ruído branco', description: 'Constante' },
  { icon: '♨', name: 'Café', description: 'Ambiente' },
];
type PomodoroSettings = { focusMinutes: number; shortBreakMinutes: number; longBreakMinutes: number; sound: string; soundEnabled: boolean };
const defaultPomodoro: PomodoroSettings = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, sound: 'Chuva leve', soundEnabled: true };
type FocusTool = 'pomodoro' | 'clock' | 'stopwatch' | 'timer';
let selectedFocusTool: FocusTool = 'pomodoro';

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remaining = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return '0 min';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes.toString().padStart(2, '0')}min` : `${minutes} min`;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toUtcDateTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function urlBase64ToUint8Array(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function syncPushSubscription(sessionToken: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
  const configResponse = await fetch('/api/push', { headers: { Authorization: `Bearer ${sessionToken}` } });
  const config = await configResponse.json() as { enabled?: boolean; publicKey?: string };
  if (!configResponse.ok || !config.enabled || !config.publicKey) return;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) });
  await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ action: 'subscribe', subscription: subscription.toJSON() }) });
}

async function hashPin(pin: string) {
  const bytes = new TextEncoder().encode(`cave:${pin}`);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

let bellContext: AudioContext | null = null;
function primeBell() { const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (Audio) { bellContext ??= new Audio(); void bellContext.resume(); } }
function playBell() {
  const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) return;
  const context = bellContext ?? new Audio(); void context.resume(); const oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(660, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + .35);
  gain.gain.setValueAtTime(.001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.18, context.currentTime + .03); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .7);
  oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .72);
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [account, setAccount] = useState<Account | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [tasks, setTasks] = useState(initialTasks);
  const tasksRef = useRef<Task[]>(initialTasks);
  const [pomodoro, setPomodoro] = useState<PomodoroSettings>(defaultPomodoro);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerKind, setTimerKind] = useState<'focus' | 'shortBreak' | 'longBreak'>('focus');
  const [focusSeconds, setFocusSeconds] = useState(0);
  const [completedSessions, setCompletedSessions] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showPlanTask, setShowPlanTask] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [newRoutine, setNewRoutine] = useState<Routine>('morning');
  const [newNote, setNewNote] = useState('');
  const [newDueAt, setNewDueAt] = useState('');
  const [newRepeat, setNewRepeat] = useState<Task['repeat']>('daily');
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium');
  const [newEstimate, setNewEstimate] = useState(25);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [focusHistory, setFocusHistory] = useState<{ day: string; minutes: number }[]>([]);
  const [subjects, setSubjects] = useState<{ id: number; name: string; topics: { id: number; name: string; done: boolean }[] }[]>([]);
  const remindedTasks = useRef<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState('');
  const routineTasks = tasks.filter((task) => !task.planned);
  const completed = routineTasks.filter((task) => task.done).length;
  const progress = routineTasks.length ? Math.round((completed / routineTasks.length) * 100) : 0;

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const unlockAudio = () => primeBell();
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    const saved = window.localStorage.getItem('cave-progress-v1');
    const savedSession = window.localStorage.getItem('cave-session-v1');
    const savedAccounts = window.localStorage.getItem('cave-accounts-v1');
    if (saved) {
      try {
        const data = JSON.parse(saved) as { tasks?: Task[]; focusSeconds?: number; completedSessions?: number };
        setTasks((data.tasks ?? []).map((task) => ({ ...task, routine: task.routine ?? 'morning' })));
        setFocusSeconds(data.focusSeconds ?? 0);
        setCompletedSessions(data.completedSessions ?? 0);
      } catch {
        window.localStorage.removeItem('cave-progress-v1');
      }
    }
    if (savedSession) {
      try {
        const currentAccount = JSON.parse(savedSession) as Account;
        if (currentAccount.sessionToken) {
          setAccount(currentAccount);
          setAuthenticated(true);
        } else {
          window.localStorage.removeItem('cave-session-v1');
        }
      } catch {
        window.localStorage.removeItem('cave-session-v1');
      }
    } else if (savedAccounts) {
      try {
        const registeredAccounts = JSON.parse(savedAccounts) as LegacyAccount[];
        const sessionEmail = window.localStorage.getItem('cave-session-email-v1');
        const legacyAccount = registeredAccounts.find((item) => item.email === sessionEmail);
        if (legacyAccount) {
          const currentAccount = { name: legacyAccount.name, email: legacyAccount.email, phone: legacyAccount.phone };
          void fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'migrate', ...legacyAccount }) }).then(async (response) => {
            const data = await response.json() as { user?: Account; sessionToken?: string };
            const migrated = data.user && data.sessionToken ? { ...data.user, sessionToken: data.sessionToken } : currentAccount;
            window.localStorage.setItem('cave-session-v1', JSON.stringify(migrated)); setAccount(migrated); setAuthenticated(true);
          });
        }
      } catch {
        window.localStorage.removeItem('cave-accounts-v1');
        window.localStorage.removeItem('cave-session-email-v1');
      }
    }
    setIsHydrated(true);
    setAuthLoading(false);
    return () => window.removeEventListener('pointerdown', unlockAudio);
  }, []);

  useEffect(() => {
    if (!account?.sessionToken) return;
    const sync = () => { void syncPushSubscription(account.sessionToken!).catch(() => undefined); };
    sync();
    window.addEventListener('focus', sync);
    const interval = window.setInterval(sync, 30_000);
    return () => { window.removeEventListener('focus', sync); window.clearInterval(interval); };
  }, [account?.sessionToken]);

  useEffect(() => {
    if (isHydrated) window.localStorage.setItem('cave-progress-v1', JSON.stringify({ tasks, focusSeconds, completedSessions }));
  }, [tasks, focusSeconds, completedSessions, isHydrated]);

  useEffect(() => {
    if (!account?.sessionToken) return;
    fetch('/api/pomodoro', { headers: { Authorization: `Bearer ${account.sessionToken}` } }).then(async (response) => {
      const data = await response.json() as { settings?: PomodoroSettings };
      if (response.ok && data.settings) { setPomodoro(data.settings); setTimerSeconds(data.settings.focusMinutes * 60); }
    }).catch(() => undefined);
  }, [account?.sessionToken]);

  const workspace = async (action: string, body: Record<string, unknown> = {}) => {
    if (!account?.sessionToken) throw new Error('Entre novamente para sincronizar seus dados.');
    const response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.sessionToken}` }, body: JSON.stringify({ action, ...body }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível sincronizar seus dados.');
    return data;
  };
  const loadWorkspace = async () => {
    if (!account?.sessionToken) return;
    const headers = { Authorization: `Bearer ${account.sessionToken}` };
    try {
      const [taskResponse, goalResponse, historyResponse, studyResponse] = await Promise.all([fetch('/api/workspace?mode=tasks', { headers }), fetch('/api/workspace?mode=goals', { headers }), fetch('/api/workspace?mode=history', { headers }), fetch('/api/workspace?mode=studies', { headers })]);
      const [taskData, goalData, historyData, studyData] = await Promise.all([taskResponse.json(), goalResponse.json(), historyResponse.json(), studyResponse.json()]) as [{ tasks?: Task[] }, { goals?: Goal[] }, { history?: { day: string; minutes: number }[] }, { subjects?: typeof subjects }];
      if (taskResponse.ok) {
        const remoteTasks = taskData.tasks ?? [];
        if (!remoteTasks.length && tasks.length) {
          await Promise.all(tasks.map((task) => workspace('createTask', { title: task.title, note: task.note ?? '', dueAt: task.dueAt ?? '', repeat: task.repeat ?? 'none', priority: task.priority ?? 'medium', estimateMinutes: task.estimateMinutes ?? 25, routine: task.routine })));
          return void loadWorkspace();
        }
        setTasks(remoteTasks.map((task) => ({ ...task, meta: task.dueAt ? new Date(task.dueAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : task.repeat === 'daily' ? 'Todos os dias' : 'Sem horário definido', color: task.priority === 'high' ? 'peach' : task.priority === 'low' ? 'mint' : 'sky' })));
      }
      if (goalResponse.ok) setGoals(goalData.goals ?? []);
      if (historyResponse.ok) setFocusHistory(historyData.history ?? []);
      if (studyResponse.ok) setSubjects(studyData.subjects ?? []);
    } catch { notify('Não foi possível sincronizar agora. Seus dados locais continuam seguros.'); }
  };
  useEffect(() => { void loadWorkspace(); }, [account?.sessionToken]);

  useEffect(() => {
    if (!timerRunning) return;
    const timer = window.setInterval(() => {
      setTimerSeconds((current) => {
        setFocusSeconds((total) => total + 1);
        if (current <= 1) {
          setTimerRunning(false);
          playBell();
          if (timerKind === 'focus') {
            const nextTotal = completedSessions + 1;
            setCompletedSessions(nextTotal);
            void workspace('logFocus', { minutes: pomodoro.focusMinutes }).then(loadWorkspace).catch(() => undefined);
            const longBreak = nextTotal % 4 === 0;
            setTimerKind(longBreak ? 'longBreak' : 'shortBreak');
            setToast(longBreak ? 'Ciclo concluído. Hora da pausa longa.' : 'Sessão concluída. Hora de uma pausa curta.');
            return (longBreak ? pomodoro.longBreakMinutes : pomodoro.shortBreakMinutes) * 60;
          }
          setTimerKind('focus');
          setToast('Pausa concluída. Pronto para focar de novo?');
          return pomodoro.focusMinutes * 60;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning, timerKind, completedSessions, pomodoro]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const reminderTime = (task: Task, now: Date) => {
      const original = new Date(task.dueAt!);
      if (task.repeat === 'none') return original;
      if (task.repeat === 'weekdays' && (now.getDay() === 0 || now.getDay() === 6)) return null;
      if (task.repeat === 'weekly' && now.getDay() !== original.getDay()) return null;
      const occurrence = new Date(now);
      occurrence.setHours(original.getHours(), original.getMinutes(), 0, 0);
      return occurrence;
    };
    const showReminder = async (task: Task) => {
      const options = { body: task.title, icon: '/icon-192.png', tag: `cave-task-${task.id}`, renotify: true };
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification('Cave · lembrete', options);
      } catch {
        new Notification('Cave · lembrete', options);
      }
    };
    const remind = () => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const now = new Date();
      tasks.filter((task) => !task.done && task.dueAt).forEach((task) => {
        const due = reminderTime(task, now);
        const key = `${task.id}:${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        if (due && due.getTime() <= now.getTime() && due.getTime() > now.getTime() - 5 * 60_000 && !remindedTasks.current.has(key)) {
          remindedTasks.current.add(key);
          void showReminder(task);
          playBell();
        }
      });
    };
    remind(); const timer = window.setInterval(remind, 15_000); return () => window.clearInterval(timer);
  }, [tasks]);

  useEffect(() => { const finish = () => finishFocus(); window.addEventListener('cave-finish-focus', finish); return () => window.removeEventListener('cave-finish-focus', finish); });

  const dateLabel = useMemo(() => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    .format(new Date()).replace(/^./, (letter) => letter.toUpperCase()), []);

  const notify = (message: string) => setToast(message);
  const openPanel = (title: string, body: string) => setPanel({ title, body });

  function toggleTask(id: number) {
    const task = tasks.find((item) => item.id === id);
    setTasks((current) => current.map((item) => item.id === id ? { ...item, done: !item.done } : item));
    if (task) notify(task.done ? 'Tarefa reaberta.' : 'Tarefa concluída. Bom ritmo!');
    void workspace('toggleTask', { id }).catch((error) => notify(error instanceof Error ? error.message : 'Não foi possível salvar a tarefa.'));
  }

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!newTask.trim()) return;
    try {
      await workspace('createTask', { title: newTask.trim(), note: newNote, dueAt: toUtcDateTime(newDueAt), repeat: newRepeat, priority: newPriority, estimateMinutes: newEstimate, routine: newRoutine });
      await loadWorkspace();
    } catch (error) { notify(error instanceof Error ? error.message : 'Não foi possível adicionar a tarefa.'); return; }
    setNewTask('');
    setNewNote(''); setNewDueAt(''); setNewRepeat('daily'); setNewPriority('medium'); setNewEstimate(25);
    setShowAddTask(false);
    notify('Tarefa adicionada à sua rotina.');
  }

  async function addPlannedTask(event: React.FormEvent) {
    event.preventDefault();
    if (!newTask.trim() || !newDueAt) return notify('Escolha uma tarefa e o dia/horário.');
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    try {
      await workspace('createTask', { title: newTask.trim(), note: newNote, dueAt: toUtcDateTime(newDueAt), repeat: newRepeat, priority: newPriority, estimateMinutes: newEstimate, routine: 'morning', planned: true });
      await loadWorkspace(); setNewTask(''); setNewNote(''); setNewDueAt(''); setNewRepeat('none'); setNewPriority('medium'); setNewEstimate(25); setShowPlanTask(false); notify('Tarefa planejada.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Não foi possível planejar a tarefa.'); }
  }

  function deleteTask(id: number) {
    setTasks((current) => current.filter((task) => task.id !== id));
    notify('Tarefa removida da rotina.');
    void workspace('deleteTask', { id }).catch(() => void loadWorkspace());
  }

  function reorderTask(sourceId: number, targetId: number) {
    if (sourceId === targetId) return;
    const current = tasksRef.current;
    const sourceIndex = current.findIndex((task) => task.id === sourceId);
    const targetIndex = current.findIndex((task) => task.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...current];
      const [source] = next.splice(sourceIndex, 1);
      const targetRoutine = current[targetIndex].routine;
      const moved = { ...source, routine: targetRoutine };
      next.splice(targetIndex, 0, moved);
    const ordered = next.map((task, index) => ({ ...task, position: index }));
    tasksRef.current = ordered;
    setTasks(ordered);
    void workspace('reorderTasks', { items: ordered.map((task) => ({ id: task.id, routine: task.routine, position: task.position })) }).catch(() => void loadWorkspace());
  }

  function finishFocus() {
    if (!timerRunning) return notify('Inicie uma sessão para poder finalizá-la.');
    const total = (timerKind === 'focus' ? pomodoro.focusMinutes : timerKind === 'shortBreak' ? pomodoro.shortBreakMinutes : pomodoro.longBreakMinutes) * 60;
    const elapsedMinutes = Math.max(1, Math.ceil((total - timerSeconds) / 60));
    setTimerRunning(false); playBell();
    if (timerKind === 'focus') {
      setCompletedSessions((value) => value + 1); void workspace('logFocus', { minutes: elapsedMinutes }).then(loadWorkspace).catch(() => undefined);
      setToast(`Sessão finalizada: ${elapsedMinutes} min registrados.`);
    }
    setTimerSeconds(total);
  }

  function finishAuthentication(nextAccount: Account) {
    window.localStorage.setItem('cave-session-v1', JSON.stringify(nextAccount));
    setAccount(nextAccount);
    setAuthenticated(true);
  }

  function logout() {
    setTimerRunning(false);
    window.localStorage.removeItem('cave-session-v1');
    setAuthenticated(false);
    setActiveTab('today');
  }

  if (authLoading) return <main className="auth-shell"><div className="auth-loading">cave</div></main>;
  if (!authenticated) return <AuthFlow onAuthenticated={finishAuthentication} />;

  return (
    <main className={`app-shell ${timerRunning ? 'focus-mode' : ''}`}>
      <div className="grain" />
      <header className="topbar">
        <button className="brand brand-button" onClick={() => setActiveTab('today')} aria-label="Ir para Hoje"><img className="brand-mark" src="/cave-logo.jpeg" alt="" /><span>cave</span></button>
        <button className="icon-button" aria-label="Notificações" onClick={() => { const next = tasks.find((task) => !task.done); openPanel('Notificações', next ? `Próxima tarefa: ${next.title}.` : 'Não há tarefas pendentes.'); }}>♢<span className="notification-dot" /></button>
      </header>

      <div className="page-content">
        {activeTab === 'today' && <TodayView dateLabel={dateLabel} tasks={routineTasks} completed={completed} progress={progress} focusSeconds={focusSeconds} onToggle={toggleTask} onDelete={deleteTask} onReorder={reorderTask} onAdd={() => setShowAddTask(true)} onFocus={() => setActiveTab('focus')} />}
        {activeTab === 'plan' && <PlanView tasks={tasks} onAdd={() => { setNewRepeat('none'); setShowPlanTask(true); }} onOpenTask={(task) => openPanel(task.title, `${task.note || 'Sem notas adicionais.'}\n\n${task.estimateMinutes} min estimados · ${task.repeat === 'none' ? 'não se repete' : `repete: ${task.repeat}`}. Você pode concluir esta tarefa pela tela Hoje.`)} />}
        {activeTab === 'focus' && <FocusView timerSeconds={timerSeconds} focusSeconds={focusSeconds} completedSessions={completedSessions} running={timerRunning} kind={timerKind} settings={pomodoro} setRunning={setTimerRunning} onSettings={async (next) => { setPomodoro(next); if (account?.sessionToken) await fetch('/api/pomodoro', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.sessionToken}` }, body: JSON.stringify(next) }); notify('Pomodoro atualizado.'); }} reset={() => { setTimerRunning(false); setTimerSeconds((timerKind === 'focus' ? pomodoro.focusMinutes : timerKind === 'shortBreak' ? pomodoro.shortBreakMinutes : pomodoro.longBreakMinutes) * 60); notify('Cronômetro reiniciado.'); }} notify={notify} />}
        {activeTab === 'studies' && account && <StudiesView subjects={subjects} onSave={async (action, data) => { await workspace(action, data); await loadWorkspace(); }} notify={notify} />}
        {activeTab === 'community' && account && <CommunityView account={account} notify={notify} />}
        {activeTab === 'profile' && account && <ProfileView account={account} completed={completed} focusSeconds={focusSeconds} completedSessions={completedSessions} goals={goals} history={focusHistory} onCreateGoal={async (title, target, period) => { await workspace('createGoal', { title, target, period }); await loadWorkspace(); notify('Meta criada.'); }} onOpen={openPanel} onLogout={logout} />}
      </div>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {navItems.map((item) => <button key={item.id} className={`nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}
      </nav>

      {showAddTask && <div className="modal-backdrop" onClick={() => setShowAddTask(false)}><form className="add-modal task-modal" onSubmit={addTask} onClick={(event) => event.stopPropagation()}><div className="modal-handle" /><h2>Nova rotina</h2><p>Ela aparecerá todos os dias no seu ritmo.</p><input autoFocus required value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="O que você quer realizar?" aria-label="Nova rotina" /><textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Nota ou checklist (opcional)" maxLength={1000} /><div className="task-fields"><label>Prioridade<select value={newPriority} onChange={(event) => setNewPriority(event.target.value as Task['priority'])}><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select></label><label>Tempo (min)<input type="number" min="1" max="600" value={newEstimate} onChange={(event) => setNewEstimate(Number(event.target.value))} /></label></div><label className="routine-select">Em qual rotina?<select value={newRoutine} onChange={(event) => setNewRoutine(event.target.value as Routine)}><option value="morning">Rotina matinal</option><option value="afternoon">Rotina da tarde</option><option value="night">Rotina da noite</option></select></label><button className="primary-button" type="submit">Adicionar à rotina</button><button className="modal-cancel" type="button" onClick={() => setShowAddTask(false)}>Cancelar</button></form></div>}
      {showPlanTask && <div className="modal-backdrop" onClick={() => setShowPlanTask(false)}><form className="add-modal task-modal" onSubmit={addPlannedTask} onClick={(event) => event.stopPropagation()}><div className="modal-handle" /><h2>Planejar tarefa</h2><p>Esta tarefa entra na agenda, não na rotina diária.</p><input autoFocus required value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="O que precisa fazer?" /><textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Nota (opcional)" /><div className="task-fields"><label>Dia e hora<input required type="datetime-local" value={newDueAt} onChange={(event) => setNewDueAt(event.target.value)} /></label><label>Repetir<select value={newRepeat} onChange={(event) => setNewRepeat(event.target.value as Task['repeat'])}><option value="none">Não repetir</option><option value="daily">Todos os dias</option><option value="weekdays">Dias úteis</option><option value="weekly">Semanalmente</option></select></label><label>Prioridade<select value={newPriority} onChange={(event) => setNewPriority(event.target.value as Task['priority'])}><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select></label><label>Tempo (min)<input type="number" min="1" max="600" value={newEstimate} onChange={(event) => setNewEstimate(Number(event.target.value))} /></label></div><button className="primary-button" type="submit">Adicionar ao planejamento</button><button className="modal-cancel" type="button" onClick={() => setShowPlanTask(false)}>Cancelar</button></form></div>}
      {panel && <InfoPanel panel={panel} onClose={() => setPanel(null)} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function InfoPanel({ panel, onClose }: { panel: NonNullable<Panel>; onClose: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}><section className="add-modal info-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="panel-title"><div className="modal-handle" /><h2 id="panel-title">{panel.title}</h2><p>{panel.body}</p><button className="primary-button" onClick={onClose}>Entendi</button></section></div>;
}

function AuthFlow({ onAuthenticated }: { onAuthenticated: (account: Account) => void }) {
  const [screen, setScreen] = useState<AuthScreen>('choice');
  const [details, setDetails] = useState({ name: '', email: '', phone: '' });
  const [email, setEmail] = useState('');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function show(nextScreen: AuthScreen) {
    setError('');
    setPin('');
    setScreen(nextScreen);
  }

  function continueRegistration(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeEmail(details.email);
    setDetails((current) => ({ ...current, email: normalized }));
    show('register-pin');
  }

  function continueLogin(event: React.FormEvent) {
    event.preventDefault();
    setSelectedEmail(normalizeEmail(email));
    show('login-pin');
  }

  async function requestAccount(payload: Record<string, string>) {
    const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json() as { user?: Account; sessionToken?: string; error?: string };
    if (!response.ok || !data.user) throw new Error(data.error ?? 'Não foi possível acessar sua conta agora.');
    return { ...data.user, sessionToken: data.sessionToken };
  }

  async function register() {
    if (pin.length !== 4) return setError('Digite os quatro números do seu PIN.');
    setSubmitting(true);
    try {
      const user = await requestAccount({ action: 'register', ...details, email: normalizeEmail(details.email), pinHash: await hashPin(pin) });
      onAuthenticated(user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível criar sua conta.');
    } finally {
      setSubmitting(false);
    }
  }

  async function login() {
    if (!selectedEmail || pin.length !== 4) return setError('Digite os quatro números do seu PIN.');
    setSubmitting(true);
    try {
      const user = await requestAccount({ action: 'login', email: selectedEmail, pinHash: await hashPin(pin) });
      onAuthenticated(user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível entrar agora.');
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  if (screen === 'choice') return <main className="auth-shell"><AuthBrand /><section className="auth-card choice-card"><span className="eyebrow">Seu espaço, no seu ritmo</span><h1>Bem-vindo à Cave.</h1><p>Organize o que importa e avance uma tarefa de cada vez.</p><button className="primary-button auth-action" onClick={() => show('login-email')}>Entrar</button><button className="secondary-button auth-action" onClick={() => show('register-details')}>Cadastrar</button></section></main>;

  if (screen === 'register-details') return <main className="auth-shell"><AuthBrand /><form className="auth-card" onSubmit={continueRegistration}><span className="eyebrow">Criar conta</span><h1>Seu espaço começa aqui.</h1><p>Use seus dados para reconhecer sua conta neste aparelho.</p><label>Nome<input autoFocus required value={details.name} onChange={(event) => setDetails({ ...details, name: event.target.value })} placeholder="Como quer ser chamado?" /></label><label>E-mail<input required type="email" value={details.email} onChange={(event) => setDetails({ ...details, email: event.target.value })} placeholder="voce@email.com" /></label><label>Celular<input required type="tel" inputMode="tel" value={details.phone} onChange={(event) => setDetails({ ...details, phone: event.target.value })} placeholder="(00) 00000-0000" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-action" type="submit">Continuar</button><button className="auth-back" type="button" onClick={() => show('choice')}>Voltar</button></form></main>;

  if (screen === 'login-email') return <main className="auth-shell"><AuthBrand /><form className="auth-card" onSubmit={continueLogin}><span className="eyebrow">Entrar</span><h1>Qual é seu e-mail?</h1><p>Vamos localizar sua conta salva neste aparelho.</p><label>E-mail<input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-action" type="submit">Continuar</button><button className="auth-back" type="button" onClick={() => show('choice')}>Voltar</button></form></main>;

  const isRegistration = screen === 'register-pin';
  return <main className="auth-shell"><AuthBrand /><section className="auth-card pin-card"><span className="eyebrow">{isRegistration ? 'Proteja seu acesso' : 'Olá de novo'}</span><h1>{isRegistration ? 'Crie seu PIN.' : 'Bem-vindo de volta.'}</h1><p>{isRegistration ? 'Escolha quatro números para abrir a Cave.' : 'Digite seu PIN para continuar.'}</p><PinKeypad pin={pin} onChange={setPin} /><div className="pin-status" aria-live="polite">{pin.length}/4 números</div>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-action" disabled={pin.length !== 4 || submitting} onClick={isRegistration ? register : login}>{submitting ? 'Aguarde…' : isRegistration ? 'Criar acesso' : 'Entrar na Cave'}</button><button className="auth-back" type="button" disabled={submitting} onClick={() => show(isRegistration ? 'register-details' : 'login-email')}>Voltar</button></section></main>;
}

function AuthBrand() {
  return <div className="auth-brand"><img className="brand-mark" src="/cave-logo.jpeg" alt="" /><strong>cave</strong></div>;
}

function PinKeypad({ pin, onChange }: { pin: string; onChange: (pin: string) => void }) {
  function addDigit(digit: string) {
    if (pin.length < 4) onChange(`${pin}${digit}`);
  }
  return (
    <div className="pin-keypad" aria-label="Teclado numérico">
      <div className="pin-digits" aria-label={`${pin.length} de 4 números digitados`}>
        {[0, 1, 2, 3].map((index) => <span className={pin[index] ? 'filled' : ''} key={index}>{pin[index] || '—'}</span>)}
      </div>
      <div className="number-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => <button type="button" key={digit} aria-label={`Número ${digit}`} onClick={() => addDigit(digit)}>{digit}</button>)}
        <span />
        <button type="button" aria-label="Número 0" onClick={() => addDigit('0')}>0</button>
        <button type="button" className="delete-pin" aria-label="Apagar último número" onClick={() => onChange(pin.slice(0, -1))}>⌫</button>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  const [focusTool, setFocusTool] = useState<FocusTool>(() => selectedFocusTool);
  const hasFocusTools = title === 'Presença no agora';
  const selectFocusTool = (tool: FocusTool) => { selectedFocusTool = tool; setFocusTool(tool); window.dispatchEvent(new CustomEvent('cave-focus-tool', { detail: tool })); };
  return <><div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div><div className="heading-actions">{action}</div></div>{hasFocusTools && <div className="focus-tool-switcher" role="tablist" aria-label="Tipo de relógio">{[['pomodoro','◷','Pomodoro'],['clock','◴','Relógio'],['stopwatch','◉','Cronômetro'],['timer','⌛','Timer']].map(([id, icon, label]) => <button key={id} role="tab" aria-selected={focusTool === id} className={focusTool === id ? 'selected' : ''} onClick={() => selectFocusTool(id as typeof focusTool)}><span>{icon}</span>{label}</button>)}<button className="fullscreen-tool-button" onClick={() => window.dispatchEvent(new Event('cave-open-fullscreen-clock'))} aria-label="Abrir em tela cheia">⛶</button><button className="finish-tool-button" onClick={() => window.dispatchEvent(new Event('cave-finish-focus'))}>Finalizar</button></div>}</>;
}

function TodayView({ dateLabel, tasks, completed, progress, focusSeconds, onToggle, onDelete, onReorder, onAdd, onFocus }: { dateLabel: string; tasks: Task[]; completed: number; progress: number; focusSeconds: number; onToggle: (id: number) => void; onDelete: (id: number) => void; onReorder: (source: number, target: number) => void; onAdd: () => void; onFocus: () => void }) {
  return <>
    <section className="hero-section"><div className="eyebrow">{dateLabel}</div><h1>Seu progresso<br /><em>começa hoje.</em></h1><p>Uma tarefa de cada vez.</p><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-spark">✦</div></section>
    <section className="stat-grid"><div className="stat-card"><span className="stat-label">Tarefas concluídas</span><strong>{completed}<small>/{tasks.length}</small></strong><div className="mini-progress"><i style={{ width: `${progress}%` }} /></div><span className="stat-foot">Progresso de hoje</span></div><div className="stat-card accent-card"><span className="stat-label">Foco registrado</span><strong>{formatDuration(focusSeconds)}</strong><span className="stat-foot">Registrado nesta sessão</span></div></section>
    <section className="section-block"><div className="section-title"><div><span className="eyebrow">Acompanhe o ritmo</span><h2>Suas rotinas</h2></div><button className="text-button" onClick={onAdd}>+ Adicionar</button></div><div className="routine-card"><div className="routine-top"><span>Hoje</span><strong>{progress}% concluído</strong></div><div className="large-progress"><i style={{ width: `${progress}%` }} /></div><p className="reorder-hint">Segure o ícone ⠿ e arraste para reorganizar.</p>{(['morning', 'afternoon', 'night'] as Routine[]).map((routine) => <RoutineGroup key={routine} routine={routine} tasks={tasks.filter((task) => task.routine === routine)} onToggle={onToggle} onDelete={onDelete} onReorder={onReorder} />)}{!tasks.length && <p className="empty-state">Adicione sua primeira tarefa para começar.</p>}</div></section>
    <section className="focus-banner"><div className="focus-symbol">◷</div><div><span className="eyebrow">Espaço de foco</span><h2>Reserve um tempo para você.</h2><p>25 minutos de presença podem mudar o seu dia.</p></div><button className="focus-open" onClick={onFocus}>Começar</button></section>
    <section className="quote-card"><span>“</span><p>Consistência não é fazer tudo. É voltar para o que importa.</p><small>— Seu Cave de hoje</small></section>
  </>;
}

function RoutineGroup({ routine, tasks, onToggle, onDelete, onReorder }: { routine: Routine; tasks: Task[]; onToggle: (id: number) => void; onDelete: (id: number) => void; onReorder: (source: number, target: number) => void }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const draggingId = useRef<number | null>(null);
  const lastTargetId = useRef<number | null>(null);
  const label = routine === 'morning' ? 'Rotina matinal' : routine === 'afternoon' ? 'Rotina da tarde' : 'Rotina da noite';
  const stopDragging = () => { draggingId.current = null; lastTargetId.current = null; setDragging(null); };
  return <section className="routine-group"><h3>{label}<small>{tasks.length} {tasks.length === 1 ? 'tarefa' : 'tarefas'}</small></h3><div className="task-list">{tasks.length ? tasks.map((task) => <div className={`task-row ${task.done ? 'is-done' : ''} ${dragging === task.id ? 'dragging' : ''}`} data-task-id={task.id} key={task.id}><button className="drag-handle" type="button" aria-label={`Segurar para mover ${task.title}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); draggingId.current = task.id; lastTargetId.current = task.id; setDragging(task.id); }} onPointerMove={(event) => { if (draggingId.current !== task.id) return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-task-id]'); const targetId = Number(target?.dataset.taskId); if (targetId && targetId !== lastTargetId.current) { lastTargetId.current = targetId; onReorder(task.id, targetId); } }} onPointerUp={stopDragging} onPointerCancel={stopDragging}>⠿</button><button className="task-main" onClick={() => onToggle(task.id)} aria-pressed={task.done}><span className={`task-check ${task.done ? 'checked' : ''}`}>{task.done ? '✓' : ''}</span><span className="task-copy"><strong>{task.title}</strong><small>{task.meta}</small></span><span className={`task-color ${task.color}`} /></button><button className="task-delete" type="button" aria-label={`Excluir ${task.title}`} onClick={() => onDelete(task.id)}>×</button></div>) : <p className="routine-empty">Nenhuma tarefa nesta rotina.</p>}</div></section>;
}

function LegacyPlanView({ tasks, onAdd, onOpenTask }: { tasks: Task[]; onAdd: () => void; onOpenTask: (task: Task) => void }) {
  const [selectedDay, setSelectedDay] = useState(2);
  const days = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];
  return <><PageHeading eyebrow="Planejar" title="Dê forma ao seu dia" action={<button className="round-add" onClick={onAdd} aria-label="Adicionar tarefa">+</button>} /><div className="week-strip">{days.map((day, index) => <button className={index === selectedDay ? 'today' : ''} key={day} onClick={() => setSelectedDay(index)} aria-pressed={index === selectedDay}><span>{day}</span><strong>{12 + index}</strong></button>)}</div><section className="section-block"><div className="section-title"><div><span className="eyebrow">{days[selectedDay]}, {12 + selectedDay} out</span><h2>Agenda do dia</h2></div><span className="soft-pill">{tasks.length} itens</span></div><div className="schedule-card">{tasks.map((task, index) => <button className="schedule-row" key={task.id} onClick={() => onOpenTask(task)}><span className="schedule-time">{['08:00', '10:30', '15:00', '18:30'][index] || '20:00'}</span><span className={`schedule-line ${task.color}`} /><span><strong>{task.title}</strong><small>{task.meta}</small></span><span className="more">···</span></button>)}</div></section><div className="tip-card"><span className="tip-icon">✦</span><div><strong>Planeje com espaço</strong><p>Deixe 20% do seu dia livre para o inesperado.</p></div></div></>;
}

function isScheduledFor(task: Task, date: Date) {
  if (!task.dueAt) return false;
  const start = new Date(task.dueAt); const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()); const first = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (day < first) return false;
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekdays') return day.getDay() > 0 && day.getDay() < 6;
  if (task.repeat === 'weekly') return day.getDay() === first.getDay();
  return day.getTime() === first.getTime();
}

function PlanView({ tasks, onAdd, onOpenTask }: { tasks: Task[]; onAdd: () => void; onOpenTask: (task: Task) => void }) {
  const [selectedDay, setSelectedDay] = useState(2);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index - 2);
    return date;
  });
  const selected = dates[selectedDay];
  const dayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(selected);
  const dayTasks = tasks.filter((task) => isScheduledFor(task, selected)).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  return <><PageHeading eyebrow="Planejar" title="Dê forma à sua semana" action={<button className="round-add" onClick={onAdd} aria-label="Adicionar tarefa">+</button>} /><div className="week-strip">{dates.map((date, index) => <button className={index === selectedDay ? 'today' : ''} key={date.toDateString()} onClick={() => setSelectedDay(index)} aria-pressed={index === selectedDay}><span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '').toUpperCase()}</span><strong>{date.getDate()}</strong></button>)}</div><section className="section-block"><div className="section-title"><div><span className="eyebrow">{dayLabel}</span><h2>Agenda do dia</h2></div><span className="soft-pill">{dayTasks.length} itens</span></div><div className="schedule-card">{dayTasks.length ? dayTasks.map((task) => <button className="schedule-row" key={task.id} onClick={() => onOpenTask(task)}><span className="schedule-time">{task.dueAt ? new Date(task.dueAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span><span className={`schedule-line ${task.color}`} /><span><strong>{task.title}</strong><small>{task.estimateMinutes} min · {task.priority === 'high' ? 'prioridade alta' : task.note || task.meta}</small></span><span className="more">···</span></button>) : <p className="empty-state">Nenhuma tarefa planejada para este dia.</p>}</div></section></>;
}

function FocusView({ timerSeconds, focusSeconds, completedSessions, running, kind, settings, setRunning, onSettings, reset, notify }: { timerSeconds: number; focusSeconds: number; completedSessions: number; running: boolean; kind: 'focus' | 'shortBreak' | 'longBreak'; settings: PomodoroSettings; setRunning: (value: boolean) => void; onSettings: (settings: PomodoroSettings) => Promise<void>; reset: () => void; notify: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(settings);
  const audioRef = useRef<AudioContext | null>(null);
  const duration = (kind === 'focus' ? settings.focusMinutes : kind === 'shortBreak' ? settings.shortBreakMinutes : settings.longBreakMinutes) * 60;
  const percent = Math.max(0, ((duration - timerSeconds) / duration) * 100);
  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => {
    if (!running || !settings.soundEnabled) return;
    const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    const context = new Audio(); audioRef.current = context;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = context.createBiquadFilter(); filter.type = settings.sound === 'Chuva leve' ? 'bandpass' : settings.sound === 'Café' ? 'lowpass' : 'highpass'; filter.frequency.value = settings.sound === 'Chuva leve' ? 1500 : settings.sound === 'Café' ? 650 : 1100;
    const gain = context.createGain(); gain.gain.value = settings.sound === 'Café' ? .045 : .09;
    source.connect(filter).connect(gain).connect(context.destination); source.start();
    return () => { source.stop(); void context.close(); audioRef.current = null; };
  }, [running, settings.sound, settings.soundEnabled]);
  const [fullClock, setFullClock] = useState(false);
  useEffect(() => { const open = () => { setFullClock(true); if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined); }; const changed = () => { if (!document.fullscreenElement) setFullClock(false); }; window.addEventListener('cave-open-fullscreen-clock', open); document.addEventListener('fullscreenchange', changed); return () => { window.removeEventListener('cave-open-fullscreen-clock', open); document.removeEventListener('fullscreenchange', changed); }; }, []);
  const [tool, setTool] = useState<'pomodoro' | 'clock' | 'stopwatch' | 'timer'>('pomodoro'); const [toolRunning, setToolRunning] = useState(false); const [toolSeconds, setToolSeconds] = useState(0); const [timerMinutes, setTimerMinutes] = useState(10); const [now, setNow] = useState(new Date());
  useEffect(() => { const select = (event: Event) => { const next = (event as CustomEvent<'pomodoro' | 'clock' | 'stopwatch' | 'timer'>).detail; setRunning(false); setTool(next); setToolRunning(false); if (next !== 'pomodoro') setToolSeconds(next === 'timer' ? timerMinutes * 60 : 0); }; window.addEventListener('cave-focus-tool', select); return () => window.removeEventListener('cave-focus-tool', select); }, [setRunning, timerMinutes]);
  useEffect(() => { if (tool !== 'clock') return; const interval = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(interval); }, [tool]);
  useEffect(() => { if (!toolRunning || tool === 'clock') return; const interval = window.setInterval(() => setToolSeconds((value) => { if (tool === 'timer' && value <= 1) { setToolRunning(false); playBell(); notify('Timer finalizado.'); return 0; } return tool === 'timer' ? value - 1 : value + 1; }), 1000); return () => window.clearInterval(interval); }, [toolRunning, tool, notify]);
  const kindLabel = kind === 'focus' ? 'sessão de foco' : kind === 'shortBreak' ? 'pausa curta' : 'pausa longa';
  const toolLabel = tool === 'pomodoro' ? 'Pomodoro' : tool === 'clock' ? 'Relógio' : tool === 'stopwatch' ? 'Cronômetro' : 'Timer';
  const toolDisplay = tool === 'pomodoro' ? formatTime(timerSeconds) : tool === 'clock' ? now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : formatTime(toolSeconds);
  const toolIsRunning = tool === 'pomodoro' ? running : toolRunning;
  const toggleCurrentTool = () => { primeBell(); if (tool === 'pomodoro') { setRunning(!running); return; } if (tool === 'timer' && toolSeconds <= 0) setToolSeconds(timerMinutes * 60); setToolRunning(!toolRunning); };
  const resetCurrentTool = () => { if (tool === 'pomodoro') reset(); else { setToolRunning(false); setToolSeconds(tool === 'timer' ? timerMinutes * 60 : 0); } };
  if (fullClock) return <section className="clock-fullscreen"><button className="clock-exit" onClick={() => { setFullClock(false); if (document.fullscreenElement) void document.exitFullscreen(); }}>×</button><span>{toolLabel}</span><strong>{toolDisplay}</strong><small>{tool === 'pomodoro' ? kindLabel : tool === 'clock' ? now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : tool === 'stopwatch' ? 'tempo corrido' : 'contagem regressiva'}</small>{tool !== 'clock' && <div><button className="secondary-button" onClick={resetCurrentTool}>Reiniciar</button><button className="primary-button" onClick={toggleCurrentTool}>{toolIsRunning ? 'Pausar' : 'Começar'}</button></div>}</section>;
  if (tool !== 'pomodoro') return <ToolClock tool={tool} seconds={toolSeconds} running={toolRunning} now={now} timerMinutes={timerMinutes} onMinutes={(value) => { setTimerMinutes(value); setToolSeconds(value * 60); }} onToggle={toggleCurrentTool} onReset={resetCurrentTool} />;
  return <><PageHeading eyebrow="Central de foco" title="Presença no agora" action={<button className="soft-pill" onClick={() => setEditing(true)}>Ajustar</button>} /><section className="timer-card"><div className="timer-ring" style={{ '--progress': `${percent * 3.6}deg` } as React.CSSProperties}><div className="timer-inner"><span>{running ? (kind === 'focus' ? 'Em foco' : 'Em pausa') : 'Pronto para começar'}</span><strong>{formatTime(timerSeconds)}</strong><small>{kindLabel}</small></div></div><div className="timer-controls"><button className="secondary-button" onClick={reset}>Reiniciar</button><button className="primary-button timer-start" onClick={() => { setRunning(!running); notify(running ? 'Sessão pausada.' : `${kind === 'focus' ? 'Foco' : 'Pausa'} iniciado.`); }}>{running ? 'Pausar' : kind === 'focus' ? 'Começar foco' : 'Começar pausa'}</button></div></section><div className="focus-options"><div><span>Duração</span><strong>{Math.round(duration / 60)} min</strong></div><div><span>Foco registrado</span><strong>{formatDuration(focusSeconds)}</strong></div><div><span>Sessões concluídas</span><strong>{completedSessions}</strong></div></div><section className="section-block"><div className="section-title"><div><span className="eyebrow">Escolha seu ambiente</span><h2>Som para acompanhar</h2></div><button className="text-button" onClick={() => void onSettings({ ...settings, soundEnabled: !settings.soundEnabled })}>{settings.soundEnabled ? 'Desligar' : 'Ligar'}</button></div><div className="sound-grid">{soundOptions.map((sound) => <button key={sound.name} className={`sound-card ${settings.sound === sound.name ? 'selected' : ''}`} onClick={() => { void onSettings({ ...settings, sound: sound.name, soundEnabled: true }); notify(`${sound.name} selecionado.`); }} aria-pressed={settings.sound === sound.name}>{sound.icon}<span>{sound.name}</span><small>{sound.description}</small></button>)}</div></section>{editing && <div className="modal-backdrop" onClick={() => setEditing(false)}><form className="add-modal pomodoro-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void onSettings(draft); setEditing(false); }}><div className="modal-handle" /><h2>Configurar Pomodoro</h2><p>Defina o ritmo que funciona para você.</p><label>Foco (min)<input type="number" min="1" max="120" value={draft.focusMinutes} onChange={(event) => setDraft({ ...draft, focusMinutes: Number(event.target.value) })} /></label><label>Pausa curta (min)<input type="number" min="1" max="120" value={draft.shortBreakMinutes} onChange={(event) => setDraft({ ...draft, shortBreakMinutes: Number(event.target.value) })} /></label><label>Pausa longa (min)<input type="number" min="1" max="120" value={draft.longBreakMinutes} onChange={(event) => setDraft({ ...draft, longBreakMinutes: Number(event.target.value) })} /></label><button className="primary-button" type="submit">Salvar configuração</button></form></div>}</>;
}

function ToolClock({ tool, seconds, running, now, timerMinutes, onMinutes, onToggle, onReset }: { tool: 'clock' | 'stopwatch' | 'timer'; seconds: number; running: boolean; now: Date; timerMinutes: number; onMinutes: (value: number) => void; onToggle: () => void; onReset: () => void }) {
  const title = tool === 'clock' ? 'Relógio' : tool === 'stopwatch' ? 'Cronômetro' : 'Timer'; const display = tool === 'clock' ? now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : formatTime(seconds);
  return <><PageHeading eyebrow="Central de foco" title="Presença no agora" /><section className="timer-card tool-clock"><span className="tool-name">{title}</span><span>{tool === 'clock' ? now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : tool === 'stopwatch' ? 'tempo corrido' : 'contagem regressiva'}</span><strong>{display}</strong>{tool === 'timer' && <label>Minutos<input type="number" min="1" max="180" disabled={running} value={timerMinutes} onChange={(event) => onMinutes(Math.max(1, Number(event.target.value)))} /></label>}{tool !== 'clock' && <div className="timer-controls"><button className="secondary-button" onClick={onReset}>Reiniciar</button><button className="primary-button" onClick={onToggle}>{running ? 'Pausar' : seconds <= 0 && tool === 'timer' ? 'Começar de novo' : 'Começar'}</button></div>}</section></>;
}

type CommunityPost = { id: number; body: string; created_at: string; name: string; email: string; likes: number; comments: number; liked: boolean | null };
type CommunityPerson = { name: string; email: string; following: boolean; followers: number };
type CommunityComment = { id: number; body: string; created_at: string; name: string; email: string };
type CommunityMessage = { id: number; body: string; created_at: string; sender_email: string; recipient_email: string; sender_name: string };
type Challenge = { id: number; title: string; description: string; targetMinutes: number; progress: number; joined: boolean; members: number; rank: number };

function CommunityCore({ account, notify }: { account: Account; notify: (message: string) => void }) {
  const [tab, setTab] = useState<'feed' | 'following' | 'messages' | 'challenges'>('feed'); const [posts, setPosts] = useState<CommunityPost[]>([]); const [people, setPeople] = useState<CommunityPerson[]>([]); const [challenges, setChallenges] = useState<Challenge[]>([]); const [query, setQuery] = useState(''); const [postText, setPostText] = useState(''); const [commentFor, setCommentFor] = useState<number | null>(null); const [commentText, setCommentText] = useState(''); const [comments, setComments] = useState<CommunityComment[]>([]); const [talkingTo, setTalkingTo] = useState<CommunityPerson | null>(null); const [messages, setMessages] = useState<CommunityMessage[]>([]); const [messageText, setMessageText] = useState(''); const [error, setError] = useState('');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${account.sessionToken ?? ''}` };
  const call = async (url: string, init?: RequestInit) => { const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Não foi possível concluir esta ação.'); return data; };
  const loadPosts = async (following = false) => { try { const data = await call(`/api/social?mode=feed&following=${following ? '1' : '0'}`); setPosts(data.posts); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar.'); } };
  const loadPeople = async (value = query) => { try { const data = await call(`/api/social?mode=people&q=${encodeURIComponent(value)}`); setPeople(data.people); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar.'); } };
  const loadChallenges = async () => { try { const data = await fetch('/api/workspace?mode=challenges', { headers }); const result = await data.json(); if (!data.ok) throw new Error(result.error); setChallenges(result.challenges); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar desafios.'); } };
  useEffect(() => { void loadPosts(); void loadPeople(''); void loadChallenges(); }, []);
  const send = async (action: string, values: Record<string, unknown>) => call('/api/social', { method: 'POST', body: JSON.stringify({ action, ...values }) });
  const openComments = async (postId: number) => { setCommentFor(postId); try { const data = await call(`/api/social?mode=comments&post=${postId}`); setComments(data.comments); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar comentários.'); } };
  const openMessages = async (person: CommunityPerson) => { setTalkingTo(person); setTab('messages'); try { const data = await call(`/api/social?mode=messages&with=${encodeURIComponent(person.email)}`); setMessages(data.messages); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível abrir a conversa.'); } };
  return <><PageHeading eyebrow="Comunidade" title="Crescer junto é melhor" action={<button className="icon-button" aria-label="Atualizar comunidade" onClick={() => void loadPosts(tab === 'following')}>↻</button>} /><div className="community-tabs">{[['feed','Para você'],['following','Seguindo'],['messages','Conversas']].map(([id,label]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => { setTab(id as typeof tab); if (id === 'feed') void loadPosts(); if (id === 'following') void loadPosts(true); }} aria-pressed={tab === id}>{label}</button>)}</div>{error && <p className="auth-error">{error}</p>}<section className="people-card"><input value={query} onChange={(event) => { setQuery(event.target.value); void loadPeople(event.target.value); }} placeholder="Buscar pessoas por nome ou e-mail" aria-label="Buscar pessoas" />{query && <div className="people-list">{people.map((person) => <div className="person-row" key={person.email}><div><strong>{person.name}</strong><small>{person.followers} seguidores</small></div><button className="text-button" onClick={() => void openMessages(person)}>Mensagem</button><button className="follow-button" onClick={async () => { await send(person.following ? 'unfollow' : 'follow', { email: person.email }); await loadPeople(); notify(person.following ? 'Você deixou de seguir esta pessoa.' : 'Agora vocês estão conectados.'); }}>{person.following ? 'Seguindo' : 'Seguir'}</button></div>)}</div>}</section>{tab !== 'messages' && <><form className="composer" onSubmit={async (event) => { event.preventDefault(); if (!postText.trim()) return; await send('post', { body: postText }); setPostText(''); await loadPosts(tab === 'following'); notify('Publicação compartilhada.'); }}><textarea value={postText} onChange={(event) => setPostText(event.target.value)} maxLength={500} placeholder="Compartilhe uma pequena vitória ou ideia…" /><button className="primary-button" type="submit">Publicar</button></form>{posts.length ? posts.map((post) => <article className="feed-card" key={post.id}><div className="post-author"><div className="avatar avatar-blue">{post.name.charAt(0).toUpperCase()}</div><div><strong>{post.name}</strong><small>{new Date(post.created_at).toLocaleString('pt-BR')}</small></div></div><p>{post.body}</p><div className="post-actions"><button onClick={async () => { await send(post.liked ? 'unlike' : 'like', { postId: post.id }); await loadPosts(tab === 'following'); }}>{post.liked ? '♥' : '♡'} {post.likes}</button><button onClick={() => void openComments(post.id)}>◌ {post.comments} comentários</button><button onClick={() => { const person = people.find((item) => item.email === post.email) ?? { name: post.name, email: post.email, following: false, followers: 0 }; void openMessages(person); }}>✉ Mensagem</button></div>{commentFor === post.id && <div className="comments"><div>{comments.map((comment) => <p key={comment.id}><strong>{comment.name}</strong> {comment.body}</p>)}</div><form onSubmit={async (event) => { event.preventDefault(); if (!commentText.trim()) return; await send('comment', { postId: post.id, body: commentText }); setCommentText(''); await openComments(post.id); await loadPosts(tab === 'following'); }}><input value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={300} placeholder="Escreva um comentário" /><button type="submit">Enviar</button></form></div>}</article>) : <p className="empty-state">Ainda não há publicações aqui. Que tal abrir a conversa?</p>}</>}{tab === 'messages' && <section className="messages-card">{!talkingTo ? <><p className="empty-state">Busque uma pessoa acima e toque em Mensagem para começar.</p>{people.map((person) => <button className="person-row" key={person.email} onClick={() => void openMessages(person)}><div><strong>{person.name}</strong><small>{person.email}</small></div><span>›</span></button>)}</> : <><div className="message-head"><button className="text-button" onClick={() => setTalkingTo(null)}>‹ Voltar</button><strong>{talkingTo.name}</strong></div><div className="message-list">{messages.map((message) => <p className={message.sender_email === account.email ? 'mine' : ''} key={message.id}>{message.body}</p>)}</div><form className="message-compose" onSubmit={async (event) => { event.preventDefault(); if (!messageText.trim()) return; await send('message', { email: talkingTo.email, body: messageText }); setMessageText(''); await openMessages(talkingTo); }}><input value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={1000} placeholder="Mensagem" /><button type="submit">Enviar</button></form></>}</section>}</>;
}

function StudiesView({ subjects, onSave, notify }: { subjects: { id: number; name: string; topics: { id: number; name: string; done: boolean }[] }[]; onSave: (action: string, data: Record<string, unknown>) => Promise<void>; notify: (message: string) => void }) {
  const [subject, setSubject] = useState(''); const [topic, setTopic] = useState<Record<number, string>>({});
  return <><PageHeading eyebrow="Estudos" title="Aprenda no seu ritmo" /><form className="study-add" onSubmit={async (event) => { event.preventDefault(); if (!subject.trim()) return; await onSave('createSubject', { name: subject }); setSubject(''); notify('Matéria adicionada.'); }}><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Nova matéria: ex. Matemática" /><button type="submit">Adicionar</button></form>{subjects.length ? subjects.map((item) => { const completed = item.topics.filter((itemTopic) => itemTopic.done).length; const progress = item.topics.length ? completed / item.topics.length * 100 : 0; return <section className="study-card" key={item.id}><div className="study-head"><div><h2>{item.name}</h2><small>{completed}/{item.topics.length || 0} assuntos concluídos</small></div><button className="delete-study" aria-label={`Excluir ${item.name}`} onClick={async () => { await onSave('deleteSubject', { subjectId: item.id }); notify('Matéria excluída.'); }}>×</button></div><div className="study-progress"><i style={{ width: `${progress}%` }} /></div><div>{item.topics.map((itemTopic) => <div className={`study-topic ${itemTopic.done ? 'done' : ''}`} key={itemTopic.id}><button onClick={async () => { await onSave('toggleTopic', { topicId: itemTopic.id }); }}><span>{itemTopic.done ? '✓' : ''}</span>{itemTopic.name}</button><button className="delete-study" aria-label={`Excluir ${itemTopic.name}`} onClick={async () => { await onSave('deleteTopic', { topicId: itemTopic.id }); }}>×</button></div>)}</div><form onSubmit={async (event) => { event.preventDefault(); const name = topic[item.id]?.trim(); if (!name) return; await onSave('createTopic', { subjectId: item.id, name }); setTopic({ ...topic, [item.id]: '' }); }}><input value={topic[item.id] ?? ''} onChange={(event) => setTopic({ ...topic, [item.id]: event.target.value })} placeholder="Adicionar assunto" /><button type="submit">+</button></form></section>; }) : <p className="empty-state">Adicione uma matéria e organize os assuntos que quer estudar.</p>}</>;
}

function CommunityView({ account, notify }: { account: Account; notify: (message: string) => void }) {
  const [view, setView] = useState<'feed' | 'people' | 'challenges'>('feed');
  return <><div className="community-hub-tabs">{[['feed','Feed'],['people','Pessoas'],['challenges','Desafios']].map(([id,label]) => <button key={id} className={view === id ? 'selected' : ''} onClick={() => setView(id as typeof view)}>{label}</button>)}</div>{view === 'feed' && <CommunityCore account={account} notify={notify} />}{view === 'people' && <PeopleView account={account} notify={notify} />}{view === 'challenges' && <ChallengeView account={account} onBack={() => setView('feed')} notify={notify} />}</>;
}

function PeopleView({ account, notify }: { account: Account; notify: (message: string) => void }) {
  const [people, setPeople] = useState<CommunityPerson[]>([]); const [query, setQuery] = useState(''); const [error, setError] = useState('');
  const load = async (value = '') => { try { const response = await fetch(`/api/social?mode=people&q=${encodeURIComponent(value)}`, { headers: { Authorization: `Bearer ${account.sessionToken ?? ''}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPeople(data.people); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar pessoas.'); } };
  useEffect(() => { void load(); }, []);
  return <><PageHeading eyebrow="Comunidade" title="Encontre sua turma" />{error && <p className="auth-error">{error}</p>}<section className="people-card people-explorer"><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); void load(event.target.value); }} placeholder="Buscar pelo nome ou e-mail" />{people.length ? people.map((person) => <div className="person-row" key={person.email}><div className="avatar avatar-blue">{person.name.charAt(0).toUpperCase()}</div><div><strong>{person.name}</strong><small>{person.followers} seguidores</small></div><button className="follow-button" onClick={async () => { const response = await fetch('/api/social', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.sessionToken ?? ''}` }, body: JSON.stringify({ action: person.following ? 'unfollow' : 'follow', email: person.email }) }); if (!response.ok) return setError('Não foi possível atualizar o vínculo.'); await load(query); notify(person.following ? 'Você deixou de seguir esta pessoa.' : 'Agora vocês estão conectados.'); }}>{person.following ? 'Seguindo' : 'Seguir'}</button></div>) : <p className="empty-state">Nenhuma pessoa encontrada ainda.</p>}</section></>;
}

function ChallengeView({ account, onBack, notify }: { account: Account; onBack: () => void; notify: (message: string) => void }) {
  const [challenges, setChallenges] = useState<Challenge[]>([]); const [error, setError] = useState('');
  const load = async () => { try { const response = await fetch('/api/workspace?mode=challenges', { headers: { Authorization: `Bearer ${account.sessionToken ?? ''}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setChallenges(data.challenges); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar desafios.'); } };
  useEffect(() => { void load(); }, []);
  return <><PageHeading eyebrow="Comunidade" title="Desafios em grupo" action={<button className="text-button" onClick={onBack}>Voltar</button>} />{error && <p className="auth-error">{error}</p>}{challenges.map((challenge) => <section className="challenge-card" key={challenge.id}><span className="eyebrow">{challenge.members} participantes · seu ranking #{challenge.rank}</span><h2>{challenge.title}</h2><p>{challenge.description}</p><div className="large-progress"><i style={{ width: `${Math.min(100, challenge.progress / challenge.targetMinutes * 100)}%` }} /></div><small>{challenge.progress}/{challenge.targetMinutes} min nesta semana</small><button className="primary-button" disabled={challenge.joined} onClick={async () => { const response = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.sessionToken ?? ''}` }, body: JSON.stringify({ action: 'joinChallenge', challengeId: challenge.id }) }); if (!response.ok) return setError('Não foi possível entrar no desafio.'); notify('Você entrou no desafio. Bom foco!'); await load(); }}>{challenge.joined ? 'Participando' : 'Entrar no desafio'}</button></section>)}{!challenges.length && !error && <p className="empty-state">Nenhum desafio disponível agora.</p>}</>;
}

function ProfileView({ account, completed, focusSeconds, completedSessions, goals, history, onCreateGoal, onOpen, onLogout }: { account: Account; completed: number; focusSeconds: number; completedSessions: number; goals: Goal[]; history: { day: string; minutes: number }[]; onCreateGoal: (title: string, target: number, period: 'daily' | 'weekly') => Promise<void>; onOpen: (title: string, body: string) => void; onLogout: () => void }) {
  const [addingGoal, setAddingGoal] = useState(false); const [title, setTitle] = useState(''); const [target, setTarget] = useState(60); const [period, setPeriod] = useState<'daily' | 'weekly'>('daily'); const max = Math.max(1, ...history.map((item) => item.minutes));
  return <><section className="profile-head"><div className="profile-avatar">{account.name.charAt(0).toUpperCase()}</div><div><span className="eyebrow">Seu espaço</span><h1>{account.name}</h1><p>{account.email}</p></div><button className="icon-button" aria-label="Lembretes" onClick={async () => { if (!('Notification' in window)) return onOpen('Lembretes', 'Este navegador não oferece notificações.'); const permission = await Notification.requestPermission(); onOpen('Lembretes', permission === 'granted' ? 'Lembretes ativados enquanto o Cave estiver aberto.' : 'Você pode liberar notificações nas configurações do navegador.'); }}>♢</button></section><div className="profile-stats"><div><strong>{completed}</strong><span>tarefas concluídas</span></div><div><strong>{formatDuration(focusSeconds)}</strong><span>foco registrado</span></div><div><strong>{completedSessions}</strong><span>sessões concluídas</span></div></div><section className="section-block"><div className="section-title"><div><span className="eyebrow">Últimos 7 dias</span><h2>Ritmo de foco</h2></div></div><div className="focus-chart">{history.length ? history.map((item) => <div key={item.day}><i style={{ height: `${Math.max(8, (item.minutes / max) * 100)}%` }} /><span>{item.day.slice(8)}</span></div>) : <p className="empty-state">Conclua uma sessão para iniciar seu histórico.</p>}</div></section><section className="section-block"><div className="section-title"><div><span className="eyebrow">Direção</span><h2>Metas</h2></div><button className="text-button" onClick={() => setAddingGoal(true)}>+ Meta</button></div><div className="goal-list">{goals.length ? goals.map((goal) => <div className="goal-card" key={goal.id}><div><strong>{goal.title}</strong><small>{goal.period === 'daily' ? 'Diária' : 'Semanal'} · {goal.currentValue}/{goal.target}</small></div><div className="large-progress"><i style={{ width: `${Math.min(100, goal.currentValue / goal.target * 100)}%` }} /></div></div>) : <p className="empty-state">Crie uma meta simples para ganhar consistência.</p>}</div></section>{addingGoal && <div className="modal-backdrop" onClick={() => setAddingGoal(false)}><form className="add-modal" onClick={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); if (!title.trim()) return; await onCreateGoal(title, target, period); setTitle(''); setAddingGoal(false); }}><div className="modal-handle" /><h2>Nova meta</h2><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: 1 hora de foco" /><div className="task-fields"><label>Meta<input type="number" min="1" value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label><label>Período<select value={period} onChange={(event) => setPeriod(event.target.value as 'daily' | 'weekly')}><option value="daily">Diária</option><option value="weekly">Semanal</option></select></label></div><button className="primary-button" type="submit">Criar meta</button></form></div>}<div className="settings-card"><button onClick={() => onOpen('Lembretes', 'Cadastre data e horário nas tarefas e permita notificações para receber os avisos enquanto o Cave estiver aberto.')}>◌ <span>Lembretes</span>›</button><button onClick={() => onOpen('Exportar dados', 'Suas tarefas, metas e registros de foco agora ficam sincronizados na sua conta.')}>⇩ <span>Dados sincronizados</span>›</button><button className="logout-button" onClick={onLogout}>↪ <span>Sair da conta</span>›</button></div></>;
}
