"use client";

import type { Messages } from "@anen/i18n";
import type { Contact } from "@anen/types";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Field, SelectField } from "@/components/ui";
import { saveContactAction, toggleArchiveContactAction } from "./actions";

type ContactInitial = Pick<Contact, "id" | "kind" | "name" | "tax_id" | "email" | "phone" | "address" | "payment_terms_days" | "notes">;

export function ContactForm({ m, initial, defaultKind = "client" }: { m: Messages; initial?: ContactInitial; defaultKind?: Contact["kind"] }) {
  const t = m.business.contacts;
  return (
    <ActionForm action={saveContactAction}>
      {(state) => (
        <>
          {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <SelectField
              name="kind"
              label={t.kind}
              defaultValue={initial?.kind ?? defaultKind}
              options={(["client", "supplier", "both"] as const).map((k) => ({ value: k, label: t.kinds[k] }))}
              error={state.fieldErrors?.kind}
            />
            <Field name="name" label={t.name} defaultValue={initial?.name} required maxLength={160} error={state.fieldErrors?.name} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="taxId" label={t.taxId} optionalLabel={m.common.optional} defaultValue={initial?.tax_id ?? ""} maxLength={32} error={state.fieldErrors?.taxId} />
            <Field name="email" type="email" label={t.email} optionalLabel={m.common.optional} defaultValue={initial?.email ?? ""} maxLength={254} error={state.fieldErrors?.email} />
            <Field name="phone" type="tel" label={t.phone} optionalLabel={m.common.optional} defaultValue={initial?.phone ?? ""} maxLength={40} error={state.fieldErrors?.phone} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <Field name="address" label={t.address} optionalLabel={m.common.optional} defaultValue={initial?.address ?? ""} maxLength={400} error={state.fieldErrors?.address} />
            <Field
              name="paymentTermsDays"
              type="number"
              min={0}
              max={365}
              inputMode="numeric"
              label={t.paymentTerms}
              optionalLabel={m.common.optional}
              defaultValue={initial?.payment_terms_days ?? ""}
              error={state.fieldErrors?.paymentTermsDays}
            />
          </div>
          <Field name="notes" label={t.notes} optionalLabel={m.common.optional} defaultValue={initial?.notes ?? ""} maxLength={2000} error={state.fieldErrors?.notes} />
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {m.common.save}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ArchiveContactButton({ m, id, archived }: { m: Messages; id: string; archived: boolean }) {
  return (
    <InlineAction
      action={toggleArchiveContactAction}
      fields={{ id, archive: archived ? "0" : "1" }}
      label={archived ? m.business.contacts.unarchive : m.business.contacts.archive}
      pendingLabel={m.common.saving}
      variant="secondary"
    />
  );
}
