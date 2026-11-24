#!/usr/bin/env node
/**
 * Gera a migration de uma edição dos modelos de orçamento com preços a partir do pacote do dono da app
 * (data/modelos-orcamento/dados/modelos_orcamento_<edição>.json).
 *
 *   node scripts/quote-models/build-migration.mjs 2026-11 > supabase/migrations/20261124003100_quote_service_models.sql
 *   node scripts/quote-models/build-migration.mjs 2026-12 > supabase/migrations/20261124003300_quote_service_models_2026_12.sql
 *
 * A primeira edição cria as tabelas; as seguintes só acrescentam um conjunto novo por país (as anteriores ficam,
 * para os orçamentos já criados continuarem a apontar para o modelo de onde vieram). A página usa a edição mais recente.
 *
 * Determinístico: o mesmo JSON dá sempre o mesmo SQL. Recusa dados inconsistentes (composição que não
 * soma o preço, preço fora da faixa, ids repetidos, categorias desconhecidas). Os preços passam a
 * unidades mínimas (cêntimos) sem vírgula flutuante. Não altera preços: isso é decisão do dono da app.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EDITION = process.argv[2] ?? "2026-11";
const EDITIONS = {
  "2026-11": { schema: true, validFrom: "2026-11-01" },
  "2026-12": { schema: false, validFrom: "2026-11-24" },
};
if (!EDITIONS[EDITION]) throw new Error(`Edição desconhecida: ${EDITION}`);
const pack = JSON.parse(readFileSync(resolve(root, `data/modelos-orcamento/dados/modelos_orcamento_${EDITION}.json`), "utf8"));

/** Categoria do pacote → modelo de orçamento da app (quote_templates.key). */
export const CATEGORY_TO_TEMPLATE = {
  agricultura: "agriculture",
  automotivo: "automotive",
  hidraulica: "plumbing",
  construcao: "construction",
  consultoria: "consulting",
  design: "design",
  educacao: "education",
  eletrica: "electrical",
  estetica: "beauty",
  eventos: "events",
  limpeza: "cleaning",
  marketing: "marketing",
  pintura: "painting",
  reforma: "renovation",
  "alimentacao-buffet": "food_service",
  saude: "health",
  "servicos-domesticos": "home_services",
  tecnologia: "technology",
  transportes: "transport",
};

/** Tipo de custo de cada linha, igual ao das linhas dos modelos da app (migration 0500). */
const LINE_KIND = {
  "Materiais de construção": "material",
  "Mão de obra (pedreiro)": "labor",
  "Mão de obra (servente)": "labor",
  "Aluguer de equipamento": "equipment",
  "Deslocação": "travel",
  "Deslocação / entulho": "travel", // só no pacote (Construção); o nome mantém-se como veio
  "Licenças, seguros e resíduos": "overhead",
  "Demolição e preparação": "labor",
  "Materiais": "material",
  "Execução": "labor",
  "Remoção de entulho": "overhead",
  "Tinta": "material",
  "Primário / selante": "material",
  "Fita, lixas, plásticos de proteção": "material",
  "Preparação de superfícies": "labor",
  "Pintura": "labor",
  "Tomadas / interruptores": "material",
  "Cabo elétrico": "material",
  "Caixas e tubagem": "material",
  "Instalação": "labor",
  "Tubagem e acessórios": "material",
  "Torneiras / louças": "material",
  "Instalação / reparação": "labor",
  "Consulta / sessão": "labor",
  "Consumíveis": "material",
  "Espaço e equipamento": "overhead",
  "Serviço": "labor",
  "Produtos": "material",
  "Ingredientes": "material",
  "Cozinha e serviço": "labor",
  "Equipamento e loiça": "equipment",
  "Transporte": "travel",
  "Análise e desenho": "labor",
  "Desenvolvimento": "labor",
  "Testes e implementação": "labor",
  "Licenças e serviços de terceiros": "other",
  "Peças": "material",
  "Óleos e consumíveis": "material",
  "Mão de obra": "labor",
  "Diagnóstico": "labor",
  "Limpeza": "labor",
  "Produtos de limpeza": "material",
  "Equipamento": "equipment",
  "Briefing e pesquisa": "labor",
  "Criação": "labor",
  "Revisões": "labor",
  "Licenças de imagens / fontes": "other",
  "Estratégia": "labor",
  "Produção de conteúdos": "labor",
  "Investimento em anúncios": "other",
  "Relatórios": "labor",
  "Quilómetros": "travel",
  "Carga e descarga": "labor",
  "Portagens / pedágios": "overhead",
  "Material de embalagem": "material",
  "Aulas / formação": "labor",
  "Preparação": "labor",
  "Materiais didáticos": "material",
  "Sementes / plantas": "material",
  "Fertilizantes": "material",
  "Maquinaria": "equipment",
  "Organização": "labor",
  "Espaço": "other",
  "Catering": "other",
  "Consultoria": "labor",
  "Relatório": "labor",
};

