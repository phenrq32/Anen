import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteOrganizationsCreatedBy, deleteUser } from "./admin";

// Prompt 03 · Fase 4: desconto, produto/serviço nas linhas e descrição do projeto.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) {
    await deleteOrganizationsCreatedBy(id);
    await deleteUser(id);
  }
});

test("desconto, produtos e serviços no documento, e projeto com a descrição do orçamento", async ({ page }, info) => {
  test.setTimeout(150_000);
  const email = `e2e-desc-${Date.now()}-${info.project.name}@example.com`;
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

  // Mesmos custos do E2E de pintura: custo 1102,68 €, margem 25 % → 1470,24 € sem imposto.
  const qty = main.getByLabel("Qtd.", { exact: true });
  const cost = main.getByLabel("Custo unit.", { exact: true });
  const values: Array<[string, string]> = [["18", "24,90"], ["1", "0"], ["1", "45"], ["12,5", "18"], ["20", "18"], ["68", "0,36"]];
  for (const [i, [q, c]] of values.entries()) {
    await qty.nth(i).fill(q);
    await cost.nth(i).fill(c);
  }
  await main.getByLabel("Margem sobre o preço (%)").fill("25");
  await main.getByLabel("Nome do imposto").fill("IVA");
  await main.getByLabel("%", { exact: true }).fill("23");
  await main.locator("#q-description").fill("Pintura interior do T2, duas demãos");

  // Natureza sugerida pelo tipo: materiais são produtos, mão de obra e deslocação são serviços.
  const nature = main.getByLabel("Produto ou serviço", { exact: true });
  await expect(nature).toHaveCount(6);
  await expect(nature.nth(0)).toHaveValue("product");
  await expect(nature.nth(3)).toHaveValue("service");

  // Desconto fixo maior do que o preço: assinalado e sem total.
  await main.getByLabel("Desconto", { exact: true }).selectOption("amount");
  await main.getByLabel("Valor", { exact: true }).fill("1500");
  await expect(main.getByText("O desconto não pode ser maior do que o preço antes do desconto.")).toBeVisible();
  // Desconto fixo abaixo do custo: permitido, com aviso.
  await main.getByLabel("Valor", { exact: true }).fill("1200");
  await expect(main.getByText(/fica abaixo do custo/)).toBeVisible();

  // 10 %: 147,02 € de desconto, 1323,22 € sem imposto, IVA 304,34 €, total 1627,56 €.
  await main.getByLabel("Desconto", { exact: true }).selectOption("percent");
  await main.getByLabel("Valor", { exact: true }).fill("10");
  await expect(main.getByText("− 147,02 €")).toBeVisible();
  await expect(main.getByText("1323,22 €")).toBeVisible();
  await expect(main.getByText("1627,56 €")).toBeVisible();
  await expect(main.getByText(/fica abaixo do custo/)).toHaveCount(0);

  await main.getByRole("button", { name: "Guardar orçamento" }).click();
  await expect(main.getByText("Orçamento guardado (versão 1).")).toBeVisible();

  // Depois de recarregar, o desconto e as naturezas mantêm-se.
  await page.reload();
  await expect(main.getByLabel("Desconto", { exact: true })).toHaveValue("percent");
  await expect(main.getByLabel("Valor", { exact: true })).toHaveValue("10");
  await expect(main.getByText("1627,56 €")).toBeVisible();

  const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noOverflow).toBe(true);

  await main.getByRole("button", { name: "Marcar como enviado" }).click();
  await main.getByRole("button", { name: "Marcar como aceite" }).click();
  await expect(main.getByText(/já não pode ser alterado/)).toBeVisible();

  // Documento para o cliente: produtos e serviços, desconto antes do imposto, sem custos.
  const quoteUrl = page.url();
  await page.goto(quoteUrl.replace("/orcamentos/", "/imprimir/orcamento/"));
  await expect(page.getByText("Desconto (10 %)")).toBeVisible();
  await expect(page.getByText("− 147,02 €")).toBeVisible();
  await expect(page.getByText("1470,24 €")).toBeVisible();
  await expect(page.getByText("1627,56 €")).toBeVisible();
  await expect(page.getByText("Produtos", { exact: true })).toBeVisible();
  await expect(page.getByText("Serviços", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Produto", exact: true }).first()).toBeVisible();
  await expect(page.getByText("1102,68 €")).toHaveCount(0);

  // Projeto a partir do orçamento aceite: herda a descrição e a receita já descontada.
  await page.goto(quoteUrl);
  await main.getByRole("button", { name: "Criar projeto" }).click();
  await page.waitForURL(/\/projetos\/[0-9a-f-]{36}$/);
  await expect(main.getByText("Pintura interior do T2, duas demãos").first()).toBeVisible();
  await expect(main.getByLabel("Descrição do projeto (opcional)")).toHaveValue("Pintura interior do T2, duas demãos");
  await expect(main.getByText("1323,22 €").first()).toBeVisible();
});
