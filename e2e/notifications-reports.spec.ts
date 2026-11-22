import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Prompt 03 · Fase 9: notificações na aplicação e relatórios por período.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

const MORE = "Mais detalhes";
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("notificações de pagamentos (vencido e a vencer), preferências e relatório com faturado e por pagar", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-notif-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Gestor Avisos"));
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
  await expect(main.getByText("Banco").first()).toBeVisible();

  // Duas despesas por pagar: uma vencida há 5 dias, outra a vencer amanhã.
  for (const [description, amount, due] of [["Renda do armazém", "120", isoDay(-5)], ["Seguro", "80", isoDay(1)]] as const) {
    await page.goto("/financas/movimentos");
    await main.getByLabel(/^Valor/).fill(amount);
    await main.getByLabel("Descrição", { exact: true }).fill(description);
    await main.locator("summary", { hasText: MORE }).click();
    await main.getByLabel("Estado do pagamento").selectOption("pending");
    await main.getByLabel(/^Vencimento/).fill(due);
    await main.getByRole("button", { name: "Guardar" }).click();
    await expect(main.getByText("Movimento registado.")).toBeVisible();
  }

  // A página gera as notificações em falta; o menu mostra o contador.
  await page.goto("/notificacoes");
  await expect(main.getByText("Pagamento vencido: Renda do armazém")).toBeVisible();
  await expect(main.getByText("A pagar em breve: Seguro")).toBeVisible();
  await expect(main.getByText(/120,00\s€ por liquidar · venceu a/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("2 por ler").first()).toBeAttached();

  // Abrir leva ao destino e marca como lida.
  await main.getByRole("listitem").filter({ hasText: "Renda do armazém" }).getByRole("button", { name: "Abrir" }).click();
  await page.waitForURL(/\/financas\/em-aberto/);
  await page.goto("/notificacoes");
  await expect(main.getByText("Pagamento vencido: Renda do armazém")).toHaveCount(0);
  await page.goto("/notificacoes?ver=todas");
  await expect(main.getByText("Pagamento vencido: Renda do armazém")).toBeVisible();

  // Preferências e marcar todas como lidas.
  await main.getByLabel("Pagamentos e recebimentos a vencer").uncheck();
  await main.getByRole("button", { name: "Guardar preferências" }).click();
  await expect(main.getByText("Preferências guardadas.")).toBeVisible();
  await page.goto("/notificacoes");
  await main.getByRole("button", { name: "Marcar todas como lidas" }).click();
  await expect(main.getByText("Não há notificações por ler.")).toBeVisible();
  await page.reload();
  await expect(main.getByLabel("Pagamentos e recebimentos a vencer")).not.toBeChecked();

  // Relatório do mês: 200 € faturados, nada pago, 200 € por pagar; CSV por categoria.
  await page.goto("/relatorios");
  await expect(main.getByText(/^200,00\s€$/).first()).toBeVisible();
  await expect(main.getByText(/Por pagar: 200,00\s€/)).toBeVisible();
  await expect(main.getByRole("table", { name: "Por categoria" })).toBeVisible();
  const href = await main.getByRole("link", { name: "Exportar CSV" }).first().getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain('"200.00"');
  expect(text.split("\r\n")).toHaveLength(2);
  await page.goto("/relatorios?periodo=previous_year");
  await expect(main.getByText("Não há movimentos neste período.")).toBeVisible();
  await page.goto(`/relatorios?periodo=custom&de=${isoDay(-40)}&ate=${isoDay(40)}`);
  await expect(main.getByText(/^200,00\s€$/).first()).toBeVisible();

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);
});