/** Metodologia, fontes e impostos por país e por edição (da última página de cada PDF do pacote). */
const SETS_2026_11 = {
  pt: {
    country: "PT",
    disclaimer:
      "Valores indicativos. Cada profissional deve validar com os seus custos reais (hora, seguro, combustível, margem) antes de publicar. Não constitui aconselhamento fiscal.",
    methodology:
      "Preços recomendados a partir das médias e intervalos publicados pelas principais plataformas de contratação de serviços em Portugal, tabelas de grandes prestadores e dados oficiais de custos, atualizados para 2026. Onde as fontes divergiam, foi usado o valor central para um profissional com seguro, fatura e garantia. Referências comerciais, não tabelas oficiais. Referência: Portugal continental.",
    sources: [
      "Zaask – guias “Quanto custa” (zaask.pt/quanto-custa)",
      "Habitissimo – guias de preços (habitissimo.pt/orcamentos)",
      "Worten Resolve – preços tabelados de instalação elétrica e canalização",
      "idealista/news – limpeza doméstica 2026 e custos de construção/mão de obra (INE)",
      "INE / ECO – Índice de Custos de Construção de Habitação Nova 2025",
      "ANECRA / DN – custo médio de mão de obra em oficinas (2026)",
      "Casamentos.pt – catering de casamento por convidado",
      "OCC / CRN Contabilidade – compensação por km em viatura própria",
    ],
    // Preços sem IVA. Taxa normal no continente: 23 % (Código do IVA, art. 18.º, n.º 1, al. c)). Só se soma se o profissional escolher.
    suggestedTax: { percent: "23", label: "IVA 23% (continente)", reference: "Código do IVA, art. 18.º, n.º 1, alínea c)" },
  },
  br: {
    country: "BR",
    disclaimer:
      "Valores indicativos. Cada profissional deve validar com seus custos reais (hora, impostos, combustível, margem) antes de publicar. Não constitui orientação contábil ou fiscal.",
    methodology:
      "Preços recomendados a partir de tabelas e guias de preço brasileiros publicados em 2026 (plataformas de contratação, portais de reforma baseados no SINAPI, tabelas de eletricistas, buffets, salões e clínicas). Onde as fontes divergiam, foi usado o valor central para um profissional formalizado (MEI/CNPJ), com nota fiscal e garantia, em capital do Sudeste. Referências comerciais, não tabelas oficiais.",
    sources: [
      "SINAPI / Caixa e Lar Pontual (Portal da Reforma) – data-base 2026",
      "Catraca Livre, Cidesp e Engenharia 360 – mão de obra de pedreiro 2026",
      "Engehall e Lar Pontual – tabela de preços de eletricista 2026",
      "Cronoshare e GetNinjas – encanador, diarista, design gráfico, fisioterapia, carreto e mudanças",
      "Superprof, Labra e GetNinjas – hora-aula particular e reforço escolar",
      "Casamentos.com.br, Plusdin e Freela Sem Crise – buffet, social media, tráfego pago, logotipo",
      "Webmotors e Expert Zoom – pastilhas, discos e revisão",
      "SICRO/DNIT (Orçamentor) – custo horário de trator com roçadeira (abr/2026)",
      "Agilize, Meu Tudo e Booksy – psicólogo, nutricionista, manicure, depilação e sobrancelha",
    ],
    suggestedTax: null,
  },
};

