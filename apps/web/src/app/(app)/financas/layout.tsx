import { format } from "@anen/i18n";
import { Alert, PageHeader } from "@/components/ui";
import { businessScope } from "@/lib/business";
import { financeScope } from "@/lib/finance";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { FinanceTabs } from "./tabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { m } = await getI18n();
  const session = await requireOnboardedSession();
  const scope = financeScope(session);
  const title = session.active
    ? format(m.finance.scopeOrganization, { organization: session.active.organization.name })
    : m.finance.scopePersonal;

  return (
    <>
      <PageHeader title={m.finance.title} description={title} />
      {scope.canRead ? (
        <>
          <FinanceTabs
            items={[
              { href: "/financas", label: m.finance.tabs.overview },
              ...(session.active ? [] : [{ href: "/financas/plano", label: m.finance.tabs.plan }]),
              { href: "/financas/movimentos", label: m.finance.tabs.transactions },
              { href: "/financas/em-aberto", label: m.finance.tabs.open },
              { href: "/financas/parcelas", label: m.finance.tabs.installments },
              { href: "/financas/calendario", label: m.finance.tabs.calendar },
              { href: "/financas/assinaturas", label: m.finance.tabs.subscriptions },
              { href: "/financas/dividas", label: m.finance.tabs.debts },
              { href: "/financas/contas", label: m.finance.tabs.accounts },
              { href: "/financas/orcamentos", label: m.finance.tabs.budgets },
              { href: "/financas/recorrentes", label: m.finance.tabs.recurring },
              { href: "/financas/categorias", label: m.finance.tabs.categories },
              ...(scope.canWrite ? [{ href: "/financas/importar", label: m.finance.tabs.import }] : []),
              ...(businessScope(session).canRead ? [{ href: "/financas/centros-de-custo", label: m.finance.tabs.costCenters }] : []),
            ]}
          />
          {!scope.canWrite ? <Alert tone="info">{m.finance.readOnly}</Alert> : null}
          {children}
        </>
      ) : (
        <Alert tone="info">{m.finance.noPermission}</Alert>
      )}
    </>
  );
}
