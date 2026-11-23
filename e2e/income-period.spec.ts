import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

// Receitas de um período (migration 2600) e pagamento por IBAN em Portugal (migration 2500).
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

test("registar o total recebido numa semana e pedir o plano por transferência", async ({ page }, info) => {
  test.setTimeout(150_000);
  const email = `e2e-periodo-rec-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Rui Entregas"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Conta");
  await main.getByLabel("Saldo inicial").fill("0");
  await main.getByRole("button", { name: "Guardar" }).click();
  // Nome exato: "Conta" sozinho também apanhava o separador "Contas" e o teste seguia antes de a conta ser gravada.
  await expect(main.getByText("Conta", { exact: true }).first()).toBeVisible();

  await page.goto("/financas?registar=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Receita", { exact: true }).click();
  await dialog.getByText("Uma semana", { exact: true }).click();
  await expect(dialog.getByText(/Total da semana de \d{2}\/\d{2} a \d{2}\/\d{2}/)).toBeVisible();
  await dialog.getByLabel(/Valor/).fill("850");
  await dialog.getByLabel("Descrição").fill("Entregas da semana");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByText("«Entregas da semana»")).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).first().click();

  await page.goto("/financas/movimentos");
  await expect(main.getByText(/Semana \d{2}\/\d{2}–\d{2}\/\d{2}/).first()).toBeVisible();
  await expect(main.getByText("Entregas da semana")).toBeVisible();

  // Portugal: plano por transferência mostra o IBAN e a referência.
  await page.goto("/planos?moeda=EUR&periodo=mensal");
  await main.getByRole("button", { name: "Assinar Pro" }).click();
  await page.waitForURL(/\/planos\/transferencia\?pedido=anen-/);
  await expect(main.getByText(/3,99\s€/)).toBeVisible();
  await expect(main.locator('input[value^="PT50"]')).toBeVisible();
  await expect(main.locator('input[value^="anen-"]')).toHaveValue(/^anen-[0-9A-F]{12}$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
