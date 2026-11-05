import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config';

export const isEmulator = import.meta.env.VITE_USE_EMULATOR === 'true';

/** false, пока в firebase-config.ts не вставлены настройки: карта работает, вход выключен. */
export const backendReady = isEmulator || isFirebaseConfigured;

function connect() {
  const app = initializeApp(
    isEmulator
      ? { apiKey: 'demo-key', projectId: 'demo-metki', authDomain: 'demo-metki.firebaseapp.com' }
      : firebaseConfig,
  );
  const authService = getAuth(app);
  const dbService = getFirestore(app);
  authService.languageCode = 'ru';

  if (isEmulator) {
    connectAuthEmulator(authService, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(dbService, '127.0.0.1', 8080);
    authService.settings.appVerificationDisabledForTesting = true;
  }
  return { authService, dbService };
}

const services = backendReady ? connect() : null;

// Весь код, работающий с базой, вызывается только при backendReady === true.
export const auth = services?.authService as Auth;
export const db = services?.dbService as Firestore;
