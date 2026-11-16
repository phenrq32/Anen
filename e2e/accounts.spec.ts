import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const password = "Segura12345e2e";
const created: string[] = [];

async function signIn(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/entrar"));
}

async function signOut(page: Page) {
  const button = page.getByRole("button", { name: "Terminar sessão" });
  if (!(await button.isVisible())) await page.locator("summary").first().click(); // menu móvel
  await button.click();
  await expect(page).toHaveURL(/\/entrar/);
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("rotas privadas exigem sessão e credenciais erradas são recusadas", async ({ page }) => {
  await page.goto("/painel");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fpainel/);
  await page.getByLabel("Email").fill(`ninguem-${run}@example.com`);
  await page.getByLabel("Palavra-passe").fill("errada1234567");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Email ou palavra-passe incorretos.")).toBeVisible();
});

test("registo valida os campos no servidor e mantém o que foi escrito", async ({ page }) => {
  await page.goto("/criar-conta");
  await page.getByLabel("Nome completo").fill("A");
  await page.getByLabel("Email").fill("invalido");
  await page.getByLabel("Palavra-passe").fill("curta");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Email inválido.")).toBeVisible();
  await expect(page.getByText("A palavra-passe precisa de pelo menos 10 caracteres.")).toBeVisible();
  await expect(page.getByText("É necessário aceitar os termos.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("invalido");
});

test("onboarding, organização, convite e aceitação por outro utilizador", async ({ page }, info) => {
  const suffix = `${run}-${info.project.name}`;
  const ownerEmail = `e2e-dona-${suffix}@example.com`;
  const guestEmail = `e2e-convidado-${suffix}@example.com`;
  created.push(await createConfirmedUser(ownerEmail, password, "Ana Teste"));
  created.push(await createConfirmedUser(guestEmail, password, "Bruno Teste"));
  const orgName = `Oficina E2E ${info.project.name}`;
  const main = page.getByRole("main");

  // Dona: onboarding → criar empresa
  await signIn(page, ownerEmail);
  await expect(page).toHaveURL(/\/boas-vindas/);
  await expect(page.getByLabel("Nome completo")).toHaveValue("Ana Teste");
  await page.getByText("Empresa", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page).toHaveURL(/\/organizacoes\/nova\?tipo=business/);

  await page.getByLabel("Nome comercial").fill(orgName);
  await page.getByLabel(/Número fiscal/).fill("123456780");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page.getByText("Número fiscal inválido para o país selecionado.")).toBeVisible();
  await expect(page.getByLabel("Nome comercial")).toHaveValue(orgName); // não perde o que foi escrito
  await page.getByLabel(/Número fiscal/).fill("123 456 789");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page).toHaveURL(/\/painel/);
  await expect(page.getByRole("heading", { name: "Olá, Ana" })).toBeVisible();
  await expect(main.getByText(orgName).first()).toBeVisible();
  await expect(page.getByText("criou a organização").first()).toBeVisible();

  // Convite
  await page.goto("/organizacao/membros");
  await page.getByLabel("Email").fill(guestEmail);
  await page.getByRole("button", { name: "Criar convite" }).click();
  const linkField = page.locator("input[readonly]").first();
  await expect(linkField).toHaveValue(/\/convite\/[0-9a-f]{64}$/);
  const inviteLink = await linkField.inputValue();
  await expect(page.getByText(guestEmail, { exact: true })).toBeVisible(); // na lista de convites pendentes
  await signOut(page);

  // Convidado: aceita e passa a ver a organização, sem poder gerir
  await page.goto(new URL(inviteLink).pathname);
  await expect(page.getByRole("heading", { name: `Convite para ${orgName}` })).toBeVisible();
  await main.getByRole("link", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/entrar\?next=%2Fconvite%2F/);
  await page.getByLabel("Email").fill(guestEmail);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/convite\/[0-9a-f]{64}$/); // volta ao convite depois do login
  await page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(page).toHaveURL(/\/boas-vindas/);
  await page.getByText("Procurar serviços", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page).toHaveURL(/\/painel/);
  await expect(main.getByText(orgName).first()).toBeVisible();

  await page.goto("/organizacao/membros");
  await expect(main.getByText("Ana Teste")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Convidar membro" })).toHaveCount(0);
  await page.goto("/organizacao");
  await expect(page.getByRole("button", { name: "Guardar" })).toHaveCount(0);

  // Convite já usado não volta a funcionar
  await page.goto(new URL(inviteLink).pathname);
  await expect(page.getByText("Este convite não é válido")).toBeVisible();
});
