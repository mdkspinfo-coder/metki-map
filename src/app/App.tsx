import { signOut } from 'firebase/auth';
import { Check, Flag, LoaderCircle, LocateFixed, MapPinPlus, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, isPermissionDenied } from '../shared/errors';
import { auth } from '../shared/firebase';
import {
  computeActiveIds,
  distanceMeters,
  formatDistance,
  MAX_USABLE_ACCURACY_M,
  ACTIVATION_RADIUS_M,
  sameIds,
  type LatLng,
} from '../shared/geo';
import { Modal } from '../shared/Modal';
import type { MapMarker } from '../shared/types';
import { AccountDialog, LoginDialog, RegisterDialog, StatusGate } from './AccountDialogs';
import { MapCanvas, type MapHandle, type MapPoint, type PopupContent } from './MapCanvas';
import { ComplaintDialog, MarkerForm } from './MarkerDialogs';
import { useGps, type GpsStatus } from './useGps';
import { useMarkers } from './useMarkers';
import { useSession } from './useSession';

const NO_IDS: ReadonlySet<string> = new Set();

const GPS_PROBLEMS: Partial<Record<GpsStatus, string>> = {
  denied: 'Доступ к геолокации запрещён. Разрешите его в настройках браузера для этого сайта.',
  unavailable: 'Не удалось определить местоположение. Включите GPS и попробуйте снова.',
  unsupported: 'Этот браузер не поддерживает геолокацию.',
};

