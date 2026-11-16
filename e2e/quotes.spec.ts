import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("orçamento de pintura: custos, margem, IVA, versões, estados e PDF sem custos internos", async ({ page }, info) => {
  test.setTimeout(150_000);
  const email = `e2e-orc-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Paulo Pintor"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);

  await page.goto("/orcamentos/novo");
  await page.getByRole("button", { name: /^Pintura/ }).click();
  await page.waitForURL(/\/orcamentos\/[0-9a-f-]{36}$/);
  const main = page.getByRole("main");
  await expect(main.getByText(/ORC-\d{4}-0001/)).toBeVisible();

  const qty = main.getByLabel("Qtd.", { exact: true });
  const cost = main.getByLabel("Custo unit.", { exact: true });
  await expect(qty).toHaveCount(6);
  const values: Array<[string, string]> = [["18", "24,90"], ["1", "0"], ["1", "45"], ["12,5", "18"], ["20", "18"], ["68", "0,36"]];
  for (const [i, [q, c]] of values.entries()) {
    await qty.nth(i).fill(q);
    await cost.nth(i).fill(c);
  }
  await main.getByLabel("Margem sobre o preço (%)").fill("25");
  await main.getByLabel("Nome do imposto").fill("IVA");
  await main.getByLabel("%", { exact: true }).fill("23");
  await main.getByLabel("Nome", { exact: true }).fill("Condomínio Sol");

  // Pré-visualização ao vivo
  await expect(main.getByText("1102,68 €").first()).toBeVisible();
  await expect(main.getByText("1808,40 €")).toBeVisible();

  // Valor inválido bloqueia o total
  await qty.nth(0).fill("abc");
  await expect(main.getByText("Corrija os valores assinalados")).toBeVisible();
  await qty.nth(0).fill("18");

  await main.getByRole("button", { name: "Guardar orçamento" }).click();
  await expect(main.getByText("Orçamento guardado (versão 1).")).toBeVisible();

  // Estados
  await main.getByRole("button", { name: "Marcar como enviado" }).click();
  await expect(main.getByRole("button", { name: "Marcar como aceite" })).toBeVisible();
  await main.getByRole("button", { name: "Marcar como aceite" }).click();
  await expect(main.getByText(/já não pode ser alterado/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Guardar orçamento" })).toHaveCount(0);

  // Documento para o cliente: preços, sem custos internos
  const quoteUrl = page.url();
  await page.goto(quoteUrl.replace("/orcamentos/", "/imprimir/orcamento/"));
  await expect(page.getByText("Condomínio Sol")).toBeVisible();
  await expect(page.getByText("1808,40 €")).toBeVisible();
  await expect(page.getByText("1470,24 €")).toBeVisible();
  await expect(page.getByText("Custo unit.")).toHaveCount(0);
  await expect(page.getByText("1102,68 €")).toHaveCount(0);
  await expect(page.getByText("Este documento é um orçamento e não constitui fatura.")).toBeVisible();
});

test("ficha técnica: custo por dose e preço recomendado", async ({ page }, info) => {
  test.setTimeout(120_000);
  const email = `e2e-rest-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Chef Teste"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Empresa", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/organizacoes\/nova/);
  await page.getByLabel("Nome comercial").fill("Tasca E2E");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL(/\/painel/);

  await page.goto("/restauracao");
  const main = page.getByRole("main");
  await main.getByLabel("Prato").fill("Bacalhau à Brás");
  await main.getByRole("button", { name: "Nova ficha técnica" }).click();
  await page.waitForURL(/\/restauracao\/[0-9a-f-]{36}$/);

  await main.getByLabel("Doses").fill("4");
  await main.getByLabel("Food cost alvo (%)").fill("30");
  await main.getByLabel("Taxa de imposto (%)").fill("13");
  const rows: Array<[string, string, string, string, string]> = [
    ["Bacalhau", "600", "1000", "15,90", "15"],
    ["Batata", "1,2", "5", "4,50", "20"],
    ["Ovos", "6", "12", "3,60", "0"],
    ["Azeite", "40", "750", "7,99", "0"],
  ];
  for (const [i, [name, q, pack, price, waste]] of rows.entries()) {
    await main.getByRole("button", { name: "+ Adicionar ingrediente" }).click();
    await main.getByLabel("Ingrediente", { exact: true }).nth(i).fill(name);
    await main.getByLabel("Qtd. usada").nth(i).fill(q);
    await main.getByLabel("Qtd. embalagem").nth(i).fill(pack);
    await main.getByLabel("Preço embalagem").nth(i).fill(price);
    await main.getByLabel("Desperdício %").nth(i).fill(waste);
  }
  await main.getByLabel("Energia").fill("1,20");
  await main.getByLabel("Mão de obra").fill("6");
  await main.getByLabel("Embalagens").fill("0,80");

  await expect(main.getByText("5,70 €")).toHaveCount(2); // custo por dose = preço mínimo (margem mínima 0 %)
  await expect(main.getByText("12,34 €")).toBeVisible(); // preço recomendado
  await expect(main.getByText(/Food cost: 29,98 %/)).toBeVisible();
  await main.getByRole("button", { name: "Guardar ficha" }).click();
  await expect(main.getByText("Ficha guardada.")).toBeVisible();

  await page.goto("/restauracao");
  await expect(main.getByRole("link", { name: "Bacalhau à Brás" })).toBeVisible();
  await expect(main.getByText("12,34 €")).toBeVisible();
});
