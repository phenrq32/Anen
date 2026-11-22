"use client";

import { useMemo, useState } from "react";
import { add, moneyFromMinor, multiply, percentOf, subtract, zero } from "@anen/financial-engine";
import { formatMoney, type Messages } from "@anen/i18n";
import type { FiscalAddress, InvoicingTax, Locale } from "@anen/types";
import { NEW_FISCAL_KINDS, TAX_EXEMPTION_CODES, isGuideKind, parseAmountInput, parseQuantityInput } from "@anen/validation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, SelectField, cx } from "@/components/ui";
import { createFiscalDocumentAction } from "./actions";

export interface ContactOption {
  id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  address: string | null;
}

interface Line {
  key: number;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxName: string;
  discount: string;
  stockItemId: string;
}

export interface DocumentDefaults {
  kind?: (typeof NEW_FISCAL_KINDS)[number];
  contactId?: string;
  projectId?: string;
  quoteId?: string;
  reference?: string;
  lines?: Omit<Line, "key">[];
  note?: string;
}

const emptyLine = (key: number, taxName: string): Line => ({ key, name: "", description: "", quantity: "1", unitPrice: "", taxName, discount: "0", stockItemId: "" });

export function DocumentForm({
  m,
  locale,
  today,
  contacts,
  projects,
  stockItems,
  taxes,
  loadAddress,
  defaults,
}: {
  m: Messages;
  locale: Locale;
  today: string;
  contacts: ContactOption[];
  projects: { id: string; name: string }[];
  stockItems: { id: string; name: string; unit: string }[];
  taxes: InvoicingTax[];
  loadAddress: FiscalAddress | null;
  defaults: DocumentDefaults;
}) {
  const t = m.invoicing.form;
  const defaultTax = taxes.find((x) => x.default_tax === 1)?.name ?? taxes[0]?.name ?? "";
  const [kind, setKind] = useState<(typeof NEW_FISCAL_KINDS)[number]>(defaults.kind ?? "invoice");
  const [contactId, setContactId] = useState(defaults.contactId ?? "");
  const contact = contacts.find((c) => c.id === contactId);
  const [client, setClient] = useState({
    name: contact?.name ?? "",
    fiscalId: contact?.tax_id ?? "",
    email: contact?.email ?? "",
    address: contact?.address ?? "",
    city: "",
    postalCode: "",
    country: "Portugal",
  });
  const [lines, setLines] = useState<Line[]>(
    defaults.lines?.length ? defaults.lines.map((l, i) => ({ ...l, key: i })) : [emptyLine(0, defaultTax)],
  );
  const [nextKey, setNextKey] = useState(lines.length);
  const [from, setFrom] = useState<FiscalAddress>(loadAddress ?? { detail: "", city: "", postal_code: "", country: "Portugal" });
  const [to, setTo] = useState<FiscalAddress>({ detail: "", city: "", postal_code: "", country: "Portugal" });
  const [meta, setMeta] = useState({
    issueDate: today,
    dueDate: "",
    reference: defaults.reference ?? "",
    observations: "",
    taxExemption: "",
    projectId: defaults.projectId ?? "",
    stockOut: true,
    loadedAt: "",
    licensePlate: "",
  });
  const setM = (patch: Partial<typeof meta>) => setMeta((prev) => ({ ...prev, ...patch }));
  const guide = isGuideKind(kind);
  const taxValue = (name: string) => taxes.find((x) => x.name === name)?.value ?? "0";
  const hasZeroTax = lines.some((l) => Number(taxValue(l.taxName)) === 0);

  const pickContact = (id: string) => {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c) setClient((prev) => ({ ...prev, name: c.name, fiscalId: c.tax_id ?? "", email: c.email ?? "", address: c.address ?? "" }));
  };
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Estimativa (os valores finais vêm do InvoiceXpress).
  const preview = useMemo(() => {
    let net = zero("EUR");
    let vat = zero("EUR");
    for (const l of lines) {
      const price = parseAmountInput(l.unitPrice, 2);
      const qty = parseQuantityInput(l.quantity);
      const disc = parseQuantityInput(l.discount || "0");
      if (price === null || qty === null || disc === null) continue;
      const gross = multiply(moneyFromMinor(price, "EUR"), qty);
      const lineNet = subtract(gross, percentOf(gross, disc));
      net = add(net, lineNet);
      vat = add(vat, percentOf(lineNet, taxValue(l.taxName)));
    }
    return { net, vat, total: add(net, vat) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, taxes]);
  const fmt = (v: bigint) => formatMoney(v, "EUR", 2, locale);

  const payload = JSON.stringify({
    kind,
    contactId: contactId || "",
    clientName: client.name,
    clientFiscalId: client.fiscalId,
    clientEmail: client.email,
    clientAddress: client.address,
    clientCity: client.city,
    clientPostalCode: client.postalCode,
    clientCountry: client.country,
    issueDate: meta.issueDate,
    dueDate: guide ? "" : meta.dueDate,
    reference: meta.reference,
    observations: meta.observations,
    taxExemption: hasZeroTax ? meta.taxExemption : "",
    projectId: meta.projectId,
    quoteId: defaults.quoteId ?? "",
    stockOut: lines.some((l) => l.stockItemId) && meta.stockOut,
    lines: lines.map(({ key: _key, ...l }) => l),
    ...(guide
      ? {
          loadedAt: meta.loadedAt,
          licensePlate: meta.licensePlate,
          addressFrom: { detail: from.detail, city: from.city, postalCode: from.postal_code, country: from.country || "Portugal" },
          addressTo: { detail: to.detail, city: to.city, postalCode: to.postal_code, country: to.country || "Portugal" },
        }
      : {}),
  });

  return (
    <ActionForm action={createFiscalDocumentAction}>
      {(state) => (
        <div className="flex flex-col gap-6">
          <input type="hidden" name="payload" value={payload} readOnly />
          {defaults.note ? <p className="text-sm text-muted">{defaults.note}</p> : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold">{t.kind}</legend>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {NEW_FISCAL_KINDS.map((k) => (
                <label key={k} className={cx("flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm", kind === k ? "border-brand/50 bg-brand/10" : "border-line hover:border-graphite-soft")}>
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="kindRadio" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-[#FF851B]" />
                    {m.invoicing.kinds[k]}
                  </span>
                  <span className="text-xs text-subtle">{m.invoicing.kindHints[k as keyof typeof m.invoicing.kindHints]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-semibold">{t.client}</legend>
            <SelectField
              name="contactPick"
              label={t.pickClient}
              value={contactId}
              onChange={(e) => pickContact(e.currentTarget.value)}
              options={[{ value: "", label: t.newClient }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <Field name="clientName" label={t.clientName} value={client.name} onChange={(e) => setClient({ ...client, name: e.currentTarget.value })} required maxLength={200} error={state.fieldErrors?.clientName} />
              <Field name="clientFiscalId" label={t.fiscalId} hint={t.fiscalIdHint} value={client.fiscalId} onChange={(e) => setClient({ ...client, fiscalId: e.currentTarget.value })} maxLength={30} error={state.fieldErrors?.clientFiscalId} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="clientEmail" type="email" label={t.email} optionalLabel={m.common.optional} value={client.email} onChange={(e) => setClient({ ...client, email: e.currentTarget.value })} maxLength={254} />
              <Field name="clientAddress" label={t.address} optionalLabel={m.common.optional} value={client.address} onChange={(e) => setClient({ ...client, address: e.currentTarget.value })} maxLength={400} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field name="clientPostalCode" label={t.postalCode} optionalLabel={m.common.optional} value={client.postalCode} onChange={(e) => setClient({ ...client, postalCode: e.currentTarget.value })} maxLength={20} />
              <Field name="clientCity" label={t.city} optionalLabel={m.common.optional} value={client.city} onChange={(e) => setClient({ ...client, city: e.currentTarget.value })} maxLength={120} />
              <Field name="clientCountry" label={t.country} value={client.country} onChange={(e) => setClient({ ...client, country: e.currentTarget.value })} maxLength={60} />
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="issueDate" type="date" label={t.issueDate} value={meta.issueDate} onChange={(e) => setM({ issueDate: e.currentTarget.value })} required />
            {!guide ? <Field name="dueDate" type="date" label={t.dueDate} optionalLabel={m.common.optional} value={meta.dueDate} onChange={(e) => setM({ dueDate: e.currentTarget.value })} error={state.fieldErrors?.dueDate} /> : null}
            <Field name="reference" label={t.reference} optionalLabel={m.common.optional} value={meta.reference} onChange={(e) => setM({ reference: e.currentTarget.value })} maxLength={120} />
          </div>
          {projects.length > 0 ? (
            <SelectField
              name="projectId"
              label={t.project}
              optionalLabel={m.common.optional}
              value={meta.projectId}
              onChange={(e) => setM({ projectId: e.currentTarget.value })}
              options={[{ value: "", label: t.noProject }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            />
          ) : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold">{t.lines}</legend>
            {lines.map((l, i) => (
              <div key={l.key} className="flex flex-col gap-3 rounded-lg border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                  <Field name={`l${l.key}-name`} label={`${t.lineName} ${i + 1}`} value={l.name} onChange={(e) => setLine(l.key, { name: e.currentTarget.value })} required maxLength={60} />
                  {stockItems.length > 0 ? (
                    <SelectField
                      name={`l${l.key}-stock`}
                      label={t.stockItem}
                      value={l.stockItemId}
                      onChange={(e) => {
                        const id = e.currentTarget.value;
                        const item = stockItems.find((s) => s.id === id);
                        setLine(l.key, { stockItemId: id, ...(item && !l.name ? { name: item.name.slice(0, 60) } : {}) });
                      }}
                      options={[{ value: "", label: t.noStockItem }, ...stockItems.map((s) => ({ value: s.id, label: `${s.name} (${s.unit})` }))]}
                    />
                  ) : (
                    <Field name={`l${l.key}-desc`} label={t.lineDescription} optionalLabel={m.common.optional} value={l.description} onChange={(e) => setLine(l.key, { description: e.currentTarget.value })} maxLength={200} />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[100px_1fr_160px_100px_auto] sm:items-end">
                  <Field name={`l${l.key}-qty`} label={t.quantity} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.currentTarget.value })} required maxLength={20} />
                  <Field name={`l${l.key}-price`} label={t.unitPrice} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.currentTarget.value })} required maxLength={32} />
                  <SelectField
                    name={`l${l.key}-tax`}
                    label={t.tax}
                    value={l.taxName}
                    onChange={(e) => setLine(l.key, { taxName: e.currentTarget.value })}
                    options={taxes.map((x) => ({ value: x.name, label: `${x.name} (${Number(x.value)} %)` }))}
                  />
                  <Field name={`l${l.key}-disc`} label={t.discount} inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.currentTarget.value })} maxLength={10} />
                  {lines.length > 1 ? (
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="h-11 rounded-md px-3 text-sm text-muted hover:bg-graphite hover:text-paper">
                      {t.removeLine}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setLines((ls) => [...ls, emptyLine(nextKey, defaultTax)]);
                setNextKey((k) => k + 1);
              }}
              className="self-start rounded-md px-3 py-2 text-sm font-medium text-brand hover:bg-graphite"
            >
              {t.addLine}
            </button>
          </fieldset>

          {hasZeroTax ? (
            <SelectField
              name="taxExemption"
              label={t.exemption}
              hint={t.exemptionHint}
              value={meta.taxExemption}
              onChange={(e) => setM({ taxExemption: e.currentTarget.value })}
              options={[{ value: "", label: t.noExemption }, ...TAX_EXEMPTION_CODES.map((c) => ({ value: c, label: m.invoicing.exemptions[c] }))]}
              error={state.fieldErrors?.taxExemption}
            />
          ) : null}

          {guide ? (
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-2 text-sm font-semibold">{t.transport}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="loadedAt" type="datetime-local" label={t.loadedAt} hint={t.loadedAtHint} value={meta.loadedAt} onChange={(e) => setM({ loadedAt: e.currentTarget.value })} required />
                <Field name="licensePlate" label={t.licensePlate} optionalLabel={m.common.optional} value={meta.licensePlate} onChange={(e) => setM({ licensePlate: e.currentTarget.value })} maxLength={20} />
              </div>
              {(["from", "to"] as const).map((side) => {
                const a = side === "from" ? from : to;
                const set = side === "from" ? setFrom : setTo;
                return (
                  <div key={side} className="flex flex-col gap-3 rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{side === "from" ? t.addressFrom : t.addressTo}</span>
                      {side === "to" ? (
                        <button
                          type="button"
                          onClick={() => setTo({ detail: client.address, city: client.city, postal_code: client.postalCode, country: client.country })}
                          className="text-sm text-brand hover:underline"
                        >
                          {t.sameAsClient}
                        </button>
                      ) : null}
                    </div>
                    <Field name={`${side}-detail`} label={t.address} value={a.detail} onChange={(e) => set({ ...a, detail: e.currentTarget.value })} required maxLength={200} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field name={`${side}-pc`} label={t.postalCode} value={a.postal_code} onChange={(e) => set({ ...a, postal_code: e.currentTarget.value })} required maxLength={20} />
                      <Field name={`${side}-city`} label={t.city} value={a.city} onChange={(e) => set({ ...a, city: e.currentTarget.value })} required maxLength={120} />
                      <Field name={`${side}-country`} label={t.country} value={a.country} onChange={(e) => set({ ...a, country: e.currentTarget.value })} maxLength={60} />
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ) : null}

          {lines.some((l) => l.stockItemId) ? (
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" name="stockOut" value="1" checked={meta.stockOut} onChange={(e) => setM({ stockOut: e.currentTarget.checked })} className="size-4 accent-[#FF851B]" />
              {t.stockOut}
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{t.observations}</span>
            <textarea name="observations" rows={2} maxLength={2000} value={meta.observations} onChange={(e) => setM({ observations: e.currentTarget.value })} className="w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[15px] text-paper focus:border-brand focus:outline-none" />
          </label>

          {!guide ? (
            <div className="flex flex-col gap-1 rounded-lg border border-line bg-graphite/40 p-4 text-sm">
              <span className="font-semibold">{t.preview}</span>
              <div className="tabular grid grid-cols-3 gap-2">
                <span>{t.subtotal}: {fmt(preview.net.amountMinor)}</span>
                <span>{t.vat}: {fmt(preview.vat.amountMinor)}</span>
                <span className="font-semibold">{t.total}: {fmt(preview.total.amountMinor)}</span>
              </div>
              <span className="text-xs text-subtle">{t.previewHint}</span>
            </div>
          ) : null}

          <SubmitButton pendingLabel={m.common.saving} className="self-start">{t.submit}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
