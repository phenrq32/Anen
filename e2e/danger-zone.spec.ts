import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Sair e apagar uma organização, apagar a própria conta (migration 2200).
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id).catch(() => undefined);
    await deleteUser(id).catch(() => undefined);
  }
});

test("organização: a última proprietária não sai; apaga confirmando o nome; depois apaga a conta", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-perigo-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Lia Perigo"));
  const orgName = `Apagar E2E ${info.project.name}`;
  const main = page.getByRole("main");
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Empresa", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/organizacoes\/nova/);
  await page.getByLabel("Nome comercial").fill(orgName);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/painel/);

  // Sair sendo a única proprietária: recusado com explicação.
  await page.goto("/organizacao");
  page.once("dialog", (d) => d.accept());
  await main.getByRole("button", { name: "Sair da organização" }).click();
  await expect(main.getByText("A organização precisa de pelo menos um proprietário ativo.")).toBeVisible();

  // Apagar: o botão só fica ativo com o nome certo.
  const del = main.getByRole("button", { name: "Apagar a organização definitivamente" });
  await expect(del).toBeDisabled();
  await main.getByLabel("Para confirmar, escreva o nome da organização").fill("outro nome");
  await expect(del).toBeDisabled();
  await main.getByLabel("Para confirmar, escreva o nome da organização").fill(orgName);
  await expect(del).toBeEnabled();
  page.once("dialog", (d) => d.accept());
  await del.click();
  await page.waitForURL(/\/painel\?organizacao=apagada/);
  await expect(main.getByText("A organização foi apagada.")).toBeVisible();

  // Apagar a conta: email certo, sai da sessão e não volta a entrar.
  await page.goto("/definicoes#conta");
  const delAccount = main.getByRole("button", { name: "Apagar a conta definitivamente" });
  await expect(delAccount).toBeDisabled();
  await main.getByLabel("Para confirmar, escreva o email da sua conta").fill(email.toUpperCase());
  page.once("dialog", (d) => d.accept());
  await delAccount.click();
  await page.waitForURL(/\/entrar\?conta=apagada/);
  await expect(page.getByText("A sua conta e os seus dados pessoais foram apagados.", { exact: false })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await page.goto("/painel");
  await expect(page).toHaveURL(/\/entrar/);
});
