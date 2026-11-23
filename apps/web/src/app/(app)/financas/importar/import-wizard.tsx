"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { format, formatMoney, type Messages } from "@anen/i18n";
import type { Locale } from "@anen/types";
import {
  csvToStatement,
  guessCsvMapping,
  looksLikeOfx,
  ofxToStatement,
  parseCsv,
  type CsvMapping,
  type CsvTable,
  type StatementRow,
} from "@anen/validation";
import { Alert, Badge, Button, SelectField, cx } from "@/components/ui";
import { importStatementAction, previewImportAction } from "./actions";

export interface ImportAccount {
  id: string;
  name: string;
  currency: string;
  minorUnit: number;
}
export interface ImportCategory {
  id: string;
  label: string;
  kind: "income" | "expense";
}

/** Lê o ficheiro como UTF-8 e, se houver caracteres inválidos, como Windows-1252 (muitos bancos exportam assim). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

type Row = StatementRow & { include: boolean; duplicate: boolean; categoryId: string; suggested: boolean };

export function ImportWizard({ m, locale, accounts, categories }: { m: Messages; locale: Locale; accounts: ImportAccount[]; categories: ImportCategory[] }) {
  const t = m.import;
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [ofxRows, setOfxRows] = useState<{ rows: StatementRow[]; invalid: number[] } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, start] = useTransition();
  const [dragging, setDragging] = useState(false);

  const parsed = useMemo(() => {
    if (!account) return null;
    if (ofxRows) return ofxRows;
    if (table && mapping) return csvToStatement(table, mapping, account.minorUnit);
    return null;
  }, [account, ofxRows, table, mapping]);

  const reset = () => {
    setRows(null);
    setDone("");
    setError("");
  };

  const onFile = async (file: File | undefined) => {
    reset();
    setTable(null);
    setMapping(null);
    setOfxRows(null);
    if (!file || !account) return;
    if (file.size > 3 * 1024 * 1024) return setError(t.tooBig);
    setFileName(file.name);
    const text = await readText(file);
    if (looksLikeOfx(text)) {
      const r = ofxToStatement(text, account.minorUnit);
      if (r.rows.length === 0) return setError(t.nothingFound);
      setOfxRows(r);
      return;
    }
    const tb = parseCsv(text);
    if (tb.rows.length === 0) return setError(t.nothingFound);
    setTable(tb);
    const guess = guessCsvMapping(tb);
    setMapping(guess ?? { date: 0, description: Math.min(1, tb.headers.length - 1), amount: Math.min(2, tb.headers.length - 1) });
    if (!guess) setError(t.mapManually);
  };

  const review = () => {
    if (!parsed || !account || parsed.rows.length === 0) return setError(t.nothingFound);
    setError("");
    start(async () => {
      const payload = parsed.rows.map((r) => ({ occurredOn: r.occurredOn, description: r.description, amountMinor: r.amountMinor.toString(), ref: r.ref }));
      const res = await previewImportAction({ accountId, rows: payload });
      if (!res.ok) return setError(res.message ?? m.errors.generic);
      const dup = new Set(res.duplicates ?? []);
      setRows(
        parsed.rows.map((r) => {
          const cat = res.suggestions?.[r.ref] ?? "";
          return { ...r, include: !dup.has(r.ref), duplicate: dup.has(r.ref), categoryId: cat, suggested: Boolean(cat) };
        }),
      );
    });
  };

  const submit = () => {
    if (!rows) return;
    const chosen = rows.filter((r) => r.include);
    if (chosen.length === 0) return setError(t.noneSelected);
    start(async () => {
      const res = await importStatementAction({
        accountId,
        rows: chosen.map((r) => ({ occurredOn: r.occurredOn, description: r.description, amountMinor: r.amountMinor.toString(), ref: r.ref, categoryId: r.categoryId })),
      });
      if (!res.ok) return setError(res.message ?? m.errors.generic);
      setDone(res.message ?? "");
      setRows(null);
      setTable(null);
      setOfxRows(null);
      setFileName("");
    });
  };

  const money = (v: bigint) => (account ? formatMoney(v < 0n ? -v : v, account.currency, account.minorUnit, locale) : "");
  const selected = rows?.filter((r) => r.include) ?? [];
  const totals = selected.reduce((acc, r) => (r.amountMinor < 0n ? { ...acc, out: acc.out - r.amountMinor } : { ...acc, in: acc.in + r.amountMinor }), { in: 0n, out: 0n });
  const columnOptions = (table?.headers ?? []).map((h, i) => ({ value: String(i), label: h || `${t.column} ${i + 1}` }));
  const twoColumns = mapping?.debit !== undefined;

  if (accounts.length === 0) {
    return (
      <Alert tone="info">
        {t.noAccounts}{" "}
        <Link href="/financas/contas" className="underline">
          {m.finance.tabs.accounts}
        </Link>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {done ? (
        <div className="pop-in">
          <Alert tone="success">{done}</Alert>
        </div>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {!rows ? (
        <section className="glass spot flex flex-col gap-5 rounded-2xl border p-5 sm:p-6">
          <SelectField
            name="accountId"
            label={t.account}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              reset();
            }}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
          />
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void onFile(e.dataTransfer.files[0]);
            }}
            className={cx(
              "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-all",
              dragging ? "scale-[1.01] border-brand bg-brand/10" : "border-line hover:border-brand/50 hover:bg-graphite/40",
            )}
          >
            <span className="float grid size-12 place-items-center rounded-2xl bg-brand/15 text-brand" aria-hidden>
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
              </svg>
            </span>
            <span className="font-semibold">{fileName || t.drop}</span>
            <span className="text-sm text-subtle">{t.formats}</span>
            <input type="file" accept=".csv,.txt,.ofx,text/csv" className="sr-only" aria-label={t.chooseFile} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>

          {table && mapping ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-semibold">{t.columns}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SelectField name="colDate" label={t.colDate} value={String(mapping.date)} onChange={(e) => setMapping({ ...mapping, date: Number(e.target.value) })} options={columnOptions} />
                <SelectField
                  name="colDescription"
                  label={t.colDescription}
                  value={String(mapping.description)}
                  onChange={(e) => setMapping({ ...mapping, description: Number(e.target.value) })}
                  options={columnOptions}
                />
                {twoColumns ? (
                  <>
                    <SelectField name="colDebit" label={t.colDebit} value={String(mapping.debit)} onChange={(e) => setMapping({ ...mapping, debit: Number(e.target.value) })} options={columnOptions} />
                    <SelectField name="colCredit" label={t.colCredit} value={String(mapping.credit)} onChange={(e) => setMapping({ ...mapping, credit: Number(e.target.value) })} options={columnOptions} />
                  </>
                ) : (
                  <SelectField name="colAmount" label={t.colAmount} value={String(mapping.amount ?? 0)} onChange={(e) => setMapping({ ...mapping, amount: Number(e.target.value) })} options={columnOptions} />
                )}
              </div>
            </fieldset>
          ) : null}

          {parsed ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-sm text-muted" aria-live="polite">
                {format(t.found, { count: parsed.rows.length })}
                {parsed.invalid.length ? ` ${format(t.invalidLines, { count: parsed.invalid.length, lines: parsed.invalid.slice(0, 8).join(", ") })}` : ""}
              </p>
              <Button type="button" onClick={review} disabled={pending || parsed.rows.length === 0}>
                {pending ? m.common.saving : t.review}
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="glass sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 lg:top-4">
            <span className="text-sm">
              <strong className="tabular">{selected.length}</strong> {t.selectedOf} {rows.length}
              {" · "}
              <span className="tabular text-success">+{money(totals.in)}</span>
              {" · "}
              <span className="tabular text-danger">−{money(totals.out)}</span>
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setRows(null)} disabled={pending}>
                {t.back}
              </Button>
              <Button type="button" onClick={submit} disabled={pending || selected.length === 0}>
                {pending ? m.common.saving : format(t.importN, { count: selected.length })}
              </Button>
            </span>
          </div>
          <ul className="stagger flex flex-col gap-2" aria-label={t.preview}>
            {rows.map((r, i) => (
              <li
                key={r.ref}
                className={cx("glass flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 sm:flex-nowrap", !r.include && "opacity-55")}
              >
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={() => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, include: !x.include } : x)))}
                  aria-label={format(t.includeRow, { description: r.description })}
                  className="size-5 shrink-0 accent-[#FF851B]"
                />
                <span className="tabular w-20 shrink-0 text-xs text-subtle">{r.occurredOn.split("-").reverse().join("/")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.description}</span>
                  {r.duplicate ? <Badge tone="danger">{t.duplicate}</Badge> : null}
                </span>
                <select
                  aria-label={format(t.categoryFor, { description: r.description })}
                  value={r.categoryId}
                  onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, categoryId: e.target.value, suggested: false } : x)))}
                  className={cx(
                    "h-9 w-full rounded-md border bg-surface px-2 text-sm sm:w-44",
                    r.suggested ? "border-brand/50" : "border-line",
                  )}
                >
                  <option value="">{m.finance.tx.noCategory}</option>
                  {categories
                    .filter((c) => c.kind === (r.amountMinor < 0n ? "expense" : "income"))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                </select>
                <span className={cx("tabular w-28 shrink-0 text-right text-sm font-semibold", r.amountMinor < 0n ? "text-paper" : "text-success")}>
                  {r.amountMinor < 0n ? "−" : "+"}
                  {money(r.amountMinor)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle">{t.suggestedHint}</p>
        </section>
      )}
    </div>
  );
}
