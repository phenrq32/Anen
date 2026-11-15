"use client";

import Link from "next/link";
import type { Messages } from "@anen/i18n";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field } from "@/components/ui";
import {
  forgotPasswordAction,
  resetPasswordAction,
  signInAction,
  signInWithGoogleAction,
  signUpAction,
} from "./actions";

function GoogleButton({ m, next }: { m: Messages; next: string }) {
  return (
    <ActionForm action={signInWithGoogleAction} className="gap-3">
      {() => (
        <>
          <input type="hidden" name="next" value={next} />
          <SubmitButton variant="secondary" pendingLabel={m.common.loading} className="w-full">
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
              <path fill="#fff" d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.24c1.9-1.75 2.96-4.33 2.96-7.34Z" />
              <path fill="#fff" opacity=".75" d="M12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.5c-.9.6-2.05.95-3.4.95-2.6 0-4.82-1.76-5.6-4.13H3.06v2.58A10 10 0 0 0 12 22Z" />
              <path fill="#fff" opacity=".55" d="M6.4 13.89a6 6 0 0 1 0-3.78V7.53H3.06a10 10 0 0 0 0 8.94l3.34-2.58Z" />
              <path fill="#fff" opacity=".9" d="M12 5.98c1.47 0 2.8.5 3.84 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.94 5.53l3.34 2.58C7.18 7.74 9.4 5.98 12 5.98Z" />
            </svg>
            {m.auth.signIn.google}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function SignInForm({ m, next, googleEnabled, notice }: { m: Messages; next: string; googleEnabled: boolean; notice?: string }) {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-[26px] font-bold">{m.auth.signIn.title}</h1>
      </header>
      {notice ? <Alert tone="error">{notice}</Alert> : null}
      <ActionForm action={signInAction}>
        {(state) => (
          <>
            <input type="hidden" name="next" value={next} />
            <Field name="email" type="email" label={m.auth.signIn.email} autoComplete="email" required error={state.fieldErrors?.email} />
            <Field
              name="password"
              type="password"
              label={m.auth.signIn.password}
              autoComplete="current-password"
              required
              error={state.fieldErrors?.password}
            />
            <div className="-mt-2 text-right">
              <Link href="/recuperar-acesso" className="text-sm text-muted hover:text-paper">
                {m.auth.signIn.forgot}
              </Link>
            </div>
            <SubmitButton pendingLabel={m.common.loading} className="w-full">
              {m.auth.signIn.submit}
            </SubmitButton>
          </>
        )}
      </ActionForm>
      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-subtle">
            <span className="h-px flex-1 bg-line" />
            {m.auth.signIn.or}
            <span className="h-px flex-1 bg-line" />
          </div>
          <GoogleButton m={m} next={next} />
        </>
      ) : null}
      <p className="text-sm text-muted">
        {m.auth.signIn.noAccount}{" "}
        <Link href={`/criar-conta${next !== "/painel" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-brand hover:underline">
          {m.auth.signIn.createAccount}
        </Link>
      </p>
    </div>
  );
}

export function SignUpForm({ m, next, googleEnabled }: { m: Messages; next: string; googleEnabled: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[26px] font-bold">{m.auth.signUp.title}</h1>
        <p className="text-muted">{m.auth.signUp.subtitle}</p>
      </header>
      <ActionForm action={signUpAction}>
        {(state) =>
          state.status === "success" ? null : (
            <>
              <input type="hidden" name="next" value={next} />
              <Field name="fullName" label={m.auth.signUp.fullName} autoComplete="name" required error={state.fieldErrors?.fullName} />
              <Field name="email" type="email" label={m.auth.signUp.email} autoComplete="email" required error={state.fieldErrors?.email} />
              <Field
                name="password"
                type="password"
                label={m.auth.signUp.password}
                autoComplete="new-password"
                hint={m.auth.signUp.passwordHint}
                required
                error={state.fieldErrors?.password}
              />
              <div className="flex flex-col gap-1">
                <label className="flex items-start gap-3 text-sm text-muted">
                  <input type="checkbox" name="acceptTerms" className="mt-0.5 size-4 accent-[#FF851B]" aria-invalid={state.fieldErrors?.acceptTerms ? true : undefined} />
                  {m.auth.signUp.acceptTerms}
                </label>
                {state.fieldErrors?.acceptTerms ? <p className="text-[13px] text-danger">{state.fieldErrors.acceptTerms}</p> : null}
              </div>
              <SubmitButton pendingLabel={m.common.loading} className="w-full">
                {m.auth.signUp.submit}
              </SubmitButton>
            </>
          )
        }
      </ActionForm>
      {googleEnabled ? <GoogleButton m={m} next={next} /> : null}
      <p className="text-sm text-muted">
        {m.auth.signUp.haveAccount}{" "}
        <Link href="/entrar" className="font-medium text-brand hover:underline">
          {m.auth.signUp.signIn}
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordForm({ m }: { m: Messages }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[26px] font-bold">{m.auth.forgot.title}</h1>
        <p className="text-muted">{m.auth.forgot.subtitle}</p>
      </header>
      <ActionForm action={forgotPasswordAction}>
        {(state) =>
          state.status === "success" ? null : (
            <>
              <Field name="email" type="email" label={m.auth.signIn.email} autoComplete="email" required error={state.fieldErrors?.email} />
              <SubmitButton pendingLabel={m.common.loading} className="w-full">
                {m.auth.forgot.submit}
              </SubmitButton>
            </>
          )
        }
      </ActionForm>
      <Link href="/entrar" className="text-sm text-muted hover:text-paper">
        ← {m.auth.forgot.back}
      </Link>
    </div>
  );
}

export function ResetPasswordForm({ m }: { m: Messages }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[26px] font-bold">{m.auth.reset.title}</h1>
        <p className="text-muted">{m.auth.reset.subtitle}</p>
      </header>
      <ActionForm action={resetPasswordAction}>
        {(state) => (
          <>
            <Field
              name="password"
              type="password"
              label={m.auth.reset.password}
              autoComplete="new-password"
              hint={m.auth.signUp.passwordHint}
              required
              error={state.fieldErrors?.password}
            />
            <Field
              name="confirmPassword"
              type="password"
              label={m.auth.reset.confirm}
              autoComplete="new-password"
              required
              error={state.fieldErrors?.confirmPassword}
            />
            <SubmitButton pendingLabel={m.common.saving} className="w-full">
              {m.auth.reset.submit}
            </SubmitButton>
          </>
        )}
      </ActionForm>
    </div>
  );
}
