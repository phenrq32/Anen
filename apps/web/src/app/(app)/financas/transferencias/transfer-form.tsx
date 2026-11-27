"use client";

import { useEffect, useState } from "react";
import { format, formatMoney, type Messages } from "@anen/i18n";
import type { Locale } from "@anen/types";
import { parseAmountInput } from "@anen/validation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field, SelectField, cx } from "@/components/ui";
import { createTransferAction } from "./actions";

export interface TransferSpace {
  /** "PERSONAL:<uuid>" ou "BUSINESS:<uuid>" */
  key: string;
  label: string;
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; label: string; kind: "income" | "expense" }[];
}

/**
 * Transferência entre o espaço ativo e outro, em dois passos: preencher e rever; só depois se confirma (§7).
 * O clientRef gerado ao abrir o formulário impede que um duplo envio crie duas transferências.
 */
export function TransferForm({
  m,
  locale,
  here,
  others,
  minorUnits,
  today,
}: {
  m: Messages;
  locale: Locale;
  here: TransferSpace;
  others: TransferSpace[];
  minorUnits: Record<string, number>;
  today: string;
}) {
  const t = m.finance.transfers;
  const [clientRef, setClientRef] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [otherKey, setOtherKey] = useState(others[0]?.key ?? "");
  const other = others.find((o) => o.key === otherKey) ?? others[0]!;
  const [thisAccountId, setThisAccountId] = useState(here.accounts[0]?.id ?? "");
  const [otherAccountId, setOtherAccountId] = useState(other.accounts[0]?.id ?? "");
  const [thisCategoryId, setThisCategoryId] = useState("");
  const [otherCategoryId, setOtherCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [type, setType] = useState<keyof typeof t.types>("owner_withdrawal");
  const [description, setDescription] = useState("");
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => setClientRef(crypto.randomUUID()), []);
  useEffect(() => {
    setOtherAccountId(other.accounts[0]?.id ?? "");
    setOtherCategoryId("");
  }, [other]);

  const thisAccount = here.accounts.find((a) => a.id === thisAccountId);
  const otherAccount = other.accounts.find((a) => a.id === otherAccountId);
  const currency = thisAccount?.currency ?? "EUR";
  const amountMinor = parseAmountInput(amount, minorUnits[currency] ?? 2);
  const ready = Boolean(thisAccount && otherAccount && amountMinor !== null && amountMinor > 0n && description.trim() && date);
  // Saída: despesa neste espaço e receita no outro; entrada: o contrário.
  const thisKind = direction === "out" ? "expense" : "income";
  const otherKind = direction === "out" ? "income" : "expense";
  const catOptions = (s: TransferSpace, kind: "income" | "expense") => [
    { value: "", label: t.noCategory },
    ...s.categories.filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: c.label })),
  ];
  const from = direction === "out" ? { space: here.label, account: thisAccount?.name ?? "" } : { space: other.label, account: otherAccount?.name ?? "" };
  const to = direction === "out" ? { space: other.label, account: otherAccount?.name ?? "" } : { space: here.label, account: thisAccount?.name ?? "" };

  return (
    <ActionForm action={createTransferAction}>
      {(state) =>
        state.status === "success" ? (
          <div className="flex flex-col items-start gap-3">
            <Alert tone="success">{state.message}</Alert>
          </div>
        ) : (
          <>
            <input type="hidden" name="clientRef" value={clientRef} />
            <input type="hidden" name="direction" value={direction} />
            <input type="hidden" name="other" value={other.key} />
            <input type="hidden" name="thisAccountId" value={thisAccountId} />
            <input type="hidden" name="otherAccountId" value={otherAccountId} />
            <input type="hidden" name="thisCategoryId" value={thisCategoryId} />
            <input type="hidden" name="otherCategoryId" value={otherCategoryId} />
            <input type="hidden" name="amount" value={amount} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="description" value={description} />
            {state.status === "error" && state.message ? <Alert>{state.message}</Alert> : null}
            {reviewing ? (
              <div className="flex flex-col gap-4 rounded-xl border border-brand/40 bg-brand/5 p-4">
                <p className="font-semibold">{t.confirmTitle}</p>
                <p className="text-sm">
                  {format(t.confirmBody, {
                    amount: amountMinor !== null ? formatMoney(amountMinor, currency, minorUnits[currency] ?? 2, locale) : amount,
                    from: from.space,
                    fromAccount: from.account,
                    to: to.space,
                    toAccount: to.account,
                    date,
                  })}
                </p>
                <p className="text-xs text-muted">
                  {t.types[type]} · {description}
                </p>
                <input type="hidden" name="confirmed" value="1" />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton pendingLabel={m.common.saving}>{t.confirm}</SubmitButton>
                  <button type="button" onClick={() => setReviewing(false)} className="h-11 rounded-lg px-4 text-sm text-muted hover:text-paper">
                    {t.edit}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-2 text-sm font-medium">{t.direction}</legend>
                  {(["out", "in"] as const).map((d) => (
                    <label
                      key={d}
                      className={cx(
                        "flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm",
                        direction === d ? "border-brand bg-brand/10 text-paper" : "border-line text-muted",
                      )}
                    >
                      <input type="radio" name="directionChoice" value={d} checked={direction === d} onChange={() => setDirection(d)} className="sr-only" />
                      {d === "out" ? t.directionOut : t.directionIn}
                    </label>
                  ))}
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField name="otherChoice" label={t.other} value={other.key} onChange={(e) => setOtherKey(e.target.value)} options={others.map((o) => ({ value: o.key, label: o.label }))} />
                  <SelectField
                    name="typeChoice"
                    label={t.type}
                    hint={t.typeHint}
                    value={type}
                    onChange={(e) => setType(e.target.value as keyof typeof t.types)}
                    options={(Object.keys(t.types) as (keyof typeof t.types)[]).map((k) => ({ value: k, label: t.types[k] }))}
                  />
                  <SelectField
                    name="thisAccountChoice"
                    label={t.thisAccount}
                    value={thisAccountId}
                    onChange={(e) => setThisAccountId(e.target.value)}
                    error={state.fieldErrors?.thisAccountId}
                    options={here.accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
                  />
                  <SelectField
                    name="otherAccountChoice"
                    label={t.otherAccount}
                    value={otherAccountId}
                    onChange={(e) => setOtherAccountId(e.target.value)}
                    error={state.fieldErrors?.otherAccountId}
                    options={other.accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
                  />
                  <SelectField name="thisCategoryChoice" label={t.thisCategory} value={thisCategoryId} onChange={(e) => setThisCategoryId(e.target.value)} options={catOptions(here, thisKind)} />
                  <SelectField name="otherCategoryChoice" label={t.otherCategory} value={otherCategoryId} onChange={(e) => setOtherCategoryId(e.target.value)} options={catOptions(other, otherKind)} />
                  <Field name="amountInput" label={`${t.amount} (${currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={state.fieldErrors?.amount} className="tabular" />
                  <Field name="dateInput" type="date" label={t.date} value={date} onChange={(e) => setDate(e.target.value)} error={state.fieldErrors?.date} />
                </div>
                <Field name="descriptionInput" label={t.description} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} error={state.fieldErrors?.description} />
                {thisAccount && otherAccount && thisAccount.currency !== otherAccount.currency ? <Alert>{m.errors.transfer_currency_mismatch}</Alert> : null}
                <button
                  type="button"
                  disabled={!ready || thisAccount?.currency !== otherAccount?.currency}
                  onClick={() => setReviewing(true)}
                  className="inline-flex h-11 items-center self-start rounded-lg bg-brand px-4 text-[15px] font-semibold text-on-brand transition-colors hover:bg-brand-hover disabled:pointer-events-none disabled:opacity-50"
                >
                  {t.review}
                </button>
              </>
            )}
          </>
        )
      }
    </ActionForm>
  );
}
