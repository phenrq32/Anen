import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@anen/i18n";
import type { AppNotification, NotificationKind } from "@anen/types";
import { Alert, PageHeader, Section, buttonClass, cx } from "@/components/ui";
import { getI18n } from "@/lib/i18n";
import { notificationText } from "@/lib/notifications";
import { requireOnboardedSession } from "@/lib/session";
import { openNotificationAction } from "./actions";
import { DismissNotificationButton, DismissReadButton, MarkAllReadButton, MarkReadButton, NotificationSettingsForm } from "./notification-forms";

export const metadata: Metadata = { title: "Notificações" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const t = m.notifications;
  const params = await searchParams;
  const showAll = params.ver === "todas";

  // Gera o que estiver em falta para esta pessoa antes de mostrar (a tarefa diária faz o mesmo para todos).
  await session.supabase.rpc("refresh_my_notifications");

  let query = session.supabase.from("notifications").select("*").is("dismissed_at", null).order("created_at", { ascending: false }).limit(200);
  if (!showAll) query = query.is("read_at", null);
  const [listRes, unreadRes, settingsRes, currenciesRes] = await Promise.all([
    query,
    session.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).is("dismissed_at", null),
    session.supabase.from("notification_settings").select("*").eq("user_id", session.user.id).maybeSingle(),
    session.supabase.from("currencies").select("code, minor_unit"),
  ]);
  const list: AppNotification[] = listRes.data ?? [];
  const unread = unreadRes.count ?? 0;
  const minorUnits = new Map((currenciesRes.data ?? []).map((c) => [c.code, c.minor_unit]));
  const orgNames = new Map(session.memberships.map((x) => [x.organization.id, x.organization.name]));
  const disabled: NotificationKind[] = settingsRes.data?.disabled_kinds ?? [];
  const chip = (active: boolean) =>
    cx("inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors", active ? "border-brand/40 bg-brand/10 text-paper" : "border-line text-muted hover:text-paper");
  const when = (v: string) => formatDate(v, locale, session.preferences.timezone, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PageHeader title={t.title} description={t.description} actions={
          list.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {unread > 0 ? <MarkAllReadButton m={m} /> : null}
              {list.some((x) => x.read_at) ? <DismissReadButton m={m} /> : null}
            </div>
          ) : undefined
        } />
      <Alert tone="info">{t.emailNote}</Alert>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/notificacoes" className={chip(!showAll)}>
          {t.unread}
          {unread > 0 ? ` (${unread})` : ""}
        </Link>
        <Link href="/notificacoes?ver=todas" className={chip(showAll)}>{t.all}</Link>
      </div>

      <section className="rounded-xl border border-line bg-surface">
        {list.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted sm:px-6">{showAll ? t.empty : t.emptyUnread}</p>
        ) : (
          <ul className="flex flex-col" aria-label={t.title}>
            {list.map((n) => {
              const text = notificationText(m, locale, n, minorUnits);
              const context = n.organization_id ? (orgNames.get(n.organization_id) ?? "") : t.personal;
              return (
                <li key={n.id} className="flex flex-col gap-3 border-b border-line px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} aria-hidden />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className={cx("break-words text-[15px]", n.read_at ? "text-muted" : "font-medium")}>{text.title}</p>
                      <p className="break-words text-sm text-subtle">{text.body}</p>
                      <p className="text-xs text-subtle">
                        {context} · <time dateTime={n.created_at}>{when(n.created_at)}</time>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                    {!n.read_at ? <MarkReadButton m={m} id={n.id} /> : null}
                    <DismissNotificationButton m={m} id={n.id} />
                    <form action={openNotificationAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <button type="submit" className={buttonClass("secondary", "h-9 px-3")}>{t.open}</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Section title={t.settings.title} description={t.settings.description}>
        <NotificationSettingsForm m={m} disabled={disabled} dueSoonDays={settingsRes.data?.due_soon_days ?? 3} expirySoonDays={settingsRes.data?.expiry_soon_days ?? 7} />
      </Section>
    </>
  );
}