const PT_TAX = { percent: "23", label: "IVA 23% (continente)", reference: "Código do IVA, art. 18.º, n.º 1, alínea c)" };
/** Edição revista a pedido do dono da app (24/11/2026): preços pela média nacional publicada e mais serviços. */
const SETS_2026_12 = {
  pt: {
    country: "PT",
    disclaimer: SETS_2026_11.pt.disclaimer,
    methodology:
      "Edição revista a pedido do dono da aplicação. O preço recomendado de cada serviço revisto ou novo segue a média nacional publicada pela fonte indicada (sobretudo os guias “Quanto custa” da Zaask), e foram acrescentados serviços em todas as categorias. Os serviços sem nova fonte mantêm o valor da edição anterior. Referências comerciais, não tabelas oficiais. Referência: Portugal continental.",
    sources: [
      "Zaask – guias “Quanto custa” 2026, médias nacionais por serviço (zaask.pt/quanto-custa)",
      "Expert-Zoom / ANECRA 2024 e DNotícias 2026 – revisão, kit de distribuição e hora de oficina",
      ...SETS_2026_11.pt.sources,
    ],
    suggestedTax: PT_TAX,
  },
  br: {
    country: "BR",
    disclaimer: SETS_2026_11.br.disclaimer,
    methodology:
      "Edição revista a pedido do dono do aplicativo. Os preços recomendados passaram a seguir a média nacional publicada pelos guias de preço de 2026 (antes: capitais do Sudeste), e foram acrescentados serviços em todas as categorias. Para cada serviço revisto ou novo foi usado o valor central da faixa publicada pela fonte indicada; os serviços sem nova fonte mantêm o valor da edição anterior. A tabela de eletricista indica só mão de obra (material à parte). Referências comerciais, não tabelas oficiais.",
    sources: [
      "Cronoshare – guias de preço “Quanto custa” 2026, média nacional por serviço (cronoshare.com.br/quanto-custa)",
      "Engehall – tabela de preços de eletricista 2026 (fev/2026), só mão de obra",
      "Lar Pontual / Portal da Reforma – tabelas de encanador, reboco e contrapiso 2026",
      "Cidesp – tabelas de mão de obra de pedreiro e hidráulica 2026",
      "Catraca Livre, Monitor do Mercado e Diário do Comércio – diaristas, pedreiro e embreagem (2026)",
      "Webmotors, Porto Seguro Centro Automotivo e Vrum – troca de óleo, pastilhas e fluido de câmbio",
      "Idec – custo da hora em oficina independente",
      "Edição 2026-11 (SINAPI/Caixa, SICRO/DNIT, Casamentos.com.br, Superprof e outras) – serviços sem nova fonte",
    ],
    suggestedTax: null,
  },
};
const SETS = { "2026-11": SETS_2026_11, "2026-12": SETS_2026_12 }[EDITION];

/** "130" → 13000n; "2.2" → 220n (até 2 casas decimais; mais é recusado). */
function toMinor(value) {
  const s = typeof value === "number" ? String(value) : value;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Valor inválido: ${s}`);
  const [int, frac = ""] = s.split(".");
  return BigInt(int) * 100n + BigInt((frac + "00").slice(0, 2));
}

const q = (s) => (s === null || s === undefined || s === "" ? "null" : `'${String(s).replace(/'/g, "''")}'`);

function build() {
  const version = pack.versao;
  if (!/^\d{4}-\d{2}$/.test(version)) throw new Error("versao inválida");
  const out = [];
  const ids = new Set();
  out.push(`-- GERADO por scripts/quote-models/build-migration.mjs a partir de data/modelos-orcamento (versão ${version}). Não editar à mão.`);
  if (version !== EDITION) throw new Error(`O pacote diz ${version}, pedido ${EDITION}`);
  if (EDITIONS[EDITION].schema) {
    out.push("-- Modelos de orçamento com preços por país (Portugal sem IVA, Brasil com impostos incluídos).");
    out.push("-- Reversão: drop table public.quote_service_models; drop table public.quote_model_sets; drop function private.validate_quote_service_model();");
    out.push(SCHEMA);
  } else {
    out.push("-- Nova edição dos modelos de orçamento (preços revistos e mais serviços). As edições anteriores ficam: os orçamentos já criados continuam a apontar para o modelo de onde vieram.");
    out.push(`-- Reversão: delete from public.quote_model_sets where version = '${version}';`);
  }
  for (const [code, p] of Object.entries(pack.paises)) {
    const meta = SETS[code];
    if (!meta) throw new Error(`País sem metadados: ${code}`);
    const setId = `${code}-${version}`;
    out.push(
      `insert into public.quote_model_sets (id, country_code, currency_code, version, taxes_included, tax_note, suggested_tax_percent, suggested_tax_label, suggested_tax_reference, methodology, sources, disclaimer, valid_from) values (${q(setId)}, ${q(meta.country)}, ${q(p.moeda)}, ${q(version)}, ${p.impostos_inclusos}, ${q(p.nota_impostos)}, ${meta.suggestedTax ? meta.suggestedTax.percent : "null"}, ${q(meta.suggestedTax?.label)}, ${q(meta.suggestedTax?.reference)}, ${q(meta.methodology)}, array[${meta.sources.map(q).join(", ")}], ${q(meta.disclaimer)}, '${EDITIONS[EDITION].validFrom}');`,
    );
    const rows = [];
    let position = 0;
    for (const c of p.categorias) {
      const template = CATEGORY_TO_TEMPLATE[c.id];
      if (!template) throw new Error(`Categoria desconhecida: ${c.id}`);
      for (const s of c.servicos) {
        if (ids.has(`${code}:${s.id}`)) throw new Error(`id repetido: ${s.id}`);
        ids.add(`${code}:${s.id}`);
        const composition = s.composicao.map((x) => {
          const kind = LINE_KIND[x.linha];
          if (!kind) throw new Error(`Linha sem tipo: ${x.linha}`);
          if (!c.linhas_de_custo.includes(x.linha)) throw new Error(`Linha fora da categoria: ${s.id} ${x.linha}`);
          return { line: x.linha, kind, amount_minor: Number(toMinor(x.valor)) };
        });
        const sum = composition.reduce((a, x) => a + BigInt(x.amount_minor), 0n);
        const rec = toMinor(s.preco_recomendado);
        if (sum !== rec) throw new Error(`Composição não soma o preço: ${s.id}`);
        const min = toMinor(s.faixa_min);
        const max = toMinor(s.faixa_max);
        if (!(min <= rec && rec <= max)) throw new Error(`Preço fora da faixa: ${s.id}`);
        rows.push(
          `  (${q(setId)}, ${q(s.id)}, ${q(c.id)}, ${q(template)}, ${q(c.nome)}, ${q(s.nome)}, ${q(s.unidade)}, ${rec}, ${min}, ${max}, ${q(s.materiais)}, ${q(s.nota)}, ${q(JSON.stringify(composition))}::jsonb, ${position++})`,
        );
      }
    }
    out.push(
      `insert into public.quote_service_models (set_id, service_key, category_key, template_key, category_name, name, unit, recommended_minor, range_min_minor, range_max_minor, materials, note, composition, position) values\n${rows.join(",\n")};`,
    );
  }
  return out.join("\n\n") + "\n";
}

