import { useCallback, useEffect, useRef, useState } from 'react';
import { shouldAcceptFix } from '../shared/geo';

export type GpsStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'unsupported';

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
  receivedAt: number;
}

const HIGH_ACCURACY: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };

/** Если человек стоит на месте, браузер может не присылать обновления: запрашиваем сами. */
const REFRESH_AFTER_MS = 30_000;
/**
 * Дольше этого координатам не верим. Порог большой намеренно: когда человек сидит на месте,
 * браузер может долго не присылать новых данных, и гасить метку у него на глазах хуже,
 * чем показать её зелёной чуть дольше после настоящей потери сигнала.
 */
const STALE_AFTER_MS = 600_000;

export function useGps() {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [status, setStatus] = useState<GpsStatus>('idle');
  const [stale, setStale] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastFix = useRef<GpsFix | null>(null);
  const refreshing = useRef(false);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const accept = useCallback((position: GeolocationPosition) => {
    const next: GpsFix = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      receivedAt: Date.now(),
    };
    if (!shouldAcceptFix(lastFix.current, next)) return;
    lastFix.current = next;
    setFix(next);
    setStatus('ok');
    setStale(false);
  }, []);

  const handleError = useCallback(
    (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        stopWatch();
        lastFix.current = null;
        setFix(null);
        setStatus('denied');
      } else if (!lastFix.current) {
        // Таймаут после хорошей точки не страшен: за старением следит таймер ниже.
        setStatus('unavailable');
      }
    },
    [stopWatch],
  );

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    if (watchId.current !== null && lastFix.current) return;
    stopWatch();
    if (!lastFix.current) setStatus('locating');
    watchId.current = navigator.geolocation.watchPosition(accept, handleError, HIGH_ACCURACY);
  }, [accept, handleError, stopWatch]);

  // Если доступ уже разрешён, включаем GPS сразу. Иначе ждём действия пользователя.
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((permission) => {
        if (!cancelled && permission.state === 'granted') start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [start]);

  useEffect(() => {
    const check = () => {
      const last = lastFix.current;
      if (!last || watchId.current === null) return;
      const age = Date.now() - last.receivedAt;
      if (age > STALE_AFTER_MS) setStale(true);
      if (age > REFRESH_AFTER_MS && !refreshing.current) {
        refreshing.current = true;
        navigator.geolocation.getCurrentPosition(
          (position) => {
            refreshing.current = false;
            accept(position);
          },
          () => {
            refreshing.current = false;
          },
          { ...HIGH_ACCURACY, timeout: 15_000 },
        );
      }
    };
    const timer = setInterval(check, 10_000);
    // После сворачивания вкладки обновления могли не приходить.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accept]);

  useEffect(() => stopWatch, [stopWatch]);

  return { fix, status, stale, start };
}
