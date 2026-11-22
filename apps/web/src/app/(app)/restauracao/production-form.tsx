"use client";

import type { Messages } from "@anen/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { produceRecipeAction } from "../orcamentos/actions";

/** Registar uma produção da ficha (as quantidades e os lotes são calculados no servidor). */
export function ProductionForm({ m, recipeId, portions, today }: { m: Messages; recipeId: string; portions: string; today: string }) {
  const t = m.recipes.production;
  return (
    <ActionForm action={produceRecipeAction}>
      {(state) => (
        <div className="flex flex-col gap-4">
          <input type="hidden" name="id" value={recipeId} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              name="portions"
              label={t.portions}
              inputMode="decimal"
              defaultValue={portions}
              required
              maxLength={20}
              className="tabular"
              error={state.fieldErrors?.portions}
            />
            <Field name="occurredOn" type="date" label={t.date} defaultValue={today} required error={state.fieldErrors?.occurredOn} />
            <Field name="notes" label={t.notes} optionalLabel={m.common.optional} maxLength={500} />
          </div>
          <SubmitButton pendingLabel={m.common.saving} className="self-start">
            {t.submit}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
