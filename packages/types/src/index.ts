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

export interface CostCenter extends FinanceScoped {
  id: string;
  name: string;
  archived_at: string | null;
}

export interface Project extends FinanceScoped {
  id: string;
  name: string;
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