const SCHEMA = `
create table public.quote_model_sets (
  id text primary key check (id ~ '^[a-z]{2}-[0-9]{4}-[0-9]{2}$'),
  country_code char(2) not null references public.countries (code),
  currency_code char(3) not null references public.currencies (code),
  version text not null,
  taxes_included boolean not null,
  tax_note text not null,
  suggested_tax_percent numeric(6, 3) check (suggested_tax_percent is null or suggested_tax_percent between 0 and 100),
  suggested_tax_label text,
  suggested_tax_reference text,
  methodology text not null,
  sources text[] not null,
  disclaimer text not null,
  valid_from date not null,
  valid_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (country_code, version)
);

create table public.quote_service_models (
  set_id text not null references public.quote_model_sets (id) on delete cascade,
  service_key text not null check (service_key ~ '^[a-z0-9-]+__[a-z0-9-]+$'),
  category_key text not null,
  template_key text not null references public.quote_templates (key),
  category_name text not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  unit text not null check (char_length(unit) between 1 and 20),
  recommended_minor bigint not null check (recommended_minor > 0),
  range_min_minor bigint not null check (range_min_minor > 0),
  range_max_minor bigint not null,
  materials text,
  note text,
  -- [{ "line": "...", "kind": "material|labor|travel|equipment|overhead|other", "amount_minor": 123 }]
  composition jsonb not null,
  position integer not null,
  primary key (set_id, service_key),
  constraint quote_service_models_range check (range_min_minor <= recommended_minor and recommended_minor <= range_max_minor)
);
create index quote_service_models_template_idx on public.quote_service_models (set_id, template_key, position);

-- A composição tem de somar o preço recomendado e ter linhas válidas.
create or replace function private.validate_quote_service_model()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sum bigint;
begin
  if jsonb_typeof(new.composition) <> 'array' or jsonb_array_length(new.composition) = 0 then
    raise exception 'quote_model_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.composition) e
    where coalesce(e ->> 'kind', '') not in ('material', 'labor', 'travel', 'equipment', 'overhead', 'other')
       or char_length(btrim(coalesce(e ->> 'line', ''))) = 0
       or (e ->> 'amount_minor')::bigint < 0
  ) then
    raise exception 'quote_model_invalid' using errcode = '22023';
  end if;
  select sum((e ->> 'amount_minor')::bigint) into v_sum from jsonb_array_elements(new.composition) e;
  if v_sum <> new.recommended_minor then
    raise exception 'quote_model_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger quote_service_models_validate before insert or update on public.quote_service_models
  for each row execute function private.validate_quote_service_model();

-- Dados de referência: leitura para quem tem sessão; escrita só por migration (service_role).
alter table public.quote_model_sets enable row level security;
alter table public.quote_service_models enable row level security;
create policy "quote model sets readable" on public.quote_model_sets for select to authenticated using (is_active);
create policy "quote service models readable" on public.quote_service_models for select to authenticated
  using (exists (select 1 from public.quote_model_sets s where s.id = set_id and s.is_active));
revoke all on public.quote_model_sets, public.quote_service_models from public, anon, authenticated;
grant select on public.quote_model_sets, public.quote_service_models to authenticated;
`;

process.stdout.write(build());
