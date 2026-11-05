import { defineConfig } from '@playwright/test';

// Сценарии идут по собранному сайту из подпапки, как на GitHub Pages. Перед запуском:
//   npx vite build --mode emulator --outDir e2e-dist/metki-map
//   npm run emulators
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/metki-map/',
    channel: process.env.E2E_CHANNEL ?? 'msedge',
    viewport: { width: 1100, height: 760 },
    locale: 'ru-RU',
    screenshot: 'only-on-failure',
    // Иначе клик по перекрытому элементу ждал бы до конца всего теста.
    actionTimeout: 25_000,
    launchOptions: {
      // Программный WebGL: карта рисуется и там, где нет видеокарты.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npx vite preview --outDir e2e-dist',
    url: 'http://127.0.0.1:4173/metki-map/index.html',
    reuseExistingServer: true,
  },
});
