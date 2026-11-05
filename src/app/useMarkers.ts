import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../shared/firebase';
import type { MapMarker } from '../shared/types';

const toMarker = (snapshot: QueryDocumentSnapshot): MapMarker => ({
  ...(snapshot.data({ serverTimestamps: 'estimate' }) as Omit<MapMarker, 'id'>),
  id: snapshot.id,
});

/** Загружает метки только для одобренного пользователя: uid = null значит «ничего не читать». */
export function useMarkers(uid: string | null, onError: (error: unknown) => void) {
  const [published, setPublished] = useState<MapMarker[]>([]);
  const [own, setOwn] = useState<MapMarker[]>([]);

  useEffect(() => {
    if (!uid) {
      setPublished([]);
      setOwn([]);
      return undefined;
    }
    const markers = collection(db, 'markers');
    const stopPublished = onSnapshot(
      query(markers, where('status', '==', 'approved'), limit(5000)),
      (snapshot) => setPublished(snapshot.docs.map(toMarker)),
      onError,
    );
    const stopOwn = onSnapshot(
      query(markers, where('ownerId', '==', uid), limit(500)),
      (snapshot) => setOwn(snapshot.docs.map(toMarker)),
      onError,
    );
    return () => {
      stopPublished();
      stopOwn();
    };
  }, [uid, onError]);

  // Своя одобренная метка приходит из обоих запросов: на карте она должна быть одна.
  const visible = useMemo(() => {
    const byId = new Map(published.map((marker) => [marker.id, marker]));
    for (const marker of own) {
      if (marker.status === 'pending') byId.set(marker.id, marker);
    }
    return [...byId.values()];
  }, [published, own]);

  return { visible, own };
}
