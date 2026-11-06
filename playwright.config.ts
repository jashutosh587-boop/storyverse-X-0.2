import { defineConfig, devices } from '@playwright/test';
import { ANON_KEY } from './e2e/mock-supabase/jwt';

const APP_PORT = 3100;
const MOCK_PORT = 54321;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
// A second copy of the site on a project that has never had a title imported: what the owner sees first.
const EMPTY_APP_PORT = 3101;
const EMPTY_MOCK_PORT = 54322;
const EMPTY_APP_URL = `http://127.0.0.1:${EMPTY_APP_PORT}`;

/**
 * End-to-end tests run the built site (`npm run build` first) against a stand-in
 * for Supabase (e2e/mock-supabase) that executes the real SQL migrations.
 * Both servers are started fresh for every run so no state carries over.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  // One shared stand-in database, and the tests create accounts in it, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: APP_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, testIgnore: /first-run\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /(smoke|layout)\.spec\.ts/ },
    {
      name: 'first-run',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: EMPTY_APP_URL },
      testMatch: /first-run\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'npx tsx e2e/mock-supabase/server.ts',
      url: `http://127.0.0.1:${MOCK_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { MOCK_SUPABASE_PORT: String(MOCK_PORT) },
    },
    {
      command: `npx next start -p ${APP_PORT} -H 127.0.0.1`,
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        SUPABASE_ANON_KEY: ANON_KEY,
        SITE_URL: APP_URL,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
    {
      command: 'npx tsx e2e/mock-supabase/server.ts',
      url: `http://127.0.0.1:${EMPTY_MOCK_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { MOCK_SUPABASE_PORT: String(EMPTY_MOCK_PORT), MOCK_SUPABASE_EMPTY: '1' },
    },
    {
      command: `npx next start -p ${EMPTY_APP_PORT} -H 127.0.0.1`,
      url: EMPTY_APP_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        SUPABASE_URL: `http://127.0.0.1:${EMPTY_MOCK_PORT}`,
        SUPABASE_ANON_KEY: ANON_KEY,
        SITE_URL: EMPTY_APP_URL,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
