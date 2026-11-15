import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-ink hover:bg-brand-hover font-semibold",
  secondary: "bg-graphite text-paper border border-line hover:border-graphite-soft hover:bg-[#262626]",
  ghost: "text-muted hover:text-paper hover:bg-graphite",
  danger: "text-danger border border-line hover:border-danger/60 hover:bg-danger/10",
};
const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 h-11 text-sm transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";

export function buttonClass(variant: Variant = "primary", extra?: string): string {
  return cx(base, variants[variant], extra);
}

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

const inputClass =
  "w-full h-11 rounded-md bg-surface border border-line px-3.5 text-[15px] text-paper placeholder:text-subtle transition-colors hover:border-graphite-soft focus:border-brand focus:outline-none aria-[invalid=true]:border-danger";

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optionalLabel?: string | undefined;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, optionalLabel, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-paper">
        {label}
        {optionalLabel ? <span className="ml-1.5 font-normal text-subtle">({optionalLabel})</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type FieldProps = Omit<ComponentProps<"input">, "id"> & {
  name: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optionalLabel?: string | undefined;
};

export function Field({ name, label, hint, error, optionalLabel, className, ...props }: FieldProps) {
  const id = `f-${name}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(inputClass, className)}
        {...props}
      />
    </FieldShell>
  );
}

type SelectProps = Omit<ComponentProps<"select">, "id"> & {
  name: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optionalLabel?: string | undefined;
  options: ReadonlyArray<{ value: string; label: string }>;
};

export function SelectField({ name, label, hint, error, optionalLabel, options, className, ...props }: SelectProps) {
  const id = `f-${name}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optionalLabel={optionalLabel}>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(inputClass, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path d=%22M2 4l4 4 4-4%22 fill=%22none%22 stroke=%22%23A3A3A3%22 stroke-width=%221.5%22/></svg>')] bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-10", className)}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-danger/40 bg-danger/10 text-[#FFB3B3]",
    success: "border-success/40 bg-success/10 text-[#A6F0C9]",
    info: "border-line bg-graphite text-muted",
  } as const;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-4 py-3 text-sm leading-relaxed", tones[tone])}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold sm:text-[28px]">{title}</h1>
        {description ? <p className="max-w-2xl text-[15px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "danger" }) {
  const tones = {
    neutral: "bg-graphite text-muted border-line",
    brand: "bg-brand/10 text-brand border-brand/30",
    danger: "bg-danger/10 text-danger border-danger/30",
  } as const;
  return <span className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 104" role="img" aria-label="ANEN" className={className}>
      <polyline points="6,90 36,58 58,76" fill="none" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="58" y1="76" x2="99" y2="25" stroke="#FF851B" strokeWidth="12" strokeLinecap="round" />
      <polygon points="112,10 106.7,34.5 88.5,18.9" fill="#FF851B" />
      <g transform="translate(150,0)" fill="#FFFFFF">
        <polygon points="0,100 28,0 46,0 74,100 55,100 37,34 19,100" />
        <rect x="96" y="0" width="18" height="100" />
        <rect x="150" y="0" width="18" height="100" />
        <polygon points="96,0 114,0 168,100 150,100" />
        <rect x="190" y="0" width="62" height="18" />
        <rect x="206" y="41" width="46" height="18" fill="#FF851B" />
        <rect x="190" y="82" width="62" height="18" />
        <rect x="274" y="0" width="18" height="100" />
        <rect x="328" y="0" width="18" height="100" />
        <polygon points="274,0 292,0 346,100 328,100" />
      </g>
    </svg>
  );
}
