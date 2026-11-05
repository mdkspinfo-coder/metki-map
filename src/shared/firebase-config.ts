// Настройки проекта Firebase из консоли:
// Project settings -> General -> Your apps -> Web app -> SDK setup and configuration.
// Эти значения не секретны: они видны любому посетителю сайта.
// Данные защищает файл firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyA3qAbrqWueMEKP8DrKUw6fd_xocYhiZaU',
  authDomain: 'metki-4e2da.firebaseapp.com',
  projectId: 'metki-4e2da',
  storageBucket: 'metki-4e2da.firebasestorage.app',
  messagingSenderId: '121170677440',
  appId: '1:121170677440:web:c9a50939e152c18b8f6725',
};

export const isFirebaseConfigured = !firebaseConfig.apiKey.includes('REPLACE_ME');
