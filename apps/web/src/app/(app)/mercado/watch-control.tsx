"use client";

import { useActionState } from "react";
import type { Messages } from "@anen/i18n";
import { SubmitButton } from "@/components/forms";
import { initialFormState } from "@/lib/form";
import { removeWatchAction, saveWatchAction } from "./actions";

/** Acompanhar uma série com um limiar de variação mensal (pontos percentuais). */
export function WatchControl({
  m,
  seriesId,
  seriesName,
  watch,
}: {
  m: Messages;
  seriesId: string;
  seriesName: string;
  watch: { id: string; threshold: string } | null;
}) {
  const [state, save] = useActionState(saveWatchAction, initialFormState);
  const [, remove] = useActionState(removeWatchAction, initialFormState);
  const t = m.market.watch;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        <form action={save} className="flex items-center gap-1.5">
          <input type="hidden" name="seriesId" value={seriesId} />
          {watch ? <input type="hidden" name="watchId" value={watch.id} /> : null}
          <input
            name="threshold"
            inputMode="decimal"
            defaultValue={watch?.threshold ?? "1"}
            aria-label={`${t.threshold} · ${seriesName}`}
            title={t.hint}
            aria-invalid={state.fieldErrors?.threshold ? true : undefined}
            className="tabular h-9 w-16 rounded-md border border-line bg-ink px-2 text-right text-sm text-paper focus:border-brand focus:outline-none aria-[invalid=true]:border-danger"
          />
          <SubmitButton pendingLabel="…" variant={watch ? "ghost" : "secondary"} className="h-9 px-3">
            {watch ? t.save : t.add}
          </SubmitButton>
        </form>
        {watch ? (
          <form action={remove}>
            <input type="hidden" name="watchId" value={watch.id} />
            <SubmitButton pendingLabel="…" variant="ghost" className="h-9 px-2">
              <span aria-hidden="true">✕</span>
              <span className="sr-only">{`${t.remove} · ${seriesName}`}</span>
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-xs text-danger">{state.fieldErrors?.threshold ?? state.message}</p>
      ) : state.status === "success" && state.message ? (
        <p role="status" className="text-xs text-success">{state.message}</p>
      ) : null}
    </div>
  );
}
