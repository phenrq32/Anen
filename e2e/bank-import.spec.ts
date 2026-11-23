import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

// Importar extrato (migration 2300): CSV de banco português, categoria lembrada e sem duplicar.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

const today = new Date().toISOString().slice(0, 10).split("-").reverse().join("/");
const csv = [
  "Extrato de conta;;;;",
  "Data Mov.;Data Valor;Descrição;Montante;Saldo",
  `${today};${today};"SUPERMERCADO; CENTRO";-23,45;976,55`,
  `${today};${today};TRF SALARIO NOVEMBRO;1.250,00;2.226,55`,
].join("\r\n");

test("importar extrato CSV: pré-visualização, categoria lembrada e sem duplicados", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-extrato-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Iva Importa"));
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
  await main.getByLabel("Saldo inicial").fill("1000");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco").first()).toBeVisible();

  // Um registo anterior com a mesma descrição e categoria: a importação deve lembrá-la.
  await page.goto("/financas");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Valor/).fill("10");
  await dialog.getByLabel("Descrição").fill("Supermercado; Centro");
  await dialog.getByLabel("Categoria").selectOption({ label: "Alimentação" });
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByText("«Supermercado; Centro»")).toBeVisible();
  // A memória funciona logo no registo rápido.
  await dialog.getByLabel(/Valor/).fill("5");
  await dialog.getByLabel("Descrição").fill("SUPERMERCADO; centro");
  await expect(dialog.getByText("Categoria lembrada do último registo com esta descrição.")).toBeVisible();
  await expect(dialog.getByLabel("Categoria")).toHaveValue(/[0-9a-f-]{36}/);
  await dialog.getByRole("button", { name: "Fechar" }).first().click();

  const upload = async () => {
    await page.goto("/financas/importar");
    await main.getByLabel("Escolher ficheiro do extrato").setInputFiles({ name: "extrato.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
    await expect(main.getByText("2 movimento(s) encontrados.")).toBeVisible();
    await main.getByRole("button", { name: "Rever antes de importar" }).click();
  };

  await upload();
  const list = main.getByRole("list", { name: "Movimentos a importar" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByLabel("Categoria de «SUPERMERCADO; CENTRO»").locator("option:checked")).toHaveText("Alimentação");
  await expect(list.getByText("Já existe")).toHaveCount(0);
  await main.getByRole("button", { name: "Importar 2" }).click();
  await expect(main.getByText("2 movimento(s) importados. 0 já existiam e foram ignorados.")).toBeVisible();

  // O mesmo ficheiro outra vez: tudo marcado como repetido e desmarcado.
  await upload();
  await expect(list.getByText("Já existe")).toHaveCount(2);
  await expect(main.getByRole("button", { name: "Importar 0" })).toBeDisabled();

  await page.goto("/financas/movimentos");
  await expect(main.getByText("TRF SALARIO NOVEMBRO")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
