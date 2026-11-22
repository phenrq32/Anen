import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser, setPersonalPlan } from "./admin";

// ANEN AI: só nos planos Pro e Max, com consentimento, limite diário e respostas com fontes.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("ANEN AI: bloqueada no Free; no Pro pede consentimento e responde com dados reais e fontes", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `e2e-ia-${Date.now()}-${info.project.name}@example.com`;
  const userId = await createConfirmedUser(email, password, "Gestora IA");
  created.push(userId);
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Free: sem IA, com os limites dos planos.
  await page.goto("/ia");
  await expect(main.getByText("Disponível nos planos Pro e Max")).toBeVisible();
  await expect(main.getByText(/Pro: 25 perguntas por dia · Max: 100 perguntas por dia/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Perguntar" })).toHaveCount(0);

  // Dados reais: uma conta e uma despesa de 42,50 € hoje.
  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Banco");
  await main.getByLabel("Saldo inicial").fill("500");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco").first()).toBeVisible();
  await page.goto("/financas/movimentos");
  await main.getByLabel(/^Valor/).fill("42,50");
  await main.getByLabel("Descrição", { exact: true }).fill("Tinta branca");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();

  // Pro: consentimento e pergunta.
  await setPersonalPlan(userId, "pro");
  await page.goto("/ia");
  await expect(main.getByText("Plano Pro")).toBeVisible();
  await main.getByRole("button", { name: "Aceito e quero usar a ANEN AI" }).click();
  await expect(main.getByText("0 de 25 perguntas hoje")).toBeVisible();
  await main.getByRole("button", { name: "Quanto gastei este mês e em quê?" }).click();
  await page.waitForURL(/\/ia\?c=[0-9a-f-]{36}/, { timeout: 150_000 });
  const answer = main.locator("li").filter({ hasText: "ANEN AI" }).last();
  await expect(answer).toBeVisible();
  // O valor vem da ferramenta (cálculo da ANEN) e a fonte aponta para o relatório do período.
  await expect(answer).toContainText(/42,50/);
  await expect(answer.getByRole("link", { name: /Relatório/ })).toBeVisible();
  await expect(answer).toContainText(/Consultou: .*resumo financeiro/);
  await expect(main.getByText("1 de 25 perguntas hoje")).toBeVisible();

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);
});
