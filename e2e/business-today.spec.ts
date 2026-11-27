import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/**
 * Dual Workspace · Fase 6 (§6.1): "Hoje" da empresa. Saldo registado, resultado (lucro), rentabilidade e saldo
 * previsto a 30 dias separados; operação com valores em aberto, orçamentos pendentes, projetos e alertas.
 * Conta com 5000 €, receita paga de 3000 €, despesa paga de 2100 €, 1000 € por receber e 800 € por pagar
 * (ambos a vencer nos próximos 30 dias).
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

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("Hoje da empresa: saldo, lucro, rentabilidade, previsto e operação", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `e2e-biz-hoje-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Rui Empresa"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/organizacoes/nova");
  await page.getByLabel("Nome comercial").fill(`Obras Hoje ${Date.now()}`);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/painel/);

  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Banco");
  await main.getByLabel("Saldo inicial").fill("5000");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco", { exact: true }).first()).toBeVisible();

  const movement = async (kind: "income" | "expense", amount: string, description: string) => {
    await page.goto("/financas/movimentos");
    if (kind === "income") await main.getByText("Receita", { exact: true }).first().click();
    await main.getByLabel(/^Valor/).fill(amount);
    await main.getByLabel("Descrição", { exact: true }).fill(description);
    await main.getByRole("button", { name: "Guardar" }).click();
    await expect(main.getByText("Movimento registado.")).toBeVisible();
  };
  await movement("income", "3000", "Obra concluída");
  await movement("expense", "2100", "Materiais");

  const open = async (tipo: "income" | "expense", amount: string, description: string, due: string) => {
    await page.goto(tipo === "income" ? "/financas/em-aberto?tipo=income" : "/financas/em-aberto");
    await main.getByLabel(/^Valor/).fill(amount);
    await main.getByLabel("Descrição", { exact: true }).fill(description);
    await main.getByLabel("Vencimento").fill(due);
    await main.getByRole("button", { name: "Guardar" }).click();
    await expect(main.getByText("Movimento registado.")).toBeVisible();
  };
  await open("income", "1000", "Segunda prestação do cliente", inDays(10));
  await open("expense", "800", "Fornecedor de tintas", inDays(5));

  await page.goto("/painel");
  const card = (name: string) => main.getByRole("listitem", { name, exact: true });
  await expect(main.getByRole("heading", { name: "Dinheiro e resultado" })).toBeVisible();
  await expect(card("Saldo de caixa registado")).toContainText(/5900,00\s€/);
  await expect(card("Resultado do período (lucro)")).toContainText(/900,00\s€/);
  await expect(card("Rentabilidade")).toContainText(/30,0\s%/);
  await expect(card("Saldo previsto a 30 dias")).toContainText(/6100,00\s€/);
  await expect(card("Saldo previsto a 30 dias")).toContainText("É uma previsão");

  await expect(main.getByRole("heading", { name: "Operação" })).toBeVisible();
  await expect(main.getByRole("link", { name: "A receber (previsto)" })).toContainText(/1000,00\s€/);
  await expect(main.getByRole("link", { name: "A pagar (previsto)" })).toContainText(/800,00\s€/);
  await expect(main.getByRole("link", { name: "Orçamentos pendentes" })).toContainText("Nenhum orçamento à espera de resposta");
  await expect(main.getByRole("link", { name: "Projetos ativos" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Alertas financeiros" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Oportunidades de mercado" })).toBeVisible();
  await main.getByRole("link", { name: "A receber (previsto)" }).click();
  await page.waitForURL(/\/financas\/em-aberto/);
});
