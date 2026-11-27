import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/**
 * Modelos de orçamento com preços (edição 2026-12, Portugal, sem IVA; este serviço manteve o preço da edição 2026-11).
 * Parede de tijolo 11 cm rebocada (2 faces): 45 €/m², mercado 35 € – 60 €.
 * 12,5 m² → 562,50 €; com IVA 23 % → 691,88 €.
 * Vários de uma vez: + Teto falso em pladur (25 €/m²) × 10 m² = 250 € → 812,50 € sem IVA.
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

test("orçamento a partir de um serviço com preço: categoria, serviço, quantidade, IVA e referência de mercado", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-modelos-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Paulo Obras"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Categoria Construção com serviços com preço (EUR → modelos de Portugal)
  await page.goto("/orcamentos/novo");
  await expect(main.getByRole("link", { name: /^\d+ serviços com preço/ })).toHaveCount(19);
  await page.goto("/orcamentos/novo?categoria=construction");
  await expect(main.getByRole("heading", { name: /Construção: serviços com preço/ })).toBeVisible();
  await expect(main.getByText("Valores SEM IVA (somar 23% no continente).")).toBeVisible();

  const service = main.getByText("Parede de tijolo 11 cm rebocada (2 faces)", { exact: true });
  await service.click();
  const row = main.getByRole("listitem").filter({ hasText: "Parede de tijolo 11 cm rebocada (2 faces)" });
  await expect(row.getByText(/45,00\s€ por m²/)).toBeVisible();
  await expect(row.getByText(/Mercado: 35,00\s€ – 60,00\s€/)).toBeVisible();

  await main.getByLabel(/^Quantidade/).fill("12,5");
  await expect(main.getByText(/Total: 562,50\s€/)).toBeVisible();
  await main.getByLabel(/Somar IVA 23%/).check();
  await expect(main.getByText(/Total: 691,88\s€/)).toBeVisible();

  // Fontes e PDF
  await main.getByText(/Fontes e metodologia/).click();
  await expect(main.getByText(/Zaask/).first()).toBeVisible();
  await expect(main.getByRole("link", { name: /tabela de preços \(PDF\)/ })).toHaveAttribute("href", "/modelos/Modelos_Orcamento_2026_Portugal.pdf");

  await main.getByRole("button", { name: "Criar orçamento" }).click();
  await page.waitForURL(/\/orcamentos\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { name: /Parede de tijolo 11 cm rebocada \(2 faces\)/ })).toBeVisible();
  // Referência só para o profissional
  const reference = main.getByRole("complementary", { name: "Referência do modelo" });
  await expect(reference.getByText(/Preço recomendado: 45,00\s€ por m² · Mercado: 35,00\s€ – 60,00\s€/)).toBeVisible();
  await expect(main.getByText(/691,88\s€/).first()).toBeVisible();

  // O PDF descarrega-se com sessão
  const pdf = await page.request.get("/modelos/Modelos_Orcamento_2026_Portugal.pdf");
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("vários serviços de uma vez, cada um com a sua quantidade", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-modelos-varios-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Paulo Obras"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/orcamentos/novo?categoria=construction");
  await expect(main.getByRole("button", { name: "Criar orçamento" })).toBeDisabled();
  const wall = main.getByRole("listitem", { name: "Parede de tijolo 11 cm rebocada (2 faces)" });
  const ceiling = main.getByRole("listitem", { name: "Teto falso em pladur" });
  await wall.getByRole("checkbox").check();
  await wall.getByLabel(/^Quantidade/).fill("12,5");
  await ceiling.getByRole("checkbox").check();
  await ceiling.getByLabel(/^Quantidade/).fill("10");
  await expect(main.getByText("2 serviços escolhidos")).toBeVisible();
  await expect(main.getByText(/Total: 812,50\s€/)).toBeVisible();

  await main.getByRole("button", { name: "Criar orçamento" }).click();
  await page.waitForURL(/\/orcamentos\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { name: /Parede de tijolo 11 cm rebocada \(2 faces\) \(\+1\)/ })).toBeVisible();
  await expect(main.getByText(/812,50\s€/).first()).toBeVisible();
  // Linhas agrupadas por serviço (uma secção por serviço); sem referência de um único modelo
  await expect(main.getByRole("textbox", { name: "Secção" })).toHaveCount(2);
  await expect(main.getByRole("textbox", { name: "Secção" }).nth(1)).toHaveValue("Teto falso em pladur");
  await expect(main.getByRole("complementary", { name: "Referência do modelo" })).toHaveCount(0);

  // Documento do cliente agrupado e PDF gerado no servidor
  const quoteId = page.url().split("/").pop()!;
  await page.goto(`/imprimir/orcamento/${quoteId}`);
  const wallGroup = page.getByRole("region", { name: "Parede de tijolo 11 cm rebocada (2 faces)" });
  await expect(wallGroup.getByText(/562,50\s€/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Teto falso em pladur" }).getByText(/250,00\s€/).first()).toBeVisible();
  const pdf = await page.request.get(`/api/orcamentos/${quoteId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});
