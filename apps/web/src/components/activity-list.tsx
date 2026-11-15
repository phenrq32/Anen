import { formatDate, lookup, type Messages } from "@anen/i18n";
import type { AuditLog, Locale } from "@anen/types";

export function ActivityList({
  m,
  locale,
  timeZone,
  logs,
  names,
}: {
  m: Messages;
  locale: Locale;
  timeZone: string;
  logs: AuditLog[];
  names: ReadonlyMap<string, string>;
}) {
  if (logs.length === 0) return <p className="text-sm text-muted">{m.audit.empty}</p>;
  return (
    <ol className="flex flex-col">
      {logs.map((log) => {
        const label = lookup(m.audit.events, `${log.entity_type}.${log.action}`) ?? m.audit.events.other;
        const actor = log.actor_id ? (names.get(log.actor_id) ?? "—") : m.audit.unknownActor;
        return (
          <li key={log.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
            <p className="text-sm">
              <span className="font-medium">{actor}</span> <span className="text-muted">{label}</span>
            </p>
            <time dateTime={log.created_at} className="tabular shrink-0 text-xs text-subtle">
              {formatDate(log.created_at, locale, timeZone, { dateStyle: "short", timeStyle: "short" })}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
