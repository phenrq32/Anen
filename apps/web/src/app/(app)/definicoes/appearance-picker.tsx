"use client";

import { useEffect, useState } from "react";
import type { Messages } from "@anen/i18n";
import { cx } from "@/components/ui";
import { clientCookie, TEXT_COOKIE, TEXT_SIZES, THEME_COOKIE, THEMES, TOUR_COOKIE, type TextSize, type Theme } from "@/lib/appearance";

/** Tema e tamanho do texto: escolhas grandes e visuais, aplicadas na hora e guardadas neste aparelho. */
export function AppearancePicker({ m, theme, text }: { m: Messages; theme: Theme; text: TextSize }) {
  const t = m.settings.appearance;
  const [current, setCurrent] = useState({ theme, text });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(id);
  }, [saved]);

  const apply = (next: { theme: Theme; text: TextSize }) => {
    document.documentElement.dataset.theme = next.theme;
    document.documentElement.dataset.text = next.text;
    document.cookie = clientCookie(THEME_COOKIE, next.theme);
    document.cookie = clientCookie(TEXT_COOKIE, next.text);
    setCurrent(next);
    setSaved(true);
  };

  const swatch: Record<Theme, string> = {
    dark: "bg-[linear-gradient(135deg,#090909_0%,#202020_100%)]",
    light: "bg-[linear-gradient(135deg,#f5f4f1_0%,#ffffff_100%)]",
    system: "bg-[linear-gradient(135deg,#090909_0%,#090909_50%,#f5f4f1_50%,#f5f4f1_100%)]",
  };
  const sample: Record<TextSize, string> = { normal: "text-[15px]", large: "text-[17px]", xlarge: "text-[19px]" };

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[15px] font-semibold">{t.theme}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {THEMES.map((th) => (
            <label
              key={th}
              className={cx(
                "lift flex cursor-pointer flex-col gap-3 rounded-2xl border p-3 transition-colors",
                current.theme === th ? "border-brand bg-brand/10" : "glass spot",
              )}
            >
              <input
                type="radio"
                name="theme"
                value={th}
                checked={current.theme === th}
                onChange={() => apply({ ...current, theme: th })}
                className="sr-only"
              />
              <span className={cx("relative h-20 overflow-hidden rounded-xl border border-line", swatch[th])} aria-hidden>
                <span className="absolute left-3 top-3 h-2 w-14 rounded-full bg-brand" />
                <span className={cx("absolute left-3 top-7 h-2 w-20 rounded-full", th === "light" ? "bg-[#dedad4]" : "bg-[#353535]")} />
                <span className="absolute bottom-3 right-3 h-6 w-12 rounded-md bg-brand" />
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{t.themes[th]}</span>
                {current.theme === th ? <span className="text-xs font-semibold text-brand">✓ {t.selected}</span> : null}
              </span>
              <span className="text-xs text-subtle">{t.themeHints[th]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[15px] font-semibold">{t.text}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {TEXT_SIZES.map((sz) => (
            <label
              key={sz}
              className={cx(
                "lift flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition-colors",
                current.text === sz ? "border-brand bg-brand/10" : "glass spot",
              )}
            >
              <input
                type="radio"
                name="text"
                value={sz}
                checked={current.text === sz}
                onChange={() => apply({ ...current, text: sz })}
                className="sr-only"
              />
              <span className={cx("font-heading font-bold", sample[sz])} aria-hidden>Aa</span>
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{t.texts[sz]}</span>
                {current.text === sz ? <span className="text-xs font-semibold text-brand">✓ {t.selected}</span> : null}
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-subtle">{t.textHint}</p>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p role="status" aria-live="polite" className={cx("text-sm transition-opacity", saved ? "text-success opacity-100" : "opacity-0")}>
          ✓ {t.saved}
        </p>
        <button
          type="button"
          onClick={() => {
            document.cookie = clientCookie(TOUR_COOKIE, "");
            window.location.assign("/painel?tour=1");
          }}
          className="h-11 rounded-lg border border-line px-4 text-[15px] text-muted transition-colors hover:border-brand/40 hover:text-paper"
        >
          {t.tourAgain}
        </button>
      </div>
    </div>
  );
}
