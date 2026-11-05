// Те же ограничения проверяет сервер в firestore.rules. Здесь они нужны,
// чтобы показать понятную ошибку до отправки.
export const LIMITS = {
  fullName: { min: 3, max: 100 },
  title: { min: 1, max: 60 },
  caption: { min: 1, max: 280 },
  complaint: { min: 10, max: 1000 },
  reason: { max: 300 },
} as const;

export function validateUsername(value: string): string | null {
  if (!/^[A-Za-z0-9_.]{3,24}$/.test(value)) {
    return 'От 3 до 24 символов: латинские буквы, цифры, точка и подчёркивание';
  }
  return null;
}

export function validateFullName(value: string): string | null {
  const size = value.trim().length;
  if (size < LIMITS.fullName.min) return 'Укажите ФИО';
  if (size > LIMITS.fullName.max) return `Не больше ${LIMITS.fullName.max} символов`;
  return null;
}

export function validateEmail(value: string): string | null {
  if (value.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return 'Проверьте адрес почты';
  }
  return null;
}

/** Приводит номер к международному виду. Девять цифр считаются польским номером. */
export function normalizePhone(value: string): string | null {
  let digits = value.trim().replace(/[\s()\-.]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^\d{9}$/.test(digits)) digits = `+48${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
