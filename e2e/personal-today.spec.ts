import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/**
 * Dual Workspace · Fase 5 (parte 2): assinaturas, dívidas, calendário com saldo previsto e "Hoje".
 * Valores calculados à mão: conta 1000,00 €; assinatura 12,99 € gerada hoje (paga);
 * portátil 600,00 € em 6 parcelas de 100,00 €, a primeira hoje (prevista).
 */
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("assinaturas, dívidas, calendário com saldo previsto e próximos pagamentos no Hoje", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-hoje-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Inês Hoje"));
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
  await main.getByLabel("Nome", { exact: true }).fill("Banco");
  await main.getByLabel("Saldo inicial").fill("1000");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco", { exact: true }).first()).toBeVisible();

  // Assinatura mensal a começar hoje
  await page.goto("/financas/recorrentes");
  await main.getByLabel(/^Valor/).fill("12,99");
  await main.getByLabel("Descrição", { exact: true }).fill("Streaming");
  await main.getByRole("button", { name: "Nova recorrência" }).click();
  await expect(main.getByText("Recorrência criada.")).toBeVisible();

  await page.goto("/financas/assinaturas");
  await expect(main.getByText("Streaming")).toBeVisible();
  await expect(main.getByText(/Total por mês: 12,99\s€/)).toBeVisible();
  await expect(main.getByText(/Total por ano: 155,88\s€/)).toBeVisible();

  // Parcelamento: 600,00 € em 6 parcelas, a primeira hoje (o dia e o início vêm preenchidos com hoje)
  await page.goto("/financas/parcelas");
  await main.getByLabel("Descrição", { exact: true }).fill("Portátil");
  await main.getByLabel(/^Valor/).fill("600");
  await main.getByLabel("Número de parcelas").fill("6");
  await main.getByRole("button", { name: "Criar parcelas" }).click();
  await expect(main.getByText("Parcelas criadas.")).toBeVisible();

  await page.goto("/financas/dividas");
  await expect(main.getByText("Portátil")).toBeVisible();
  await expect(main.getByText("Faltam 6 parcelas")).toBeVisible();
  await expect(main.getByRole("region", { name: "Em dívida" }).getByText(/600,00\s€/)).toBeVisible();

  // Calendário: saldo atual 987,01 € (só o pago) e previsto no fim do mês 887,01 €
  await page.goto("/financas/calendario");
  const forecast = main.getByRole("listitem", { name: "Saldo previsto EUR" });
  await expect(forecast.getByText(/987,01\s€/)).toBeVisible();
  await expect(forecast.getByText(/887,01\s€/)).toBeVisible();
  await expect(main.getByText("Portátil").filter({ visible: true }).first()).toBeVisible();

  // Hoje: próximos pagamentos e o menu pessoal
  await page.goto("/painel");
  await expect(main.getByRole("heading", { name: "Próximos pagamentos" })).toBeVisible();
  await expect(main.getByText("Portátil").filter({ visible: true }).first()).toBeVisible();
});
