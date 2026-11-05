import { deleteUser, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { AppError, isPermissionDenied, withNetwork } from '../shared/errors';
import { db } from '../shared/firebase';
import { SITE } from '../shared/site-config';
import type { MapMarker, UserProfile } from '../shared/types';

export interface RegistrationInput {
  username: string;
  fullName: string;
  /** Номер в международном виде. Он не проверяется: его вводит сам пользователь. */
  phone: string;
}

export function createProfile(user: User, input: RegistrationInput): Promise<void> {
  return withNetwork(async () => {
    // Правила базы сверяют почту с токеном, поэтому берём её оттуда же.
    const { claims } = await user.getIdTokenResult();
    if (typeof claims.email !== 'string') throw new AppError('В аккаунте Google не найдена почта.');

    const usernameLower = input.username.toLowerCase();
    const taken = await getDoc(doc(db, 'usernames', usernameLower));
    if (taken.exists()) throw new AppError('Это имя пользователя уже занято.');

    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', usernameLower), { uid: user.uid });
    batch.set(doc(db, 'users', user.uid), {
      uid: user.uid,
      username: input.username,
      usernameLower,
      fullName: input.fullName.trim(),
      email: claims.email,
      phone: input.phone,
      status: 'pending',
      createdAt: serverTimestamp(),
      consents: {
        dataProcessing: true,
        privacyPolicy: true,
        version: SITE.legalVersion,
        acceptedAt: serverTimestamp(),
      },
    });
    try {
      await batch.commit();
    } catch (error) {
      if (isPermissionDenied(error)) {
        throw new AppError(
          'Не удалось зарегистрироваться. Возможно, имя только что заняли или эта почта заблокирована.',
        );
      }
      throw error;
    }
  });
}

export function createMarker(
  uid: string,
  input: { title: string; caption: string; lat: number; lng: number },
): Promise<void> {
  return withNetwork(async () => {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'markers')), {
      title: input.title.trim(),
      caption: input.caption.trim(),
      lat: Number(input.lat.toFixed(6)),
      lng: Number(input.lng.toFixed(6)),
      ownerId: uid,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'rateLimits', uid), { lastMarkerAt: serverTimestamp() });
    try {
      await batch.commit();
    } catch (error) {
      if (isPermissionDenied(error)) {
        throw new AppError('Метки можно ставить не чаще одного раза в 30 секунд. Подождите немного.');
      }
      throw error;
    }
  });
}

export function deleteOwnMarker(marker: MapMarker): Promise<void> {
  return withNetwork(() => deleteDoc(doc(db, 'markers', marker.id)));
}

export function submitComplaint(uid: string, markerId: string, text: string): Promise<void> {
  return withNetwork(async () => {
    const ref = doc(db, 'complaints', `${markerId}_${uid}`);
    const existing = await getDoc(ref);
    if (existing.exists()) throw new AppError('Вы уже отправляли жалобу на эту метку.');
    try {
      await setDoc(ref, {
        markerId,
        text: text.trim(),
        authorId: uid,
        status: 'open',
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      if (isPermissionDenied(error)) throw new AppError('Эта метка больше недоступна.');
      throw error;
    }
  });
}

let deletingAccount = false;

/** Пока идёт удаление, профиль уже стёрт, но вход ещё активен: форму регистрации не показываем. */
export const isDeletingAccount = () => deletingAccount;

export function deleteAccount(user: User, profile: UserProfile): Promise<void> {
  return withNetwork(async () => {
    // Firebase удаляет аккаунт только сразу после входа. Проверяем это заранее,
    // иначе данные были бы стёрты, а сам вход остался.
    const { authTime } = await user.getIdTokenResult();
    if (Date.now() - Date.parse(authTime) > 4 * 60_000) {
      throw new AppError('Для удаления нужен свежий вход: выйдите, войдите снова и сразу повторите.');
    }

    deletingAccount = true;
    try {
      const own = await getDocs(query(collection(db, 'markers'), where('ownerId', '==', user.uid)));
      const refs = own.docs.map((snapshot) => snapshot.ref);
      // В одном пакете не больше 500 записей: лишние метки удаляем заранее.
      while (refs.length > 400) {
        const batch = writeBatch(db);
        refs.splice(0, 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
      const batch = writeBatch(db);
      refs.forEach((ref) => batch.delete(ref));
      batch.delete(doc(db, 'rateLimits', user.uid));
      batch.delete(doc(db, 'usernames', profile.usernameLower));
      batch.delete(doc(db, 'users', user.uid));
      await batch.commit();
      await deleteUser(user);
    } finally {
      deletingAccount = false;
    }
  }, 40_000);
}
