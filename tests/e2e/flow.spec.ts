import { expect, test, type Page } from '@playwright/test';
import {
  account,
  addButton,
  clickPoint,
  complaintButton,
  fillRegistration,
  googleSignIn,
  jump,
  makeModerator,
  mapIdle,
  mapReady,
  newContext,
  northOfWarsaw,
  pointsOnMap,
  resetBackend,
  WARSAW,
} from './helpers';

const XSS_TITLE = '<img src=x onerror="window.__xss=1">Кафе';
const CAPTION = 'Лучший кофе в районе';

const expectToast = (page: Page, text: string) => expect(page.getByRole('status')).toContainText(text);

/** Статус метки на экране. Перед проверкой карта показывает окрестности Варшавы. */
const markerState = async (page: Page) => (await pointsOnMap(page))[0]?.state;

const signIn = (page: Page, email: string, name: string) =>
  googleSignIn(page, () => page.getByRole('button', { name: 'Войти через Google' }).click(), email, name);

async function placeMarker(page: Page, title: string, caption: string) {
  await addButton(page).click();
  await page.waitForTimeout(400);
  await mapIdle(page);
  await page.getByRole('button', { name: 'Поставить здесь' }).click();
  await page.locator('input[name=title]').fill(title);
  await page.locator('textarea[name=caption]').fill(caption);
  await page.getByRole('button', { name: 'Отправить на проверку' }).click();
}

