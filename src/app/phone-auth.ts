import {
  linkWithPhoneNumber,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth } from '../shared/firebase';

/**
 * Отправляет SMS. Для каждой попытки создаётся новый контейнер reCAPTCHA: повторное
 * использование старого даёт ошибку «reCAPTCHA has already been rendered» при повторной отправке.
 * С linkTo номер привязывается к уже вошедшему через Google пользователю.
 */
export async function sendSmsCode(phone: string, linkTo?: User): Promise<ConfirmationResult> {
  const host = document.getElementById('recaptcha-root');
  if (!host) throw new Error('recaptcha-root не найден');
  host.replaceChildren();
  const element = document.createElement('div');
  host.append(element);

  const verifier = new RecaptchaVerifier(auth, element, { size: 'invisible' });
  try {
    return linkTo
      ? await linkWithPhoneNumber(linkTo, phone, verifier)
      : await signInWithPhoneNumber(auth, phone, verifier);
  } finally {
    verifier.clear();
  }
}
