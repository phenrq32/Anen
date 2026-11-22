"use client";

import { useState } from "react";
import type { Messages } from "@anen/i18n";
import { cx } from "@/components/ui";
import { A11Y_ATTR, A11Y_COOKIE, A11Y_OPTIONS, serializeA11y, type A11yOption } from "@/lib/a11y";
import { clientCookie } from "@/lib/appearance";

/** Interruptores de acessibilidade: aplicam-se na hora e ficam guardados neste aparelho. */
export function A11yPicker({ m, initial }: { m: Messages; initial: A11yOption[] }) {
  const t = m.settings.a11y;
  const [on, setOn] = useState(() => new Set(initial));
  const [saved, setSaved] = useState(false);

  const toggle = (o: A11yOption) => {
    const next = new Set(on);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    const { attr, on: value } = A11Y_ATTR[o];
    if (next.has(o)) document.documentElement.setAttribute(`data-${attr}`, value);
    else document.documentElement.removeAttribute(`data-${attr}`);
    document.cookie = clientCookie(A11Y_COOKIE, serializeA11y(next));
    setOn(next);
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface/80">
        {A11Y_OPTIONS.map((o) => {
          const checked = on.has(o);
          return (
            <li key={o}>
              <label className="relative flex min-h-16 cursor-pointer items-center gap-4 px-4 py-3 hover:bg-graphite/40">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">{t.options[o].title}</span>
                  <span className="text-sm text-subtle">{t.options[o].hint}</span>
                </span>
                <input type="checkbox" role="switch" checked={checked} onChange={() => toggle(o)} className="peer sr-only" />
                <span
                  aria-hidden
                  className={cx(
                    "relative h-7 w-12 shrink-0 rounded-full border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand",
                    checked ? "border-brand bg-brand" : "border-line bg-graphite",
                  )}
                >
                  <span className={cx("absolute top-0.5 size-5.5 rounded-full bg-paper shadow transition-transform", checked ? "translate-x-5.5 bg-on-brand" : "translate-x-0.5")} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className={cx("text-sm transition-opacity", saved ? "text-success opacity-100" : "opacity-0")}>
        ✓ {m.settings.appearance.saved}
      </p>
    </div>
  );
}
