import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/**
 * Dual Workspace · Fase 4: menu adaptado ao workspace, convites pendentes no seletor e abas sincronizadas.
 * Usa a barra lateral (desktop); a mesma lista de grupos alimenta o menu do telemóvel e a procura.
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

async function signIn(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("menu por workspace e abas sincronizadas", async ({ page, context }, info) => {
  test.skip(info.project.name === "mobile", "Barra lateral e duas abas: desktop");
  test.setTimeout(240_000);
  const stamp = Date.now();
  const ownerEmail = `e2e-nav-dona-${stamp}@example.com`;
  created.push(await createConfirmedUser(ownerEmail, password, "Rosa Menu"));
  const orgName = `Menu Lda ${stamp}`;
  const nav = page.getByRole("navigation", { name: "Navegação principal" });

  // Pessoal: sem os módulos de empresa no menu, com a explicação de onde estão
  await signIn(page, ownerEmail);
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  // Menu pessoal (Fase 5): Hoje, movimentos, orçamento, contas, assinaturas, dívidas, calendário e análises
  for (const label of ["Hoje", "Movimentos", "Orçamento e objetivos", "Contas", "Assinaturas", "Dívidas", "Calendário", "Notificações", "Análises", "ANEN AI"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  for (const label of ["Compras", "Inventário", "Faturação", "Projetos", "Orçamentos"]) await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  await expect(nav.getByText(/Orçamentos, faturação, projetos, compras e inventário ficam nas organizações/)).toBeVisible();

  // Empresa: os módulos aparecem
  await page.goto("/organizacoes/nova");
  await page.getByLabel("Nome comercial").fill(orgName);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/painel/);
  for (const label of ["Compras", "Inventário", "Faturação", "Projetos", "Orçamentos"]) await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  await expect(nav.getByText(/ficam nas organizações/)).toHaveCount(0);
  // Menu empresarial (Fase 6, §6), por esta ordem
  const businessMenu = ["Hoje", "Finanças", "Orçamentos", "Projetos", "Clientes", "Fornecedores", "Compras", "Inventário", "Fichas técnicas", "Inteligência de mercado", "Relatórios", "ANEN AI", "Equipa", "Definições"];
  const shown = (await nav.getByRole("link").allInnerTexts()).map((x) => x.trim());
  // "Fichas técnicas" pode estar escondida nas preferências da pessoa (Definições → Áreas do menu).
  expect(shown.filter((x) => businessMenu.includes(x))).toEqual(businessMenu.filter((x) => x !== "Fichas técnicas" || shown.includes(x)));
  // Clientes e Fornecedores abrem os contactos já filtrados, e o item certo fica ativo
  await nav.getByRole("link", { name: "Fornecedores", exact: true }).click();
  await page.waitForURL(/\/contactos\?tipo=supplier/);
  await expect(nav.getByRole("link", { name: "Fornecedores", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Clientes", exact: true })).not.toHaveAttribute("aria-current", "page");
  await page.goto("/painel");

  // Abas sincronizadas: a aba B muda para o pessoal e a aba A atualiza-se sozinha
  const other = await context.newPage();
  await other.goto("/painel");
  await other.getByLabel("Mudar de contexto").first().selectOption({ label: "Pessoal" });
  await expect(other.getByRole("main").getByText("Contexto pessoal", { exact: true }).first()).toBeVisible();
  await expect(nav.getByRole("link", { name: "Compras", exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByLabel("Mudar de contexto").first()).toHaveValue("personal");
  await other.close();

});

test("convite pendente aceite no seletor, sem o link", async ({ browser }, info) => {
  test.skip(info.project.name === "mobile", "Barra lateral: desktop");
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = `e2e-conv-dona-${stamp}@example.com`;
  const guestEmail = `e2e-conv-hugo-${stamp}@example.com`;
  created.push(await createConfirmedUser(ownerEmail, password, "Sara Convida"));
  created.push(await createConfirmedUser(guestEmail, password, "Hugo Convite"));
  const orgName = `Convite Lda ${stamp}`;

  const ownerContext = await browser.newContext();
  const page = await ownerContext.newPage();
  await signIn(page, ownerEmail);
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Empresa", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/organizacoes\/nova/);
  await page.getByLabel("Nome comercial").fill(orgName);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/painel/);
  await page.goto("/organizacao/membros");
  await page.getByLabel("Email").fill(guestEmail);
  await page.getByRole("button", { name: "Criar convite" }).click();
  await expect(page.getByText(guestEmail, { exact: true })).toBeVisible();
  await ownerContext.close();

  // Hugo (outro navegador): vê o convite no seletor e aceita-o sem o link
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await signIn(guest, guestEmail);
  await guest.waitForURL(/\/boas-vindas/);
  await guest.getByText("Finanças pessoais", { exact: true }).click();
  await guest.getByRole("button", { name: "Concluir" }).click();
  await guest.waitForURL(/\/painel/);
  const invites = guest.getByRole("region", { name: "Convites pendentes" }).first();
  await expect(invites.getByText(orgName)).toBeVisible();
  await expect(invites.getByText("Leitor")).toBeVisible();
  await invites.getByRole("button", { name: "Aceitar" }).click();
  await guest.waitForURL(/\/painel/);
  await expect(guest.getByLabel("Mudar de contexto").first()).toHaveValue(/[0-9a-f-]{36}/);
  await expect(guest.getByRole("region", { name: "Convites pendentes" })).toHaveCount(0);
  // Leitor: vê a organização, sem as áreas para as quais não tem permissão de leitura
  const guestNav = guest.getByRole("navigation", { name: "Navegação principal" });
  await expect(guestNav.getByRole("link", { name: "Hoje", exact: true })).toBeVisible();
  await guestContext.close();
});
