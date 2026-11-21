import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Prompt 03 · Fase 6: inteligência de mercado. Pressupõe que o agente já correu em produção
// (recolha diária ou `select private.run_market_agent()` depois de aplicar a migration 1400).
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("mercado: séries oficiais de Portugal e do Brasil, fontes e acompanhamento com limiar", async ({ page }, info) => {
  test.setTimeout(120_000);
  const email = `e2e-mkt-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Ana Mercado"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/mercado");
  await expect(main.getByRole("heading", { name: "Agente de mercado" })).toBeVisible();
  await expect(main.getByText(/^Última recolha:/).first()).toBeVisible();
  // Portugal (moeda EUR): HICP do Eurostat, com a fonte e a licença.
  await expect(main.getByRole("link", { name: "Portugal" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("heading", { name: "Alimentação" })).toBeVisible();
  await expect(main.getByRole("cell", { name: /Cereais e produtos à base de cereais/ })).toBeVisible();
  await expect(main.getByText(/Eurostat: Índice harmonizado de preços no consumidor \(HICP\)\. .*CC BY 4\.0/)).toBeVisible();
  await expect(main.getByText(/^Último erro/)).toHaveCount(0);

  // Acompanhar uma série com limiar inválido e depois válido.
  const threshold = main.getByLabel("Limiar (p.p.) · Cereais e produtos à base de cereais");
  await threshold.fill("abc");
  await threshold.locator("xpath=..").getByRole("button", { name: "Acompanhar" }).click();
  await expect(main.getByText("Percentagem inválida.")).toBeVisible();
  await threshold.fill("0,5");
  await threshold.locator("xpath=..").getByRole("button", { name: "Acompanhar" }).click();
  await expect(main.getByText("Alerta guardado.")).toBeVisible();
  await expect(main.getByText("A acompanhar")).toBeVisible();
  await page.reload();
  await expect(main.getByLabel("Limiar (p.p.) · Cereais e produtos à base de cereais")).toHaveValue("0,5");

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);

  await main.getByRole("button", { name: "Deixar de acompanhar · Cereais e produtos à base de cereais" }).click();
  await expect(main.getByText("A acompanhar")).toHaveCount(0);

  // Brasil: IPCA e SINAPI do IBGE, o custo do m² em reais.
  await main.getByRole("link", { name: "Brasil" }).click();
  await page.waitForURL(/pais=BR/);
  await expect(main.getByRole("cell", { name: /Farinhas, féculas e massas/ })).toBeVisible();
  await expect(main.getByRole("cell", { name: /Custo médio do m² da construção/ })).toBeVisible();
  await expect(main.getByText(/(R\$\s?[\d.]+,\d{2}|[\d.\s]+,\d{2}\sR\$)\/m²/)).toBeVisible();
  await expect(main.getByText(/IBGE: Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil/)).toBeVisible();
});
