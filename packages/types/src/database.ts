/**
 * Tipos do esquema público para o cliente Supabase (supabase-js).
 * Mantidos à mão a partir de supabase/migrations; substituir pela saída de
 * `supabase gen types typescript --project-id <ref>` quando o projeto estiver ligado.
 */
import type {
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
        Partial<Pick<UserPreferences, "country_code" | "language_code" | "currency_code" | "timezone" | "active_organization_id">>
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
    };
    Enums: {
      account_type: AccountType;
      organization_kind: OrganizationKind;
      member_status: MemberStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
