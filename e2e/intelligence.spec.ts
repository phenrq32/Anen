import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser, setPersonalPlan } from "./admin";

// Centro de inteligência: recomendações determinísticas (todos os planos) e resumo da ANEN AI (Pro e Max).
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

test("recomendações com dados reais no Free; resumo da IA guardado no Pro", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `e2e-intel-${Date.now()}-${info.project.name}@example.com`;
  const userId = await createConfirmedUser(email, password, "Gestora Inteligência");
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

  // Sem movimentos: a página diz isso, sem inventar nada.
  await page.goto("/inteligencia");
  await expect(main.getByRole("heading", { name: "Centro de inteligência" })).toBeVisible();
  await expect(main.getByText("Sem movimentos neste período")).toBeVisible();

  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Banco");
  await main.getByLabel("Saldo inicial").fill("500");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco").first()).toBeVisible();

  // Despesa de 90 € paga hoje e outra de 60 € por pagar, vencida há 3 dias (sem receitas: resultado negativo).
  for (const [description, amount, due] of [["Material de escritório", "90", null], ["Fornecedor de papel", "60", isoDay(-3)]] as const) {
    await page.goto("/financas/movimentos");
    await main.getByLabel(/^Valor/).fill(amount);
    await main.getByLabel("Descrição", { exact: true }).fill(description);
    if (due) {
      await main.locator("summary", { hasText: MORE }).click();
      await main.getByLabel("Estado do pagamento").selectOption("pending");
      await main.getByLabel(/^Vencimento/).fill(due);
    }
    await main.getByRole("button", { name: "Guardar" }).click();
    await expect(main.getByText("Movimento registado.")).toBeVisible();
  }

  await page.goto("/inteligencia");
  const neg = main.locator('[data-kind="negative_result"]');
  await expect(neg).toBeVisible();
  await expect(neg.getByText(/em 150,00\s€/)).toBeVisible();
  await expect(neg.getByText("Prioridade alta")).toBeVisible();
  const overdue = main.locator('[data-kind="overdue_payables"]');
  await expect(overdue.getByText(/Pagamentos vencidos: 1, num total de 60,00\s€/)).toBeVisible();
  await overdue.getByRole("link", { name: "Ver em aberto" }).click();
  await page.waitForURL(/\/financas\/em-aberto/);

  // Período de 30 dias e sem deslocamento horizontal.
  await page.goto("/inteligencia?periodo=month");
  await expect(main.getByRole("link", { name: "Últimos 30 dias" })).toHaveAttribute("aria-current", "page");
  await expect(main.locator('[data-kind="negative_result"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // Free: sem resumo da IA (as recomendações continuam).
  await expect(main.getByText(/O resumo escrito pela IA está disponível nos planos Pro e Max/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Gerar resumo" })).toHaveCount(0);

  // Pro: pede o consentimento da ANEN AI e depois gera e guarda o resumo.
  await setPersonalPlan(userId, "pro");
  await page.goto("/inteligencia");
  await expect(main.getByText("Para gerar resumos, aceite primeiro as condições na página da ANEN AI.")).toBeVisible();
  await page.goto("/ia");
  await main.getByRole("button", { name: "Aceito e quero usar a ANEN AI" }).click();
  await page.goto("/inteligencia");
  await main.getByRole("button", { name: "Gerar resumo" }).click();
  const digest = main.getByRole("article", { name: "Resumo da ANEN AI" });
  await expect(digest).toBeVisible({ timeout: 150_000 });
  await expect(digest.getByText(/150,00|90,00|60,00/).first()).toBeVisible();
  await expect(digest.getByText(/^Gerado a/)).toBeVisible();
  // Guardado: voltar não gera outra vez.
  await page.reload();
  await expect(main.getByRole("article", { name: "Resumo da ANEN AI" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Gerar de novo" })).toBeVisible();
});
