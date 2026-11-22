import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

// Painel: os totais seguem o período escolhido (este mês, 3 meses, 12 meses) e comparam com o período anterior.
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

function isoMonthsAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(10);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

test("painel: filtro de período nos totais", async ({ page }, info) => {
  test.setTimeout(180_000);
  const email = `e2e-periodo-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Paula Período"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page).toHaveURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/financas/contas");
  await page.getByLabel("Nome", { exact: true }).fill("Conta principal");
  await page.getByLabel("Saldo inicial").fill("0");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Conta principal")).toBeVisible();

  // Despesa deste mês (10 €) e de há 2 meses (30 €)
  await page.goto("/financas");
  for (const [value, desc, date] of [["10", "Agora", null], ["30", "Antes", isoMonthsAgo(2)]] as const) {
    await page.keyboard.press("n");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Registo rápido" })).toBeVisible();
    await dialog.getByLabel(/Valor/).fill(value);
    await dialog.getByLabel("Descrição").fill(desc);
    if (date) await dialog.getByLabel("Data", { exact: true }).fill(date);
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog.getByText(`«${desc}»`)).toBeVisible();
    await dialog.getByRole("button", { name: "Fechar" }).first().click();
  }

  const kpis = async () => (await main.locator(".sr-only").allTextContents()).map((t) => t.replace(/\s/g, " ")).slice(0, 4);

  await page.goto("/painel");
  const nav = main.getByRole("navigation", { name: "Período dos totais" });
  await expect(nav.getByRole("link", { name: "Este mês" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByText("Despesas do mês")).toBeVisible();
  expect((await kpis())[2]).toBe("10,00 €");

  await nav.getByRole("link", { name: "3 meses" }).click();
  await expect(page).toHaveURL(/periodo=quarter/);
  await expect(main.getByText("Despesas (3 meses)")).toBeVisible();
  await expect.poll(async () => (await kpis())[2]).toBe("40,00 €");
  await expect(main.getByText(/3 meses anteriores: 0,00\s€/).first()).toBeVisible();

  await nav.getByRole("link", { name: "12 meses" }).click();
  await expect(page).toHaveURL(/periodo=year/);
  await expect(main.getByText("Despesas (12 meses)")).toBeVisible();
  await expect.poll(async () => (await kpis())[2]).toBe("40,00 €");

  await nav.getByRole("link", { name: "Este mês" }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect.poll(async () => (await kpis())[2]).toBe("10,00 €");

  // Sem deslocamento horizontal (telemóvel incluído)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
