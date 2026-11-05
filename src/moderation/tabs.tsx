import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import { BadgeCheck, MapPin } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../shared/errors';
import { db } from '../shared/firebase';
import { Modal } from '../shared/Modal';
import type { Complaint, MapMarker, UserProfile } from '../shared/types';
import { LIMITS } from '../shared/validation';
import {
  banUser,
  removeMarkerAndResolve,
  setComplaintStatus,
  setMarkerStatus,
  setUserStatus,
  unbanUser,
} from './actions';
import { MiniMapDialog } from './MiniMap';
import { useQueue } from './useQueue';

const formatDate = (value: Timestamp | null | undefined) =>
  value
    ? value.toDate().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : 'нет даты';

/** Кнопки решения: блокируют себя на время запроса и показывают ошибку рядом. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

interface ReasonRequest {
  title: string;
  confirm: string;
  onConfirm: (reason: string) => Promise<unknown>;
}

function ReasonDialog({ request, onClose }: { request: ReasonRequest; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await request.onConfirm(reason.trim());
      onClose();
    });
  };

  return (
    <Modal title={request.title} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Причина (её увидит пользователь)</span>
          <textarea
            name="reason"
            value={reason}
            maxLength={LIMITS.reason.max}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-danger button-wide" disabled={busy}>
          {request.confirm}
        </button>
      </form>
    </Modal>
  );
}

function Filters<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="filters" role="group" aria-label="Статус">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="filter"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function QueueState({
  loading,
  error,
  empty,
  truncated,
  children,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  truncated: boolean;
  children: ReactNode;
}) {
  if (loading) return <p className="empty">Загрузка…</p>;
  if (error) return <p className="form-error">Не удалось загрузить список.</p>;
  if (empty) return <p className="empty">Здесь пока ничего нет.</p>;
  return (
    <>
      {truncated && <p className="form-note">Показаны первые записи. Обработайте их, чтобы увидеть остальные.</p>}
      <ul className="cards">{children}</ul>
    </>
  );
}

function Card({ children, actions, error }: { children: ReactNode; actions: ReactNode; error?: string }) {
  return (
    <li className="card">
      <div className="card-main">{children}</div>
      <div className="card-actions">{actions}</div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ---------- Аккаунты ----------

type UserRow = UserProfile & { id: string };

function AccountCard({ moderatorId, user }: { moderatorId: string; user: UserRow }) {
  const { busy, error, run } = useAction();
  const [reasonRequest, setReasonRequest] = useState<ReasonRequest | null>(null);
  const uid = user.id;

  const approve = () => run(() => setUserStatus(moderatorId, uid, 'approved'));

  return (
    <>
      <Card
        error={error}
        actions={
          <>
            {(user.status === 'pending' || user.status === 'rejected') && (
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void approve()}>
                Одобрить
              </button>
            )}
            {user.status === 'pending' && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  setReasonRequest({
                    title: `Отклонить ${user.username}`,
                    confirm: 'Отклонить',
                    onConfirm: (reason) => setUserStatus(moderatorId, uid, 'rejected', reason),
                  })
                }
              >
                Отклонить
              </button>
            )}
            {user.status === 'approved' && (
              <button
                type="button"
                className="button button-quiet-danger"
                disabled={busy}
                onClick={() =>
                  setReasonRequest({
                    title: `Заблокировать ${user.username}`,
                    confirm: 'Заблокировать',
                    onConfirm: (reason) => banUser(moderatorId, user, reason),
                  })
                }
              >
                Заблокировать
              </button>
            )}
            {user.status === 'banned' && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void run(() => unbanUser(moderatorId, user))}
              >
                Разблокировать
              </button>
            )}
          </>
        }
      >
        <h2 className="card-title">{user.username}</h2>
        <dl className="facts">
          <Fact label="ФИО">{user.fullName}</Fact>
          <Fact label="Почта">
            {user.email}{' '}
            {user.emailVerified ? (
              <BadgeCheck className="ok-icon" size={15} aria-label="подтверждена" />
            ) : (
              <span className="tag">не подтверждена</span>
            )}
          </Fact>
          <Fact label="Телефон">
            {user.phone} <BadgeCheck className="ok-icon" size={15} aria-label="подтверждён по SMS" />
          </Fact>
          <Fact label="Регистрация">{formatDate(user.createdAt)}</Fact>
          <Fact label="Согласия">версия {user.consents?.version ?? 'нет данных'}</Fact>
          {user.rejectReason && <Fact label="Причина">{user.rejectReason}</Fact>}
        </dl>
      </Card>
      {reasonRequest && <ReasonDialog request={reasonRequest} onClose={() => setReasonRequest(null)} />}
    </>
  );
}

export function AccountsTab({ moderatorId }: { moderatorId: string }) {
  const [status, setStatus] = useState<UserProfile['status']>('pending');
  const queue = useQueue<UserRow>('users', status);

  return (
    <>
      <Filters
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: 'Новые' },
          { value: 'approved', label: 'Одобренные' },
          { value: 'rejected', label: 'Отклонённые' },
          { value: 'banned', label: 'Заблокированные' },
        ]}
      />
      <QueueState {...queue} empty={queue.rows.length === 0}>
        {queue.rows.map((user) => (
          <AccountCard key={user.id} moderatorId={moderatorId} user={user} />
        ))}
      </QueueState>
    </>
  );
}

// ---------- Автор записи ----------

const authorCache = new Map<string, Promise<UserProfile | null>>();

function loadAuthor(uid: string): Promise<UserProfile | null> {
  let request = authorCache.get(uid);
  if (!request) {
    request = getDoc(doc(db, 'users', uid)).then((snapshot) =>
      snapshot.exists() ? (snapshot.data() as UserProfile) : null,
    );
    // Неудачный запрос не кэшируем, иначе автор не загрузится до перезагрузки страницы.
    request.catch(() => authorCache.delete(uid));
    authorCache.set(uid, request);
  }
  return request;
}

function Author({ uid }: { uid: string }) {
  const [text, setText] = useState('…');

  useEffect(() => {
    let current = true;
    loadAuthor(uid)
      .then((author) => {
        if (current) setText(author ? `${author.username} (${author.fullName})` : 'аккаунт удалён');
      })
      .catch(() => {
        if (current) setText('не удалось загрузить');
      });
    return () => {
      current = false;
    };
  }, [uid]);

  return <>{text}</>;
}

// ---------- Метки ----------

type MarkerRow = MapMarker;

function MarkerCard({ moderatorId, marker }: { moderatorId: string; marker: MarkerRow }) {
  const { busy, error, run } = useAction();
  const [reasonRequest, setReasonRequest] = useState<ReasonRequest | null>(null);
  const [showMap, setShowMap] = useState(false);

  return (
    <>
      <Card
        error={error}
        actions={
          <>
            <button type="button" className="button" onClick={() => setShowMap(true)}>
              <MapPin size={16} aria-hidden />
              На карте
            </button>
            {marker.status !== 'approved' && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void run(() => setMarkerStatus(moderatorId, marker.id, 'approved'))}
              >
                Одобрить
              </button>
            )}
            {marker.status === 'pending' && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  setReasonRequest({
                    title: 'Отклонить метку',
                    confirm: 'Отклонить',
                    onConfirm: (reason) => setMarkerStatus(moderatorId, marker.id, 'rejected', reason),
                  })
                }
              >
                Отклонить
              </button>
            )}
            {marker.status === 'approved' && (
              <button
                type="button"
                className="button button-quiet-danger"
                disabled={busy}
                onClick={() =>
                  setReasonRequest({
                    title: 'Снять метку с карты',
                    confirm: 'Снять с карты',
                    onConfirm: (reason) => setMarkerStatus(moderatorId, marker.id, 'removed', reason),
                  })
                }
              >
                Снять с карты
              </button>
            )}
          </>
        }
      >
        <h2 className="card-title">{marker.title}</h2>
        <p className="card-text">{marker.caption}</p>
        <dl className="facts">
          <Fact label="Автор">
            <Author uid={marker.ownerId} />
          </Fact>
          <Fact label="Создана">{formatDate(marker.createdAt)}</Fact>
          {marker.rejectReason && <Fact label="Причина">{marker.rejectReason}</Fact>}
        </dl>
      </Card>
      {reasonRequest && <ReasonDialog request={reasonRequest} onClose={() => setReasonRequest(null)} />}
      {showMap && <MiniMapDialog title={marker.title} point={marker} onClose={() => setShowMap(false)} />}
    </>
  );
}

export function MarkersTab({ moderatorId }: { moderatorId: string }) {
  const [status, setStatus] = useState<MapMarker['status']>('pending');
  const queue = useQueue<MarkerRow>('markers', status);

  return (
    <>
      <Filters
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: 'Новые' },
          { value: 'approved', label: 'Одобренные' },
          { value: 'rejected', label: 'Отклонённые' },
          { value: 'removed', label: 'Снятые' },
        ]}
      />
      <QueueState {...queue} empty={queue.rows.length === 0}>
        {queue.rows.map((marker) => (
          <MarkerCard key={marker.id} moderatorId={moderatorId} marker={marker} />
        ))}
      </QueueState>
    </>
  );
}

// ---------- Жалобы ----------

function ComplaintCard({
  moderatorId,
  complaint,
  openComplaints,
}: {
  moderatorId: string;
  complaint: Complaint;
  openComplaints: Complaint[];
}) {
  const { busy, error, run } = useAction();
  const [reasonRequest, setReasonRequest] = useState<ReasonRequest | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [marker, setMarker] = useState<MapMarker | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    getDoc(doc(db, 'markers', complaint.markerId))
      .then((snapshot) => {
        if (current) {
          setMarker(snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as MapMarker) : null);
        }
      })
      .catch(() => {
        if (current) setMarker(null);
      });
    return () => {
      current = false;
    };
  }, [complaint.markerId, complaint.status]);

  const isOpen = complaint.status === 'open';

  return (
    <>
      <Card
        error={error}
        actions={
          <>
            {marker && (
              <button type="button" className="button" onClick={() => setShowMap(true)}>
                <MapPin size={16} aria-hidden />
                На карте
              </button>
            )}
            {isOpen && (
              <>
                {marker && (
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={busy}
                    onClick={() =>
                      setReasonRequest({
                        title: 'Снять метку по жалобе',
                        confirm: 'Снять метку',
                        onConfirm: (reason) =>
                          removeMarkerAndResolve(moderatorId, complaint.markerId, openComplaints, reason),
                      })
                    }
                  >
                    Снять метку
                  </button>
                )}
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void run(() => setComplaintStatus(moderatorId, complaint.id, 'dismissed'))}
                >
                  Отклонить жалобу
                </button>
              </>
            )}
          </>
        }
      >
        <h2 className="card-title">
          {marker === undefined ? 'Загрузка…' : (marker?.title ?? 'Метка удалена автором')}
        </h2>
        {marker && <p className="card-text card-quote">{marker.caption}</p>}
        <p className="card-text">
          <strong>Жалоба:</strong> {complaint.text}
        </p>
        <dl className="facts">
          <Fact label="Автор жалобы">
            <Author uid={complaint.authorId} />
          </Fact>
          {marker && (
            <Fact label="Автор метки">
              <Author uid={marker.ownerId} />
            </Fact>
          )}
          <Fact label="Подана">{formatDate(complaint.createdAt)}</Fact>
        </dl>
      </Card>
      {reasonRequest && <ReasonDialog request={reasonRequest} onClose={() => setReasonRequest(null)} />}
      {showMap && marker && <MiniMapDialog title={marker.title} point={marker} onClose={() => setShowMap(false)} />}
    </>
  );
}

export function ComplaintsTab({
  moderatorId,
  openComplaints,
}: {
  moderatorId: string;
  openComplaints: Complaint[];
}) {
  const [status, setStatus] = useState<Complaint['status']>('open');
  const queue = useQueue<Complaint>('complaints', status);

  return (
    <>
      <Filters
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: 'Новые' },
          { value: 'resolved', label: 'Метка снята' },
          { value: 'dismissed', label: 'Отклонённые' },
        ]}
      />
      <QueueState {...queue} empty={queue.rows.length === 0}>
        {queue.rows.map((complaint) => (
          <ComplaintCard
            key={complaint.id}
            moderatorId={moderatorId}
            complaint={complaint}
            openComplaints={openComplaints}
          />
        ))}
      </QueueState>
    </>
  );
}