export function App() {
  const session = useSession();
  const gps = useGps();
  const mapRef = useRef<MapHandle>(null);

  const [toast, setToast] = useState('');
  const [mapFailure, setMapFailure] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [draftPosition, setDraftPosition] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [complaintFor, setComplaintFor] = useState<string | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(NO_IDS);
  const flyWhenLocated = useRef(false);

  const approved = session.phase === 'ready' && session.profile.status === 'approved';
  const uid = approved ? session.user.uid : null;

  // Отказ в доступе здесь значит, что статус только что сменился: об этом сообщит окно статуса.
  const reportMarkersError = useCallback((error: unknown) => {
    if (!isPermissionDenied(error)) setToast(errorMessage(error));
  }, []);
  const { visible: markers, own } = useMarkers(uid, reportMarkersError);

  const position = useMemo<LatLng | null>(() => {
    if (!gps.fix || gps.stale || gps.fix.accuracy > MAX_USABLE_ACCURACY_M) return null;
    return { lat: gps.fix.lat, lng: gps.fix.lng };
  }, [gps.fix, gps.stale]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Одобренному пользователю GPS нужен сразу: без него метки не становятся зелёными.
  const startGps = gps.start;
  useEffect(() => {
    if (approved) startGps();
  }, [approved, startGps]);

  // Зелёные метки считаем только для одобренного пользователя.
  useEffect(() => {
    setActiveIds((previous) => {
      const next = computeActiveIds(markers, position, previous);
      return sameIds(previous, next) ? previous : next;
    });
  }, [markers, position]);

  // Если статус изменился, пока был открыт диалог, снимаем всё, что доступно только одобренным.
  useEffect(() => {
    if (approved) return;
    setPlacing(false);
    setDraftPosition(null);
    setSelectedId(null);
    setComplaintFor(null);
    setAccountOpen(false);
  }, [approved]);

  const flyToFix = useCallback((fix: { lat: number; lng: number; accuracy: number }) => {
    mapRef.current?.flyTo(fix);
    if (fix.accuracy > MAX_USABLE_ACCURACY_M) {
      setToast(`Слабый сигнал GPS: точность ±${Math.round(fix.accuracy)} м.`);
    }
  }, []);

  // Кнопка нажата до первых координат: летим, как только они появятся.
  useEffect(() => {
    if (flyWhenLocated.current && gps.fix) {
      flyWhenLocated.current = false;
      flyToFix(gps.fix);
    }
  }, [gps.fix, flyToFix]);

  useEffect(() => {
    const problem = GPS_PROBLEMS[gps.status];
    if (problem && flyWhenLocated.current) {
      flyWhenLocated.current = false;
      setToast(problem);
    }
  }, [gps.status]);

  const onLocate = () => {
    if (gps.fix) {
      flyToFix(gps.fix);
      return;
    }
    if (!window.isSecureContext) {
      setToast('Геолокация работает только на сайтах с https.');
      return;
    }
    if (!('geolocation' in navigator)) {
      setToast(GPS_PROBLEMS.unsupported ?? '');
      return;
    }
    flyWhenLocated.current = true;
    gps.start();
  };

  const onAdd = () => {
    if (session.phase === 'loading') return;
    if (!approved) {
      if (session.phase === 'guest') setToast('Чтобы ставить метки, войдите в аккаунт.');
      setAccountOpen(true);
      return;
    }
    setSelectedId(null);
    // Если карта далеко, сразу приближаем её к человеку: точное место проще выбрать вблизи.
    if (gps.fix && (mapRef.current?.zoom() ?? 0) < 14) mapRef.current?.flyTo(gps.fix, 16);
    setPlacing(true);
  };

  const onPointTap = useCallback(
    (id: string) => {
      const marker = markers.find((item) => item.id === id);
      if (!marker) return;
      if (marker.status === 'pending' || activeIds.has(id)) {
        setSelectedId(id);
        return;
      }
      setSelectedId(null);
      if (!position) {
        setToast('Чтобы открыть метку, включите GPS и подойдите к ней ближе.');
      } else {
        const distance = formatDistance(distanceMeters(position, marker));
        setToast(`До метки ${distance}. Она откроется в радиусе ${ACTIVATION_RADIUS_M} м.`);
      }
    },
    [markers, activeIds, position],
  );

  const onEmptyTap = useCallback(() => setSelectedId(null), []);
  const onPopupClose = useCallback(() => setSelectedId(null), []);

  // Метку могли снять с карты, а человек мог уйти из радиуса: окно с текстом закрывается.
  const selected = markers.find((marker) => marker.id === selectedId);
  const canShowSelected = selected && (selected.status === 'pending' || activeIds.has(selected.id));
  useEffect(() => {
    if (selectedId && !canShowSelected) setSelectedId(null);
  }, [selectedId, canShowSelected]);

  const popup = useMemo<PopupContent | null>(() => {
    if (!selected || !canShowSelected) return null;
    return {
      id: selected.id,
      lat: selected.lat,
      lng: selected.lng,
      title: selected.title,
      caption: selected.caption,
      badge: selected.status === 'pending' ? 'На проверке' : undefined,
    };
  }, [selected, canShowSelected]);

  const points = useMemo<MapPoint[]>(
    () =>
      markers.map((marker) => ({
        id: marker.id,
        lat: marker.lat,
        lng: marker.lng,
        state:
          marker.status === 'pending' ? 'pending' : activeIds.has(marker.id) ? 'active' : 'idle',
      })),
    [markers, activeIds],
  );

  const activeMarkers = useMemo(() => {
    if (!position) return [];
    return markers
      .filter((marker) => activeIds.has(marker.id))
      .map((marker) => ({ ...marker, distance: distanceMeters(position, marker) }))
      .sort((a, b) => a.distance - b.distance);
  }, [markers, activeIds, position]);

  // Список фиксируется при открытии: иначе он менялся бы под рукой при каждом обновлении GPS.
  const [complaintList, setComplaintList] = useState(activeMarkers);
  const openComplaint = () => {
    setComplaintList(activeMarkers);
    setComplaintFor(selected && activeIds.has(selected.id) ? selected.id : activeMarkers[0].id);
  };

  const showOwnMarker = (marker: MapMarker) => {
    setAccountOpen(false);
    mapRef.current?.flyTo(marker, 15);
  };

  const weakSignal =
    approved && gps.fix && !gps.stale && gps.fix.accuracy > MAX_USABLE_ACCURACY_M
      ? `Слабый сигнал GPS (±${Math.round(gps.fix.accuracy)} м): метки не активируются`
      : '';
  const lostSignal = approved && gps.stale ? 'Нет сигнала GPS: метки не активируются' : '';

  const locating = gps.status === 'locating';

  return (
    <div className="app">
      <MapCanvas
        ref={mapRef}
        points={points}
        gps={gps.fix}
        showRange={approved}
        placing={placing}
        popup={popup}
        onPointTap={onPointTap}
        onEmptyTap={onEmptyTap}
        onPopupClose={onPopupClose}
        onFailure={setMapFailure}
      />

      <button
        type="button"
        className="account-button"
        disabled={session.phase === 'loading'}
        onClick={() => setAccountOpen(true)}
      >
        <UserRound size={18} aria-hidden />
        Аккаунт
      </button>

      {(weakSignal || lostSignal) && <p className="gps-chip">{weakSignal || lostSignal}</p>}
      {mapFailure && (
        <p className="map-failure" role="alert">
          {mapFailure}
        </p>
      )}

      {placing ? (
        <>
          <div className="crosshair" aria-hidden />
          <div className="placing-bar">
            <p>Передвиньте карту так, чтобы точка оказалась в нужном месте</p>
            <div className="field-row">
              <button type="button" className="button" onClick={() => setPlacing(false)}>
                <X size={18} aria-hidden />
                Отмена
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setPlacing(false);
                  setDraftPosition(mapRef.current?.center() ?? null);
                }}
              >
                <Check size={18} aria-hidden />
                Поставить здесь
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="fabs">
          {approved && activeMarkers.length > 0 && (
            <button
              type="button"
              className="fab fab-complaint"
              aria-label="Пожаловаться на метку"
              title="Пожаловаться на метку"
              onClick={openComplaint}
            >
              <Flag size={22} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="fab"
            aria-label="Показать моё местоположение"
            title="Показать моё местоположение"
            onClick={onLocate}
          >
            {locating ? (
              <LoaderCircle size={24} className="spin" aria-hidden />
            ) : (
              <LocateFixed size={24} aria-hidden color={gps.fix ? 'var(--primary)' : 'currentColor'} />
            )}
          </button>
          <button
            type="button"
            className="fab fab-add"
            aria-label="Добавить метку"
            title="Добавить метку"
            onClick={onAdd}
          >
            <MapPinPlus size={30} aria-hidden />
          </button>
        </div>
      )}

      {accountOpen && session.phase === 'disabled' && (
        <Modal title="Вход пока недоступен" onClose={() => setAccountOpen(false)}>
          <p>Сервер ещё не настроен: добавьте настройки Firebase по инструкции в README.</p>
        </Modal>
      )}
      {accountOpen && session.phase === 'guest' && <LoginDialog onClose={() => setAccountOpen(false)} />}
      {accountOpen && approved && session.phase === 'ready' && (
        <AccountDialog
          user={session.user}
          profile={session.profile}
          markers={own}
          onClose={() => setAccountOpen(false)}
          onShowMarker={showOwnMarker}
          onToast={setToast}
        />
      )}

      {session.phase === 'needs-profile' && <RegisterDialog user={session.user} />}
      {session.phase === 'ready' && !approved && (
        <StatusGate user={session.user} profile={session.profile} />
      )}
      {session.phase === 'error' && (
        <Modal title="Не удалось открыть аккаунт">
          <div className="form">
            <p>Сервер не отдал данные профиля. Проверьте интернет и обновите страницу.</p>
            <button type="button" className="button button-wide" onClick={() => void signOut(auth)}>
              Выйти
            </button>
          </div>
        </Modal>
      )}

      {draftPosition && uid && (
        <MarkerForm
          uid={uid}
          position={draftPosition}
          onCancel={() => setDraftPosition(null)}
          onSaved={() => {
            setDraftPosition(null);
            setToast('Метка отправлена на проверку модератору.');
          }}
        />
      )}

      {complaintFor && uid && (
        <ComplaintDialog
          uid={uid}
          candidates={complaintList}
          initialId={complaintFor}
          onClose={() => setComplaintFor(null)}
          onSent={() => {
            setComplaintFor(null);
            setToast('Жалоба отправлена модераторам.');
          }}
        />
      )}

      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}
