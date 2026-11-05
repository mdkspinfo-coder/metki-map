// Вставьте сюда настройки из консоли Firebase:
// Project settings -> General -> Your apps -> Web app -> SDK setup and configuration.
// Эти значения не секретны: они видны любому посетителю сайта.
// Данные защищает файл firestore.rules.
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

export const isFirebaseConfigured = !firebaseConfig.apiKey.includes('REPLACE_ME');
