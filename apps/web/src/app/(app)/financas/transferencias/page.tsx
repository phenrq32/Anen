import type { Metadata } from "next";
import { formatDate, formatMoney } from "@anen/i18n";
import { InlineAction } from "@/components/forms";
import { Alert, Badge, Section } from "@/components/ui";
import { categoryLabel, financeScope, todayIn } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { can, requireOnboardedSession } from "@/lib/session";
import { revertTransferAction } from "./actions";
import { TransferForm, type TransferSpace } from "./transfer-form";

export const metadata: Metadata = { title: "Transferências" };

/** Dual Workspace · Fase 7 (§7): transferências entre o espaço ativo e outro onde a pessoa gere finanças. */
export default async function TransfersPage() {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  if (!scope.canRead) return null;
  const t = m.finance.transfers;
  const { supabase, user, active } = session;

  // Espaços onde a pessoa pode escrever finanças: o pessoal e as empresas com essa permissão.
  const writableOrgs = session.memberships.filter((x) => can(x, "finance.write"));
  const spaces = [
    { key: `PERSONAL:${user.id}`, label: t.personal, orgId: null as string | null },
    ...writableOrgs.map((x) => ({ key: `BUSINESS:${x.organization.id}`, label: x.organization.name, orgId: x.organization.id as string | null })),
  ];
  const hereKey = active ? `BUSINESS:${active.organization.id}` : `PERSONAL:${user.id}`;
  const hereType = active ? "BUSINESS" : "PERSONAL";
  const hereId = active?.organization.id ?? user.id;

  const orgIds = writableOrgs.map((x) => x.organization.id);
  const [accountsRes, categoriesRes, currenciesRes, transfersRes] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select("id, name, currency_code, organization_id, owner_user_id, archived_at")
      .or([`owner_user_id.eq.${user.id}`, ...(orgIds.length ? [`organization_id.in.(${orgIds.join(",")})`] : [])].join(","))
      .is("archived_at", null)
      .order("name"),
    supabase.from("transaction_categories").select("*").is("archived_at", null).order("name"),
    supabase.from("currencies").select("code, minor_unit"),
    supabase
      .from("cross_workspace_transfers")
      .select("*")
      .or(
        `and(source_workspace_type.eq.${hereType},source_workspace_id.eq.${hereId}),and(destination_workspace_type.eq.${hereType},destination_workspace_id.eq.${hereId})`,
      )
      .order("transfer_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const minorUnits = Object.fromEntries((currenciesRes.data ?? []).map((c) => [c.code, c.minor_unit]));
  const toSpace = (s: (typeof spaces)[number]): TransferSpace => ({
    key: s.key,
    label: s.label,
    accounts: (accountsRes.data ?? [])
      .filter((a) => (s.orgId ? a.organization_id === s.orgId : a.owner_user_id === user.id))
      .map((a) => ({ id: a.id, name: a.name, currency: a.currency_code })),
    categories: (categoriesRes.data ?? [])
      .filter((c) => c.is_system || (s.orgId ? c.organization_id === s.orgId : c.owner_user_id === user.id))
      .map((c) => ({ id: c.id, label: categoryLabel(m, c), kind: c.kind })),
  });
  const here = spaces.find((s) => s.key === hereKey);
  const hereSpace = here ? toSpace(here) : null;
  const others = spaces.filter((s) => s.key !== hereKey).map(toSpace).filter((s) => s.accounts.length > 0);

  const spaceName = (type: string, id: string) =>
    type === "PERSONAL"
      ? id === user.id
        ? t.personal
        : t.otherPersonal
      : (session.memberships.find((x) => x.organization.id === id)?.organization.name ?? id.slice(0, 8));
  const transfers = transfersRes.data ?? [];
  const writableKeys = new Set(spaces.map((s) => s.key));

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted">{t.hint}</p>
      {scope.canWrite ? (
        <Section title={t.new}>
          {!hereSpace || others.length === 0 ? (
            <Alert tone="info">{others.length === 0 && spaces.length > 1 ? t.noAccounts : t.noOther}</Alert>
          ) : hereSpace.accounts.length === 0 ? (
            <Alert tone="info">{t.noAccounts}</Alert>
          ) : (
            <TransferForm m={m} locale={locale} here={hereSpace} others={others} minorUnits={minorUnits} today={todayIn(scope.timezone)} />
          )}
        </Section>
      ) : null}

      <Section title={t.listTitle} description={t.lockedNote}>
        {transfers.length === 0 ? (
          <p className="text-sm text-muted">{t.empty}</p>
        ) : (
          <ul className="-my-2 flex flex-col">
            {transfers.map((x) => {
              const out = x.source_workspace_type === hereType && x.source_workspace_id === hereId;
              const canRevert =
                x.status === "completed" &&
                writableKeys.has(`${x.source_workspace_type}:${x.source_workspace_id}`) &&
                writableKeys.has(`${x.destination_workspace_type}:${x.destination_workspace_id}`);
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0" aria-label={x.reference}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{x.description}</span>
                    <span className="block text-xs text-subtle">
                      {t.from}: {spaceName(x.source_workspace_type, x.source_workspace_id)} · {t.to}:{" "}
                      {spaceName(x.destination_workspace_type, x.destination_workspace_id)} · {t.types[x.transfer_type]}
                    </span>
                    <span className="tabular block text-xs text-subtle">
                      {t.reference} {x.reference} · {formatDate(x.transfer_date, locale, "UTC", { day: "2-digit", month: "short", year: "numeric" })}
                      {x.revert_reason ? ` · ${x.revert_reason}` : ""}
                    </span>
                  </span>
                  <Badge tone={x.status === "completed" ? "brand" : "neutral"}>{x.status === "completed" ? t.statusCompleted : t.statusReverted}</Badge>
                  <span className={`tabular whitespace-nowrap font-semibold ${out ? "text-danger" : "text-success"}`}>
                    {out ? "−" : "+"} {formatMoney(BigInt(x.amount_minor), x.currency_code, minorUnits[x.currency_code] ?? 2, locale)}
                  </span>
                  {canRevert && scope.canWrite ? (
                    <InlineAction
                      action={revertTransferAction}
                      fields={{ id: x.id, reason: "" }}
                      label={t.revert}
                      pendingLabel={m.common.saving}
                      confirmMessage={t.revertConfirm}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
