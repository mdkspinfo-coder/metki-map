import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { pointInRing } from '../../src/shared/geo';
import { addButton, account, jump, locateButton, mapIdle, mapReady, newContext, resetBackend, WARSAW } from './helpers';

const POLAND_RING: number[][] = JSON.parse(readFileSync('src/shared/poland-boundary.json', 'utf8')).precise
  .coordinates[0][0];

const countLayer = (page: Page, layer: string) =>
  page.evaluate(
    (id) =>
      (window as never as { __map: { queryRenderedFeatures(o: unknown): unknown[] } }).__map.queryRenderedFeatures({
        layers: [id],
      }).length,
    layer,
  );

test.beforeAll(resetBackend);

test('карта открывается из подпапки, как на GitHub Pages', async ({ page }) => {
  const failed: string[] = [];
  page.on('requestfailed', (request) => failed.push(request.url()));
  page.on('pageerror', (error) => failed.push(error.message));
  await page.goto('./');
  await mapReady(page);
  await mapIdle(page);
  expect(failed).toEqual([]);
});

test('3D-здания есть только в Польше', async ({ page }) => {
  await page.goto('./');
  await mapReady(page);

  await jump(page, 21.0122, 52.2297, 16); // Варшава
  expect(await countLayer(page, 'poland-buildings-3d')).toBeGreaterThan(20);
  await page.screenshot({ path: 'test-results/warsaw-3d.png' });

  await jump(page, 19.945, 50.0647, 16); // Краков
  expect(await countLayer(page, 'poland-buildings-3d')).toBeGreaterThan(20);

  await jump(page, 13.405, 52.52, 16); // Берлин
  expect(await countLayer(page, 'poland-buildings-3d')).toBe(0);
  // Плоские контуры за границей не должны пропасть вместе с 3D.
  expect(await countLayer(page, 'building')).toBeGreaterThan(20);
  await page.screenshot({ path: 'test-results/berlin-flat.png' });

  await jump(page, 24.0297, 49.8397, 16); // Львов
  expect(await countLayer(page, 'poland-buildings-3d')).toBe(0);
});

test('у границы 3D обрывается на самой границе', async ({ page }) => {
  await page.goto('./');
  await mapReady(page);

  // Первая точка каждого объёмного дома. Соседние дома в данных карты бывают объединены
  // в один составной объект, поэтому разбираем и простые, и составные.
  const buildings = () =>
    page.evaluate(() => {
      type Feature = { geometry: { type: string; coordinates: unknown } };
      const map = (window as never as { __map: { queryRenderedFeatures(o: unknown): Feature[] } }).__map;
      return map.queryRenderedFeatures({ layers: ['poland-buildings-3d'] }).flatMap(({ geometry }) => {
        const polygons = (
          geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
        ) as number[][][][];
        return polygons.map((polygon) => polygon[0][0]);
      });
    });

  // Згожелец (Польша) и Гёрлиц (Германия) разделены рекой Нысой: на экране оба берега.
  await jump(page, 14.9975, 51.1525, 15, 50);
  await expect.poll(async () => (await buildings()).length, { timeout: 30_000 }).toBeGreaterThan(100);
  await page.screenshot({ path: 'test-results/border-3d-view.png' });
  const foreign = (await buildings()).filter(([lng, lat]) => !pointInRing(lng, lat, POLAND_RING));
  expect(foreign).toEqual([]);

  // На немецком берегу вблизи объёмных домов нет совсем, а плоские есть.
  await jump(page, 14.985, 51.1535, 17, 60);
  await page.waitForTimeout(1000);
  expect(await buildings()).toEqual([]);
  expect(await countLayer(page, 'building')).toBeGreaterThan(20);

  // На польском берегу объёмные все.
  await jump(page, 15.0065, 51.1535, 17, 60);
  await expect.poll(async () => (await buildings()).length, { timeout: 30_000 }).toBeGreaterThan(30);
});

test('рядом с Польшей карта не зависает', async ({ page }) => {
  await page.goto('./');
  await mapReady(page);
  await jump(page, 21.0122, 52.2297, 15);

  // Раньше обработка участков Берлина занимала больше минуты.
  const started = Date.now();
  await jump(page, 13.405, 52.52, 15);
  expect(Date.now() - started).toBeLessThan(15_000);
});

test('после прокрутки вокруг Земли 3D остаётся в Польше', async ({ page }) => {
  await page.goto('./');
  await mapReady(page);
  await jump(page, 21.0122 + 360, 52.2297, 16);
  await expect
    .poll(() => countLayer(page, 'poland-buildings-3d'), { timeout: 30_000 })
    .toBeGreaterThan(20);
});

test('гость: кнопки на месте, жалоб нет, метки ставить нельзя', async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto('./');
  await mapReady(page);

  const accountBox = await account(page).boundingBox();
  const locateBox = await locateButton(page).boundingBox();
  const addBox = await addButton(page).boundingBox();
  if (!accountBox || !locateBox || !addBox) throw new Error('кнопка не найдена');

  expect(accountBox.x).toBeLessThan(40);
  expect(accountBox.y).toBeLessThan(40);
  expect(locateBox.x).toBeGreaterThan(900);
  expect(addBox.x).toBeGreaterThan(900);
  expect(addBox.y).toBeGreaterThan(600);
  expect(addBox.width).toBeGreaterThan(locateBox.width);
  await expect(page.getByRole('button', { name: 'Пожаловаться на метку' })).toHaveCount(0);

  await addButton(page).click();
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Вход' })).toHaveCount(0);
  await context.close();
});

test('кнопка GPS приближает карту к реальным координатам', async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto('./');
  await mapReady(page);
  await locateButton(page).click();
  await page.waitForTimeout(500);
  await mapIdle(page);

  const view = await page.evaluate(() => {
    const map = (window as never as {
      __map: { getCenter(): { lat: number; lng: number }; getZoom(): number; getPitch(): number };
    }).__map;
    return { ...map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch() };
  });
  expect(view.lat).toBeCloseTo(WARSAW.latitude, 4);
  expect(view.lng).toBeCloseTo(WARSAW.longitude, 4);
  expect(view.zoom).toBeGreaterThanOrEqual(17);
  expect(view.pitch).toBeGreaterThan(40);
  await context.close();
});

test('если геолокация запрещена, человек видит понятное сообщение', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173/metki-map/' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const denied = { code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' };
    navigator.geolocation.watchPosition = (_ok, fail) => {
      setTimeout(() => fail?.(denied as GeolocationPositionError), 10);
      return 1;
    };
  });
  await page.goto('./');
  await mapReady(page);
  await locateButton(page).click();
  await expect(page.getByRole('status')).toContainText('Доступ к геолокации запрещён');
  await context.close();
});
