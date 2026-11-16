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

test("fornecedor, projeto e despesa pendente: desvio orçamental e valores a pagar", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-biz-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Rita Obras"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Conta
  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Banco");
  await main.getByLabel("Saldo inicial").fill("1000");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco").first()).toBeVisible();

  // Fornecedor
  await page.goto("/contactos");
  await main.getByLabel("Tipo", { exact: true }).selectOption("supplier");
  await main.getByLabel("Nome", { exact: true }).fill("Materiais Lisboa");
  await main.getByLabel("Prazo de pagamento (dias)").fill("30");
  await main.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL(/\/contactos\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { name: /Materiais Lisboa/ })).toBeVisible();

  // Projeto: previsto 300 € de custo e 500 € de receita
  await page.goto("/projetos");
  await main.locator("summary", { hasText: "Novo projeto" }).click();
  await main.getByLabel("Nome", { exact: true }).fill("Remodelação A");
  await main.getByLabel("Custo previsto").fill("300");
  await main.getByLabel("Receita prevista (sem impostos)").fill("500");
  await main.getByRole("button", { name: "Novo projeto" }).click();
  await page.waitForURL(/\/projetos\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  // Despesa de 350 € em materiais, por pagar, ligada ao projeto e ao fornecedor
  await main.getByRole("link", { name: "Registar movimento" }).click();
  await page.waitForURL(/\/financas\/movimentos\?projeto=/);
  await main.getByLabel(/^Valor/).fill("350");
  await main.getByLabel("Descrição", { exact: true }).fill("Cimento e tinta");
  await expect(main.getByLabel("Projeto")).toHaveValue(projectUrl.split("/").pop()!);
  await main.getByLabel("Cliente ou fornecedor").selectOption({ label: "Materiais Lisboa" });
  await main.getByLabel("Tipo de custo").selectOption("material");
  await main.getByLabel("Estado do pagamento").selectOption("pending");
  await main.getByLabel(/Imposto incluído/).fill("65,45");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();

  // O saldo não muda (ainda não foi pago) e a despesa aparece em "A pagar"
  await page.goto("/financas/em-aberto");
  await expect(main.getByText("Cimento e tinta")).toBeVisible();
  await expect(main.getByText("350,00 €").first()).toBeVisible();

  // Projeto: custo real sem IVA = 284,55 €, abaixo do previsto
  await page.goto(projectUrl);
  await expect(main.getByText("284,55 €").first()).toBeVisible();
  await expect(main.getByText(/ultrapassou o custo previsto/)).toHaveCount(0);

  // Segunda despesa sem imposto separado: 70 € → custo real 354,55 €, desvio de 54,55 €
  await main.getByRole("link", { name: "Registar movimento" }).click();
  await main.getByLabel(/^Valor/).fill("70");
  await main.getByLabel("Descrição", { exact: true }).fill("Parafusos");
  await main.getByLabel("Tipo de custo").selectOption("material");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();
  await page.goto(projectUrl);
  await expect(main.getByText("Este projeto ultrapassou o custo previsto em 54,55 € (18,2%).")).toBeVisible();
  // Projeto sem orçamento de origem: o real por tipo aparece, sem previsto nem desvio por tipo inventados
  const materialRow = main.getByRole("row").filter({ hasText: "Material" });
  await expect(materialRow.getByRole("cell").nth(0)).toHaveText("—");
  await expect(materialRow.getByRole("cell").nth(2)).toHaveText("—");

  // Marcar como pago: sai de "A pagar"
  await page.goto("/financas/em-aberto");
  page.once("dialog", (d) => d.accept());
  await main.getByRole("button", { name: "Marcar como liquidado" }).click();
  await expect(main.getByText("Cimento e tinta")).toHaveCount(0);
  await expect(main.getByText("Não há valores em aberto.").first()).toBeVisible();
});
