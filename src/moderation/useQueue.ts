import { collection, limit, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../shared/firebase';

const MAX_ROWS = 300;

interface QueueState<T> {
  rows: T[];
  loading: boolean;
  error: boolean;
  truncated: boolean;
}

type Row = { createdAt: Timestamp | null };

/**
 * Живой список записей с нужным статусом, старые сверху: кто раньше подал, тот раньше
 * проверяется. Сортировка на стороне браузера, поэтому составные индексы базы не нужны.
 */
export function useQueue<T extends Row>(name: string, status: string): QueueState<T> {
  const [state, setState] = useState<QueueState<T>>({
    rows: [],
    loading: true,
    error: false,
    truncated: false,
  });

  useEffect(() => {
    setState({ rows: [], loading: true, error: false, truncated: false });
    return onSnapshot(
      query(collection(db, name), where('status', '==', status), limit(MAX_ROWS)),
      (snapshot) => {
        const rows = snapshot.docs.map(
          (item) => ({ ...item.data({ serverTimestamps: 'estimate' }), id: item.id }) as unknown as T,
        );
        rows.sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
        setState({ rows, loading: false, error: false, truncated: rows.length >= MAX_ROWS });
      },
      (error) => {
        console.error(error);
        setState({ rows: [], loading: false, error: true, truncated: false });
      },
    );
  }, [name, status]);

  return state;
}
