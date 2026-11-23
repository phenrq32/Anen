/**
 * Tipos de domínio partilhados entre web, mobile e serviços.
 * Espelham o esquema em supabase/migrations. Quando o projeto Supabase estiver ligado,
 * os tipos de linha serão complementados com `supabase gen types typescript`.
 */

export const ACCOUNT_TYPES = ["personal", "independent", "business", "client"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ORGANIZATION_KINDS = ["independent", "business"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const MEMBER_STATUSES = ["active", "suspended"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const SYSTEM_ROLE_KEYS = ["owner", "admin", "manager", "accountant", "employee", "viewer"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** Catálogo de permissões da Fase 1. Novos módulos acrescentam chaves via migration. */
export const PERMISSION_KEYS = [
  "organization.update",
  "organization.delete",
  "members.invite",
  "members.manage",
  "roles.manage",
  "audit.read",
  "finance.read",
  "finance.write",
  "quotes.read",
  "quotes.write",
  "business.read",
  "business.write",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const SUPPORTED_LOCALES = ["pt-PT", "pt-BR", "en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export interface Country {
  code: string;
  name: string;
  default_currency_code: string;
  default_language_code: string;
  default_timezone: string;
  is_supported: boolean;
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  minor_unit: number;
  is_enabled: boolean;
}

export interface Language {
  code: string;
  name: string;
  native_name: string;
  is_enabled: boolean;
}

export interface Region {
  id: string;
  country_code: string;
  parent_id: string | null;
  code: string;
  name: string;
  kind: "state" | "autonomous_region" | "mainland" | "district" | "municipality";
  timezone: string | null;
}

export interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_path: string | null;
  primary_account_type: AccountType | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: string;
  country_code: string | null;
  language_code: string;
  currency_code: string;
  timezone: string;
  active_organization_id: string | null;
  /** Áreas escondidas do menu (só o menu e a procura; as páginas continuam). */
  hidden_modules: string[];
}

/** Dual Workspace: espaço pessoal (o utilizador) ou empresarial (uma organização). Ver supabase/migrations/*_workspaces.sql. */
export const WORKSPACE_TYPES = ["PERSONAL", "BUSINESS"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

/** Referência a um workspace. No PERSONAL o id é o do utilizador; no BUSINESS é o da organização. */
export type WorkspaceRef = { type: "PERSONAL"; id: string } | { type: "BUSINESS"; id: string };

/** Linha da vista public.workspaces (só leitura, filtrada pelo RLS das tabelas de origem). */
export interface Workspace {
  id: string;
  type: WorkspaceType;
  /** null no pessoal: a interface mostra "Pessoal" no idioma de quem vê. */
  name: string | null;
  organization_kind: OrganizationKind | null;
  owner_user_id: string | null;
  country_code: string | null;
  region_id: string | null;
  currency_code: string;
  timezone: string;
  /** null nas organizações: cada membro usa o seu idioma. */
  language_code: string | null;
  created_at: string;
  updated_at: string;
}

/** Linha da vista public.workspace_members. */
export interface WorkspaceMember {
  workspace_id: string;
  workspace_type: WorkspaceType;
  user_id: string;
  role_key: string;
  status: MemberStatus;
  created_at: string;
}

export interface Organization {
  id: string;
  kind: OrganizationKind;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  country_code: string;
  region_id: string | null;
  currency_code: string;
  timezone: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  organization_id: string | null;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  rank: number;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string;
  status: MemberStatus;
  created_at: string;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role_id: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Finanças (Fase 2). Valores em unidades mínimas; o PostgREST devolve bigint como number,
// limitado na base de dados a 2^53-1 para não perder precisão. Converter com BigInt().
// ---------------------------------------------------------------------------
export type AccountKind = "checking" | "savings" | "cash" | "credit_card" | "investment" | "other";
export type TransactionKind = "income" | "expense";
export type Frequency = "weekly" | "monthly" | "yearly";

interface FinanceScoped {
  organization_id: string | null;
  owner_user_id: string | null;
}

export interface FinancialAccount extends FinanceScoped {
  id: string;
  name: string;
  kind: AccountKind;
  currency_code: string;
  opening_balance_minor: number;
  archived_at: string | null;
  created_at: string;
}

export interface TransactionCategory extends FinanceScoped {
  id: string;
  key: string | null;
  kind: TransactionKind;
  name: string;
  color: string;
  is_system: boolean;
  archived_at: string | null;
}

export interface FinanceTransaction extends FinanceScoped {
  id: string;
  account_id: string;
  category_id: string | null;
  kind: TransactionKind;
  amount_minor: number;
  currency_code: string;
  occurred_on: string;
  description: string;
  counterparty: string | null;
  notes: string | null;
  recurring_id: string | null;
  contact_id: string | null;
  project_id: string | null;
  cost_center_id: string | null;
  cost_kind: QuoteItemKind | null;
  due_on: string | null;
  net_minor: number | null;
  tax_minor: number | null;
  settled_minor: number;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  document_ref: string | null;
  created_by: string | null;
  created_at: string;
  /** Linha do extrato importado (FITID ou impressão digital); evita duplicar a mesma linha na conta. */
  import_ref: string | null;
  /** Valor de um período (dia, semana ou mês) em vez de um movimento único. */
  period_start: string | null;
  period_end: string | null;
}

export const PAYMENT_METHODS = ["transfer", "card", "cash", "direct_debit", "mbway", "pix", "boleto", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = "pending" | "partial" | "paid";

export interface RecurringTransaction extends FinanceScoped {
  id: string;
  account_id: string;
  category_id: string | null;
  kind: TransactionKind;
  amount_minor: number;
  currency_code: string;
  description: string;
  counterparty: string | null;
  frequency: Frequency;
  interval_count: number;
  start_on: string;
  end_on: string | null;
  next_run_on: string;
  is_active: boolean;
  contact_id: string | null;
  project_id: string | null;
  cost_center_id: string | null;
  cost_kind: QuoteItemKind | null;
  generate_pending: boolean;
  due_days: number | null;
}

export interface Budget extends FinanceScoped {
  id: string;
  category_id: string;
  period_start: string;
  amount_minor: number;
  currency_code: string;
}

export interface SavingsGoal extends FinanceScoped {
  id: string;
  name: string;
  target_minor: number;
  saved_minor: number;
  currency_code: string;
  target_date: string | null;
}

// ---------------------------------------------------------------------------
// Orçamentos e fichas técnicas (Fase 3). Colunas numeric chegam como number.
// ---------------------------------------------------------------------------
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "cancelled";
export type QuoteItemKind = "material" | "labor" | "travel" | "equipment" | "overhead" | "other";
export type QuoteItemNature = "product" | "service";

export interface QuoteTemplate {
  id: string;
  key: string;
  activity: string;
  name: string;
  default_margin_percent: number;
  lines: Array<{ kind: QuoteItemKind; description: string; unit?: string }>;
}

export interface Quote extends FinanceScoped {
  id: string;
  number: string;
  template_key: string | null;
  title: string;
  description: string | null;
  client_contact_id: string | null;
  client_name: string | null;
  client_email: string | null;
  client_tax_id: string | null;
  client_address: string | null;
  currency_code: string;
  status: QuoteStatus;
  valid_until: string | null;
  margin_percent: number;
  tax_rate_percent: number;
  tax_label: string | null;
  conditions: string | null;
  /** Desconto em % (0 quando é fixo ou não há). */
  discount_percent: number;
  /** Desconto fixo indicado, em unidades mínimas (0 quando é em % ou não há). */
  discount_fixed_minor: number;
  /** Valor descontado; o preço antes do desconto é price_before_tax_minor + discount_minor. */
  discount_minor: number;
  total_cost_minor: number;
  price_before_tax_minor: number;
  tax_minor: number;
  total_minor: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  position: number;
  kind: QuoteItemKind;
  nature: QuoteItemNature;
  description: string;
  quantity: number;
  unit: string | null;
  unit_cost_minor: number;
  total_cost_minor: number;
}

export interface Recipe extends FinanceScoped {
  id: string;
  name: string;
  category: string | null;
  currency_code: string;
  portions: number;
  target_food_cost_percent: number;
  minimum_margin_percent: number;
  tax_rate_percent: number;
  energy_minor: number;
  water_minor: number;
  labor_minor: number;
  packaging_minor: number;
  overhead_minor: number;
  cost_per_portion_minor: number;
  recommended_price_minor: number;
  updated_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  position: number;
  name: string;
  quantity: number;
  unit: string;
  package_quantity: number;
  package_price_minor: number;
  waste_percent: number;
  cost_minor: number;
  /** Preço de fornecedor de onde veio package_price_minor (fotografia do preço na altura). */
  supplier_price_id: string | null;
  /** Artigo de stock de onde sai o ingrediente quando se regista uma produção. */
  stock_item_id: string | null;
}

// ---------------------------------------------------------------------------
// Inteligência de mercado (fontes oficiais recolhidas pelo agente de mercado)
// ---------------------------------------------------------------------------
export type MarketCategory = "general" | "food" | "energy" | "fuel" | "services" | "construction";

export interface MarketSource {
  id: string;
  key: string;
  name: string;
  publisher: string;
  country: string;
  docs_url: string;
  license: string;
  is_active: boolean;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

export interface MarketSeries {
  id: string;
  source_id: string;
  code: string;
  name: string;
  category: MarketCategory;
  value_kind: "index" | "price" | "none";
  value_unit: string | null;
  currency_code: string | null;
  position: number;
  is_active: boolean;
}

export interface MarketObservation {
  series_id: string;
  period: string;
  /** numeric do Postgres: chega como número (PostgREST); converter com numericToString. */
  value: number | null;
  change_month: number | null;
  change_year: number | null;
  collected_at: string;
}

export interface MarketWatch extends FinanceScoped {
  id: string;
  series_id: string;
  threshold_percent: number;
  created_at: string;
}

export interface MarketAlert extends FinanceScoped {
  id: string;
  watch_id: string;
  series_id: string;
  period: string;
  change_month: number;
  change_year: number | null;
  threshold_percent: number;
  created_at: string;
  read_at: string | null;
}

/** Ingrediente ligado cujo preço registado mudou desde que foi usado na ficha. */
export interface RecipePriceUpdate {
  recipe_id: string;
  ingredient_id: string;
  linked_price_id: string;
  used_price_minor: number;
  latest_price_id: string;
  latest_price_minor: number;
  latest_unit: string | null;
  latest_observed_on: string;
  supplier_name: string;
}

export interface AuditLog {
  id: number;
  organization_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Negócio (prompt 02, Fase A): contactos, centros de custo e projetos
// ---------------------------------------------------------------------------
export const CONTACT_KINDS = ["client", "supplier", "both"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const PROJECT_STATUSES = ["planned", "active", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Contact extends FinanceScoped {
  id: string;
  kind: ContactKind;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  payment_terms_days: number | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
}

export const CONTACT_NOTE_KINDS = ["note", "call", "meeting", "email", "visit"] as const;
export type ContactNoteKind = (typeof CONTACT_NOTE_KINDS)[number];

export interface ContactNote extends FinanceScoped {
  id: string;
  contact_id: string;
  kind: ContactNoteKind;
  noted_on: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface SupplierPrice extends FinanceScoped {
  id: string;
  contact_id: string;
  item_name: string;
  unit: string | null;
  unit_price_minor: number;
  currency_code: string;
  observed_on: string;
  transaction_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const STOCK_MOVEMENT_KINDS = ["in", "out", "loss", "count"] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];
export const PURCHASE_STATUSES = ["draft", "ordered", "received", "cancelled"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** Quantidades numeric: o PostgREST devolve-as como número JSON e o Postgres como texto; converter com String() antes do motor. */
export type NumericValue = string | number;

export interface StockItem extends FinanceScoped {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  currency_code: string;
  min_quantity: NumericValue;
  target_quantity: NumericValue | null;
  preferred_supplier_id: string | null;
  quantity_on_hand: NumericValue;
  average_cost_minor: number;
  notes: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockMovement extends FinanceScoped {
  id: string;
  item_id: string;
  kind: StockMovementKind;
  quantity: NumericValue;
  unit_cost_minor: number | null;
  occurred_on: string;
  notes: string | null;
  purchase_order_id: string | null;
  /** Entradas: código e validade do lote criado. Saídas e perdas: lote escolhido (senão, FEFO). */
  lot_code: string | null;
  expires_on: string | null;
  lot_id: string | null;
  production_id: string | null;
  quantity_change: NumericValue;
  balance_after: NumericValue;
  average_cost_after: number;
  created_by: string | null;
  created_at: string;
}

export const STOCK_LOT_ORIGINS = ["in", "count", "opening"] as const;
export type StockLotOrigin = (typeof STOCK_LOT_ORIGINS)[number];

/** Lote: criado pelas entradas (e contagens acima do saldo); consumido por FEFO. Só leitura. */
export interface StockLot extends FinanceScoped {
  id: string;
  item_id: string;
  code: string | null;
  expires_on: string | null;
  received_on: string;
  quantity_received: NumericValue;
  quantity_remaining: NumericValue;
  unit_cost_minor: number;
  origin: StockLotOrigin;
  source_movement_id: string | null;
  created_at: string;
}

export interface StockLotMovement extends FinanceScoped {
  movement_id: string;
  lot_id: string;
  quantity: NumericValue;
}

export interface RecipeProduction extends FinanceScoped {
  id: string;
  recipe_id: string | null;
  recipe_name: string;
  portions: NumericValue;
  occurred_on: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PurchaseOrder extends FinanceScoped {
  id: string;
  supplier_id: string | null;
  status: PurchaseStatus;
  currency_code: string;
  project_id: string | null;
  ordered_on: string | null;
  expected_on: string | null;
  received_on: string | null;
  notes: string | null;
  total_minor: number;
  transaction_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  order_id: string;
  position: number;
  stock_item_id: string | null;
  description: string;
  quantity: NumericValue;
  unit: string | null;
  unit_price_minor: number;
  total_minor: number;
}

export interface ReorderSuggestion {
  item_id: string;
  item_name: string;
  unit: string;
  currency_code: string;
  quantity_on_hand: NumericValue;
  min_quantity: NumericValue;
  open_quantity: NumericValue;
  suggested_quantity: NumericValue;
  supplier_id: string | null;
  supplier_name: string | null;
  last_unit_price_minor: number | null;
}

export const NOTIFICATION_KINDS = [
  "payment_overdue",
  "payment_due_soon",
  "stock_below_minimum",
  "stock_expiring",
  "stock_expired",
  "purchase_late",
  "market_alert",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface AppNotification {
  id: string;
  user_id: string;
  organization_id: string | null;
  kind: NotificationKind;
  entity_id: string | null;
  /** Parâmetros para o texto (variam por tipo; lidos com verificação de tipo na interface). */
  data: Record<string, unknown>;
  link: string | null;
  dedupe_key: string;
  created_at: string;
  read_at: string | null;
  /** Apagada pela pessoa (fica para não ser recriada). */
  dismissed_at: string | null;
}

export interface NotificationSettings {
  user_id: string;
  disabled_kinds: NotificationKind[];
  due_soon_days: number;
  expiry_soon_days: number;
  updated_at: string;
}

export interface FinanceReportRow {
  dimension: "total" | "category" | "contact" | "project" | "cost_center";
  key: string | null;
  currency_code: string;
  income_total: number;
  income_settled: number;
  expense_total: number;
  expense_settled: number;
  count: number;
}

export const PLAN_KEYS = ["free", "pro", "max"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface Plan {
  key: PlanKey;
  name: string;
  position: number;
  ai_daily_limit: number;
  updated_at: string;
}

export interface AiStatus {
  plan_key: PlanKey;
  plan_name: string;
  daily_limit: number;
  used_today: number;
  consented: boolean;
}

export interface AiConversation {
  id: string;
  user_id: string;
  organization_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiSource {
  label: string;
  href: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sources: AiSource[];
  tools: string[];
  model: string | null;
  created_at: string;
}

export type AiDigestKind = "week" | "month";

export interface AiDigest {
  id: string;
  user_id: string;
  organization_id: string | null;
  period_kind: AiDigestKind;
  period_from: string;
  period_to: string;
  content: string;
  sources: AiSource[];
  tools: string[];
  model: string | null;
  created_at: string;
}

export interface InvoicingTax {
  name: string;
  value: string;
  default_tax: number;
}

export interface InvoicingConnection extends FinanceScoped {
  id: string;
  provider: "invoicexpress";
  account_name: string;
  api_key_ciphertext: string;
  api_key_hint: string;
  organization_name: string | null;
  taxes: InvoicingTax[];
  sequences: { id: number; serie: string; default_sequence: number | boolean }[];
  load_address: FiscalAddress | null;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

export type FiscalDocumentKind = "invoice" | "invoice_receipt" | "simplified_invoice" | "credit_note" | "transport" | "shipping";
export type FiscalDocumentStatus = "draft" | "final" | "settled" | "canceled";

export interface FiscalAddress {
  detail: string;
  city: string;
  postal_code: string;
  country: string;
}

export interface FiscalDocument extends FinanceScoped {
  id: string;
  connection_id: string | null;
  kind: FiscalDocumentKind;
  status: FiscalDocumentStatus;
  provider_id: number;
  proprietary_uid: string;
  sequence_number: string | null;
  atcud: string | null;
  saft_hash: string | null;
  at_doc_code: string | null;
  permalink: string | null;
  contact_id: string | null;
  client_name: string;
  client_fiscal_id: string | null;
  client_email: string | null;
  client_address: string | null;
  client_city: string | null;
  client_postal_code: string | null;
  client_country: string | null;
  quote_id: string | null;
  project_id: string | null;
  transaction_id: string | null;
  owner_document_id: string | null;
  issue_date: string;
  due_date: string | null;
  currency_code: string;
  before_taxes_minor: number | null;
  taxes_minor: number | null;
  total_minor: number | null;
  reference: string | null;
  observations: string | null;
  tax_exemption: string | null;
  loaded_at: string | null;
  license_plate: string | null;
  address_from: FiscalAddress | null;
  address_to: FiscalAddress | null;
  stock_out: boolean;
  stock_applied_at: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
}

export interface FiscalDocumentLine {
  id: string;
  document_id: string;
  position: number;
  name: string;
  description: string | null;
  quantity: NumericValue;
  unit_price_minor: number;
  tax_name: string | null;
  tax_percent: NumericValue | null;
  discount_percent: NumericValue;
  stock_item_id: string | null;
}

export interface CostCenter extends FinanceScoped {
  id: string;
  name: string;
  archived_at: string | null;
}

export interface Project extends FinanceScoped {
  id: string;
  name: string;
  description: string | null;
  client_contact_id: string | null;
  quote_id: string | null;
  status: ProjectStatus;
  currency_code: string;
  planned_cost_minor: number;
  planned_revenue_minor: number;
  start_on: string | null;
  end_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Plano do mês (finanças pessoais)
// ---------------------------------------------------------------------------
export interface FixedExpense {
  id: string;
  owner_user_id: string;
  name: string;
  amount_minor: number;
  currency_code: string;
  category_id: string | null;
  is_active: boolean;
  position: number;
}

export interface MonthlyPlanRow {
  id: string;
  owner_user_id: string;
  month: string;
  currency_code: string;
  salary_minor: number;
  emergency_reserve_minor: number;
}

export interface InvestmentOption {
  id: string;
  country_code: string;
  key: string;
  bucket: "reserve" | "long_term";
  risk: "low" | "medium" | "high";
  liquidity: "immediate" | "days" | "months" | "years";
  position: number;
  source_name: string;
  source_url: string;
  reviewed_on: string;
}

export interface TransactionAttachment {
  id: string;
  transaction_id: string;
  organization_id: string | null;
  owner_user_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}
