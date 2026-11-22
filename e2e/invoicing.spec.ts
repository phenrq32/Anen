import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Faturação certificada via InvoiceXpress: ligação da conta (validada no InvoiceXpress real) e avisos legais.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("faturação: explica a certificação, valida a conta no InvoiceXpress e não guarda uma chave recusada", async ({ page }, info) => {
  test.setTimeout(120_000);
  const email = `e2e-fat-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Gestor Faturas"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/faturacao");
  await expect(main.getByRole("heading", { name: "Faturação", level: 1 })).toBeVisible();
  await expect(main.getByText(/A ANEN não é um programa de faturação certificado/)).toBeVisible();
  await expect(main.getByText("Ligar a sua conta InvoiceXpress")).toBeVisible();
  await expect(main.getByText("Ainda não há documentos.")).toBeVisible();
  // Sem conta ligada não há "Novo documento".
  await expect(main.getByRole("link", { name: "Novo documento" })).toHaveCount(0);

  // Conta inválida: o nome com domínio é recusado antes de sair da ANEN.
  await main.getByLabel(/^Nome da conta/).fill("conta.evil.com");
  await main.getByLabel(/^Chave da API/).fill("chave-falsa-1234567890");
  await main.getByRole("button", { name: "Ligar conta" }).click();
  await expect(main.getByText(/Nome de conta inválido/)).toBeVisible();

  // Chave recusada pelo InvoiceXpress real: mensagem clara e nada guardado.
  await main.getByLabel(/^Nome da conta/).fill(`anen-e2e-${Date.now()}`);
  await main.getByRole("button", { name: "Ligar conta" }).click();
  await expect(main.getByText(/O InvoiceXpress recusou a chave da API/)).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(main.getByText("Ligar a sua conta InvoiceXpress")).toBeVisible();

  // O formulário de novo documento exige a conta ligada.
  await page.goto("/faturacao/novo");
  await page.waitForURL(/\/faturacao$/);

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);
});
