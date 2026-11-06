import { expect, test } from '@playwright/test';
import { account, addButton, mapReady } from './helpers';

// Рабочая сборка, как на GitHub Pages. Ничего не пишет в настоящую базу.
// Перед запуском: npx vite build --outDir e2e-dist/production
const BASE = 'http://127.0.0.1:4173/production/';

test('рабочая сборка: карта открывается, гость видит только вход', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));

  await page.goto(BASE);
  await mapReady(page);
  await account(page).click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await page.keyboard.press('Escape');

  await addButton(page).click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('сайт модерации закрыт от поисковиков и начинается со входа', async ({ page }) => {
  await page.goto(`${BASE}moderation/`);
  await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow');
});

test('рабочая сборка не открывает отладочный доступ к карте', async ({ page }) => {
  await page.goto(BASE);
  await mapReady(page);
  expect(await page.evaluate(() => '__map' in window)).toBe(false);
});