test('полный путь: регистрация, модерация, метка, жалоба, блокировка', async ({ browser }) => {
  test.setTimeout(420_000);
  await resetBackend();

  const aliceContext = await newContext(browser);
  const alice = await aliceContext.newPage();
  const errors: string[] = [];
  alice.on('pageerror', (error) => errors.push(error.message));

  const moderatorContext = await newContext(browser);
  const moderator = await moderatorContext.newPage();

  await test.step('вход только через Google, по телефону войти нельзя', async () => {
    await alice.goto('./');
    await mapReady(alice);
    await account(alice).click();
    await expect(alice.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
    await expect(alice.getByRole('button', { name: /по номеру телефона/ })).toHaveCount(0);
  });

  await test.step('первый вход открывает регистрацию с данными из Google', async () => {
    await signIn(alice, 'alice@example.com', 'Алиса Ковальска');
    await expect(alice.getByRole('heading', { name: 'Регистрация' })).toBeVisible();
    await expect(alice.locator('input[name=email]')).toHaveValue('alice@example.com');
    await expect(alice.locator('input[name=email]')).toHaveJSProperty('readOnly', true);
    await expect(alice.locator('input[name=fullName]')).toHaveValue('Алиса Ковальска');
  });

  await test.step('форма проверяет телефон и оба согласия', async () => {
    await alice.locator('input[name=username]').fill('alice_k');
    await alice.locator('input[name=phone]').fill('123');
    await alice.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(alice.getByRole('alert')).toContainText('Проверьте номер');

    await alice.locator('input[name=phone]').fill('500 100 200');
    await alice.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(alice.getByRole('alert')).toContainText('оба документа');

    await alice.locator('input[name=consent-data]').check();
    await alice.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(alice.getByRole('alert')).toContainText('оба документа');
  });

  await test.step('документы открываются поверх формы и не сбрасывают её', async () => {
    await alice.getByRole('button', { name: 'правила конфиденциальности' }).click();
    await expect(alice.getByRole('heading', { name: 'Политика конфиденциальности' })).toBeVisible();
    await alice.keyboard.press('Escape');
    await expect(alice.getByRole('heading', { name: 'Политика конфиденциальности' })).toHaveCount(0);
    await expect(alice.getByRole('heading', { name: 'Регистрация' })).toBeVisible();
    await expect(alice.locator('input[name=username]')).toHaveValue('alice_k');

    await alice.getByRole('button', { name: 'согласие на обработку персональных данных' }).click();
    await expect(alice.getByRole('heading', { name: 'Согласие на обработку персональных данных' })).toBeVisible();
    await alice.keyboard.press('Escape');
  });

  await test.step('после регистрации приложение закрыто до одобрения', async () => {
    await alice.locator('input[name=consent-privacy]').check();
    await alice.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(alice.getByRole('heading', { name: 'Аккаунт на проверке' })).toBeVisible();

    await alice.keyboard.press('Escape');
    await expect(alice.getByRole('heading', { name: 'Аккаунт на проверке' })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Закрыть' })).toHaveCount(0);

    await alice.reload();
    await expect(alice.getByRole('heading', { name: 'Аккаунт на проверке' })).toBeVisible();
  });

  await test.step('модерация закрыта для посторонних', async () => {
    await moderator.goto('moderation/');
    await signIn(moderator, 'mod@example.com', 'Модератор');
    await expect(moderator.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
    await expect(moderator.getByRole('tab')).toHaveCount(0);
  });

  await test.step('назначенный модератор видит очередь и одобряет аккаунт', async () => {
    const uid = await moderator.locator('.uid').innerText();
    await makeModerator(uid);
    await moderator.reload();
    await expect(moderator.getByRole('tab', { name: /Аккаунты/ })).toContainText('1');
    await expect(moderator.getByText('alice_k')).toBeVisible();
    await expect(moderator.getByText('Алиса Ковальска')).toBeVisible();
    await expect(moderator.getByText('alice@example.com')).toBeVisible();
    // Девять цифр приведены к международному виду, а модератор видит, что номер не проверен.
    await expect(moderator.getByText('+48500100200')).toBeVisible();
    await expect(moderator.getByText('не проверен')).toBeVisible();

    await moderator.getByRole('button', { name: 'Одобрить' }).click();
    await expect(moderator.getByText('Здесь пока ничего нет.')).toBeVisible();
  });

  await test.step('одобрение открывает приложение без перезагрузки', async () => {
    await expect(alice.getByRole('heading', { name: 'Аккаунт на проверке' })).toHaveCount(0);
    await mapReady(alice);
    await expect(complaintButton(alice)).toHaveCount(0);
  });

  await test.step('новая метка уходит на проверку и видна только автору', async () => {
    await placeMarker(alice, XSS_TITLE, CAPTION);
    await expectToast(alice, 'отправлена на проверку');
    await jump(alice, WARSAW.longitude, WARSAW.latitude, 16);
    await expect.poll(() => markerState(alice)).toBe('pending');
    // Метка на проверке не зелёная, хотя человек стоит рядом.
    await expect(complaintButton(alice)).toHaveCount(0);
  });

  await test.step('вторая метка подряд отклоняется ограничением частоты', async () => {
    await placeMarker(alice, 'Вторая', 'Текст');
    await expect(alice.getByRole('alert')).toContainText('30 секунд');
    // Esc работает и после отправки, когда фокус слетел с отключённой кнопки.
    await alice.keyboard.press('Escape');
    await expect(alice.getByRole('heading', { name: 'Новая метка' })).toHaveCount(0);
  });

  await test.step('модератор одобряет метку, она становится зелёной, появляется кнопка жалоб', async () => {
    await moderator.getByRole('tab', { name: /Метки/ }).click();
    await expect(moderator.getByText(CAPTION)).toBeVisible();
    await expect(moderator.getByRole('tab', { name: /Метки/ })).toContainText('1');
    // Заголовок показан как текст: разметка из поля не выполняется.
    await expect(moderator.getByRole('heading', { name: XSS_TITLE })).toBeVisible();
    await expect(moderator.getByText('alice_k (Алиса Ковальска)')).toBeVisible();

    await moderator.getByRole('button', { name: 'На карте' }).click();
    await expect(moderator.locator('.mini-map canvas')).toBeVisible();
    await moderator.keyboard.press('Escape');

    await moderator.getByRole('button', { name: 'Одобрить' }).click();

    await expect.poll(() => markerState(alice)).toBe('active');
    await expect(complaintButton(alice)).toBeVisible();

    const buttons = await Promise.all(
      [complaintButton(alice), addButton(alice)].map((button) => button.boundingBox()),
    );
    expect(Math.abs((buttons[0]?.x ?? 0) - (buttons[1]?.x ?? 0))).toBeLessThan(20);
  });

  await test.step('нажатие на зелёную метку показывает название и надпись', async () => {
    await clickPoint(alice, WARSAW.longitude, WARSAW.latitude);
    const popup = alice.locator('.marker-popup');
    await expect(popup.locator('.marker-popup-title')).toHaveText(XSS_TITLE);
    await expect(popup.locator('.marker-popup-caption')).toHaveText(CAPTION);
    await expect(popup.locator('img')).toHaveCount(0);
    expect(await alice.evaluate(() => (window as never as { __xss?: number }).__xss)).toBeUndefined();
    await alice.screenshot({ path: 'test-results/marker-popup.png' });
  });

  await test.step('при уходе за 800 м метка гаснет, окно и кнопка жалоб исчезают', async () => {
    await aliceContext.setGeolocation({ ...northOfWarsaw(900), accuracy: 10 });
    await expect.poll(() => markerState(alice)).toBe('idle');
    await expect(alice.locator('.marker-popup')).toHaveCount(0);
    await expect(complaintButton(alice)).toHaveCount(0);

    await clickPoint(alice, WARSAW.longitude, WARSAW.latitude);
    await expectToast(alice, 'До метки 900 м');
    await expect(alice.locator('.marker-popup')).toHaveCount(0);
  });

  await test.step('на границе радиуса метка снова активируется', async () => {
    await aliceContext.setGeolocation({ ...northOfWarsaw(790), accuracy: 10 });
    await expect.poll(() => markerState(alice)).toBe('active');
    await expect(complaintButton(alice)).toBeVisible();
  });

  await test.step('при плохой точности GPS метка не активируется', async () => {
    // Скачок на грубую координату фильтруется 15 секунд, поэтому ждём, пока он пройдёт.
    await aliceContext.setGeolocation({ ...WARSAW, accuracy: 900 });
    await alice.waitForTimeout(16_000);
    await aliceContext.setGeolocation({ ...northOfWarsaw(1), accuracy: 900 });
    await expect(alice.locator('.gps-chip')).toContainText('Слабый сигнал GPS');
    await expect.poll(() => markerState(alice)).toBe('idle');
    await expect(complaintButton(alice)).toHaveCount(0);

    await aliceContext.setGeolocation({ ...WARSAW, accuracy: 10 });
    await expect.poll(() => markerState(alice)).toBe('active');
    await expect(alice.locator('.gps-chip')).toHaveCount(0);
  });

  const bobContext = await newContext(browser, { ...northOfWarsaw(300), accuracy: 12 });
  const bob = await bobContext.newPage();

  await test.step('занятое имя отклоняется, свободное проходит', async () => {
    await bob.goto('./');
    await mapReady(bob);
    await account(bob).click();
    await signIn(bob, 'bob@example.com', 'Боб Новак');
    await expect(bob.getByRole('heading', { name: 'Регистрация' })).toBeVisible();

    await fillRegistration(bob, { username: 'ALICE_K', phone: '+48 500 100 300' });
    await expect(bob.getByRole('alert')).toContainText('уже занято');

    await bob.locator('input[name=username]').fill('bob_n');
    await bob.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(bob.getByRole('heading', { name: 'Аккаунт на проверке' })).toBeVisible();
  });

  await test.step('модератор отклоняет с причиной, затем одобряет', async () => {
    await moderator.getByRole('tab', { name: /Аккаунты/ }).click();
    await moderator.getByRole('button', { name: 'Отклонить' }).click();
    await moderator.locator('textarea[name=reason]').fill('Проверьте ФИО');
    await moderator.getByRole('dialog').getByRole('button', { name: 'Отклонить' }).click();

    await expect(bob.getByRole('heading', { name: 'Заявка отклонена' })).toBeVisible();
    await expect(bob.getByText('Проверьте ФИО')).toBeVisible();

    await moderator.getByRole('button', { name: 'Отклонённые' }).click();
    await moderator.getByRole('button', { name: 'Одобрить' }).click();
    await expect(bob.getByRole('heading', { name: 'Заявка отклонена' })).toHaveCount(0);
    await moderator.getByRole('button', { name: 'Новые' }).click();
  });

  await test.step('другой пользователь видит чужую метку и подаёт жалобу', async () => {
    await mapReady(bob);
    await jump(bob, WARSAW.longitude, WARSAW.latitude, 15, 0);
    await expect.poll(() => markerState(bob)).toBe('active');

    await complaintButton(bob).click();
    await expect(bob.getByRole('heading', { name: 'Жалоба на метку' })).toBeVisible();
    await expect(bob.locator('.complaint-target')).toHaveText(XSS_TITLE);

    await bob.locator('textarea[name=complaint]').fill('мало');
    await bob.getByRole('button', { name: 'Отправить жалобу' }).click();
    await expect(bob.getByRole('alert')).toContainText('минимум');

    await bob.locator('textarea[name=complaint]').fill('На этом месте нет никакого кафе');
    await bob.getByRole('button', { name: 'Отправить жалобу' }).click();
    await expectToast(bob, 'Жалоба отправлена');
  });

  await test.step('вторая жалоба на ту же метку не проходит', async () => {
    await complaintButton(bob).click();
    await bob.locator('textarea[name=complaint]').fill('Ещё раз та же самая жалоба');
    await bob.getByRole('button', { name: 'Отправить жалобу' }).click();
    await expect(bob.getByRole('alert')).toContainText('уже отправляли');
    await bob.keyboard.press('Escape');
  });

  await test.step('модератор снимает метку по жалобе, она сразу исчезает у всех', async () => {
    await moderator.getByRole('tab', { name: /Жалобы/ }).click();
    await expect(moderator.getByRole('tab', { name: /Жалобы/ })).toContainText('1');
    await expect(moderator.getByText('На этом месте нет никакого кафе')).toBeVisible();
    await expect(moderator.getByText('bob_n (Боб Новак)')).toBeVisible();
    await expect(moderator.getByText('alice_k (Алиса Ковальска)')).toBeVisible();

    await moderator.getByRole('button', { name: 'Снять метку' }).click();
    await moderator.locator('textarea[name=reason]').fill('Недостоверная информация');
    await moderator.getByRole('dialog').getByRole('button', { name: 'Снять метку' }).click();
    await expect(moderator.getByText('Здесь пока ничего нет.')).toBeVisible();

    await expect.poll(() => pointsOnMap(alice).then((points) => points.length)).toBe(0);
    await expect.poll(() => pointsOnMap(bob).then((points) => points.length)).toBe(0);
    await expect(complaintButton(alice)).toHaveCount(0);
    await expect(complaintButton(bob)).toHaveCount(0);
  });

  await test.step('автор видит статус и причину снятия в аккаунте', async () => {
    await account(alice).click();
    await expect(alice.getByText('Снята модератором: Недостоверная информация')).toBeVisible();
    await alice.keyboard.press('Escape');
  });

  await test.step('блокировка сразу закрывает приложение', async () => {
    await moderator.getByRole('tab', { name: /Аккаунты/ }).click();
    await moderator.getByRole('button', { name: 'Одобренные' }).click();
    await moderator
      .getByRole('listitem')
      .filter({ hasText: 'bob_n' })
      .getByRole('button', { name: 'Заблокировать' })
      .click();
    await moderator.locator('textarea[name=reason]').fill('Спам');
    await moderator.getByRole('dialog').getByRole('button', { name: 'Заблокировать' }).click();

    await expect(bob.getByRole('heading', { name: 'Аккаунт заблокирован' })).toBeVisible();
    await expect(bob.getByText('Спам')).toBeVisible();
    await expect(bob.getByRole('button', { name: 'Удалить аккаунт' })).toHaveCount(0);
  });

  await test.step('пользователь удаляет свой аккаунт и все данные', async () => {
    await account(alice).click();
    await alice.getByRole('button', { name: 'Удалить аккаунт' }).click();
    await alice.getByRole('button', { name: 'Удалить навсегда' }).click();
    await expect(alice.getByRole('heading', { name: 'alice_k' })).toHaveCount(0);
    await expect(alice.getByRole('heading', { name: 'Регистрация' })).toHaveCount(0);
    await addButton(alice).click();
    await expect(alice.getByRole('heading', { name: 'Вход' })).toBeVisible();
    await alice.keyboard.press('Escape');

    await moderator.getByRole('button', { name: 'Новые' }).click();
    await moderator.getByRole('button', { name: 'Одобренные' }).click();
    await expect(moderator.getByText('alice_k')).toHaveCount(0);
  });

  await test.step('повторный вход той же почтой снова показывает блокировку', async () => {
    await bob.getByRole('button', { name: 'Выйти' }).click();
    await expect(bob.getByRole('heading', { name: 'Аккаунт заблокирован' })).toHaveCount(0);

    const fresh = await newContext(browser);
    const page = await fresh.newPage();
    await page.goto('./');
    await mapReady(page);
    await account(page).click();
    await signIn(page, 'bob@example.com', 'Боб Новак');
    await expect(page.getByRole('heading', { name: 'Аккаунт заблокирован' })).toBeVisible();
    await fresh.close();
  });

  expect(errors).toEqual([]);
  await aliceContext.close();
  await bobContext.close();
  await moderatorContext.close();
});

test('телефон: кнопки не перекрываются и окна умещаются на экране', async ({ browser }) => {
  await resetBackend();
  const context = await newContext(browser, undefined, {
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('./');
  await mapReady(page);
  await page.screenshot({ path: 'test-results/mobile-guest.png' });

  const noPageScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noPageScroll).toBe(true);

  await account(page).click();
  await signIn(page, 'mobile@example.com', 'Иван Иванов');
  await expect(page.getByRole('heading', { name: 'Регистрация' })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-register.png' });

  const dialog = await page.getByRole('dialog').boundingBox();
  expect(dialog?.width).toBeLessThanOrEqual(375);
  expect((dialog?.y ?? 0) + (dialog?.height ?? 0)).toBeLessThanOrEqual(667);

  await fillRegistration(page, { username: 'mobile_user', phone: '+48 500 100 900' });
  await expect(page.getByRole('heading', { name: 'Аккаунт на проверке' })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-pending.png' });
  await context.close();
});
