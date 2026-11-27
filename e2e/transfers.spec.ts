import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/** Dual Workspace · Fase 7 (§7): retirar 500 € da empresa para a conta pessoal, com confirmação, e reverter. */
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("transferência da empresa para o pessoal: rever, confirmar, ver nos dois lados e reverter", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `e2e-transf-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Marta Sócia"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  const account = async (name: string, opening: string) => {
    await page.goto("/financas/contas");
    await main.getByLabel("Nome", { exact: true }).fill(name);
    await main.getByLabel("Saldo inicial").fill(opening);
    await main.getByRole("button", { name: "Guardar" }).click();
    await expect(main.getByText(name, { exact: true }).first()).toBeVisible();
  };
  await account("Conta pessoal", "0");
  const orgName = `Atelier ${Date.now()}`;
  await page.goto("/organizacoes/nova");
  await page.getByLabel("Nome comercial").fill(orgName);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/painel/);
  await account("Banco do atelier", "2000");

  await page.goto("/financas/transferencias");
  await expect(main.getByText(/a ANEN não decide se é rendimento, lucro, despesa/)).toBeVisible();
  await main.getByLabel("Outro espaço", { exact: true }).selectOption({ label: "Pessoal" });
  await main.getByLabel(/^Valor/).fill("500");
  await main.getByLabel("Descrição", { exact: true }).fill("Levantamento de novembro");
  await main.getByRole("button", { name: "Rever transferência" }).click();
  await expect(main.getByText("Confirme antes de concluir")).toBeVisible();
  await expect(main.getByText(new RegExp(`Sai 500,00\\s€ de ${orgName} \\(Banco do atelier\\) e entra em Pessoal \\(Conta pessoal\\)`))).toBeVisible();
  await main.getByRole("button", { name: "Confirmar transferência" }).click();
  await expect(main.getByText("Transferência registada nos dois espaços.")).toBeVisible();
  await page.reload();
  const row = main.getByRole("listitem", { name: /^TRF-\d{8}-[0-9A-F]{6}$/ }).first();
  await expect(row.getByText("Levantamento de novembro")).toBeVisible();
  await expect(row.getByText(/−\s500,00\s€/)).toBeVisible();
  await expect(row.getByText("Concluída")).toBeVisible();

  // No pessoal: a entrada com a mesma referência
  await page.goto("/painel");
  // No telemóvel o seletor está no menu "Mais"
  if (info.project.name === "mobile") await page.getByRole("button", { name: /Mais/ }).last().click();
  await page.getByLabel("Mudar de contexto").locator("visible=true").first().selectOption({ label: "Pessoal" });
  await expect(main.getByText("Contexto pessoal", { exact: true }).first()).toBeVisible();
  await page.goto("/financas/transferencias");
  const personalRow = main.getByRole("listitem", { name: /^TRF-/ }).first();
  await expect(personalRow.getByText(/\+\s500,00\s€/)).toBeVisible();
  await page.goto("/financas/movimentos");
  await expect(main.getByText("Levantamento de novembro").first()).toBeVisible();

  // Reverter (pede confirmação) cria a compensação nos dois espaços
  await page.goto("/financas/transferencias");
  page.once("dialog", (d) => d.accept());
  await personalRow.getByRole("button", { name: "Reverter" }).click();
  await expect(main.getByRole("listitem", { name: /^TRF-/ }).first().getByText("Revertida")).toBeVisible();
  await page.goto("/financas/movimentos");
  await expect(main.getByText("Reversão: Levantamento de novembro").first()).toBeVisible();
});
