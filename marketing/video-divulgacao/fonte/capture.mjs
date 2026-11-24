// Capturas reais da ANEN (telemóvel, pt-BR) para o vídeo de divulgação.
// Conta de demonstração temporária: criada pela API de administração e apagada no fim (com as organizações).
import { chromium, devices } from "/home/user/Anen/node_modules/playwright/index.mjs";

const OUT = process.argv[2];
const BASE = "http://localhost:3000";
const SB = process.env.E2E_SUPABASE_URL;
const KEY = process.env.E2E_SUPABASE_SECRET_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const email = `ana.souza.${Date.now() % 100000}@example.com`;
const password = "Segura12345promo";

async function createUser() {
  const r = await fetch(`${SB}/auth/v1/admin/users`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Ana Souza", locale: "pt-BR" } }),
  });
  if (!r.ok) throw new Error(`criar: ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}
async function cleanup(id) {
  await fetch(`${SB}/rest/v1/organizations?created_by=eq.${id}`, { method: "DELETE", headers: H });
  await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const userId = await createUser();
try {
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "pt-BR", timezoneId: "America/Sao_Paulo", colorScheme: "dark" });
  await context.addCookies([{ name: "anen-tour", value: "done", url: BASE }]);
  const page = await context.newPage();
  const main = page.getByRole("main");
  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log("shot", name);
  };

  await page.goto(`${BASE}/entrar`);
  await page.getByLabel(/^E-?mail$/).fill(email);
  await page.getByLabel("Senha").or(page.getByLabel("Palavra-passe")).first().fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/boas-vindas/);
  await page.getByText("Finanças pessoais", { exact: true }).click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.waitForURL(/\/painel/);

  // Conta
  await page.goto(`${BASE}/financas/contas`);
  await main.getByLabel("Nome", { exact: true }).fill("Conta corrente");
  await main.getByLabel("Saldo inicial").fill("3200");
  await main.getByRole("button", { name: "Salvar" }).click();
  await main.getByText("Conta corrente", { exact: true }).first().waitFor();

  // Lançamentos
  const tx = async (kind, amount, description, opts = {}) => {
    await page.goto(`${BASE}/financas/movimentos`);
    if (kind === "income") await main.getByText("Receita", { exact: true }).first().click();
    await main.getByLabel(/^Valor/).fill(amount);
    await main.getByLabel("Descrição", { exact: true }).fill(description);
    if (opts.pending) {
      await main.getByLabel("Estado do pagamento").selectOption("pending");
      if (opts.due) await main.getByLabel(/^Vencimento/).fill(opts.due);
    }
    await main.getByRole("button", { name: "Salvar" }).click();
    await main.getByText("Lançamento registrado.").or(main.getByText("Movimento registado.")).first().waitFor();
  };
  await tx("income", "5400", "Salário");
  await tx("expense", "312,40", "Mercado");
  await tx("expense", "27,90", "Uber");
  await tx("expense", "189,90", "Conta de luz", { pending: true, due: "2026-11-28" });
  await tx("income", "850", "Freela de design", { pending: true, due: "2026-11-30" });

  // Assinatura
  await page.goto(`${BASE}/financas/recorrentes`);
  await main.getByLabel(/^Valor/).fill("55,90");
  await main.getByLabel("Descrição", { exact: true }).fill("Streaming");
  await main.getByRole("button", { name: /Nova recorrência/ }).click();
  await page.waitForTimeout(1500);

  // Parcelas
  await page.goto(`${BASE}/financas/parcelas`);
  await main.getByLabel("Descrição", { exact: true }).fill("Notebook");
  await main.getByLabel(/^Valor/).fill("3600");
  await main.getByLabel("Número de parcelas").fill("10");
  await main.getByLabel("Dia do vencimento").fill("26");
  await main.getByRole("button", { name: "Criar parcelas" }).click();
  await main.getByText("Parcelas criadas.").waitFor();

  // Telas
  await page.goto(`${BASE}/painel`);
  const later = main.getByRole("button", { name: "Agora não" });
  if (await later.isVisible().catch(() => false)) await later.click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("01-hoje");
  await main.getByText(/Receitas do mês|Receitas/).first().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 250);
  await shot("01b-kpis");
  await main.getByRole("heading", { name: "Próximos pagamentos" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -120);
  await shot("02-hoje-proximos");

  await page.goto(`${BASE}/financas`);
  await page.waitForTimeout(800);
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading").first().waitFor();
  await dialog.getByLabel(/^Valor/).fill("42,90");
  await dialog.getByLabel("Descrição").fill("Almoço");
  await shot("03-registro-rapido");
  await page.keyboard.press("Escape");

  await page.goto(`${BASE}/financas/em-aberto`);
  await main.getByRole("region", { name: "A receber" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -60);
  await shot("04-a-receber-pagar");

  await page.goto(`${BASE}/financas/calendario`);
  await main.getByRole("listitem", { name: /Saldo previsto BRL/ }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 120);
  await shot("05-calendario");

  await page.goto(`${BASE}/financas/parcelas`);
  await main.getByRole("listitem", { name: "Notebook" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await shot("06-parcelas");

  // Empresa
  await page.goto(`${BASE}/organizacoes/nova`);
  await page.getByLabel(/Nome comercial|Nome fantasia/).fill("Studio Ana Design");
  await page.getByRole("button", { name: /Criar organização/ }).click();
  await page.waitForURL(/\/painel/);

  await page.goto(`${BASE}/orcamentos/novo?categoria=design`);
  await main.getByRole("radio").nth(1).check();
  await main.getByLabel(/^Quantidade/).fill("1");
  await shot("07-orcamento-modelos");
  await main.getByLabel(/^Quantidade/).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 120);
  await shot("08-orcamento-total");

  // Menu com o seletor de contexto (Pessoal / Empresa)
  await page.goto(`${BASE}/painel`);
  await page.getByRole("button", { name: /Mais/ }).last().click();
  await page.waitForTimeout(900);
  await shot("09-contexto");
} finally {
  await browser.close();
  await cleanup(userId);
  console.log("conta de demonstração apagada");
}
