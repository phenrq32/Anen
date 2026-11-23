import { expect, test } from "@playwright/test";
import { createConfirmedUser, deleteUser } from "./admin";

// Planos pagos (migration 2500): preços, períodos e abertura do checkout da InfinitePay (sem pagar).
const password = "Segura12345e2e";
const created: string[] = [];
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  for (const id of created) await deleteUser(id);
});

test("aviso de pagamento sem token é recusado", async ({ request }) => {
  const r = await request.post("/api/billing/infinitepay", { data: { order_nsu: "anen-000000000000" }, maxRedirects: 0 });
  expect(r.status()).toBe(401);
});

test("planos: preços do Brasil e de Portugal, mensal e anual, e checkout da InfinitePay", async ({ page }, info) => {
  test.setTimeout(120_000);
  const email = `e2e-planos-${Date.now()}-${info.project.name}@example.com`;
  created.push(await createConfirmedUser(email, password, "Bia Planos"));
  await page.goto("/entrar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Palavra-passe").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);
  const main = page.getByRole("main");

  await page.goto("/planos?moeda=BRL&periodo=mensal");
  await expect(main.getByRole("heading", { name: "Pro" })).toBeVisible();
  await expect(main.getByText(/R\$\s?14,90|14,90\sR\$/)).toBeVisible();
  await expect(main.getByText(/R\$\s?29,90|29,90\sR\$/)).toBeVisible();
  await expect(main.getByText("O seu plano")).toBeVisible(); // Free
  await main.getByRole("link", { name: /Anual/ }).click();
  await expect(page).toHaveURL(/periodo=anual/);
  await expect(main.getByText(/R\$\s?299,00|299,00\sR\$/)).toBeVisible();
  await page.goto("/planos?moeda=EUR&periodo=mensal");
  await expect(main.getByText(/7,99\s€/)).toBeVisible();
  // Com o IBAN configurado, Portugal também tem o botão de assinar (por transferência).
  await expect(main.getByRole("button", { name: "Assinar Max" })).toBeVisible();

  // Brasil: "Assinar Pro" abre o checkout da InfinitePay (não pagamos).
  await page.goto("/planos?moeda=BRL&periodo=mensal");
  await main.getByRole("button", { name: "Assinar Pro" }).click();
  await page.waitForURL(/infinitepay/, { timeout: 30_000 });
  expect(page.url()).toContain("infinitepay");
});
