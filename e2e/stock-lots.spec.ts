import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Lotes e validades (FEFO), ficha técnica ligada ao stock com produção, e aviso de lote vencido (migration 2000).
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const isoDaysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("lotes com validade, produção pela ficha técnica (FEFO) e aviso de lote vencido", async ({ page }, info) => {
  test.setTimeout(240_000);
  const email = `e2e-lotes-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Chef Lotes"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Artigo em kg com dois lotes: o L-B vence antes do L-A.
  await page.goto("/inventario");
  await main.getByLabel("Artigo", { exact: true }).fill("Farinha T65");
  await main.getByLabel(/^Unidade/).fill("kg");
  await main.getByRole("button", { name: "Criar artigo" }).click();
  await page.waitForURL(/\/inventario\/[0-9a-f-]{36}$/);
  const itemUrl = page.url();
  for (const [qty, lot, expires] of [["5", "L-A", isoDaysFromNow(60)], ["3", "L-B", isoDaysFromNow(20)]] as const) {
    await main.getByLabel("Quantidade (kg)").fill(qty);
    await main.getByLabel("Custo unitário / kg").fill("1,00");
    await main.getByLabel(/^Lote/).fill(lot);
    await main.getByLabel(/^Validade/).fill(expires);
    await main.getByRole("button", { name: "Registar movimento" }).click();
    await expect(main.getByText("Movimento registado.")).toBeVisible();
    await page.reload();
  }
  // Linha da tabela de lotes (começa pelo código; as linhas do histórico começam pela data).
  const lotRow = (code: string) => main.getByRole("row", { name: new RegExp(`^${code} `) });
  await expect(lotRow("L-A")).toBeVisible();
  await expect(lotRow("L-B")).toBeVisible();

  // Ficha técnica: 500 g de farinha por 4 doses, ligada ao artigo (kg).
  await page.goto("/restauracao");
  await main.getByLabel("Prato").fill("Pão de forma");
  await main.getByRole("button", { name: "Nova ficha técnica" }).click();
  await page.waitForURL(/\/restauracao\/[0-9a-f-]{36}$/);
  const recipeUrl = page.url();
  await main.getByLabel("Doses").fill("4");
  await main.getByRole("button", { name: "+ Adicionar ingrediente" }).click();
  await main.getByLabel("Qtd. usada").first().fill("500");
  await main.getByLabel("Preço embalagem").first().fill("1,00");
  const stock = main.getByLabel("Artigo do stock").first();
  await stock.selectOption({ label: "Farinha T65 (kg)" });
  await expect(main.getByLabel("Ingrediente", { exact: true }).first()).toHaveValue("Farinha T65");
  // Unidade que não converte: aviso na hora.
  await main.getByLabel("Un.").first().fill("ml");
  await expect(main.getByText(/A unidade ml não converte para kg/)).toBeVisible();
  await main.getByLabel("Un.").first().fill("g");
  await expect(main.getByText(/não converte para/)).toHaveCount(0);
  await main.getByRole("button", { name: "Guardar ficha" }).click();
  await expect(main.getByText("Ficha guardada.")).toBeVisible();

  // Produção de 16 doses = 2 kg: sai primeiro do L-B (vence antes).
  await page.reload();
  await main.getByLabel("Doses produzidas").fill("16");
  await main.getByRole("button", { name: "Registar produção" }).click();
  await expect(main.getByText("Produção registada: 1 ingrediente(s) saíram do stock.")).toBeVisible();
  await page.reload();
  await expect(main.getByText(/16 dose\(s\)/)).toBeVisible();
  // Produção acima do stock: 80 doses = 10 kg, só há 6 kg. Nada sai.
  await main.getByLabel("Doses produzidas").fill("80");
  await main.getByRole("button", { name: "Registar produção" }).click();
  await expect(main.getByText("Não há quantidade suficiente em stock.")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  await page.goto(itemUrl);
  await expect(main.getByText("6 kg", { exact: true }).first()).toBeVisible();
  await expect(lotRow("L-B")).toContainText("1 / 3 kg");
  await expect(lotRow("L-A")).toContainText("5 / 5 kg");
  await expect(main.getByText("Pão de forma × 16")).toBeVisible();

  // Perda escolhendo o lote L-A (mesmo vencendo depois).
  await main.getByLabel("Tipo", { exact: true }).selectOption("loss");
  await main.getByLabel("Quantidade (kg)").fill("2");
  const lotSelect = main.getByLabel("Lote", { exact: true });
  const aValue = await lotSelect.locator("option", { hasText: "L-A" }).getAttribute("value");
  await lotSelect.selectOption(aValue!);
  await main.getByRole("button", { name: "Registar movimento" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();
  await page.reload();
  await expect(lotRow("L-A")).toContainText("3 / 5 kg");
  await expect(lotRow("L-B")).toContainText("1 / 3 kg");

  // Lote já vencido (entrada com validade passada): aparece como vencido, no indicador e nas notificações.
  await main.getByLabel("Tipo", { exact: true }).selectOption("in");
  await main.getByLabel("Quantidade (kg)").fill("1");
  await main.getByLabel("Custo unitário / kg").fill("1,00");
  await main.getByLabel(/^Lote/).fill("L-OLD");
  await main.getByLabel(/^Validade/).fill(isoDaysFromNow(-3));
  await main.getByRole("button", { name: "Registar movimento" }).click();
  await expect(main.getByText("Movimento registado.")).toBeVisible();
  await page.reload();
  await expect(lotRow("L-OLD").getByText("Vencido")).toBeVisible();
  await page.goto("/inventario");
  await expect(main.getByText("Lotes vencidos com stock")).toBeVisible();
  await page.goto("/notificacoes");
  await expect(main.getByText("Lote vencido: Farinha T65")).toBeVisible();
  await page.goto(recipeUrl);
  await expect(main.getByRole("heading", { name: "Registar produção" })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});
