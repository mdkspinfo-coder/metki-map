import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { auth, backendReady, db } from '../shared/firebase';
import type { UserProfile } from '../shared/types';
import { isDeletingAccount } from './api';

export type Session =
  | { phase: 'disabled' }
  | { phase: 'loading' }
  | { phase: 'guest' }
  | { phase: 'error'; user: User }
  | { phase: 'needs-profile'; user: User }
  | { phase: 'ready'; user: User; profile: UserProfile };

export function useSession(): Session {
  const [session, setSession] = useState<Session>(
    backendReady ? { phase: 'loading' } : { phase: 'disabled' },
  );

  useEffect(() => {
    if (!backendReady) return undefined;
    let stopProfile: (() => void) | undefined;

    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopProfile?.();
      stopProfile = undefined;
      if (!user) {
        setSession({ phase: 'guest' });
        return;
      }
      setSession({ phase: 'loading' });
      // Подписка, а не разовое чтение: решение модератора применяется без перезагрузки.
      stopProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snapshot) => {
          if (snapshot.exists()) {
            setSession({ phase: 'ready', user, profile: snapshot.data() as UserProfile });
          } else if (!snapshot.metadata.fromCache && !isDeletingAccount()) {
            // fromCache: без сети «нет документа» ещё не значит, что профиля нет.
            setSession({ phase: 'needs-profile', user });
          }
        },
        (error) => {
          console.error(error);
          setSession({ phase: 'error', user });
        },
      );
    });

    return () => {
      stopProfile?.();
      stopAuth();
    };
  }, []);

  return session;
}
