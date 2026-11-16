import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra um ambiente real (staging ou produção).
 * Requer E2E_BASE_URL, E2E_SUPABASE_URL e E2E_SUPABASE_SECRET_KEY (só no ambiente de execução, nunca no repositório).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://anen-five.vercel.app",
    locale: "pt-PT",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
