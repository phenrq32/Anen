import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/** Dual Workspace · Fase 5 (§5.6): despesas mensais com fim e parcelamentos. */
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("parcelas: criar 12, ver em a pagar, pagar uma e cancelar as restantes", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-parc-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Nuno Parcelas"));
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
  await main.getByLabel("Saldo inicial").fill("0");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco", { exact: true }).first()).toBeVisible();

  // Novo plano: 1.000,00 € em 12 parcelas no dia 31 (os meses curtos vencem no último dia)
  await page.goto("/financas/parcelas");
  await main.getByLabel("Descrição", { exact: true }).fill("Telemóvel em prestações");
  await main.getByLabel(/^Valor/).fill("1.000,00");
  await main.getByLabel("Dia do vencimento").fill("31");
  await expect(main.getByText(/^12 parcelas de .+ · total 1000,00\s€$/)).toBeVisible();
  // 1000,00 / 12 = 83,33; a última fica com 83,37
  await expect(main.getByText(/A última parcela fica com 83,37\s€/)).toBeVisible();
  await main.getByRole("button", { name: "Criar parcelas" }).click();
  await expect(main.getByText("Parcelas criadas.")).toBeVisible();
  const plan = main.getByRole("listitem", { name: "Telemóvel em prestações" });
  await expect(plan.getByText("Pagas: 0 · Faltam: 12")).toBeVisible();
  await expect(plan.getByText("1000,00 €")).toBeVisible();

  // As parcelas aparecem em "A pagar" como previstas, com o número
  await page.goto("/financas/em-aberto");
  const payables = main.getByRole("region", { name: "A pagar" });
  await expect(payables.getByText("Parcela 1 de 12")).toBeVisible();
  await expect(payables.getByText("Parcela 12 de 12")).toBeVisible();

  // Pagar a primeira (a lista está ordenada por vencimento)
  page.once("dialog", (d) => d.accept());
  await payables.getByRole("button", { name: "Marcar como liquidado" }).first().click();
  await expect(payables.getByText("Parcela 1 de 12")).toHaveCount(0);

  // Cancelar as restantes: a paga fica
  await page.goto("/financas/parcelas");
  await expect(plan.getByText("Pagas: 1 · Faltam: 11")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await plan.getByRole("button", { name: "Cancelar as restantes" }).click();
  await expect(plan.getByText("Pagas: 1 · Faltam: 0")).toBeVisible();
  await expect(plan.getByText("Cancelado a partir da parcela 2")).toBeVisible();
  await expect(plan.getByText("0,00 €")).toBeVisible();
  await plan.getByText("Ver parcelas").click();
  await expect(plan.getByRole("row").filter({ hasText: "Parcela 1 de 12" }).getByText("Paga")).toBeVisible();
  await expect(plan.getByRole("row").filter({ hasText: "Parcela 12 de 12" }).getByText("Cancelada")).toBeVisible();
  await page.goto("/financas/em-aberto");
  await expect(main.getByText("Telemóvel em prestações")).toHaveCount(0);
});
