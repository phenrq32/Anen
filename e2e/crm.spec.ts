import { expect, test, type Page } from "@playwright/test";
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

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("CRM: observações, orçamento ligado ao cliente e histórico de preços do fornecedor", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-crm-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Rita CRM"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  // Cliente com dados que o orçamento vai copiar
  await page.goto("/contactos");
  await main.getByLabel("Tipo", { exact: true }).selectOption("client");
  await main.getByLabel("Nome", { exact: true }).fill("Maria Costa");
  await main.getByLabel("Email").fill("maria@example.com");
  await main.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL(/\/contactos\/[0-9a-f-]{36}$/);
  const clientUrl = page.url();

  // Observação datada: aparece no histórico e o campo fica limpo
  await expect(main.getByText("Ainda não há observações.")).toBeVisible();
  await main.getByLabel("Tipo", { exact: true }).first().selectOption("call");
  await main.getByLabel("Data", { exact: true }).fill("2026-11-10");
  await main.getByLabel("Observação", { exact: true }).fill("Pediu orçamento para pintar a sala.");
  await main.getByRole("button", { name: "Registar", exact: true }).click();
  await expect(main.getByText("Observação registada.")).toBeVisible();
  const timeline = main.getByRole("list", { name: "Histórico de contactos" });
  await expect(timeline.getByText("Pediu orçamento para pintar a sala.")).toBeVisible();
  await expect(timeline.getByText("Chamada")).toBeVisible();
  await expect(main.getByLabel("Observação", { exact: true })).toHaveValue("");
  await expect(main.getByText("Sem orçamentos ligados a este cliente.")).toBeVisible();
  await noHorizontalScroll(page);

  // Orçamento ligado ao cliente do cadastro: os dados são preenchidos
  await page.goto("/orcamentos/novo");
  await page.getByRole("button", { name: /^Pintura/ }).click();
  await page.waitForURL(/\/orcamentos\/[0-9a-f-]{36}$/);
  await main.getByLabel("Cliente do cadastro").selectOption({ label: "Maria Costa" });
  await expect(main.getByLabel("Nome", { exact: true })).toHaveValue("Maria Costa");
  await expect(main.getByLabel("Email", { exact: true })).toHaveValue("maria@example.com");
  await main.getByLabel("Custo unit.", { exact: true }).first().fill("100");
  await main.getByRole("button", { name: "Guardar orçamento" }).click();
  await expect(main.getByText("Orçamento guardado (versão 1).")).toBeVisible();
  await page.reload();
  await expect(main.getByLabel("Cliente do cadastro")).toHaveValue(clientUrl.split("/").pop()!);

  // A ficha do cliente mostra o orçamento
  await page.goto(clientUrl);
  const quotes = main.getByRole("list", { name: "Orçamentos" });
  await expect(quotes.getByText(/ORC-\d{4}-0001 · Rascunho/)).toBeVisible();

  // Fornecedor: dois preços do mesmo artigo (nome escrito de forma diferente) → variação
  await page.goto("/contactos");
  await main.getByLabel("Tipo", { exact: true }).selectOption("supplier");
  await main.getByLabel("Nome", { exact: true }).fill("Materiais Lisboa");
  await main.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL(/\/contactos\/[0-9a-f-]{36}$/);
  await expect(main.getByText("Ainda não há preços registados.")).toBeVisible();

  const addPrice = async (item: string, price: string, date: string) => {
    await main.getByLabel("Artigo", { exact: true }).fill(item);
    await main.getByLabel(/^Unidade/).fill("saco");
    await main.getByLabel("Preço unitário").fill(price);
    await main.getByLabel("Data do preço").fill(date);
    await main.getByRole("button", { name: "Registar preço" }).click();
    await expect(main.getByText("Preço registado.")).toBeVisible();
  };
  await addPrice("Cimento 25 kg", "6", "2026-10-01");
  await addPrice("cimento 25 KG", "6,50", "2026-11-05");

  const prices = main.getByRole("list", { name: "Histórico de preços" });
  await expect(prices.getByRole("listitem")).toHaveCount(1);
  await expect(prices.getByText("6,50 €").first()).toBeVisible();
  await expect(prices.getByText("+0,50 € (+8,3 %)")).toBeVisible();
  await expect(prices.getByText(/2 registos/)).toBeVisible();
  // O cliente não tem preços nem o fornecedor tem orçamentos
  await expect(main.getByRole("list", { name: "Orçamentos" })).toHaveCount(0);
  await noHorizontalScroll(page);

  // Apagar o registo mais recente: volta a haver um só preço
  await prices.locator("summary").first().click();
  page.once("dialog", (d) => d.accept());
  await prices.getByRole("button", { name: "Apagar" }).first().click();
  await expect(prices.getByText("Primeiro registo")).toBeVisible();
  await expect(prices.getByText("6,00 €").first()).toBeVisible();
});
