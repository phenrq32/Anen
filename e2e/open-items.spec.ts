import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("a receber e a pagar: registar, editar, liquidar e eliminar na própria página", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-open-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Sara Aberto"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Sem conta, a página explica o que falta em vez de mostrar um formulário que não grava
  await page.goto("/financas/em-aberto");
  await expect(main.getByText("Para registar valores a receber ou a pagar, crie primeiro uma conta.")).toBeVisible();
  await main.getByRole("link", { name: "Criar conta" }).click();
  await page.waitForURL(/\/financas\/contas/);
  await main.getByLabel("Nome", { exact: true }).fill("Banco");
  await main.getByLabel("Saldo inicial").fill("0");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco").first()).toBeVisible();

  // Valor a pagar com vírgula decimal e milhares: fica pendente
  await page.goto("/financas/em-aberto");
  await expect(main.getByLabel("Estado do pagamento")).toHaveValue("pending");
  await main.getByLabel(/^Valor/).fill("1.250,40");
  await main.getByLabel("Descrição", { exact: true }).fill("Renda de dezembro");
  await main.getByLabel("Vencimento").fill("2026-12-08");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();
  const payables = main.getByRole("region", { name: "A pagar" });
  await expect(payables.getByText("Renda de dezembro")).toBeVisible();
  await expect(payables.getByText("1250,40 €").first()).toBeVisible();

  // Valor a receber, parcialmente recebido
  await page.goto("/financas/em-aberto?tipo=income");
  await main.getByLabel(/^Valor/).fill("800");
  await main.getByLabel("Descrição", { exact: true }).fill("Trabalho para cliente");
  await main.getByLabel("Estado do pagamento").selectOption("partial");
  await main.getByLabel(/Valor já liquidado/).fill("300");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();
  const receivables = main.getByRole("region", { name: "A receber" });
  await expect(receivables.getByText("Trabalho para cliente")).toBeVisible();
  await expect(receivables.getByText("500,00 €").first()).toBeVisible();

  // Editar a partir da lista: o valor muda e continua por pagar
  await payables.getByRole("link", { name: "Editar: Renda de dezembro" }).click();
  await page.waitForURL(/\/financas\/movimentos\?mes=\d{4}-\d{2}&editar=/);
  await expect(main.getByLabel("Estado do pagamento")).toHaveValue("pending");
  await main.getByLabel(/^Valor/).fill("1300");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Movimento atualizado.")).toBeVisible();
  await page.goto("/financas/em-aberto");
  await expect(main.getByRole("region", { name: "A pagar" }).getByText("1300,00 €").first()).toBeVisible();

  // Marcar como recebido
  page.once("dialog", (d) => d.accept());
  await main.getByRole("region", { name: "A receber" }).getByRole("button", { name: "Marcar como liquidado" }).click();
  await expect(main.getByText("Trabalho para cliente")).toHaveCount(0);

  // Eliminar
  page.once("dialog", (d) => d.accept());
  await main.getByRole("region", { name: "A pagar" }).getByRole("button", { name: "Eliminar" }).click();
  await expect(main.getByText("Renda de dezembro")).toHaveCount(0);
  await expect(main.getByText("Não há valores em aberto.")).toHaveCount(2);
});
