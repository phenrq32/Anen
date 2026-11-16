import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

// PDF mínimo válido
const pdf = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

test("recorrente editável e gerado como pendente; anexo de fatura enviado, aberto e removido", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-f2-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Teresa Faturas"));
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
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Banco").first()).toBeVisible();

  // Recorrente que começa hoje, gerado como pendente com vencimento a 8 dias
  await page.goto("/financas/recorrentes");
  await main.getByLabel(/^Valor/).fill("650");
  await main.getByLabel("Descrição", { exact: true }).fill("Renda");
  await main.getByText("Mais detalhes").click();
  await main.getByLabel(/Gerar como pendente/).check();
  await main.getByLabel(/Vence quantos dias/).fill("8");
  await main.getByRole("button", { name: "Nova recorrência" }).click();
  await expect(main.getByText("Recorrência criada.")).toBeVisible();

  // Editar o valor
  await main.getByRole("link", { name: "Editar" }).click();
  await page.waitForURL(/editar=/);
  await main.getByLabel(/^Valor/).first().fill("700");
  await main.getByLabel("Descrição", { exact: true }).first().fill("Renda do T2");
  await main.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(main.getByText("Recorrência atualizada.")).toBeVisible();
  await page.goto("/financas/recorrentes");
  await expect(main.getByText("Renda do T2")).toBeVisible();
  await expect(main.getByText("700,00 €").first()).toBeVisible();

  // O movimento de hoje é gerado como pendente (aparece em "A pagar")
  await page.goto("/financas/movimentos");
  await page.goto("/financas/em-aberto");
  await expect(main.getByText("Renda").first()).toBeVisible();

  // Anexar fatura ao movimento
  await page.goto("/financas/movimentos");
  // Com etiquetas (Recorrente, Pendente), a linha continua a caber no ecrã (sem deslocamento horizontal)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await main.getByRole("link", { name: "Editar", exact: true }).first().click();
  await page.waitForURL(/editar=/);
  await main.getByLabel("Ficheiro").setInputFiles({ name: "fatura-renda.pdf", mimeType: "application/pdf", buffer: pdf });
  await main.getByRole("button", { name: "Anexar" }).click();
  await expect(main.getByText("Anexo guardado.")).toBeVisible();
  const link = main.getByRole("link", { name: "fatura-renda.pdf" });
  await expect(link).toBeVisible();

  // Abrir: redireciona para um URL assinado do Storage com o ficheiro
  const href = await link.getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Formato não suportado é recusado antes de enviar
  await main.getByLabel("Ficheiro").setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await main.getByRole("button", { name: "Anexar" }).click();
  await expect(main.getByText(/Formato não suportado/)).toBeVisible();

  // Remover
  page.once("dialog", (d) => d.accept());
  await main.getByRole("button", { name: "Remover" }).click();
  await expect(main.getByRole("link", { name: "fatura-renda.pdf" })).toHaveCount(0);
  await expect(main.getByText("Sem anexos.")).toBeVisible();
});
