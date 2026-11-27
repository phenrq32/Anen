import "server-only";
import { z } from "zod";
import {
  categoryChanges,
  compareSupplierPrices,
  decimalToString,
  findPossibleDuplicates,
  marginPercent,
  moneyFromMinor,
  reportLines,
  reportTotal,
  requiredRevenue,
  type Decimal,
  type ReportRow,
} from "@anen/financial-engine";
import { formatDate, formatMoney, type Messages } from "@anen/i18n";
import type { Locale } from "@anen/types";
import { parseAmountInput } from "@anen/validation";
import { businessScope } from "@/lib/business";
import { categoryLabel, financeScope, todayIn } from "@/lib/finance";
import { projectFinancials } from "@/lib/projects";
import { quotesScope } from "@/lib/quotes";
import type { SessionContext } from "@/lib/session";
import { loadFinanceOverview } from "@/lib/finance-overview";
import { aiContextFor, toolAllowed, AI_CONTEXT_TOOLS, type AiContext } from "./context";
import type { FunctionDeclaration } from "./gemini";

/**
 * Ferramentas da ANEN AI. Cada uma:
 * - corre com a sessão da pessoa (RLS e permissões normais: a IA nunca vê mais do que a pessoa);
 * - calcula com @anen/financial-engine (nada de contas feitas pelo modelo);
 * - devolve valores já formatados e as fontes (ligações para os registos usados), que a interface
 *   mostra por baixo da resposta. As fontes vêm daqui, nunca do texto do modelo.
 */
export interface Source {
  label: string;
  href: string;
}

export interface ToolResult {
  data: Record<string, unknown>;
  sources: Source[];
}

export interface ToolContext {
  session: SessionContext;
  m: Messages;
  locale: Locale;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_RANGE_DAYS = 366 * 3;

function checkRange(from: string, to: string): string | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return "Período inválido: a data inicial tem de ser anterior à final.";
  if ((b - a) / 86_400_000 > MAX_RANGE_DAYS) return "Período demasiado longo (máximo 3 anos).";
  return null;
}

const pct = (d: Decimal | null) => (d ? `${decimalToString(d)} %` : null);

async function minorUnits(ctx: ToolContext): Promise<Map<string, number>> {
  const { data } = await ctx.session.supabase.from("currencies").select("code, minor_unit");
  return new Map((data ?? []).map((c) => [c.code, c.minor_unit]));
}

function money(ctx: ToolContext, units: Map<string, number>, v: bigint, currency: string): string {
  return formatMoney(v, currency, units.get(currency) ?? 2, ctx.locale);
}

async function loadReportRows(ctx: ToolContext, from: string, to: string): Promise<ReportRow[]> {
  const fin = financeScope(ctx.session);
  const { data, error } = await ctx.session.supabase.rpc("finance_report", { p_org: fin.orgId, p_from: from, p_to: to });
  if (error) throw new Error("finance_report");
  return (data ?? []).map((r) => ({
    dimension: r.dimension,
    key: r.key,
    currency: r.currency_code,
    incomeTotal: BigInt(r.income_total),
    incomeSettled: BigInt(r.income_settled),
    expenseTotal: BigInt(r.expense_total),
    expenseSettled: BigInt(r.expense_settled),
    count: Number(r.count),
  }));
}

async function categoryNames(ctx: ToolContext): Promise<Map<string, string>> {
  const fin = financeScope(ctx.session);
  const { data } = await ctx.session.supabase
    .from("transaction_categories")
    .select("id, key, name, is_system")
    .or(`is_system.eq.true,${fin.column}.eq.${fin.value}`);
  return new Map((data ?? []).map((c) => [c.id, categoryLabel(ctx.m, c)]));
}

const reportLink = (from: string, to: string) => `/relatorios?periodo=custom&de=${from}&ate=${to}`;

interface ToolDef<S extends z.ZodTypeAny> {
  declaration: FunctionDeclaration;
  schema: S;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolResult>;
}

function tool<S extends z.ZodTypeAny>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const NO_FINANCE: ToolResult = { data: { erro: "Sem permissão para consultar as finanças neste contexto." }, sources: [] };
const NO_BUSINESS: ToolResult = { data: { erro: "Sem permissão para consultar clientes, fornecedores, compras e stock neste contexto." }, sources: [] };

