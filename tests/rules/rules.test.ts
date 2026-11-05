import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

const PHONE = '+48500100200';

/** База от лица пользователя: токен содержит то же, что выдаёт Firebase Auth. */
const as = (uid: string, token: Record<string, unknown> = {}): Firestore =>
  env.authenticatedContext(uid, token).firestore() as unknown as Firestore;
const guest = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

const seed = (path: string, data: Record<string, unknown>) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
  });

const seedUser = (uid: string, status: string, extra: Record<string, unknown> = {}) =>
  seed(`users/${uid}`, { uid, username: uid, usernameLower: uid, phone: `+4850${uid.length}`, status, ...extra });

const seedMarker = (id: string, ownerId: string, status: string) =>
  seed(`markers/${id}`, { title: 'Т', caption: 'П', lat: 52, lng: 21, ownerId, status });

const profile = (uid: string, overrides: Record<string, unknown> = {}) => ({
  uid,
  username: 'Jan_Kowalski',
  usernameLower: 'jan_kowalski',
  fullName: 'Jan Kowalski',
  email: 'jan@example.com',
  phone: PHONE,
  status: 'pending',
  createdAt: serverTimestamp(),
  consents: {
    dataProcessing: true,
    privacyPolicy: true,
    version: '2026-11-05',
    acceptedAt: serverTimestamp(),
  },
  ...overrides,
});

const fullToken = { email: 'jan@example.com', email_verified: true };

const register = (db: Firestore, uid: string, data: Record<string, unknown>) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', String(data.usernameLower)), { uid });
  batch.set(doc(db, 'users', uid), data);
  return batch.commit();
};

const newMarker = (uid: string, overrides: Record<string, unknown> = {}) => ({
  title: 'Кафе',
  caption: 'Вкусный кофе',
  lat: 52.2297,
  lng: 21.0122,
  ownerId: uid,
  status: 'pending',
  createdAt: serverTimestamp(),
  ...overrides,
});

const addMarker = (db: Firestore, uid: string, id: string, data: Record<string, unknown>) => {
  const batch = writeBatch(db);
  batch.set(doc(db, 'markers', id), data);
  batch.set(doc(db, 'rateLimits', uid), { lastMarkerAt: serverTimestamp() });
  return batch.commit();
};

const complaint = (markerId: string, uid: string, overrides: Record<string, unknown> = {}) => ({
  markerId,
  text: 'Здесь ложная информация',
  authorId: uid,
  status: 'open',
  createdAt: serverTimestamp(),
  ...overrides,
});

