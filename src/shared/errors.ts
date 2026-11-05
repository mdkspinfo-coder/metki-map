/** Ошибка с готовым текстом для пользователя. */
export class AppError extends Error {}

const MESSAGES: Record<string, string> = {
  'auth/popup-blocked': 'Браузер заблокировал окно входа. Разрешите всплывающие окна и повторите.',
  'auth/popup-closed-by-user': 'Окно входа было закрыто.',
  'auth/cancelled-popup-request': 'Окно входа было закрыто.',
  'auth/unauthorized-domain': 'Этот адрес сайта не добавлен в настройках Firebase.',
  'auth/operation-not-allowed': 'Этот способ входа не включён в настройках Firebase.',
  'auth/billing-not-enabled': 'Отправка SMS недоступна: в Firebase не подключена оплата.',
  'auth/network-request-failed': 'Нет связи с сервером. Проверьте интернет.',
  'auth/too-many-requests': 'Слишком много попыток. Подождите и повторите позже.',
  'auth/quota-exceeded': 'Превышен лимит SMS. Повторите позже.',
  'auth/invalid-phone-number': 'Проверьте номер телефона.',
  'auth/missing-phone-number': 'Введите номер телефона.',
  'auth/invalid-verification-code': 'Неверный код из SMS.',
  'auth/missing-verification-code': 'Введите код из SMS.',
  'auth/code-expired': 'Срок действия кода истёк. Запросите новый.',
  'auth/session-expired': 'Срок действия кода истёк. Запросите новый.',
  'auth/captcha-check-failed': 'Не удалось пройти проверку reCAPTCHA. Повторите.',
  'auth/credential-already-in-use':
    'Этот номер уже привязан к другому аккаунту. Выйдите и войдите по номеру телефона.',
  'auth/account-exists-with-different-credential':
    'Этот номер уже привязан к другому аккаунту. Выйдите и войдите по номеру телефона.',
  'auth/provider-already-linked': 'К аккаунту уже привязан номер телефона.',
  'auth/requires-recent-login': 'Для этого действия войдите в аккаунт ещё раз.',
  'auth/user-disabled': 'Аккаунт отключён.',
  'permission-denied': 'Нет доступа к этому действию.',
  unavailable: 'Нет связи с сервером. Проверьте интернет.',
  'deadline-exceeded': 'Сервер не ответил вовремя. Повторите.',
};

const codeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

export function isPermissionDenied(error: unknown): boolean {
  return codeOf(error) === 'permission-denied';
}

export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  const code = codeOf(error);
  if (code && MESSAGES[code]) return MESSAGES[code];
  console.error(error);
  return 'Что-то пошло не так. Повторите попытку.';
}

/**
 * Запись в базу без сети не падает, а ждёт вечно, и кнопка осталась бы в состоянии
 * загрузки. Поэтому отказываем сразу и ограничиваем ожидание ответа.
 */
export async function withNetwork<T>(action: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AppError('Нет подключения к интернету.');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError('Сервер не отвечает. Проверьте интернет и повторите.')),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([action(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
