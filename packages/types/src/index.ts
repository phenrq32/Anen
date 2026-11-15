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