const decision = (modId: string, status: string) => ({
  status,
  reviewedBy: modId,
  reviewedAt: serverTimestamp(),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-metki',
    firestore: {
      rules: readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed('moderators/mod', { addedAt: 1 });
});

describe('гость без входа', () => {
  it('не видит метки, профили и жалобы', async () => {
    await seedMarker('m1', 'a', 'approved');
    await assertFails(getDoc(doc(guest(), 'markers/m1')));
    await assertFails(getDocs(query(collection(guest(), 'markers'), where('status', '==', 'approved'))));
    await assertFails(getDocs(collection(guest(), 'users')));
    await assertFails(getDocs(collection(guest(), 'complaints')));
  });

  it('не может поставить метку', async () => {
    await assertFails(setDoc(doc(guest(), 'markers/x'), newMarker('anon')));
  });
});

describe('регистрация', () => {
  it('создаёт профиль на проверке при входе через Google', async () => {
    await assertSucceeds(register(as('u1', fullToken), 'u1', profile('u1')));
  });

  it('нельзя выдать себя за одобренного', async () => {
    await assertFails(register(as('u1', fullToken), 'u1', profile('u1', { status: 'approved' })));
  });

  it('телефон обязателен и проверяется его формат', async () => {
    for (const phone of ['123', '500100200', '+0123456789', '+48 500 100 200', 48500100200, '']) {
      await assertFails(register(as('u1', fullToken), 'u1', profile('u1', { phone })));
    }
  });

  it('нельзя подменить почту Google', async () => {
    await assertFails(register(as('u1', fullToken), 'u1', profile('u1', { email: 'boss@example.com' })));
  });

  it('почта должна быть подтверждена Google', async () => {
    const unverified = { email: 'jan@example.com', email_verified: false };
    await assertFails(register(as('u1', unverified), 'u1', profile('u1')));
    await assertFails(register(as('u1', { email: 'jan@example.com' }), 'u1', profile('u1')));
    await assertFails(register(as('u1'), 'u1', profile('u1')));
  });

  it('без обоих согласий регистрация невозможна', async () => {
    const base = profile('u1').consents;
    await assertFails(
      register(as('u1', fullToken), 'u1', profile('u1', { consents: { ...base, dataProcessing: false } })),
    );
    await assertFails(
      register(as('u1', fullToken), 'u1', profile('u1', { consents: { ...base, privacyPolicy: false } })),
    );
  });

  it('нельзя создать профиль за другого пользователя', async () => {
    await assertFails(register(as('u2', fullToken), 'u1', profile('u1')));
  });

  it('лишние поля отклоняются', async () => {
    await assertFails(register(as('u1', fullToken), 'u1', profile('u1', { isAdmin: true })));
  });

  it('занятое имя нельзя взять ещё раз, даже в другом регистре', async () => {
    await assertSucceeds(register(as('u1', fullToken), 'u1', profile('u1')));
    const other = { email: 'x@example.com', email_verified: true };
    await assertFails(
      register(as('u2', other), 'u2', profile('u2', { username: 'JAN_KOWALSKI', email: 'x@example.com' })),
    );
  });

  it('профиль нельзя создать в обход резервирования имени', async () => {
    await assertFails(setDoc(doc(as('u1', fullToken), 'users/u1'), profile('u1')));
  });

  it('имя нельзя занять без создания профиля', async () => {
    await assertFails(setDoc(doc(as('u1', fullToken), 'usernames/squat'), { uid: 'u1' }));
  });

  it('повторная запись не сбрасывает статус', async () => {
    await seedUser('u1', 'rejected');
    await assertFails(setDoc(doc(as('u1', fullToken), 'users/u1'), profile('u1')));
  });
});

describe('статус аккаунта', () => {
  it('пользователь не может одобрить сам себя', async () => {
    await seedUser('u1', 'pending');
    await assertFails(updateDoc(doc(as('u1', fullToken), 'users/u1'), { status: 'approved' }));
    await assertFails(updateDoc(doc(as('u1', fullToken), 'users/u1'), decision('u1', 'approved')));
  });

  it('пользователь видит только свой профиль', async () => {
    await seedUser('u1', 'approved');
    await seedUser('u2', 'approved');
    await assertSucceeds(getDoc(doc(as('u1'), 'users/u1')));
    await assertFails(getDoc(doc(as('u1'), 'users/u2')));
    await assertFails(getDocs(collection(as('u1'), 'users')));
  });

  it('нельзя назначить себя модератором', async () => {
    await seedUser('u1', 'approved');
    await assertFails(setDoc(doc(as('u1'), 'moderators/u1'), { addedAt: 1 }));
    await assertFails(setDoc(doc(as('mod'), 'moderators/u1'), { addedAt: 1 }));
  });
});

describe('пока аккаунт не одобрен', () => {
  for (const status of ['pending', 'rejected', 'banned']) {
    it(`статус ${status}: нет доступа к меткам и жалобам`, async () => {
      await seedUser('u1', status);
      await seedMarker('m1', 'other', 'approved');
      const db = as('u1');
      await assertFails(getDoc(doc(db, 'markers/m1')));
      await assertFails(getDocs(query(collection(db, 'markers'), where('status', '==', 'approved'))));
      await assertFails(addMarker(db, 'u1', 'x', newMarker('u1')));
      await assertFails(setDoc(doc(db, 'complaints/m1_u1'), complaint('m1', 'u1')));
    });
  }

  it('без профиля вообще нет доступа', async () => {
    await seedMarker('m1', 'other', 'approved');
    await assertFails(getDoc(doc(as('ghost'), 'markers/m1')));
    await assertFails(addMarker(as('ghost'), 'ghost', 'x', newMarker('ghost')));
  });
});

describe('метки', () => {
  beforeEach(async () => {
    await seedUser('u1', 'approved');
    await seedUser('u2', 'approved');
  });

  it('одобренный пользователь ставит метку, она уходит на модерацию', async () => {
    await assertSucceeds(addMarker(as('u1'), 'u1', 'm1', newMarker('u1')));
  });

  it('нельзя сразу опубликовать метку или поставить её от чужого имени', async () => {
    await assertFails(addMarker(as('u1'), 'u1', 'm1', newMarker('u1', { status: 'approved' })));
    await assertFails(addMarker(as('u1'), 'u1', 'm1', newMarker('u2')));
  });

  it('нельзя обойти ограничение частоты, не записав отметку времени', async () => {
    await assertFails(setDoc(doc(as('u1'), 'markers/m1'), newMarker('u1')));
  });

  it('вторая метка раньше чем через 30 секунд отклоняется', async () => {
    await assertSucceeds(addMarker(as('u1'), 'u1', 'm1', newMarker('u1')));
    await assertFails(addMarker(as('u1'), 'u1', 'm2', newMarker('u1')));
  });

  it('через 30 секунд метку снова можно поставить', async () => {
    await seed('rateLimits/u1', { lastMarkerAt: Timestamp.fromMillis(Date.now() - 31_000) });
    await assertSucceeds(addMarker(as('u1'), 'u1', 'm2', newMarker('u1')));
  });

  it('проверяются длина текста и координаты', async () => {
    const db = as('u1');
    await assertFails(addMarker(db, 'u1', 'a', newMarker('u1', { title: 'x'.repeat(61) })));
    await assertFails(addMarker(db, 'u1', 'b', newMarker('u1', { title: '   ' })));
    await assertFails(addMarker(db, 'u1', 'c', newMarker('u1', { caption: 'x'.repeat(281) })));
    await assertFails(addMarker(db, 'u1', 'd', newMarker('u1', { caption: '' })));
    await assertFails(addMarker(db, 'u1', 'e', newMarker('u1', { lat: 91 })));
    await assertFails(addMarker(db, 'u1', 'f', newMarker('u1', { lng: -181 })));
    await assertFails(addMarker(db, 'u1', 'g', newMarker('u1', { lat: 'север' })));
  });

  it('видны одобренные метки и свои, но не чужие на проверке', async () => {
    await seedMarker('ok', 'u2', 'approved');
    await seedMarker('mine', 'u1', 'pending');
    await seedMarker('hidden', 'u2', 'pending');
    await seedMarker('rejected', 'u2', 'rejected');
    const db = as('u1');
    await assertSucceeds(getDoc(doc(db, 'markers/ok')));
    await assertSucceeds(getDoc(doc(db, 'markers/mine')));
    await assertFails(getDoc(doc(db, 'markers/hidden')));
    await assertFails(getDoc(doc(db, 'markers/rejected')));
  });

  it('запросы сайта разрешены, чтение всей коллекции нет', async () => {
    const db = as('u1');
    await assertSucceeds(getDocs(query(collection(db, 'markers'), where('status', '==', 'approved'))));
    await assertSucceeds(getDocs(query(collection(db, 'markers'), where('ownerId', '==', 'u1'))));
    await assertFails(getDocs(collection(db, 'markers')));
    await assertFails(getDocs(query(collection(db, 'markers'), where('ownerId', '==', 'u2'))));
    await assertFails(getDocs(query(collection(db, 'markers'), where('status', '==', 'pending'))));
  });

  it('автор не может изменить метку после проверки', async () => {
    await seedMarker('m1', 'u1', 'approved');
    await assertFails(updateDoc(doc(as('u1'), 'markers/m1'), { title: 'Подмена' }));
    await assertFails(updateDoc(doc(as('u1'), 'markers/m1'), { status: 'approved' }));
  });

  it('удалить метку может автор, но не другой пользователь', async () => {
    await seedMarker('m1', 'u1', 'approved');
    await assertFails(deleteDoc(doc(as('u2'), 'markers/m1')));
    await assertSucceeds(deleteDoc(doc(as('u1'), 'markers/m1')));
  });
});

describe('жалобы', () => {
  beforeEach(async () => {
    await seedUser('u1', 'approved');
    await seedUser('u2', 'approved');
    await seedMarker('m1', 'u2', 'approved');
    await seedMarker('p1', 'u2', 'pending');
  });

  it('одобренный пользователь отправляет жалобу', async () => {
    await assertSucceeds(setDoc(doc(as('u1'), 'complaints/m1_u1'), complaint('m1', 'u1')));
  });

  it('вторая жалоба на ту же метку отклоняется', async () => {
    await assertSucceeds(setDoc(doc(as('u1'), 'complaints/m1_u1'), complaint('m1', 'u1')));
    await assertFails(setDoc(doc(as('u1'), 'complaints/m1_u1'), complaint('m1', 'u1')));
  });

  it('нельзя жаловаться от чужого имени или с неверным номером', async () => {
    await assertFails(setDoc(doc(as('u1'), 'complaints/m1_u2'), complaint('m1', 'u2')));
    await assertFails(setDoc(doc(as('u1'), 'complaints/any'), complaint('m1', 'u1')));
    // Номер жалобы свой, а автором указан другой человек.
    await assertFails(setDoc(doc(as('u1'), 'complaints/m1_u1'), complaint('m1', 'u2')));
  });

  it('нельзя пожаловаться на несуществующую или непроверенную метку', async () => {
    await assertFails(setDoc(doc(as('u1'), 'complaints/p1_u1'), complaint('p1', 'u1')));
    await assertFails(setDoc(doc(as('u1'), 'complaints/nope_u1'), complaint('nope', 'u1')));
  });

  it('проверяется длина текста', async () => {
    await assertFails(setDoc(doc(as('u1'), 'complaints/m1_u1'), complaint('m1', 'u1', { text: 'мало' })));
  });

  it('чужие жалобы не видны, своя видна', async () => {
    await seed('complaints/m1_u2', { markerId: 'm1', authorId: 'u2', status: 'open', text: 'текст' });
    await seed('complaints/m1_u1', { markerId: 'm1', authorId: 'u1', status: 'open', text: 'текст' });
    await assertFails(getDoc(doc(as('u1'), 'complaints/m1_u2')));
    await assertSucceeds(getDoc(doc(as('u1'), 'complaints/m1_u1')));
    await assertFails(getDocs(collection(as('u1'), 'complaints')));
  });

  it('можно проверить, что своей жалобы ещё нет', async () => {
    await assertSucceeds(getDoc(doc(as('u1'), 'complaints/m1_u1')));
  });
});

describe('модерация', () => {
  beforeEach(async () => {
    await seedUser('u1', 'pending');
    await seedMarker('m1', 'u1', 'pending');
    await seed('complaints/m1_u1', { markerId: 'm1', authorId: 'u1', status: 'open', text: 'текст' });
  });

  it('модератор видит очереди', async () => {
    const db = as('mod');
    await assertSucceeds(getDocs(query(collection(db, 'users'), where('status', '==', 'pending'))));
    await assertSucceeds(getDocs(query(collection(db, 'markers'), where('status', '==', 'pending'))));
    await assertSucceeds(getDocs(query(collection(db, 'complaints'), where('status', '==', 'open'))));
  });

  it('модератор принимает решения', async () => {
    const db = as('mod');
    await assertSucceeds(updateDoc(doc(db, 'users/u1'), decision('mod', 'approved')));
    await assertSucceeds(updateDoc(doc(db, 'markers/m1'), decision('mod', 'approved')));
    await assertSucceeds(updateDoc(doc(db, 'complaints/m1_u1'), decision('mod', 'resolved')));
  });

  it('причина отказа сохраняется и ограничена по длине', async () => {
    const db = as('mod');
    await assertSucceeds(
      updateDoc(doc(db, 'users/u1'), { ...decision('mod', 'rejected'), rejectReason: 'Неверное ФИО' }),
    );
    await assertFails(
      updateDoc(doc(db, 'users/u1'), { ...decision('mod', 'rejected'), rejectReason: 'x'.repeat(301) }),
    );
  });

  it('модератор не может менять содержимое и подделывать автора решения', async () => {
    const db = as('mod');
    await assertFails(updateDoc(doc(db, 'users/u1'), { ...decision('mod', 'approved'), fullName: 'Другой' }));
    await assertFails(updateDoc(doc(db, 'markers/m1'), { ...decision('mod', 'approved'), title: 'Другой' }));
    await assertFails(updateDoc(doc(db, 'users/u1'), decision('someone', 'approved')));
    await assertFails(updateDoc(doc(db, 'users/u1'), decision('mod', 'superuser')));
  });

  it('обычный одобренный пользователь не может модерировать', async () => {
    await seedUser('u2', 'approved');
    const db = as('u2');
    await assertFails(getDocs(query(collection(db, 'users'), where('status', '==', 'pending'))));
    await assertFails(updateDoc(doc(db, 'users/u1'), decision('u2', 'approved')));
    await assertFails(updateDoc(doc(db, 'markers/m1'), decision('u2', 'approved')));
    await assertFails(updateDoc(doc(db, 'complaints/m1_u1'), decision('u2', 'resolved')));
    await assertFails(getDocs(collection(db, 'blockedEmails')));
  });

  it('жалобы нельзя удалять', async () => {
    await assertFails(deleteDoc(doc(as('mod'), 'complaints/m1_u1')));
    await assertFails(deleteDoc(doc(as('u1'), 'complaints/m1_u1')));
  });
});

describe('блокировка и удаление аккаунта', () => {
  it('с заблокированной почтой нельзя зарегистрироваться снова', async () => {
    await seed('blockedEmails/jan@example.com', { uid: 'old' });
    await assertFails(register(as('u1', fullToken), 'u1', profile('u1')));
  });

  it('заблокированный не может удалить профиль и свои метки', async () => {
    await seedUser('u1', 'banned');
    await seedMarker('m1', 'u1', 'approved');
    await assertFails(deleteDoc(doc(as('u1'), 'users/u1')));
    await assertFails(deleteDoc(doc(as('u1'), 'markers/m1')));
  });

  it('пользователь полностью удаляет свои данные одним пакетом', async () => {
    await seedUser('u1', 'approved', { usernameLower: 'jan' });
    await seed('usernames/jan', { uid: 'u1' });
    await seed('rateLimits/u1', { lastMarkerAt: Timestamp.now() });
    await seedMarker('m1', 'u1', 'approved');
    const db = as('u1');
    const batch = writeBatch(db);
    batch.delete(doc(db, 'markers/m1'));
    batch.delete(doc(db, 'rateLimits/u1'));
    batch.delete(doc(db, 'usernames/jan'));
    batch.delete(doc(db, 'users/u1'));
    await assertSucceeds(batch.commit());
  });

  it('освободить имя или сбросить таймер отдельно от удаления нельзя', async () => {
    await seedUser('u1', 'approved', { usernameLower: 'jan' });
    await seed('usernames/jan', { uid: 'u1' });
    await seed('rateLimits/u1', { lastMarkerAt: Timestamp.now() });
    await assertFails(deleteDoc(doc(as('u1'), 'usernames/jan')));
    await assertFails(deleteDoc(doc(as('u1'), 'rateLimits/u1')));
  });

  it('чужое имя освободить нельзя', async () => {
    await seed('usernames/jan', { uid: 'u1' });
    await assertFails(deleteDoc(doc(as('u2'), 'usernames/jan')));
  });
});
