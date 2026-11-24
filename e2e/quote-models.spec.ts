import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

/**
 * Modelos de orçamento com preços (pacote 2026-11, Portugal, sem IVA).
 * Parede de tijolo 11 cm rebocada (2 faces): 45 €/m², mercado 35 € – 60 €.
 * 12,5 m² → 562,50 €; com IVA 23 % → 691,88 €.
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
  await expect(main.getByText(/Zaask/)).toBeVisible();
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
