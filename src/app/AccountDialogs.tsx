import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { BadgeCheck, LogOut, Phone, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../shared/errors';
import { auth } from '../shared/firebase';
import { DATA_PROCESSING_CONSENT, PRIVACY_POLICY, type LegalDocument } from '../shared/legal';
import { Modal } from '../shared/Modal';
import { SITE } from '../shared/site-config';
import type { MapMarker, UserProfile } from '../shared/types';
import { validateEmail, validateFullName, validateUsername } from '../shared/validation';
import { createProfile, deleteAccount, deleteOwnMarker } from './api';
import { PhoneVerifier } from './PhoneVerifier';

const logOut = () => void signOut(auth);

function LegalDialog({ document: legal, onClose }: { document: LegalDocument; onClose: () => void }) {
  return (
    <Modal title={legal.title} onClose={onClose} wide>
      <div className="legal">
        {legal.sections.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function LoginDialog({ onClose }: { onClose: () => void }) {
  const [usePhone, setUsePhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const google = async () => {
    setBusy(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // Окно, а не перенаправление: на github.io перенаправление не работает
      // в браузерах, которые блокируют сторонние данные (Safari, Firefox).
      await signInWithPopup(auth, provider);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Modal title="Вход" onClose={onClose}>
      <div className="form">
        <p className="field-hint">
          Новый аккаунт создаётся автоматически при первом входе и открывается после проверки
          модератором.
        </p>
        <button type="button" className="button button-wide" disabled={busy} onClick={() => void google()}>
          <GoogleMark />
          Войти через Google
        </button>
        {usePhone ? (
          <PhoneVerifier label="Номер телефона" onVerified={onClose} />
        ) : (
          <button type="button" className="button button-wide" onClick={() => setUsePhone(true)}>
            <Phone size={18} aria-hidden />
            Войти по номеру телефона
          </button>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.9 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.9c-.6 3-2.3 5.5-4.8 7.2l7.7 6C44.3 38 46.9 31.8 46.9 24.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

export function RegisterDialog({ user }: { user: User }) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState(user.displayName ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [phoneVerified, setPhoneVerified] = useState(Boolean(user.phoneNumber));
  const [acceptedData, setAcceptedData] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [legal, setLegal] = useState<LegalDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem =
      validateUsername(username) ??
      validateFullName(fullName) ??
      validateEmail(email.trim()) ??
      (phoneVerified ? null : 'Подтвердите номер телефона кодом из SMS.') ??
      (acceptedData && acceptedPrivacy ? null : 'Для регистрации нужно принять оба документа.');
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createProfile(user, { username, fullName, email });
      // Окно закроется само: подписка на профиль увидит новый документ.
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Modal title="Регистрация">
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="field">
          <span>Имя пользователя</span>
          <input
            name="username"
            autoComplete="username"
            value={username}
            maxLength={24}
            onChange={(event) => setUsername(event.target.value)}
          />
          <small className="field-hint">Латинские буквы, цифры, точка и подчёркивание</small>
        </label>
        <label className="field">
          <span>ФИО</span>
          <input
            name="fullName"
            autoComplete="name"
            value={fullName}
            maxLength={100}
            onChange={(event) => setFullName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Почта</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            readOnly={Boolean(user.email)}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {phoneVerified ? (
          <div className="field">
            <span>Телефон</span>
            <p className="verified">
              <BadgeCheck size={18} aria-hidden />
              {user.phoneNumber ?? 'Номер'} подтверждён
            </p>
          </div>
        ) : (
          <PhoneVerifier
            linkTo={user}
            label="Телефон"
            onVerified={async () => {
              await user.reload();
              setPhoneVerified(true);
            }}
          />
        )}

        <label className="check">
          <input
            type="checkbox"
            name="consent-data"
            checked={acceptedData}
            onChange={(event) => setAcceptedData(event.target.checked)}
          />
          <span>
            Я даю{' '}
            <button type="button" className="link-button" onClick={() => setLegal(DATA_PROCESSING_CONSENT)}>
              согласие на обработку персональных данных
            </button>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="consent-privacy"
            checked={acceptedPrivacy}
            onChange={(event) => setAcceptedPrivacy(event.target.checked)}
          />
          <span>
            Я принимаю{' '}
            <button type="button" className="link-button" onClick={() => setLegal(PRIVACY_POLICY)}>
              правила конфиденциальности
            </button>
          </span>
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button button-primary button-wide" disabled={busy}>
          Отправить на проверку
        </button>
        <button type="button" className="link-button link-centered" onClick={logOut}>
          Отменить и выйти
        </button>
      </form>
      {legal && <LegalDialog document={legal} onClose={() => setLegal(null)} />}
    </Modal>
  );
}

const MARKER_STATUS: Record<MapMarker['status'], string> = {
  pending: 'На проверке',
  approved: 'Опубликована',
  rejected: 'Отклонена',
  removed: 'Снята модератором',
};

function DeleteAccountButton({ user, profile }: { user: User; profile: UserProfile }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await deleteAccount(user, profile);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      {confirming ? (
        <div className="confirm-box">
          <p>Профиль и все ваши метки будут удалены без возможности восстановления.</p>
          <div className="field-row">
            <button type="button" className="button" disabled={busy} onClick={() => setConfirming(false)}>
              Отмена
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Удалить навсегда
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button button-wide button-quiet-danger"
          onClick={() => setConfirming(true)}
        >
          <Trash2 size={18} aria-hidden />
          Удалить аккаунт
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

interface AccountDialogProps {
  user: User;
  profile: UserProfile;
  markers: MapMarker[];
  onClose: () => void;
  onShowMarker: (marker: MapMarker) => void;
  onToast: (message: string) => void;
}

export function AccountDialog({ user, profile, markers, onClose, onShowMarker, onToast }: AccountDialogProps) {
  const [deleting, setDeleting] = useState<string | null>(null);

  const removeMarker = async (marker: MapMarker) => {
    setDeleting(marker.id);
    try {
      await deleteOwnMarker(marker);
      onToast('Метка удалена');
    } catch (caught) {
      onToast(errorMessage(caught));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Modal title={profile.username} onClose={onClose}>
      <div className="form">
        <dl className="profile-list">
          <dt>ФИО</dt>
          <dd>{profile.fullName}</dd>
          <dt>Почта</dt>
          <dd>{profile.email}</dd>
          <dt>Телефон</dt>
          <dd>{profile.phone}</dd>
        </dl>

        <section>
          <h3 className="section-title">Мои метки</h3>
          {markers.length === 0 ? (
            <p className="field-hint">Вы ещё не ставили меток.</p>
          ) : (
            <ul className="my-markers">
              {markers.map((marker) => (
                <li key={marker.id}>
                  <button type="button" className="my-marker-main" onClick={() => onShowMarker(marker)}>
                    <strong>{marker.title}</strong>
                    <small className={`status status-${marker.status}`}>
                      {MARKER_STATUS[marker.status]}
                      {marker.rejectReason ? `: ${marker.rejectReason}` : ''}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Удалить метку ${marker.title}`}
                    disabled={deleting === marker.id}
                    onClick={() => void removeMarker(marker)}
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button type="button" className="button button-wide" onClick={logOut}>
          <LogOut size={18} aria-hidden />
          Выйти
        </button>
        <DeleteAccountButton user={user} profile={profile} />
      </div>
    </Modal>
  );
}

export function StatusGate({ user, profile }: { user: User; profile: UserProfile }) {
  const title = {
    pending: 'Аккаунт на проверке',
    rejected: 'Заявка отклонена',
    banned: 'Аккаунт заблокирован',
    approved: '',
  }[profile.status];

  return (
    <Modal title={title}>
      <div className="form">
        {profile.status === 'pending' && (
          <p>
            Модератор проверит ваши данные. Сразу после одобрения приложение откроется само,
            обновлять страницу не нужно.
          </p>
        )}
        {profile.status !== 'pending' && (
          <>
            {profile.rejectReason && (
              <p className="form-note">
                <strong>Причина:</strong> {profile.rejectReason}
              </p>
            )}
            <p>Вопросы можно задать по адресу {SITE.contactEmail}.</p>
          </>
        )}
        <button type="button" className="button button-wide" onClick={logOut}>
          <LogOut size={18} aria-hidden />
          Выйти
        </button>
        {profile.status !== 'banned' && <DeleteAccountButton user={user} profile={profile} />}
      </div>
    </Modal>
  );
}