const periodParams = {
  type: "object",
  properties: {
    de: { type: "string", description: "Data inicial AAAA-MM-DD" },
    ate: { type: "string", description: "Data final AAAA-MM-DD (inclusive)" },
  },
  required: ["de", "ate"],
};

export const TOOLS = {
  resumo_financeiro: tool({
    declaration: {
      name: "resumo_financeiro",
      description:
        "Receitas, despesas, resultado e valores por receber/pagar num período, com o total por categoria (faturado = valor dos movimentos com data no período; liquidado = já recebido ou pago). Use para 'quanto gastei/recebi', 'gastos em X', 'lucro do mês'.",
      parameters: periodParams,
    },
    schema: z.object({ de: isoDate, ate: isoDate }),
    async run(ctx, { de, ate }) {
      if (!financeScope(ctx.session).canRead) return NO_FINANCE;
      const bad = checkRange(de, ate);
      if (bad) return { data: { erro: bad }, sources: [] };
      const [rows, names, units] = await Promise.all([loadReportRows(ctx, de, ate), categoryNames(ctx), minorUnits(ctx)]);
      const currencies = [...new Set(rows.filter((r) => r.dimension === "total").map((r) => r.currency))];
      if (currencies.length === 0) return { data: { periodo: { de, ate }, movimentos: 0, nota: "Não há movimentos neste período." }, sources: [] };
      const porMoeda = currencies.map((c) => {
        const t = reportTotal(rows, c);
        return {
          moeda: c,
          movimentos: t.count,
          receitas_faturadas: money(ctx, units, t.incomeTotal, c),
          receitas_recebidas: money(ctx, units, t.incomeSettled, c),
          despesas_faturadas: money(ctx, units, t.expenseTotal, c),
          despesas_pagas: money(ctx, units, t.expenseSettled, c),
          resultado_faturado: money(ctx, units, t.resultTotal, c),
          resultado_caixa: money(ctx, units, t.resultSettled, c),
          por_receber: money(ctx, units, t.receivable, c),
          por_pagar: money(ctx, units, t.payable, c),
          por_categoria: reportLines(rows, "category", c)
            .slice(0, 15)
            .map((l) => ({
              categoria: l.key ? (names.get(l.key) ?? "Categoria") : ctx.m.reports.none.category,
              receitas: money(ctx, units, l.incomeTotal, c),
              despesas: money(ctx, units, l.expenseTotal, c),
              movimentos: l.count,
            })),
        };
      });
      return { data: { periodo: { de, ate }, por_moeda: porMoeda }, sources: [{ label: `Relatório ${de} a ${ate}`, href: reportLink(de, ate) }] };
    },
  }),

  comparar_periodos: tool({
    declaration: {
      name: "comparar_periodos",
      description:
        "Compara despesas (ou receitas) por categoria entre dois períodos e ordena pelas maiores subidas. Use para 'que despesas mais aumentaram', 'comparar este mês com o anterior'.",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["despesa", "receita"] },
          anterior_de: { type: "string" },
          anterior_ate: { type: "string" },
          atual_de: { type: "string" },
          atual_ate: { type: "string" },
        },
        required: ["tipo", "anterior_de", "anterior_ate", "atual_de", "atual_ate"],
      },
    },
    schema: z.object({ tipo: z.enum(["despesa", "receita"]), anterior_de: isoDate, anterior_ate: isoDate, atual_de: isoDate, atual_ate: isoDate }),
    async run(ctx, a) {
      if (!financeScope(ctx.session).canRead) return NO_FINANCE;
      const bad = checkRange(a.anterior_de, a.anterior_ate) ?? checkRange(a.atual_de, a.atual_ate);
      if (bad) return { data: { erro: bad }, sources: [] };
      const [prev, cur, names, units] = await Promise.all([
        loadReportRows(ctx, a.anterior_de, a.anterior_ate),
        loadReportRows(ctx, a.atual_de, a.atual_ate),
        categoryNames(ctx),
        minorUnits(ctx),
      ]);
      const currencies = [...new Set([...prev, ...cur].filter((r) => r.dimension === "total").map((r) => r.currency))];
      const field = a.tipo === "despesa" ? "expenseTotal" : "incomeTotal";
      const pick = (rows: ReportRow[], c: string) =>
        rows.filter((r) => r.dimension === "category" && r.currency === c).map((r) => ({ key: r.key, totalMinor: r[field] }));
      return {
        data: {
          tipo: a.tipo,
          por_moeda: currencies.map((c) => ({
            moeda: c,
            categorias: categoryChanges(pick(prev, c), pick(cur, c), c)
              .slice(0, 12)
              .map((x) => ({
                categoria: x.key ? (names.get(x.key) ?? "Categoria") : ctx.m.reports.none.category,
                anterior: money(ctx, units, x.previous.amountMinor, c),
                atual: money(ctx, units, x.current.amountMinor, c),
                variacao: money(ctx, units, x.change.amountMinor, c),
                variacao_percentual: pct(x.changePercent),
              })),
          })),
        },
        sources: [
          { label: `Relatório ${a.anterior_de} a ${a.anterior_ate}`, href: reportLink(a.anterior_de, a.anterior_ate) },
          { label: `Relatório ${a.atual_de} a ${a.atual_ate}`, href: reportLink(a.atual_de, a.atual_ate) },
        ],
      };
    },
  }),

  pendentes: tool({
    declaration: {
      name: "pendentes",
      description: "Valores por receber de clientes e por pagar a fornecedores, com vencimento e atrasos. Use para 'quem me deve', 'pagamentos atrasados', 'o que tenho de pagar'.",
      parameters: { type: "object", properties: { tipo: { type: "string", enum: ["receber", "pagar", "todos"] } }, required: ["tipo"] },
    },
    schema: z.object({ tipo: z.enum(["receber", "pagar", "todos"]) }),
    async run(ctx, { tipo }) {
      const fin = financeScope(ctx.session);
      if (!fin.canRead) return NO_FINANCE;
      let q = ctx.session.supabase
        .from("transactions")
        .select("id, kind, description, amount_minor, settled_minor, currency_code, due_on, occurred_on, contact_id")
        .eq(fin.column, fin.value)
        .neq("payment_status", "paid")
        .order("due_on", { ascending: true, nullsFirst: false })
        .limit(300);
      if (tipo !== "todos") q = q.eq("kind", tipo === "receber" ? "income" : "expense");
      const [{ data }, units, contacts] = await Promise.all([
        q,
        minorUnits(ctx),
        businessScope(ctx.session).canRead
          ? ctx.session.supabase.from("contacts").select("id, name").eq(fin.column, fin.value).limit(5000)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const today = todayIn(fin.timezone);
      const names = new Map((contacts.data ?? []).map((c) => [c.id, c.name]));
      const items = (data ?? []).map((t) => {
        const remaining = BigInt(t.amount_minor) - BigInt(t.settled_minor);
        return { t, remaining, overdue: t.due_on !== null && t.due_on < today };
      });
      const totals = new Map<string, { receber: bigint; pagar: bigint; atrasado: bigint }>();
      for (const i of items) {
        const s = totals.get(i.t.currency_code) ?? { receber: 0n, pagar: 0n, atrasado: 0n };
        if (i.t.kind === "income") s.receber += i.remaining;
        else s.pagar += i.remaining;
        if (i.overdue) s.atrasado += i.remaining;
        totals.set(i.t.currency_code, s);
      }
      return {
        data: {
          hoje: today,
          quantidade: items.length,
          totais: [...totals].map(([c, s]) => ({
            moeda: c,
            por_receber: money(ctx, units, s.receber, c),
            por_pagar: money(ctx, units, s.pagar, c),
            em_atraso: money(ctx, units, s.atrasado, c),
          })),
          itens: items.slice(0, 25).map((i) => ({
            tipo: i.t.kind === "income" ? "receber" : "pagar",
            descricao: i.t.description,
            contacto: i.t.contact_id ? (names.get(i.t.contact_id) ?? null) : null,
            em_falta: money(ctx, units, i.remaining, i.t.currency_code),
            vencimento: i.t.due_on,
            atrasado: i.overdue,
          })),
        },
        sources: [{ label: ctx.m.finance.tabs.open, href: "/financas/em-aberto" }],
      };
    },
  }),

  despesas_duplicadas: tool({
    declaration: {
      name: "despesas_duplicadas",
      description: "Procura despesas possivelmente duplicadas num período (mesmo valor e descrição ou fornecedor, a até 3 dias).",
      parameters: periodParams,
    },
    schema: z.object({ de: isoDate, ate: isoDate }),
    async run(ctx, { de, ate }) {
      const fin = financeScope(ctx.session);
      if (!fin.canRead) return NO_FINANCE;
      const bad = checkRange(de, ate);
      if (bad) return { data: { erro: bad }, sources: [] };
      const [{ data }, units] = await Promise.all([
        ctx.session.supabase
          .from("transactions")
          .select("id, description, amount_minor, currency_code, occurred_on, contact_id")
          .eq(fin.column, fin.value)
          .eq("kind", "expense")
          .gte("occurred_on", de)
          .lte("occurred_on", ate)
          .limit(3000),
        minorUnits(ctx),
      ]);
      const groups = findPossibleDuplicates(
        (data ?? []).map((t) => ({
          id: t.id,
          description: t.description,
          amountMinor: BigInt(t.amount_minor),
          currency: t.currency_code,
          occurredOn: t.occurred_on,
          contactId: t.contact_id,
        })),
      );
      return {
        data: {
          periodo: { de, ate },
          analisadas: (data ?? []).length,
          grupos: groups.slice(0, 15).map((g) => g.map((x) => ({ descricao: x.description, valor: money(ctx, units, x.amountMinor, x.currency), data: x.occurredOn }))),
        },
        sources: [{ label: ctx.m.finance.tabs.transactions, href: `/financas/movimentos?tipo=expense&mes=${ate.slice(0, 7)}` }],
      };
    },
  }),

  projetos: tool({
    declaration: {
      name: "projetos",
      description: "Rentabilidade dos projetos: custo e receita previstos vs reais, desvio do orçamento e margem real. Use para 'serviço/projeto mais rentável', 'projeto acima do orçamento'.",
      parameters: { type: "object", properties: { estado: { type: "string", enum: ["ativos", "todos"] } }, required: ["estado"] },
    },
    schema: z.object({ estado: z.enum(["ativos", "todos"]) }),
    async run(ctx, { estado }) {
      const biz = businessScope(ctx.session);
      const fin = financeScope(ctx.session);
      if (!biz.canRead) return NO_BUSINESS;
      let q = ctx.session.supabase.from("projects").select("*").eq(biz.column, biz.value).order("created_at", { ascending: false }).limit(60);
      if (estado === "ativos") q = q.in("status", ["planned", "active"]);
      const [{ data: projects }, units] = await Promise.all([q, minorUnits(ctx)]);
      const list = projects ?? [];
      const { data: txs } =
        fin.canRead && list.length
          ? await ctx.session.supabase
              .from("transactions")
              .select("project_id, kind, amount_minor, net_minor, settled_minor, cost_kind, currency_code")
              .in("project_id", list.map((p) => p.id))
          : { data: [] };
      return {
        data: {
          financas_visiveis: fin.canRead,
          projetos: list.map((p) => {
            const f = projectFinancials(p, (txs ?? []).filter((t) => t.project_id === p.id));
            const c = p.currency_code;
            return {
              nome: p.name,
              estado: ctx.m.business.projects.statuses[p.status],
              custo_previsto: money(ctx, units, f.plannedCost.amountMinor, c),
              custo_real: money(ctx, units, f.actualCost.amountMinor, c),
              desvio_custo: money(ctx, units, f.costVariance.amountMinor, c),
              receita_prevista: money(ctx, units, f.plannedRevenue.amountMinor, c),
              receita_faturada: money(ctx, units, f.invoicedRevenue.amountMinor, c),
              receita_recebida: money(ctx, units, f.receivedRevenue.amountMinor, c),
              desvio_custo_percentual: pct(f.costVariancePercent),
              lucro_previsto: money(ctx, units, f.plannedProfit.amountMinor, c),
              lucro_real: money(ctx, units, f.actualProfit.amountMinor, c),
              margem_prevista: pct(f.plannedMarginPercent),
              margem_real: pct(f.actualMarginPercent),
              acima_do_orcamento: f.overBudget,
            };
          }),
        },
        sources: list.slice(0, 8).map((p) => ({ label: p.name, href: `/projetos/${p.id}` })),
      };
    },
  }),

  precos_fornecedores: tool({
    declaration: {
      name: "precos_fornecedores",
      description:
        "Preços registados de fornecedores (registos manuais e compras recebidas): o mais recente de cada fornecedor por artigo, do mais barato para o mais caro. Use para 'que fornecedor é mais barato', 'preço do cimento'. Não são preços de mercado.",
      parameters: { type: "object", properties: { artigo: { type: "string", description: "Parte do nome do artigo (opcional)" } } },
    },
    schema: z.object({ artigo: z.string().max(80).optional() }),
    async run(ctx, { artigo }) {
      const biz = businessScope(ctx.session);
      if (!biz.canRead) return NO_BUSINESS;
      let q = ctx.session.supabase.from("supplier_prices").select("*").eq(biz.column, biz.value).order("observed_on", { ascending: false }).limit(3000);
      if (artigo?.trim()) q = q.ilike("item_name", `%${artigo.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`);
      const [{ data: prices }, { data: suppliers }, units] = await Promise.all([
        q,
        ctx.session.supabase.from("contacts").select("id, name").eq(biz.column, biz.value).limit(5000),
        minorUnits(ctx),
      ]);
      const names = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
      const comparisons = compareSupplierPrices(
        (prices ?? []).map((p) => ({
          id: p.id,
          itemName: p.item_name,
          unit: p.unit,
          unitPriceMinor: BigInt(p.unit_price_minor),
          currency: p.currency_code,
          observedOn: p.observed_on,
          createdAt: p.created_at,
          supplierId: p.contact_id,
          supplierName: names.get(p.contact_id) ?? "",
        })),
      );
      return {
        data: {
          registos: (prices ?? []).length,
          comparacoes: comparisons.slice(0, 15).map((c) => ({
            artigo: c.itemName,
            unidade: c.unit,
            ofertas: c.offers.map((o) => ({
              fornecedor: o.supplierName,
              preco: money(ctx, units, o.price.amountMinor, c.currency),
              data_do_preco: o.observedOn,
              acima_do_mais_barato: money(ctx, units, o.aboveCheapest.amountMinor, c.currency),
            })),
          })),
          nota: comparisons.length === 0 ? "Não há artigos com preços de dois ou mais fornecedores." : undefined,
        },
        sources: [{ label: ctx.m.purchases.compare.title, href: "/compras" }],
      };
    },
  }),

  estoque_reposicao: tool({
    declaration: {
      name: "estoque_reposicao",
      description: "Artigos em stock abaixo do mínimo, quantidade sugerida para repor (já descontado o que está encomendado), fornecedor e último preço pago.",
      parameters: { type: "object", properties: {} },
    },
    schema: z.object({}),
    async run(ctx) {
      const biz = businessScope(ctx.session);
      if (!biz.canRead) return NO_BUSINESS;
      const [{ data }, units] = await Promise.all([ctx.session.supabase.rpc("stock_reorder_suggestions", { p_org: biz.orgId }), minorUnits(ctx)]);
      return {
        data: {
          artigos: (data ?? []).map((s) => ({
            artigo: s.item_name,
            em_stock: `${s.quantity_on_hand} ${s.unit}`,
            minimo: `${s.min_quantity} ${s.unit}`,
            ja_encomendado: `${s.open_quantity} ${s.unit}`,
            sugerido: `${s.suggested_quantity} ${s.unit}`,
            fornecedor: s.supplier_name,
            ultimo_preco: s.last_unit_price_minor !== null ? money(ctx, units, BigInt(s.last_unit_price_minor), s.currency_code) : null,
          })),
        },
        sources: [{ label: ctx.m.inventory.title, href: "/inventario" }],
      };
    },
  }),

  receita_necessaria: tool({
    declaration: {
      name: "receita_necessaria",
      description:
        "Quanto é preciso faturar por mês para atingir um lucro mensal: despesa média dos últimos meses completos + lucro pretendido, comparado com a receita média atual.",
      parameters: {
        type: "object",
        properties: {
          lucro_mensal: { type: "string", description: "Lucro mensal pretendido, ex.: '3000' ou '3000,50'" },
          meses_base: { type: "integer", description: "Quantos meses completos usar como base (1 a 12, padrão 3)" },
        },
        required: ["lucro_mensal"],
      },
    },
    schema: z.object({ lucro_mensal: z.string().max(32), meses_base: z.number().int().min(1).max(12).optional() }),
    async run(ctx, { lucro_mensal, meses_base }) {
      const fin = financeScope(ctx.session);
      if (!fin.canRead) return NO_FINANCE;
      const units = await minorUnits(ctx);
      const currency = fin.defaultCurrency;
      const target = parseAmountInput(lucro_mensal, units.get(currency) ?? 2);
      if (target === null) return { data: { erro: "Valor de lucro inválido." }, sources: [] };
      const months = meses_base ?? 3;
      const today = todayIn(fin.timezone);
      const [y, mo] = today.split("-").map(Number) as [number, number];
      const end = new Date(Date.UTC(y, mo - 1, 0)); // último dia do mês anterior
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
      const de = start.toISOString().slice(0, 10);
      const ate = end.toISOString().slice(0, 10);
      const total = reportTotal(await loadReportRows(ctx, de, ate), currency);
      const r = requiredRevenue({ targetProfitMinor: target, totalExpenseMinor: total.expenseTotal, totalIncomeMinor: total.incomeTotal, months, currency });
      return {
        data: {
          moeda: currency,
          base: { de, ate, meses: months, movimentos: total.count },
          formula: "receita necessária = despesa média mensal + lucro pretendido",
          lucro_pretendido: money(ctx, units, target, currency),
          despesa_media_mensal: money(ctx, units, r.averageMonthlyExpense.amountMinor, currency),
          receita_media_mensal_atual: money(ctx, units, r.averageMonthlyIncome.amountMinor, currency),
          receita_mensal_necessaria: money(ctx, units, r.requiredMonthlyRevenue.amountMinor, currency),
          falta_por_mes: money(ctx, units, r.gap.amountMinor, currency),
          margem_resultante: pct(r.targetMargin),
          nota: total.count === 0 ? "Sem movimentos nesses meses: a base é zero e o resultado não é fiável." : undefined,
        },
        sources: [{ label: `Relatório ${de} a ${ate}`, href: reportLink(de, ate) }],
      };
    },
  }),

  orcamento_e_objetivos: tool({
    declaration: {
      name: "orcamento_e_objetivos",
      description:
        "Só no espaço pessoal: orçamento do mês por categoria (limite, gasto e disponível) e objetivos de poupança (meta, poupado e data). Use para 'quanto ainda posso gastar', 'como vão os meus objetivos'.",
      parameters: { type: "object", properties: {} },
    },
    schema: z.object({}).passthrough(),
    run: async (ctx) => {
      const fin = financeScope(ctx.session);
      if (!fin.canRead) return NO_FINANCE;
      const [overview, units] = await Promise.all([loadFinanceOverview(ctx.session.supabase, fin, ctx.m, ctx.locale, "month"), minorUnits(ctx)]);
      return {
        data: {
          mes: overview.month,
          orcamentos: overview.budgets.map((b) => ({
            categoria: b.label,
            limite: money(ctx, units, BigInt(b.amount_minor), b.currency_code),
            gasto: money(ctx, units, b.spent, b.currency_code),
            disponivel: money(ctx, units, BigInt(b.amount_minor) - b.spent, b.currency_code),
          })),
          objetivos: overview.goals.map((g) => ({
            nome: g.name,
            meta: money(ctx, units, BigInt(g.target_minor), g.currency_code),
            poupado: money(ctx, units, BigInt(g.saved_minor), g.currency_code),
            falta: money(ctx, units, BigInt(g.target_minor) - BigInt(g.saved_minor) > 0n ? BigInt(g.target_minor) - BigInt(g.saved_minor) : 0n, g.currency_code),
            data_alvo: g.target_date,
          })),
        },
        sources: [
          { label: "Orçamento e objetivos", href: "/financas/orcamentos" },
        ],
      };
    },
  }),
  orcamentos: tool({
    declaration: {
      name: "orcamentos",
      description: "Orçamentos por estado, valores e margem de cada um (preço sem impostos vs custo). Use para 'orçamentos aprovados', 'estou a cobrar barato', 'margem dos meus serviços'.",
      parameters: { type: "object", properties: {} },
    },
    schema: z.object({}),
    async run(ctx) {
      const qs = quotesScope(ctx.session);
      if (!qs.canRead) return { data: { erro: "Sem permissão para consultar orçamentos neste contexto." }, sources: [] };
      const [{ data }, units] = await Promise.all([
        ctx.session.supabase
          .from("quotes")
          .select("id, number, title, status, currency_code, total_cost_minor, price_before_tax_minor, total_minor, created_at")
          .eq(qs.column, qs.value)
          .order("created_at", { ascending: false })
          .limit(100),
        minorUnits(ctx),
      ]);
      const list = data ?? [];
      return {
        data: {
          quantidade: list.length,
          orcamentos: list.slice(0, 40).map((q) => {
            const cost = BigInt(q.total_cost_minor);
            const price = BigInt(q.price_before_tax_minor);
            const margin = pct(marginPercent(moneyFromMinor(price - cost, q.currency_code), moneyFromMinor(price, q.currency_code)));
            return {
              numero: q.number,
              titulo: q.title,
              estado: ctx.m.quotes.statuses[q.status],
              custo: money(ctx, units, cost, q.currency_code),
              preco_sem_impostos: money(ctx, units, price, q.currency_code),
              total: money(ctx, units, BigInt(q.total_minor), q.currency_code),
              margem: margin,
              criado: formatDate(q.created_at, ctx.locale, "UTC", { day: "2-digit", month: "short", year: "numeric" }),
            };
          }),
        },
        sources: list.slice(0, 6).map((q) => ({ label: `${q.number} · ${q.title}`, href: `/orcamentos/${q.id}` })),
      };
    },
  }),
} as const;

export type ToolName = keyof typeof TOOLS;

export const TOOL_DECLARATIONS: FunctionDeclaration[] = Object.values(TOOLS).map((t) => t.declaration);

/** Contexto da IA do espaço ativo (§8). */
export function aiContextOf(ctx: ToolContext): AiContext {
  return aiContextFor(ctx.session.active?.organization.id ?? null);
}

/** Só as ferramentas do contexto do espaço ativo são oferecidas ao modelo. */
export function toolDeclarationsFor(context: AiContext): FunctionDeclaration[] {
  const allowed = new Set<string>(AI_CONTEXT_TOOLS[context]);
  return Object.values(TOOLS).filter((t) => allowed.has(t.declaration.name)).map((t) => t.declaration);
}

/** Executa uma ferramenta pedida pelo modelo, com os argumentos validados. Nunca lança: devolve o erro como dado. */
export async function runTool(ctx: ToolContext, name: string, args: unknown): Promise<ToolResult> {
  const def = (TOOLS as Record<string, ToolDef<z.ZodTypeAny>>)[name];
  if (!def) return { data: { erro: `Ferramenta desconhecida: ${name}` }, sources: [] };
  // Validação no servidor antes de qualquer consulta: a ferramenta tem de pertencer ao contexto do espaço ativo.
  if (!toolAllowed(aiContextOf(ctx), name)) return { data: { erro: "Esta informação não está disponível neste espaço." }, sources: [] };
  const parsed = def.schema.safeParse(args ?? {});
  if (!parsed.success) return { data: { erro: "Argumentos inválidos para a ferramenta." }, sources: [] };
  try {
    return await def.run(ctx, parsed.data);
  } catch {
    return { data: { erro: "Não foi possível consultar estes dados agora." }, sources: [] };
  }
}
