import type { ConfirmationResult, User } from 'firebase/auth';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../shared/errors';
import { normalizePhone } from '../shared/validation';
import { sendSmsCode } from './phone-auth';

interface PhoneVerifierProps {
  /** Вошедший через Google пользователь, к которому привязывается номер. */
  linkTo?: User;
  label: string;
  onVerified: () => void | Promise<void>;
}

const RESEND_SECONDS = 60;

export function PhoneVerifier({ linkTo, label, onVerified }: PhoneVerifierProps) {
  const [phone, setPhone] = useState('+48 ');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError('Проверьте номер: например, +48 500 100 200.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setConfirmation(await sendSmsCode(normalized, linkTo));
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!confirmation) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Код состоит из 6 цифр.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await confirmation.confirm(code);
      await onVerified();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  // Компонент стоит и внутри формы регистрации: Enter не должен отправлять всю форму.
  const onEnter = (action: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      action();
    }
  };

  return (
    <div className="form">
      <label className="field">
        <span>{label}</span>
        <div className="field-row">
          <input
            type="tel"
            name="phone"
            autoComplete="tel"
            value={phone}
            readOnly={Boolean(confirmation)}
            onChange={(event) => setPhone(event.target.value)}
            onKeyDown={onEnter(() => void send())}
          />
          {!confirmation && (
            <button type="button" className="button" disabled={busy} onClick={() => void send()}>
              Получить код
            </button>
          )}
        </div>
      </label>

      {confirmation && (
        <>
          <label className="field">
            <span>Код из SMS</span>
            <div className="field-row">
              <input
                name="sms-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                onKeyDown={onEnter(() => void confirm())}
              />
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                Подтвердить
              </button>
            </div>
          </label>
          <div className="field-hint">
            {cooldown > 0 ? (
              `Отправить снова можно через ${cooldown} с`
            ) : (
              <button type="button" className="link-button" disabled={busy} onClick={() => void send()}>
                Отправить код ещё раз
              </button>
            )}
            {' · '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setConfirmation(null);
                setError('');
              }}
            >
              Изменить номер
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
