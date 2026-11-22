import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { format, formatDate } from "@anen/i18n";
import type { AiConversation, AiMessage, AiStatus } from "@anen/types";
import { Alert, Badge, PageHeader, Section, buttonClass, cx } from "@/components/ui";
import { geminiConfig } from "@/lib/ai/gemini";
import { getI18n } from "@/lib/i18n";
import { requireOnboardedSession } from "@/lib/session";
import { acceptAiConsentAction } from "./actions";
import { AskForm, DeleteConversationButton, SuggestionButton } from "./ai-forms";

export const metadata: Metadata = { title: "ANEN AI" };
// A resposta pode levar várias chamadas ao modelo e às ferramentas.
export const maxDuration = 120;

const UUID = /^[0-9a-f-]{36}$/;

/** Markdown mínimo e seguro (sem HTML): **negrito**, listas com "- " ou "* " e parágrafos. */
function AiText({ text }: { text: string }) {
  const inline = (line: string, key: string): ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
      chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4 ? <strong key={`${key}-${i}`}>{chunk.slice(2, -2)}</strong> : chunk,
    );
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${k}`} className="ml-5 list-disc space-y-1">
          {list.map((l, i) => <li key={i}>{inline(l, `li-${k}-${i}`)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const item = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (item) {
      list.push(item[1]!);
      return;
    }
    flush(i);
    if (!line.trim()) return;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      <p key={i} className={heading ? "font-semibold" : undefined}>
        {inline(heading ? heading[1]! : line, `p-${i}`)}
      </p>,
    );
  });
  flush(-1);
  return <div className="flex flex-col gap-2 break-words text-[15px] leading-relaxed">{blocks}</div>;
}

export default async function AiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { m, locale } = await getI18n();
  const session = await requireOnboardedSession();
  const t = m.ai;
  const orgId = session.active?.organization.id ?? null;
  const params = await searchParams;

  if (!geminiConfig()) {
    return (
      <>
        <PageHeader title={t.title} description={t.description} />
        <Alert tone="info">{t.notConfigured}</Alert>
      </>
    );
  }

  const [statusRes, plansRes] = await Promise.all([
    session.supabase.rpc("ai_status", { p_org: orgId }),
    session.supabase.from("plans").select("key, name, ai_daily_limit").order("position"),
  ]);
  const status: AiStatus | undefined = statusRes.data?.[0];
  if (!status) throw new Error("Falha ao carregar o estado da IA");
  const limitOf = (key: string) => plansRes.data?.find((p) => p.key === key)?.ai_daily_limit ?? 0;

  const header = (
    <PageHeader
      title={t.title}
      description={t.description}
      actions={
        <div className="flex flex-col items-end gap-1 text-right">
          <Badge tone={status.daily_limit > 0 ? "brand" : "neutral"}>{format(t.plan, { plan: status.plan_name })}</Badge>
          {status.daily_limit > 0 ? (
            <span className="tabular text-xs text-subtle">{format(t.usage, { used: status.used_today, limit: status.daily_limit })}</span>
          ) : null}
        </div>
      }
    />
  );

  if (status.daily_limit <= 0) {
    return (
      <>
        {header}
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">{t.locked.title}</h2>
          <p className="max-w-2xl text-[15px] text-muted">{format(t.locked.body, { plan: status.plan_name })}</p>
          <p className="text-sm font-medium text-brand">{format(t.locked.limits, { pro: limitOf("pro"), max: limitOf("max") })}</p>
          <p className="text-sm text-subtle">{t.locked.contact}</p>
        </section>
      </>
    );
  }

  if (!status.consented) {
    return (
      <>
        {header}
        <section className="flex max-w-2xl flex-col gap-4 rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">{t.consent.title}</h2>
          <p className="text-[15px] text-muted">{t.consent.body}</p>
          <form action={acceptAiConsentAction}>
            <button type="submit" className={buttonClass("primary")}>{t.consent.accept}</button>
          </form>
        </section>
      </>
    );
  }

  let convQuery = session.supabase.from("ai_conversations").select("*").order("updated_at", { ascending: false }).limit(50);
  convQuery = orgId ? convQuery.eq("organization_id", orgId) : convQuery.is("organization_id", null);
  const { data: convData } = await convQuery;
  const conversations: AiConversation[] = convData ?? [];
  const current = params.c && UUID.test(params.c) ? conversations.find((c) => c.id === params.c) ?? null : null;
  const { data: msgData } = current
    ? await session.supabase.from("ai_messages").select("*").eq("conversation_id", current.id).order("created_at").limit(200)
    : { data: [] as AiMessage[] };
  const messages: AiMessage[] = msgData ?? [];
  const exhausted = status.used_today >= status.daily_limit;
  const when = (v: string) => formatDate(v, locale, session.preferences.timezone, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const toolName = (k: string) => (t.tools as Record<string, string>)[k] ?? k;

  return (
    <>
      {header}
      {exhausted ? <Alert tone="info">{m.errors.ai_daily_limit}</Alert> : null}
      {params.erro === "1" ? <Alert tone="error">{m.errors.ai_unavailable}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-3">
          <Link href="/ia" className={buttonClass("secondary", "w-full")}>+ {t.newChat}</Link>
          <nav aria-label={t.conversations} className="rounded-xl border border-line bg-surface">
            {conversations.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">{t.noConversations}</p>
            ) : (
              <ul className="flex max-h-[60vh] flex-col overflow-y-auto">
                {conversations.map((c) => (
                  <li key={c.id} className="border-b border-line last:border-0">
                    <Link
                      href={`/ia?c=${c.id}`}
                      aria-current={c.id === current?.id ? "page" : undefined}
                      className={cx("block px-4 py-3 text-sm transition-colors hover:bg-graphite/50", c.id === current?.id ? "bg-graphite text-paper" : "text-muted")}
                    >
                      <span className="block truncate">{c.title}</span>
                      <span className="block text-xs text-subtle">{when(c.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          {current ? (
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 break-words text-lg font-semibold">{current.title}</h2>
              <DeleteConversationButton m={m} id={current.id} />
            </div>
          ) : null}

          {messages.length === 0 && !current ? (
            <Section title={t.suggestions.title}>
              <div className="grid gap-2 sm:grid-cols-2">
                {[t.suggestions.q1, t.suggestions.q2, t.suggestions.q3, t.suggestions.q4, t.suggestions.q5, t.suggestions.q6].map((q) => (
                  <SuggestionButton key={q} text={q} />
                ))}
              </div>
            </Section>
          ) : (
            <ol className="flex flex-col gap-4" aria-label={current?.title}>
              {messages.map((msg) =>
                msg.role === "user" ? (
                  <li key={msg.id} className="self-end rounded-xl bg-graphite px-4 py-3 text-[15px] sm:max-w-[80%]">
                    <span className="sr-only">{t.you}: </span>
                    <p className="whitespace-pre-line break-words">{msg.content}</p>
                  </li>
                ) : (
                  <li key={msg.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-4 sm:px-5">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
                      <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                      {t.title}
                    </span>
                    <AiText text={msg.content} />
                    {msg.sources.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                        <span className="text-subtle">{t.sources}:</span>
                        {msg.sources.map((s) => (
                          <Link key={s.href} href={s.href} className="rounded-full border border-line px-2.5 py-1 text-muted hover:border-brand/40 hover:text-paper">
                            {s.label}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                    {msg.tools.length > 0 ? (
                      <p className="text-xs text-subtle">{format(t.toolsUsed, { tools: msg.tools.map(toolName).join(", ") })}</p>
                    ) : null}
                  </li>
                ),
              )}
            </ol>
          )}

          <AskForm m={m} conversationId={current?.id ?? null} disabled={exhausted} />
        </div>
      </div>
    </>
  );
}
