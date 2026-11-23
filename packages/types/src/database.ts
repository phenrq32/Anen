/**
 * Tipos do esquema público para o cliente Supabase (supabase-js).
 * Mantidos à mão a partir de supabase/migrations; substituir pela saída de
 * `supabase gen types typescript --project-id <ref>` quando o projeto estiver ligado.
 */
import type {
  TransactionAttachment,
  FixedExpense,
  InvestmentOption,
  MonthlyPlanRow,
  Contact,
  ContactNote,
  SupplierPrice,
  StockItem,
  StockMovement,
  StockLot,
  StockLotMovement,
  RecipeProduction,
  PurchaseOrder,
  PurchaseOrderItem,
  ReorderSuggestion,
  AppNotification,
  NotificationSettings,
  FinanceReportRow,
  Plan,
  AiStatus,
  AiConversation,
  AiMessage,
  AiDigest,
  InvoicingConnection,
  FiscalDocument,
  FiscalDocumentLine,
  CostCenter,
  Project,
  Quote,
  QuoteItem,
  QuoteTemplate,
  Recipe,
  RecipeIngredient,
  RecipePriceUpdate,
  MarketSource,
  MarketSeries,
  MarketObservation,
  MarketWatch,
  MarketAlert,
  Budget,
  FinanceTransaction,
  FinancialAccount,
  RecurringTransaction,
  SavingsGoal,
  TransactionCategory,
  AccountType,
  AuditLog,
  Country,
  Currency,
  Language,
  MemberStatus,
  Organization,
  OrganizationInvitation,
  OrganizationKind,
  OrganizationMember,
  Region,
  Role,
  UserPreferences,
  UserProfile,
} from "./index";

/** Interfaces não satisfazem Record<string, unknown>; o tipo mapeado converte-as num type literal. */
type Plain<T> = { [K in keyof T]: T[K] };
type NoWrite = { [_ in never]: never };

type Scope = { organization_id: string | null; owner_user_id: string | null };
type TxWrite = {
  account_id: string;
  category_id: string | null;
  kind: FinanceTransaction["kind"];
  amount_minor: number;
  currency_code: string;
  occurred_on: string;
  description: string;
  counterparty: string | null;
  notes: string | null;
  contact_id?: string | null;
  project_id?: string | null;
  cost_center_id?: string | null;
  cost_kind?: FinanceTransaction["cost_kind"];
  due_on?: string | null;
  net_minor?: number | null;
  tax_minor?: number | null;
  settled_minor?: number;
  payment_method?: FinanceTransaction["payment_method"];
  document_ref?: string | null;
};
type ContactWrite = Pick<Contact, "kind" | "name" | "tax_id" | "email" | "phone" | "address" | "payment_terms_days" | "notes">;
type ProjectWrite = Pick<Project, "name" | "description" | "client_contact_id" | "status" | "planned_cost_minor" | "planned_revenue_minor" | "start_on" | "end_on" | "notes">;
type StockItemWrite = Pick<StockItem, "name" | "sku" | "min_quantity" | "target_quantity" | "preferred_supplier_id" | "notes">;
type PurchaseOrderWrite = Pick<PurchaseOrder, "supplier_id" | "currency_code" | "project_id" | "ordered_on" | "expected_on" | "notes">;

type QuoteWrite = Pick<
  Quote,
  | "title"
  | "description"
  | "client_contact_id"
  | "client_name"
  | "client_email"
  | "client_tax_id"
  | "client_address"
  | "valid_until"
  | "margin_percent"
  | "tax_rate_percent"
  | "tax_label"
  | "conditions"
  | "discount_percent"
  | "discount_fixed_minor"
  | "discount_minor"
  | "total_cost_minor"
  | "price_before_tax_minor"
  | "tax_minor"
  | "total_minor"
>;
type RecipeWrite = Omit<Recipe, "id" | "organization_id" | "owner_user_id" | "updated_at">;

