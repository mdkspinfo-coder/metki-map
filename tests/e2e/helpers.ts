import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const PROJECT = 'demo-metki';
const AUTH = 'http://127.0.0.1:9099';
const STORE = 'http://127.0.0.1:8080';
const ORIGIN = 'http://127.0.0.1:4173';

export const WARSAW = { latitude: 52.2297, longitude: 21.0122 };

/** Точка на заданном расстоянии к северу от Варшавы. */
export const northOfWarsaw = (meters: number) => ({
  latitude: WARSAW.latitude + meters / 111_195,
  longitude: WARSAW.longitude,
});

export async function resetBackend() {
  await fetch(`${STORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  });
}

/** Назначение модератора: на настоящем проекте это делается вручную в консоли. */
export async function makeModerator(uid: string) {
  const response = await fetch(
    `${STORE}/v1/projects/${PROJECT}/databases/(default)/documents/moderators?documentId=${uid}`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { addedAt: { integerValue: '1' } } }),
    },
  );
  expect(response.ok).toBe(true);
}

const DOCUMENTS = `${STORE}/v1/projects/${PROJECT}/databases/(default)/documents`;
const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

/** Готовая метка в базе, в обход модерации. */
export async function seedApprovedMarker(
  id: string,
  title: string,
  caption: string,
  position: { latitude: number; longitude: number },
) {
  const response = await fetch(`${DOCUMENTS}/markers?documentId=${id}`, {
    method: 'POST',
    headers: ADMIN,
    body: JSON.stringify({
      fields: {
        title: { stringValue: title },
        caption: { stringValue: caption },
        lat: { doubleValue: position.latitude },
        lng: { doubleValue: position.longitude },
        ownerId: { stringValue: 'someone-else' },
        status: { stringValue: 'approved' },
        createdAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  expect(response.ok).toBe(true);
}

/** Одобряет единственный профиль в базе так же, как это сделал бы модератор. */
export async function approveOnlyUser() {
  const list = (await (await fetch(`${DOCUMENTS}/users`, { headers: ADMIN })).json()) as {
    documents: { name: string }[];
  };
  expect(list.documents).toHaveLength(1);
  const uid = list.documents[0].name.split('/').at(-1);
  const response = await fetch(`${DOCUMENTS}/users/${uid}?updateMask.fieldPaths=status`, {
    method: 'PATCH',
    headers: ADMIN,
    body: JSON.stringify({ fields: { status: { stringValue: 'approved' } } }),
  });
  expect(response.ok).toBe(true);
}

/** На какие метки поданы жалобы. */
export async function complaintMarkerIds(): Promise<string[]> {
  const list = (await (await fetch(`${DOCUMENTS}/complaints`, { headers: ADMIN })).json()) as {
    documents?: { fields: { markerId: { stringValue: string } } }[];
  };
  return (list.documents ?? []).map((item) => item.fields.markerId.stringValue);
}

export async function newContext(
  browser: Browser,
  geolocation: { latitude: number; longitude: number; accuracy?: number } = { ...WARSAW, accuracy: 10 },
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: `${ORIGIN}/metki-map/`,
    locale: 'ru-RU',
    geolocation,
    viewport: { width: 1100, height: 760 },
    ...options,
  });
  await context.grantPermissions(['geolocation'], { origin: ORIGIN });
  return context;
}

export async function mapReady(page: Page) {
  await expect(page.locator('.map[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
}

/** Ждёт, пока карта перестанет двигаться и догрузит всё нужное. */
export async function mapIdle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (window as never as { __map: { isMoving(): boolean; loaded(): boolean; once(e: string, f: () => void): void } }).__map;
        const check = () => {
          if (!map.isMoving() && map.loaded()) resolve();
          else setTimeout(check, 150);
        };
        check();
      }),
  );
}

export async function jump(page: Page, lng: number, lat: number, zoom: number, pitch = 55) {
  await page.evaluate(
    ([x, y, z, p]) => {
      (window as never as { __map: { jumpTo(o: unknown): void } }).__map.jumpTo({
        center: [x, y],
        zoom: z,
        pitch: p,
        bearing: 0,
      });
    },
    [lng, lat, zoom, pitch],
  );
  await page.waitForTimeout(300);
  await mapIdle(page);
}

export interface PointOnMap {
  id: string;
  state: string;
}

export function pointsOnMap(page: Page): Promise<PointOnMap[]> {
  return page.evaluate(() => {
    const map = (window as never as {
      __map: { queryRenderedFeatures(o: unknown): { properties: { id: string; state: string } }[] };
    }).__map;
    return map.queryRenderedFeatures({ layers: ['points-dot'] }).map((feature) => feature.properties);
  });
}

export async function clickPoint(page: Page, lng: number, lat: number) {
  const point = await page.evaluate(
    ([x, y]) =>
      (window as never as { __map: { project(c: number[]): { x: number; y: number } } }).__map.project([x, y]),
    [lng, lat],
  );
  await page.locator('.map canvas').click({ position: { x: point.x, y: point.y } });
}

export async function googleSignIn(page: Page, click: () => Promise<void>, email: string, name: string) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
  await popup.waitForLoadState();
  await popup.locator('#add-account-button').click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill(name);
  await popup.locator('#sign-in').click();
}

export async function fillRegistration(page: Page, input: { username: string; phone: string }) {
  await page.locator('input[name=username]').fill(input.username);
  await page.locator('input[name=phone]').fill(input.phone);
  await page.locator('input[name=consent-data]').check();
  await page.locator('input[name=consent-privacy]').check();
  await page.getByRole('button', { name: 'Отправить на проверку' }).click();
}

export const account = (page: Page) => page.getByRole('button', { name: 'Аккаунт', exact: true });
export const addButton = (page: Page) => page.getByRole('button', { name: 'Добавить метку' });
export const locateButton = (page: Page) => page.getByRole('button', { name: 'Показать моё местоположение' });
export const complaintButton = (page: Page) => page.getByRole('button', { name: 'Пожаловаться на метку' });
