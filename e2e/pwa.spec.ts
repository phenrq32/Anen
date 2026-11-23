import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

// App instalável (PWA) e notificações push.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

test("manifesto, service worker, página sem ligação e rotina de envio protegida", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const json = await manifest.json();
  expect(json).toMatchObject({ short_name: "ANEN", display: "standalone", start_url: "/painel?origem=app" });
  expect(json.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
  for (const path of ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]) {
    const r = await request.get(path);
    expect(r.ok(), path).toBe(true);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain("showNotification");
  expect((await request.get("/offline.html")).ok()).toBe(true);
  // A rotina de envio não responde sem o segredo do cron (nem redireciona para o login).
  const dispatch = await request.get("/api/push/dispatch", { maxRedirects: 0 });
  expect(dispatch.status()).toBe(401);
});

test("definições: app no telemóvel, notificações e atalho de registo", async ({ page }, info) => {
  test.setTimeout(120_000);
  const email = `e2e-pwa-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Pedro App"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");
  // O service worker fica registado.
  await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/"))), { timeout: 15_000 }).toBe(true);
  await page.goto("/definicoes#app");
  await expect(main.getByRole("heading", { name: "App no telemóvel" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Notificações no aparelho" })).toBeVisible();
  // Num navegador de testes há suporte de push: o botão de ativar aparece (não o carregamos: pediria permissão).
  await expect(main.getByRole("button", { name: "Ativar notificações" }).or(main.getByText(/não suporta notificações|bloqueadas/))).toBeVisible();

  // Atalho do ícone: abre o registo rápido (depois de haver uma conta).
  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Carteira");
  await main.getByLabel("Saldo inicial").fill("10");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Carteira").first()).toBeVisible();
  await page.goto("/financas?registar=1");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Registo rápido" })).toBeVisible();
});