type Table<Row, Insert = NoWrite, Update = NoWrite> = {
  Row: Plain<Row>;
  Insert: Plain<Insert>;
  Update: Plain<Update>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      languages: Table<Language>;
      currencies: Table<Currency>;
      countries: Table<Country>;
      regions: Table<Region>;
      permissions: Table<{ key: string; module: string; description: string; created_at: string }>;
      users_profiles: Table<
        UserProfile,
        never,
        Partial<Pick<UserProfile, "full_name" | "avatar_path" | "primary_account_type" | "onboarded_at">>
      >;
      user_preferences: Table<
        UserPreferences,
        never,
        Partial<Pick<UserPreferences, "country_code" | "language_code" | "currency_code" | "timezone" | "active_organization_id" | "hidden_modules">>
      >;
      organizations: Table<
        Organization,
        never,
        Partial<Pick<Organization, "name" | "legal_name" | "tax_id" | "region_id" | "currency_code" | "timezone">>
      >;
      roles: Table<Role>;
      role_permissions: Table<{ role_id: string; permission_key: string }>;
      organization_members: Table<OrganizationMember>;
      organization_invitations: Table<OrganizationInvitation>;
      audit_logs: Table<AuditLog>;
      feature_flags: Table<{ key: string; description: string; is_enabled: boolean; rules: Record<string, unknown> }>;
      financial_accounts: Table<
        FinancialAccount,
        Scope & { name: string; kind: FinancialAccount["kind"]; currency_code: string; opening_balance_minor?: number },
        Partial<Pick<FinancialAccount, "name" | "kind" | "currency_code" | "opening_balance_minor" | "archived_at">>
      >;
      transaction_categories: Table<
        TransactionCategory,
        Scope & { name: string; kind: TransactionCategory["kind"]; color?: string },
        Partial<Pick<TransactionCategory, "name" | "color" | "archived_at">>
      >;
      transactions: Table<
        FinanceTransaction,
        Scope & TxWrite & { import_ref?: string | null },
        Partial<TxWrite>
      >;
      recurring_transactions: Table<
        RecurringTransaction,
        Scope & {
          account_id: string;
          category_id: string | null;
          kind: RecurringTransaction["kind"];
          amount_minor: number;
          currency_code: string;
          description: string;
          frequency: RecurringTransaction["frequency"];
          interval_count: number;
          start_on: string;
          end_on: string | null;
          next_run_on: string;
          contact_id?: string | null;
          project_id?: string | null;
          cost_center_id?: string | null;
          cost_kind?: RecurringTransaction["cost_kind"];
          generate_pending?: boolean;
          due_days?: number | null;
        },
        Partial<
          Pick<
            RecurringTransaction,
            | "is_active"
            | "amount_minor"
            | "description"
            | "end_on"
            | "category_id"
            | "counterparty"
            | "contact_id"
            | "project_id"
            | "cost_center_id"
            | "cost_kind"
            | "generate_pending"
            | "due_days"
          >
        >
      >;
      transaction_attachments: Table<
        TransactionAttachment,
        Pick<TransactionAttachment, "transaction_id" | "storage_path" | "file_name" | "mime_type" | "size_bytes">,
        NoWrite
      >;
      budgets: Table<
        Budget,
        Scope & { category_id: string; period_start: string; amount_minor: number; currency_code: string },
        Partial<Pick<Budget, "amount_minor">>
      >;
      quote_templates: Table<QuoteTemplate>;
      quotes: Table<
        Quote,
        Scope & QuoteWrite & { currency_code: string; number: string; template_key?: string | null },
        Partial<QuoteWrite & { status: Quote["status"]; currency_code: string }>
      >;
      quote_items: Table<QuoteItem, Omit<QuoteItem, "id">, Partial<Omit<QuoteItem, "id" | "quote_id">>>;
      quote_versions: Table<{ id: string; quote_id: string; version: number; created_at: string; created_by: string | null }>;
      quote_status_history: Table<{ id: number; quote_id: string; from_status: string | null; to_status: string; changed_by: string | null; changed_at: string }>;
      recipes: Table<Recipe, Scope & RecipeWrite, Partial<RecipeWrite>>;
      recipe_ingredients: Table<RecipeIngredient, Omit<RecipeIngredient, "id">, NoWrite>;
      recipe_cost_history: Table<
        { id: number; recipe_id: string; cost_per_portion_minor: number; ingredient_cost_per_portion_minor: number; recorded_at: string },
        { recipe_id: string; cost_per_portion_minor: number; ingredient_cost_per_portion_minor: number }
      >;
      contacts: Table<Contact, Scope & ContactWrite, Partial<ContactWrite & { archived_at: string | null }>>;
      contact_notes: Table<
        ContactNote,
        Scope & Pick<ContactNote, "contact_id" | "kind" | "noted_on" | "body">,
        Partial<Pick<ContactNote, "kind" | "noted_on" | "body">>
      >;
      supplier_prices: Table<
        SupplierPrice,
        Scope & Pick<SupplierPrice, "contact_id" | "item_name" | "unit" | "unit_price_minor" | "currency_code" | "observed_on" | "transaction_id" | "notes">,
        Partial<Pick<SupplierPrice, "item_name" | "unit" | "unit_price_minor" | "currency_code" | "observed_on" | "transaction_id" | "notes">>
      >;
      stock_items: Table<
        StockItem,
        Scope & Pick<StockItem, "name" | "unit" | "currency_code"> & Partial<StockItemWrite>,
        Partial<StockItemWrite & { archived_at: string | null }>
      >;
      stock_movements: Table<
        StockMovement,
        Scope & Pick<StockMovement, "item_id" | "kind" | "quantity" | "occurred_on"> & Partial<Pick<StockMovement, "unit_cost_minor" | "notes" | "lot_code" | "expires_on" | "lot_id">>,
        NoWrite
      >;
      stock_lots: Table<StockLot, NoWrite, NoWrite>;
      stock_lot_movements: Table<StockLotMovement, NoWrite, NoWrite>;
      recipe_productions: Table<RecipeProduction, NoWrite, NoWrite>;
      purchase_orders: Table<
        PurchaseOrder,
        Scope & { supplier_id: string; currency_code: string } & Partial<PurchaseOrderWrite>,
        Partial<PurchaseOrderWrite & { status: PurchaseOrder["status"] }>
      >;
      purchase_order_items: Table<
        PurchaseOrderItem,
        Pick<PurchaseOrderItem, "order_id" | "description" | "quantity" | "unit_price_minor"> &
          Partial<Pick<PurchaseOrderItem, "position" | "stock_item_id" | "unit">>,
        Partial<Pick<PurchaseOrderItem, "position" | "stock_item_id" | "description" | "quantity" | "unit" | "unit_price_minor">>
      >;
      push_subscriptions: Table<
        {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          failure_count: number;
          last_success_at: string | null;
          created_at: string;
        },
        { user_id: string; endpoint: string; p256dh: string; auth: string; user_agent?: string | null },
        NoWrite
      >;
      notifications: Table<AppNotification, NoWrite, Partial<Pick<AppNotification, "read_at" | "dismissed_at">>>;
      notification_settings: Table<
        NotificationSettings,
        Pick<NotificationSettings, "user_id"> & Partial<Pick<NotificationSettings, "disabled_kinds" | "due_soon_days" | "expiry_soon_days">>,
        Partial<Pick<NotificationSettings, "disabled_kinds" | "due_soon_days" | "expiry_soon_days">>
      >;
      plans: Table<Plan>;
      ai_conversations: Table<
        AiConversation,
        Pick<AiConversation, "user_id" | "organization_id" | "title">,
        Partial<Pick<AiConversation, "title">>
      >;
      ai_messages: Table<
        AiMessage,
        Pick<AiMessage, "conversation_id" | "role" | "content"> & Partial<Pick<AiMessage, "sources" | "tools" | "model">>,
        NoWrite
      >;
      ai_digests: Table<
        AiDigest,
        Pick<AiDigest, "user_id" | "organization_id" | "period_kind" | "period_from" | "period_to" | "content"> &
          Partial<Pick<AiDigest, "sources" | "tools" | "model">>,
        NoWrite
      >;
      ai_consents: Table<{ user_id: string; accepted_at: string }, { user_id: string }, NoWrite>;
      invoicing_connections: Table<
        InvoicingConnection,
        Scope & Pick<InvoicingConnection, "account_name" | "api_key_ciphertext" | "api_key_hint"> &
          Partial<Pick<InvoicingConnection, "organization_name" | "taxes" | "sequences" | "verified_at">>,
        Partial<Pick<InvoicingConnection, "account_name" | "api_key_ciphertext" | "api_key_hint" | "organization_name" | "taxes" | "sequences" | "load_address" | "verified_at">>
      >;
      fiscal_documents: Table<
        FiscalDocument,
        Scope & Omit<Partial<FiscalDocument>, "id" | "created_at" | "updated_at"> &
          Pick<FiscalDocument, "kind" | "provider_id" | "proprietary_uid" | "client_name" | "issue_date">,
        Partial<Omit<FiscalDocument, "id" | "organization_id" | "owner_user_id" | "created_at" | "updated_at">>
      >;
      fiscal_document_lines: Table<FiscalDocumentLine, Omit<FiscalDocumentLine, "id">, Partial<Omit<FiscalDocumentLine, "id" | "document_id">>>;
      admin_users: Table<{ user_id: string; role: "super_admin" | "support" | "finance" | "content"; created_at: string }>;
      job_runs: Table<{
        id: number;
        job: string;
        started_at: string;
        finished_at: string | null;
        status: "running" | "success" | "partial" | "error";
        processed: number;
        failed: number;
        details: { alerts?: number; errors?: unknown[] };
      }>;
      market_sources: Table<MarketSource>;
      market_series: Table<MarketSeries>;
      market_observations: Table<MarketObservation>;
      market_watches: Table<MarketWatch, Scope & { series_id: string; threshold_percent: number }, Partial<Pick<MarketWatch, "threshold_percent">>>;
      market_alerts: Table<MarketAlert, NoWrite, Partial<Pick<MarketAlert, "read_at">>>;
      cost_centers: Table<CostCenter, Scope & { name: string }, Partial<{ name: string; archived_at: string | null }>>;
      projects: Table<
        Project,
        Scope & ProjectWrite & { currency_code: string; quote_id?: string | null },
        Partial<ProjectWrite>
      >;
      fixed_expenses: Table<
        FixedExpense,
        { owner_user_id: string; name: string; amount_minor: number; currency_code: string; category_id?: string | null; position?: number },
        Partial<Pick<FixedExpense, "name" | "amount_minor" | "category_id" | "is_active" | "position">>
      >;
      monthly_plans: Table<
        MonthlyPlanRow,
        { owner_user_id: string; month: string; currency_code: string; salary_minor: number; emergency_reserve_minor?: number },
        Partial<Pick<MonthlyPlanRow, "salary_minor" | "emergency_reserve_minor" | "currency_code">>
      >;
      investment_options: Table<InvestmentOption>;
      savings_goals: Table<
        SavingsGoal,
        Scope & { name: string; target_minor: number; saved_minor: number; currency_code: string; target_date: string | null },
        Partial<Pick<SavingsGoal, "name" | "target_minor" | "saved_minor" | "target_date">>
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_organization: {
        Args: {
          p_kind: OrganizationKind;
          p_name: string;
          p_country_code: string;
          p_currency_code: string;
          p_timezone: string;
          p_legal_name?: string | null;
          p_tax_id?: string | null;
          p_region_id?: string | null;
        };
        Returns: string;
      };
      invite_member: {
        Args: { p_organization_id: string; p_email: string; p_role_id: string };
        Returns: { invitation_id: string; token: string; expires_at: string }[];
      };
      get_invitation: {
        Args: { p_token: string };
        Returns: { organization_name: string; role_key: string; role_name: string; email: string; expires_at: string }[];
      };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      update_member: { Args: { p_member_id: string; p_role_id: string; p_status: MemberStatus }; Returns: undefined };
      remove_member: { Args: { p_member_id: string }; Returns: undefined };
      upsert_role: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_permissions: string[];
          p_description?: string | null;
          p_role_id?: string | null;
          p_rank?: number;
        };
        Returns: string;
      };
      delete_role: { Args: { p_role_id: string }; Returns: undefined };
      finance_monthly: {
        Args: { p_org: string | null; p_from: string; p_to: string };
        Returns: { month: string; currency_code: string; income: number; expense: number }[];
      };
      finance_by_category: {
        Args: { p_org: string | null; p_from: string; p_to: string; p_kind: string };
        Returns: { category_id: string | null; currency_code: string; total: number; count: number }[];
      };
      account_balances: {
        Args: { p_org: string | null };
        Returns: { account_id: string; currency_code: string; balance_minor: number }[];
      };
      materialize_recurring: { Args: { p_org: string | null; p_until?: string }; Returns: number };
      create_project_from_quote: { Args: { p_quote_id: string }; Returns: string };
      snapshot_quote: { Args: { p_quote_id: string }; Returns: number };
      save_quote_content: { Args: { p_quote_id: string; p_fields: Record<string, string | null>; p_items: Record<string, string | number | null>[] }; Returns: number };
      run_market_agent_now: { Args: Record<string, never>; Returns: { observations: number; failed: number; alerts: number } };
      receive_purchase_order: {
        Args: { p_order_id: string; p_received_on: string; p_account_id?: string | null; p_paid?: boolean; p_description?: string | null };
        Returns: string | null;
      };
      stock_reorder_suggestions: { Args: { p_org?: string | null }; Returns: ReorderSuggestion[] };
      create_reorder_drafts: { Args: { p_org?: string | null }; Returns: { orders: number; lines: number; skipped: number } };
      refresh_my_notifications: { Args: Record<string, never>; Returns: number };
      delete_my_account: { Args: { p_confirm_email: string }; Returns: undefined };
      delete_organization: { Args: { p_org: string; p_confirm_name: string }; Returns: undefined };
      produce_recipe: { Args: { p_recipe_id: string; p_portions: string; p_occurred_on?: string | null; p_notes?: string | null }; Returns: string };
      finance_report: { Args: { p_org: string | null; p_from: string; p_to: string }; Returns: FinanceReportRow[] };
      ai_status: { Args: { p_org?: string | null }; Returns: AiStatus[] };
      ai_begin_request: { Args: { p_org?: string | null }; Returns: { usage_id: number; daily_limit: number; used_today: number }[] };
      ai_finish_request: { Args: { p_usage_id: number; p_ok: boolean; p_model: string; p_input: number; p_output: number }; Returns: undefined };
      admin_set_plan: { Args: { p_org: string | null; p_owner: string | null; p_plan: string; p_until?: string | null }; Returns: string };
      admin_set_ai_limit: { Args: { p_plan: string; p_limit: number }; Returns: undefined };
      recipe_price_updates: { Args: { p_recipe_id?: string | null }; Returns: RecipePriceUpdate[] };
      save_recipe_content: { Args: { p_recipe_id: string; p_fields: Record<string, string | null>; p_ingredients: Record<string, string | number | null>[] }; Returns: undefined };
    };
    Enums: {
      account_type: AccountType;
      organization_kind: OrganizationKind;
      member_status: MemberStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
