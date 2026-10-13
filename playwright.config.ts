import { defineConfig, devices } from '@playwright/test';

// Testes de interface com respostas simuladas da API Supabase (apenas para teste;
// nada disto é incluído na aplicação). As regras de servidor são testadas em tests/db.
const executablePath = process.env.PW_CHROMIUM_PATH ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5179', locale: 'pt-PT', timezoneId: 'Europe/Lisbon', trace: 'off', launchOptions: executablePath ? { executablePath } : {} },
  projects: [
    { name: 'telemovel', use: { ...devices['Pixel 7'], locale: 'pt-PT', launchOptions: executablePath ? { executablePath } : {} } },
    { name: 'computador', use: { locale: 'pt-PT', viewport: { width: 1280, height: 800 }, launchOptions: executablePath ? { executablePath } : {} } },
  ],
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: true,
    env: { VITE_SUPABASE_URL: 'http://mock.supabase.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste', VITE_ENVIRONMENT_LABEL: 'Teste' },
  },
});
