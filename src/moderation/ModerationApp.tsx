import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../shared/errors';
import { auth, backendReady, db } from '../shared/firebase';
import type { Complaint, MapMarker, UserProfile } from '../shared/types';
import { AccountsTab, ComplaintsTab, MarkersTab } from './tabs';
import { useQueue } from './useQueue';

type Gate =
  | { phase: 'loading' }
  | { phase: 'signed-out' }
  | { phase: 'denied'; user: User }
  | { phase: 'allowed'; user: User };

/** Доступ решает база: запись в коллекции moderators, которую можно создать только в консоли. */
async function isModerator(uid: string): Promise<boolean> {
  try {
    return (await getDoc(doc(db, 'moderators', uid))).exists();
  } catch (error) {
    console.error(error);
    return false;
  }
}

function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <main className="gate">
      <ShieldCheck size={36} aria-hidden />
      <h1>Модерация</h1>
      <p>Закрытый раздел. Вход только для модераторов.</p>
      <button type="button" className="button button-primary button-wide" disabled={busy} onClick={() => void signIn()}>
        Войти через Google
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function Denied({ user }: { user: User }) {
  return (
    <main className="gate">
      <h1>Нет доступа</h1>
      <p>Этот аккаунт не назначен модератором. Чтобы назначить его, передайте администратору код:</p>
      <code className="uid">{user.uid}</code>
      <button type="button" className="button button-wide" onClick={() => void signOut(auth)}>
        Выйти
      </button>
    </main>
  );
}

type Tab = 'accounts' | 'markers' | 'complaints';

function Dashboard({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('accounts');
  const pendingAccounts = useQueue<UserProfile>('users', 'pending');
  const pendingMarkers = useQueue<MapMarker>('markers', 'pending');
  const openComplaints = useQueue<Complaint>('complaints', 'open');

  const count = (queue: { rows: unknown[]; truncated: boolean }) =>
    queue.truncated ? `${queue.rows.length}+` : String(queue.rows.length);

  const tabs: { id: Tab; label: string; badge: string }[] = [
    { id: 'accounts', label: 'Аккаунты', badge: count(pendingAccounts) },
    { id: 'markers', label: 'Метки', badge: count(pendingMarkers) },
    { id: 'complaints', label: 'Жалобы', badge: count(openComplaints) },
  ];

  return (
    <div className="dashboard">
      <header className="top">
        <h1>Модерация</h1>
        <nav className="tabs" role="tablist" aria-label="Разделы">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className="tab"
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.badge !== '0' && <span className="badge">{item.badge}</span>}
            </button>
          ))}
        </nav>
        <button type="button" className="button button-small" onClick={() => void signOut(auth)}>
          <LogOut size={16} aria-hidden />
          Выйти
        </button>
      </header>
      <main className="content">
        {tab === 'accounts' && <AccountsTab moderatorId={user.uid} />}
        {tab === 'markers' && <MarkersTab moderatorId={user.uid} />}
        {tab === 'complaints' && <ComplaintsTab moderatorId={user.uid} openComplaints={openComplaints.rows} />}
      </main>
    </div>
  );
}

export function ModerationApp() {
  const [gate, setGate] = useState<Gate>({ phase: 'loading' });

  useEffect(() => {
    if (!backendReady) return undefined;
    let current = true;
    const stop = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setGate({ phase: 'signed-out' });
        return;
      }
      setGate({ phase: 'loading' });
      void isModerator(user.uid).then((allowed) => {
        if (current && auth.currentUser?.uid === user.uid) {
          setGate(allowed ? { phase: 'allowed', user } : { phase: 'denied', user });
        }
      });
    });
    return () => {
      current = false;
      stop();
    };
  }, []);

  if (!backendReady) {
    return (
      <main className="gate">
        <h1>Сервер не настроен</h1>
        <p>Добавьте настройки Firebase по инструкции в README.</p>
      </main>
    );
  }
  if (gate.phase === 'loading') return <p className="gate">Загрузка…</p>;
  if (gate.phase === 'signed-out') return <SignIn />;
  if (gate.phase === 'denied') return <Denied user={gate.user} />;
  return <Dashboard user={gate.user} />;
}
