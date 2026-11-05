import { expect, test } from '@playwright/test';
import { account, addButton, mapReady } from './helpers';

// Рабочая сборка без настроек Firebase: так сайт выглядит сразу после загрузки на GitHub.
// Перед запуском: npx vite build --outDir e2e-dist/unconfigured
const BASE = 'http://127.0.0.1:4173/unconfigured/';

test('без настроек Firebase карта работает, а вход честно недоступен', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));

  await page.goto(BASE);
  await mapReady(page);
  await account(page).click();
  await expect(page.getByRole('heading', { name: 'Вход пока недоступен' })).toBeVisible();
  await page.keyboard.press('Escape');

  await addButton(page).click();
  await expect(page.getByRole('heading', { name: 'Вход пока недоступен' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('сайт модерации без настроек показывает понятное сообщение', async ({ page }) => {
  await page.goto(`${BASE}moderation/`);
  await expect(page.getByRole('heading', { name: 'Сервер не настроен' })).toBeVisible();
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('рабочая сборка не открывает отладочный доступ к карте', async ({ page }) => {
  await page.goto(BASE);
  await mapReady(page);
  expect(await page.evaluate(() => '__map' in window)).toBe(false);
});
