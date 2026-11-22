"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { format, type Messages } from "@anen/i18n";
import { initialFormState } from "@/lib/form";
import { SubmitButton } from "@/components/forms";
import { Badge, cx } from "@/components/ui";
import { deleteQuoteAction } from "./actions";

export interface QuoteRow {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: "neutral" | "brand" | "danger";
  total: string;
}

/** Lista de orçamentos com seleção para apagar vários de uma vez (só aparece a quem pode escrever). */
export function QuoteList({ m, rows, canDelete }: { m: Messages; rows: QuoteRow[]; canDelete: boolean }) {
  const t = m.quotes;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action] = useActionState(deleteQuoteAction, initialFormState);
  const all = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-3">
      {canDelete ? (
        <form
          action={action}
          onSubmit={(e) => {
            if (selected.size === 0 || !window.confirm(t.confirmDeleteMany)) e.preventDefault();
          }}
          className="flex min-h-11 flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2"
        >
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={all}
              onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
              className="size-5 accent-[#FF851B]"
            />
            {t.selectAll}
          </label>
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="id" value={id} />
          ))}
          <span className="text-sm text-muted" aria-live="polite">
            {selected.size > 0 ? format(t.selected, { count: selected.size }) : ""}
          </span>
          <SubmitButton variant="danger" pendingLabel={m.common.saving} className={cx("ml-auto h-10 px-4", selected.size === 0 && "invisible")}>
            {t.deleteSelected}
          </SubmitButton>
          {state.status === "error" && state.message ? (
            <p role="alert" className="w-full text-sm text-danger">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <ul className="divide-y divide-line">
          {rows.map((q) => (
            <li key={q.id} className={cx("flex items-stretch", selected.has(q.id) && "bg-brand/5")}>
              {canDelete ? (
                <label className="flex cursor-pointer items-center pl-4 sm:pl-5">
                  <input
                    type="checkbox"
                    checked={selected.has(q.id)}
                    onChange={() => toggle(q.id)}
                    aria-label={format(t.select, { title: `${q.number} ${q.title}` })}
                    className="size-5 accent-[#FF851B]"
                  />
                </label>
              ) : null}
              <Link href={`/orcamentos/${q.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 transition-colors hover:bg-graphite/50 sm:px-5">
                <span className="tabular w-28 text-sm text-subtle">{q.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{q.title}</span>
                  <span className="block truncate text-xs text-subtle">{q.subtitle}</span>
                </span>
                <Badge tone={q.tone}>{q.statusLabel}</Badge>
                <span className="tabular w-32 text-right font-semibold">{q.total}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
