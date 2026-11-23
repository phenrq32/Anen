import { expect, test } from "@playwright/test";
import { countTransactionsByDescription, createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/**
 * QA-03: duas abas da mesma sessão em workspaces diferentes. Um formulário aberto na empresa não pode
 * gravar no pessoal depois de outra aba mudar de contexto: nada é gravado e a pessoa é avisada.
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

test("um formulário de uma aba antiga não grava noutro workspace", async ({ page, context }, info) => {
  // O seletor de contexto do telemóvel está noutro menu; o comportamento do servidor é o mesmo.
  test.skip(info.project.name === "mobile", "Cenário de duas abas coberto em desktop");
  test.setTimeout(180_000);
  const email = `e2e-ws-${Date.now()}@example.com`;
  const description = `Gravado na aba antiga ${Date.now()}`;
  created.push(await createConfirmedUser(email, password, "Teresa Abas"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Empresa", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/organizacoes\/nova/);
  await page.getByLabel("Nome comercial").fill("Abas Lda");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Conta da empresa
  await page.goto("/financas/contas");
  await main.getByLabel("Nome", { exact: true }).fill("Banco Empresa");
  await main.getByLabel("Saldo inicial").fill("0");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco Empresa").first()).toBeVisible();

  // Aba A: formulário aberto na empresa
  await page.goto("/financas/em-aberto");
  await main.getByLabel(/^Valor/).fill("100");
  await main.getByLabel("Descrição", { exact: true }).fill(description);

  // Aba B: muda para o pessoal
  const other = await context.newPage();
  await other.goto("/painel");
  await other.getByLabel("Mudar de contexto").first().selectOption({ label: "Pessoal" });
  await other.waitForURL(/\/painel/);
  await expect(other.getByRole("main").getByText("Abas Lda")).toHaveCount(0);

  // Aba A grava: é recusado, avisa e nada fica gravado em nenhum workspace
  await main.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL(/\/painel\?contexto=alterado/);
  await expect(page.getByText(/Nada foi gravado: o espaço ativo mudou noutra aba ou janela\. Está agora em Pessoal\./)).toBeVisible();
  expect(await countTransactionsByDescription(description)).toBe(0);

  // Depois de recarregar, a aba A está no pessoal e grava normalmente (no pessoal, sem conta, pede uma)
  await page.goto("/financas/em-aberto");
  await expect(main.getByText("Para registar valores a receber ou a pagar, crie primeiro uma conta.")).toBeVisible();
});
