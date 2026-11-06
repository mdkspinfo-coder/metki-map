import { useState, type FormEvent } from 'react';
import { errorMessage } from '../shared/errors';
import { formatDistance, type LatLng } from '../shared/geo';
import { Modal } from '../shared/Modal';
import type { MapMarker } from '../shared/types';
import { LIMITS } from '../shared/validation';
import { createMarker, submitComplaint } from './api';

interface MarkerFormProps {
  uid: string;
  position: LatLng;
  onCancel: () => void;
  onSaved: () => void;
}

export function MarkerForm({ uid, position, onCancel, onSaved }: MarkerFormProps) {
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !caption.trim()) {
      setError('Заполните название и надпись.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createMarker(uid, { title, caption, ...position });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Modal title="Новая метка" onClose={onCancel}>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="field">
          <span>Название (сверху)</span>
          <input
            name="title"
            value={title}
            maxLength={LIMITS.title.max}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Надпись (снизу)</span>
          <textarea
            name="caption"
            value={caption}
            maxLength={LIMITS.caption.max}
            onChange={(event) => setCaption(event.target.value)}
          />
          <small className="field-hint">
            {caption.length} из {LIMITS.caption.max}
          </small>
        </label>
        <p className="field-hint">Метка появится на карте у других пользователей после проверки.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-primary button-wide" disabled={busy}>
          Отправить на проверку
        </button>
      </form>
    </Modal>
  );
}

interface ComplaintDialogProps {
  uid: string;
  /** Зелёные метки на момент открытия, ближайшая первой. */
  candidates: (MapMarker & { distance: number })[];
  /** Пустая строка: меток несколько, и человек выбирает сам. */
  initialId: string;
  onClose: () => void;
  onSent: () => void;
}

export function ComplaintDialog({ uid, candidates, initialId, onClose, onSent }: ComplaintDialogProps) {
  const [markerId, setMarkerId] = useState(initialId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = candidates.find((marker) => marker.id === markerId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!markerId) {
      setError('Выберите метку, на которую жалуетесь.');
      return;
    }
    if (text.trim().length < LIMITS.complaint.min) {
      setError(`Опишите проблему подробнее: минимум ${LIMITS.complaint.min} символов.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submitComplaint(uid, markerId, text);
      onSent();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Modal title="Жалоба на метку" onClose={onClose}>
      <form className="form" onSubmit={(event) => void submit(event)} noValidate>
        {candidates.length > 1 ? (
          <fieldset className="marker-choice">
            <legend>На какую метку жалоба?</legend>
            {candidates.map((marker) => (
              <label key={marker.id} className="marker-option">
                <input
                  type="radio"
                  name="marker"
                  value={marker.id}
                  checked={markerId === marker.id}
                  onChange={() => setMarkerId(marker.id)}
                />
                <span className="marker-option-text">
                  <strong>{marker.title}</strong>
                  <small>{marker.caption}</small>
                  <small>{formatDistance(marker.distance)} от вас</small>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="complaint-target">{selected?.title}</p>
        )}
        <label className="field">
          <span>Что не так с этой меткой?</span>
          <textarea
            name="complaint"
            value={text}
            maxLength={LIMITS.complaint.max}
            onChange={(event) => setText(event.target.value)}
          />
          <small className="field-hint">
            {text.length} из {LIMITS.complaint.max}
          </small>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-danger button-wide" disabled={busy}>
          Отправить жалобу
        </button>
      </form>
    </Modal>
  );
}
