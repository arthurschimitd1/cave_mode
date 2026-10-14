'use client';

import { useEffect, useMemo, useState } from 'react';

type Task = { id: number; title: string; meta: string; color: string; done: boolean };
type Tab = 'today' | 'plan' | 'focus' | 'community' | 'profile';
type Panel = { title: string; body: string } | null;
type Account = { name: string; email: string; phone: string; pinHash: string };
type AuthScreen = 'choice' | 'register-details' | 'register-pin' | 'login-email' | 'login-pin';

const initialTasks: Task[] = [];

const navItems: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Hoje', icon: '⌂' },
  { id: 'plan', label: 'Planejar', icon: '▤' },
  { id: 'focus', label: 'Foco', icon: '◷' },
  { id: 'community', label: 'Comunidade', icon: '♧' },
  { id: 'profile', label: 'Perfil', icon: '◉' },
];

const soundOptions = [
  { icon: '☁', name: 'Chuva leve', description: 'Relaxante' },
  { icon: '⌁', name: 'Ruído branco', description: 'Constante' },
  { icon: '♨', name: 'Café', description: 'Ambiente' },
];

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

async function hashPin(pin: string) {
  const bytes = new TextEncoder().encode(`cave:${pin}`);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [tasks, setTasks] = useState(initialTasks);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [focusSeconds, setFocusSeconds] = useState(0);
  const [completedSessions, setCompletedSessions] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState('');
  const completed = tasks.filter((task) => task.done).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const saved = window.localStorage.getItem('cave-progress-v1');
    const savedAccounts = window.localStorage.getItem('cave-accounts-v1');
    if (saved) {
      try {
        const data = JSON.parse(saved) as { tasks?: Task[]; focusSeconds?: number; completedSessions?: number };
        setTasks(data.tasks ?? []);
        setFocusSeconds(data.focusSeconds ?? 0);
        setCompletedSessions(data.completedSessions ?? 0);
      } catch {
        window.localStorage.removeItem('cave-progress-v1');
      }
    }
    if (savedAccounts) {
      try {
        const registeredAccounts = JSON.parse(savedAccounts) as Account[];
        const sessionEmail = window.localStorage.getItem('cave-session-email-v1');
        const currentAccount = registeredAccounts.find((item) => item.email === sessionEmail) ?? null;
        setAccounts(registeredAccounts);
        setAccount(currentAccount);
        setAuthenticated(Boolean(currentAccount));
      } catch {
        window.localStorage.removeItem('cave-accounts-v1');
        window.localStorage.removeItem('cave-session-email-v1');
      }
    }
    setIsHydrated(true);
    setAuthLoading(false);
  }, []);

  useEffect(() => {
    if (isHydrated) window.localStorage.setItem('cave-progress-v1', JSON.stringify({ tasks, focusSeconds, completedSessions }));
  }, [tasks, focusSeconds, completedSessions, isHydrated]);

  useEffect(() => {
    if (!timerRunning) return;
    const timer = window.setInterval(() => {
      setTimerSeconds((current) => {
        setFocusSeconds((total) => total + 1);
        if (current <= 1) {
          setTimerRunning(false);
          setCompletedSessions((total) => total + 1);
          setToast('Sessão concluída. Excelente presença!');
          return 25 * 60;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const dateLabel = useMemo(() => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    .format(new Date()).replace(/^./, (letter) => letter.toUpperCase()), []);

  const notify = (message: string) => setToast(message);
  const openPanel = (title: string, body: string) => setPanel({ title, body });

  function toggleTask(id: number) {
    const task = tasks.find((item) => item.id === id);
    setTasks((current) => current.map((item) => item.id === id ? { ...item, done: !item.done } : item));
    if (task) notify(task.done ? 'Tarefa reaberta.' : 'Tarefa concluída. Bom ritmo!');
  }

  function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!newTask.trim()) return;
    setTasks((current) => [...current, { id: Date.now(), title: newTask.trim(), meta: 'Sem horário definido', color: 'sky', done: false }]);
    setNewTask('');
    setShowAddTask(false);
    notify('Tarefa adicionada à sua rotina.');
  }

  function finishAuthentication(nextAccount: Account) {
    setAccounts((current) => {
      const nextAccounts = [...current.filter((item) => item.email !== nextAccount.email), nextAccount];
      window.localStorage.setItem('cave-accounts-v1', JSON.stringify(nextAccounts));
      return nextAccounts;
    });
    window.localStorage.setItem('cave-session-email-v1', nextAccount.email);
    setAccount(nextAccount);
    setAuthenticated(true);
  }

  function logout() {
    setTimerRunning(false);
    window.localStorage.removeItem('cave-session-email-v1');
    setAuthenticated(false);
    setActiveTab('today');
  }

  if (authLoading) return <main className="auth-shell"><div className="auth-loading">cave</div></main>;
  if (!authenticated) return <AuthFlow accounts={accounts} onAuthenticated={finishAuthentication} />;

  return (
    <main className="app-shell">
      <div className="grain" />
      <header className="topbar">
        <button className="brand brand-button" onClick={() => setActiveTab('today')} aria-label="Ir para Hoje"><img className="brand-mark" src="/cave-logo.jpeg" alt="" /><span>cave</span></button>
        <button className="icon-button" aria-label="Notificações" onClick={() => { const next = tasks.find((task) => !task.done); openPanel('Notificações', next ? `Próxima tarefa: ${next.title}.` : 'Não há tarefas pendentes.'); }}>♢<span className="notification-dot" /></button>
      </header>

      <div className="page-content">
        {activeTab === 'today' && <TodayView dateLabel={dateLabel} tasks={tasks} completed={completed} progress={progress} focusSeconds={focusSeconds} onToggle={toggleTask} onAdd={() => setShowAddTask(true)} onFocus={() => setActiveTab('focus')} />}
        {activeTab === 'plan' && <PlanView tasks={tasks} onAdd={() => setShowAddTask(true)} onOpenTask={(task) => openPanel(task.title, `${task.meta}. Você pode concluir esta tarefa pela tela Hoje.`)} />}
        {activeTab === 'focus' && <FocusView timerSeconds={timerSeconds} focusSeconds={focusSeconds} completedSessions={completedSessions} running={timerRunning} setRunning={setTimerRunning} reset={() => { setTimerRunning(false); setTimerSeconds(25 * 60); notify('Cronômetro reiniciado.'); }} notify={notify} />}
        {activeTab === 'community' && <CommunityView notify={notify} onOpen={openPanel} />}
        {activeTab === 'profile' && account && <ProfileView account={account} completed={completed} focusSeconds={focusSeconds} completedSessions={completedSessions} onOpen={openPanel} onLogout={logout} />}
      </div>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {navItems.map((item) => <button key={item.id} className={`nav-item ${activeTab === item.id ? 'active' : ''}`} onClick={() => setActiveTab(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}
      </nav>

      {showAddTask && <div className="modal-backdrop" onClick={() => setShowAddTask(false)}><form className="add-modal" onSubmit={addTask} onClick={(event) => event.stopPropagation()}><div className="modal-handle" /><h2>Nova tarefa</h2><p>Um passo pequeno já muda o ritmo do seu dia.</p><input autoFocus value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="O que você quer realizar?" aria-label="Nova tarefa" /><button className="primary-button" type="submit">Adicionar à rotina</button><button className="modal-cancel" type="button" onClick={() => setShowAddTask(false)}>Cancelar</button></form></div>}
      {panel && <InfoPanel panel={panel} onClose={() => setPanel(null)} />}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}

function InfoPanel({ panel, onClose }: { panel: NonNullable<Panel>; onClose: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}><section className="add-modal info-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="panel-title"><div className="modal-handle" /><h2 id="panel-title">{panel.title}</h2><p>{panel.body}</p><button className="primary-button" onClick={onClose}>Entendi</button></section></div>;
}

function AuthFlow({ accounts, onAuthenticated }: { accounts: Account[]; onAuthenticated: (account: Account) => void }) {
  const [screen, setScreen] = useState<AuthScreen>('choice');
  const [details, setDetails] = useState({ name: '', email: '', phone: '' });
  const [email, setEmail] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  function show(nextScreen: AuthScreen) {
    setError('');
    setPin('');
    setScreen(nextScreen);
  }

  function continueRegistration(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeEmail(details.email);
    if (accounts.some((item) => item.email === normalized)) {
      setError('Este e-mail já está cadastrado neste dispositivo. Use Entrar.');
      return;
    }
    setDetails((current) => ({ ...current, email: normalized }));
    show('register-pin');
  }

  function continueLogin(event: React.FormEvent) {
    event.preventDefault();
    const found = accounts.find((item) => item.email === normalizeEmail(email));
    if (!found) {
      setError('Não encontramos este e-mail neste dispositivo.');
      return;
    }
    setSelectedAccount(found);
    show('login-pin');
  }

  async function register() {
    if (pin.length !== 4) return setError('Digite os quatro números do seu PIN.');
    const pinHash = await hashPin(pin);
    onAuthenticated({ ...details, email: normalizeEmail(details.email), pinHash });
  }

  async function login() {
    if (!selectedAccount || pin.length !== 4) return setError('Digite os quatro números do seu PIN.');
    if (await hashPin(pin) !== selectedAccount.pinHash) {
      setError('PIN incorreto. Tente novamente.');
      setPin('');
      return;
    }
    onAuthenticated(selectedAccount);
  }

  if (screen === 'choice') return <main className="auth-shell"><AuthBrand /><section className="auth-card choice-card"><span className="eyebrow">Seu espaço, no seu ritmo</span><h1>Bem-vindo à Cave.</h1><p>Organize o que importa e avance uma tarefa de cada vez.</p><button className="primary-button auth-action" onClick={() => show('login-email')}>Entrar</button><button className="secondary-button auth-action" onClick={() => show('register-details')}>Cadastrar</button></section></main>;

  if (screen === 'register-details') return <main className="auth-shell"><AuthBrand /><form className="auth-card" onSubmit={continueRegistration}><span className="eyebrow">Criar conta</span><h1>Seu espaço começa aqui.</h1><p>Use seus dados para reconhecer sua conta neste aparelho.</p><label>Nome<input autoFocus required value={details.name} onChange={(event) => setDetails({ ...details, name: event.target.value })} placeholder="Como quer ser chamado?" /></label><label>E-mail<input required type="email" value={details.email} onChange={(event) => setDetails({ ...details, email: event.target.value })} placeholder="voce@email.com" /></label><label>Celular<input required type="tel" inputMode="tel" value={details.phone} onChange={(event) => setDetails({ ...details, phone: event.target.value })} placeholder="(00) 00000-0000" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-action" type="submit">Continuar</button><button className="auth-back" type="button" onClick={() => show('choice')}>Voltar</button></form></main>;

  if (screen === 'login-email') return <main className="auth-shell"><AuthBrand /><form className="auth-card" onSubmit={continueLogin}><span className="eyebrow">Entrar</span><h1>Qual é seu e-mail?</h1><p>Vamos localizar sua conta salva neste aparelho.</p><label>E-mail<input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-action" type="submit">Continuar</button><button className="auth-back" type="button" onClick={() => show('choice')}>Voltar</button></form></main>;

  const isRegistration = screen === 'register-pin';
  return <main className="auth-shell"><AuthBrand /><section className="auth-card pin-card"><span className="eyebrow">{isRegistration ? 'Proteja seu acesso' : 'Olá de novo'}</span><h1>{isRegistration ? 'Crie seu PIN.' : `Oi, ${selectedAccount?.name.split(' ')[0] ?? ''}.`}</h1><p>{isRegistration ? 'Escolha quatro números para abrir a Cave.' : 'Digite seu PIN para continuar.'}</p><PinKeypad pin={pin} onChange={setPin} /><div className="pin-status" aria-live="polite">{pin.length}/4 números</div>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-action" disabled={pin.length !== 4} onClick={isRegistration ? register : login}>{isRegistration ? 'Criar acesso' : 'Entrar na Cave'}</button><button className="auth-back" type="button" onClick={() => show(isRegistration ? 'register-details' : 'login-email')}>Voltar</button></section></main>;
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
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div>{action}</div>;
}

function TodayView({ dateLabel, tasks, completed, progress, focusSeconds, onToggle, onAdd, onFocus }: { dateLabel: string; tasks: Task[]; completed: number; progress: number; focusSeconds: number; onToggle: (id: number) => void; onAdd: () => void; onFocus: () => void }) {
  return <>
    <section className="hero-section"><div className="eyebrow">{dateLabel}</div><h1>Seu progresso<br /><em>começa hoje.</em></h1><p>Uma tarefa de cada vez.</p><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-spark">✦</div></section>
    <section className="stat-grid"><div className="stat-card"><span className="stat-label">Tarefas concluídas</span><strong>{completed}<small>/{tasks.length}</small></strong><div className="mini-progress"><i style={{ width: `${progress}%` }} /></div><span className="stat-foot">Progresso de hoje</span></div><div className="stat-card accent-card"><span className="stat-label">Foco registrado</span><strong>{formatDuration(focusSeconds)}</strong><span className="stat-foot">Registrado nesta sessão</span></div></section>
    <section className="section-block"><div className="section-title"><div><span className="eyebrow">Acompanhe o ritmo</span><h2>Sua rotina</h2></div><button className="text-button" onClick={onAdd}>+ Adicionar</button></div><div className="routine-card"><div className="routine-top"><span>Hoje</span><strong>{progress}% concluído</strong></div><div className="large-progress"><i style={{ width: `${progress}%` }} /></div><div className="task-list">{tasks.length ? tasks.map((task) => <button className={`task-row ${task.done ? 'is-done' : ''}`} key={task.id} onClick={() => onToggle(task.id)} aria-pressed={task.done}><span className={`task-check ${task.done ? 'checked' : ''}`}>{task.done ? '✓' : ''}</span><span className="task-copy"><strong>{task.title}</strong><small>{task.meta}</small></span><span className={`task-color ${task.color}`} /></button>) : <p className="empty-state">Adicione sua primeira tarefa para começar.</p>}</div></div></section>
    <section className="focus-banner"><div className="focus-symbol">◷</div><div><span className="eyebrow">Espaço de foco</span><h2>Reserve um tempo para você.</h2><p>25 minutos de presença podem mudar o seu dia.</p></div><button className="round-arrow" onClick={onFocus} aria-label="Abrir central de foco">↗</button></section>
    <section className="quote-card"><span>“</span><p>Consistência não é fazer tudo. É voltar para o que importa.</p><small>— Seu Cave de hoje</small></section>
  </>;
}

function LegacyPlanView({ tasks, onAdd, onOpenTask }: { tasks: Task[]; onAdd: () => void; onOpenTask: (task: Task) => void }) {
  const [selectedDay, setSelectedDay] = useState(2);
  const days = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];
  return <><PageHeading eyebrow="Planejar" title="Dê forma ao seu dia" action={<button className="round-add" onClick={onAdd} aria-label="Adicionar tarefa">+</button>} /><div className="week-strip">{days.map((day, index) => <button className={index === selectedDay ? 'today' : ''} key={day} onClick={() => setSelectedDay(index)} aria-pressed={index === selectedDay}><span>{day}</span><strong>{12 + index}</strong></button>)}</div><section className="section-block"><div className="section-title"><div><span className="eyebrow">{days[selectedDay]}, {12 + selectedDay} out</span><h2>Agenda do dia</h2></div><span className="soft-pill">{tasks.length} itens</span></div><div className="schedule-card">{tasks.map((task, index) => <button className="schedule-row" key={task.id} onClick={() => onOpenTask(task)}><span className="schedule-time">{['08:00', '10:30', '15:00', '18:30'][index] || '20:00'}</span><span className={`schedule-line ${task.color}`} /><span><strong>{task.title}</strong><small>{task.meta}</small></span><span className="more">···</span></button>)}</div></section><div className="tip-card"><span className="tip-icon">✦</span><div><strong>Planeje com espaço</strong><p>Deixe 20% do seu dia livre para o inesperado.</p></div></div></>;
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
  return <><PageHeading eyebrow="Planejar" title="Dê forma ao seu dia" action={<button className="round-add" onClick={onAdd} aria-label="Adicionar tarefa">+</button>} /><div className="week-strip">{dates.map((date, index) => <button className={index === selectedDay ? 'today' : ''} key={date.toDateString()} onClick={() => setSelectedDay(index)} aria-pressed={index === selectedDay}><span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '').toUpperCase()}</span><strong>{date.getDate()}</strong></button>)}</div><section className="section-block"><div className="section-title"><div><span className="eyebrow">{dayLabel}</span><h2>Agenda do dia</h2></div><span className="soft-pill">{tasks.length} itens</span></div><div className="schedule-card">{tasks.length ? tasks.map((task) => <button className="schedule-row" key={task.id} onClick={() => onOpenTask(task)}><span className="schedule-time">—</span><span className={`schedule-line ${task.color}`} /><span><strong>{task.title}</strong><small>{task.meta}</small></span><span className="more">···</span></button>) : <p className="empty-state">Nenhuma tarefa para este dia.</p>}</div></section></>;
}

function FocusView({ timerSeconds, focusSeconds, completedSessions, running, setRunning, reset, notify }: { timerSeconds: number; focusSeconds: number; completedSessions: number; running: boolean; setRunning: (value: boolean) => void; reset: () => void; notify: (message: string) => void }) {
  const [selectedSound, setSelectedSound] = useState('Chuva leve');
  const percent = ((25 * 60 - timerSeconds) / (25 * 60)) * 100;
  return <><PageHeading eyebrow="Central de foco" title="Presença no agora" action={<span className="soft-pill">Sessões: {completedSessions}</span>} /><section className="timer-card"><div className="timer-ring" style={{ '--progress': `${percent * 3.6}deg` } as React.CSSProperties}><div className="timer-inner"><span>{running ? 'Em foco' : 'Pronto para começar'}</span><strong>{formatTime(timerSeconds)}</strong><small>sessão de foco</small></div></div><div className="timer-controls"><button className="secondary-button" onClick={reset}>Reiniciar</button><button className="primary-button timer-start" onClick={() => { setRunning(!running); notify(running ? 'Sessão pausada.' : 'Sessão de foco iniciada.'); }}>{running ? 'Pausar' : 'Começar sessão'}</button></div></section><div className="focus-options"><div><span>Duração</span><strong>25 min</strong></div><div><span>Foco registrado</span><strong>{formatDuration(focusSeconds)}</strong></div><div><span>Sessões concluídas</span><strong>{completedSessions}</strong></div></div><section className="section-block"><div className="section-title"><div><span className="eyebrow">Escolha seu ambiente</span><h2>Som para acompanhar</h2></div></div><div className="sound-grid">{soundOptions.map((sound) => <button key={sound.name} className={`sound-card ${selectedSound === sound.name ? 'selected' : ''}`} onClick={() => { setSelectedSound(sound.name); notify(`${sound.name} selecionado.`); }} aria-pressed={selectedSound === sound.name}>{sound.icon}<span>{sound.name}</span><small>{sound.description}</small></button>)}</div></section></>;
}

function CommunityView({ notify, onOpen }: { notify: (message: string) => void; onOpen: (title: string, body: string) => void }) {
  const [communityTab, setCommunityTab] = useState('Para você');
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const posts: { id: string; initial: string; avatar: string; author: string; detail: string; text: string; likes: number; comments: number }[] = [];
  return <><PageHeading eyebrow="Comunidade" title="Crescer junto é melhor" action={<button className="icon-button" aria-label="Pesquisar comunidade" onClick={() => onOpen('Pesquisar comunidade', 'A busca por pessoas e comunidades ficará disponível quando o cadastro de usuários estiver conectado ao banco de dados.')}>⌕</button>} /><div className="community-tabs">{['Para você', 'Seguindo', 'Desafios'].map((tab) => <button key={tab} className={communityTab === tab ? 'selected' : ''} onClick={() => { setCommunityTab(tab); notify(`Exibindo: ${tab}.`); }} aria-pressed={communityTab === tab}>{tab}</button>)}</div>{posts.map((post) => <div className="feed-card" key={post.id}><div className="post-author"><div className={`avatar ${post.avatar}`}>{post.initial}</div><div><strong>{post.author}</strong><small>{post.detail}</small></div><span className="more">···</span></div><p>{post.text}</p>{post.id === 'marina' ? <div className="post-progress"><div><span>Desafio 7 dias de foco</span><strong>5/7</strong></div><div className="large-progress"><i style={{ width: '71%' }} /></div></div> : <div className="achievement-chip">✦ <span>30 dias em movimento</span></div>}<div className="post-actions"><button onClick={() => { setLiked((current) => ({ ...current, [post.id]: !current[post.id] })); notify(liked[post.id] ? 'Curtida removida.' : 'Publicação curtida.'); }}>{liked[post.id] ? '♥' : '♡'} {post.likes + (liked[post.id] ? 1 : 0)}</button><button onClick={() => onOpen('Comentários', `${post.comments} comentários nesta publicação. A caixa de comentários será conectada quando a comunidade tiver autenticação.`)}>◌ {post.comments} comentários</button><button onClick={() => notify('Link da publicação copiado para compartilhar.')}>↗ Compartilhar</button></div></div>)}</>;
}

function ProfileView({ account, completed, focusSeconds, completedSessions, onOpen, onLogout }: { account: Account; completed: number; focusSeconds: number; completedSessions: number; onOpen: (title: string, body: string) => void; onLogout: () => void }) {
  return <><section className="profile-head"><div className="profile-avatar">{account.name.charAt(0).toUpperCase()}</div><div><span className="eyebrow">Seu espaço</span><h1>{account.name}</h1><p>{account.email}</p></div><button className="icon-button" aria-label="Configurações" onClick={() => onOpen('Configurações', 'Preferências e exportação estarão disponíveis quando uma conta for conectada.')}>⚙</button></section><div className="profile-stats"><div><strong>{completed}</strong><span>tarefas concluídas</span></div><div><strong>{formatDuration(focusSeconds)}</strong><span>foco registrado</span></div><div><strong>{completedSessions}</strong><span>sessões concluídas</span></div></div><section className="section-block"><div className="section-title"><div><span className="eyebrow">Sua evolução</span><h2>Conquistas</h2></div></div><div className="achievement-list"><p className="empty-state">Suas conquistas aparecerão conforme você concluir sessões e tarefas.</p></div></section><div className="settings-card"><button onClick={() => onOpen('Preferências', 'As preferências serão salvas quando você criar uma conta.')}>◌ <span>Preferências</span>›</button><button onClick={() => onOpen('Exportar dados', 'A exportação será disponibilizada quando houver sincronização de dados.')}>⇩ <span>Exportar meus dados</span>›</button><button className="logout-button" onClick={onLogout}>↪ <span>Sair da conta</span>›</button></div></>;
}
