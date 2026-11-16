"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { Messages } from "@anen/i18n";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from "@anen/validation";
import { InlineAction } from "@/components/forms";
import { Alert, Button } from "@/components/ui";
import { deleteAttachmentAction, finishAttachmentAction, prepareAttachmentAction } from "./actions";

export interface AttachmentItem {
  id: string;
  fileName: string;
  sizeLabel: string;
}

/**
 * Anexos de um movimento. O servidor valida e devolve um URL de envio assinado (com o RLS do
 * Storage a confirmar a permissão); o ficheiro vai direto do browser para o Storage privado.
 */
export function AttachmentsPanel({
  m,
  transactionId,
  items,
  canWrite,
  storage,
}: {
  m: Messages;
  transactionId: string;
  items: AttachmentItem[];
  canWrite: boolean;
  storage: { url: string; key: string };
}) {
  const t = m.finance.attachments;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function upload() {
    setError(null);
    setDone(false);
    const file = input.current?.files?.[0];
    if (!file) return setError(t.missing);
    if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) return setError(t.typeInvalid);
    if (file.size > ATTACHMENT_MAX_BYTES) return setError(t.tooLarge);
    setBusy(true);
    try {
      const prepared = await prepareAttachmentAction({ transactionId, fileName: file.name, mimeType: file.type, size: file.size });
      if (!prepared.ok) return setError(prepared.message);
      const client = createClient(storage.url, storage.key, { auth: { persistSession: false, autoRefreshToken: false } });
      const sent = await client.storage.from("attachments").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      const finished = await finishAttachmentAction({ id: prepared.id, uploaded: !sent.error });
      if (!finished.ok) return setError(finished.message ?? m.errors.generic);
      if (input.current) input.current.value = "";
      setDone(true);
      router.refresh();
    } catch {
      setError(m.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t.hint}</p>
      {items.length === 0 ? (
        <p className="text-sm text-subtle">{t.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M13.5 7.5l-5.6 5.6a1.8 1.8 0 0 1-2.5-2.5L11.6 4.4a3 3 0 0 1 4.2 4.2l-6.4 6.4a4.2 4.2 0 0 1-5.9-5.9L9 3.6" />
              </svg>
              <a href={`/financas/anexos/${a.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-sm hover:text-brand">
                {a.fileName}
              </a>
              <span className="tabular shrink-0 text-xs text-subtle">{a.sizeLabel}</span>
              {canWrite ? (
                <InlineAction action={deleteAttachmentAction} fields={{ id: a.id }} label={t.remove} pendingLabel={m.common.saving} confirmMessage={t.removeConfirm} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="flex flex-col gap-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {done ? <Alert tone="success">{t.uploaded}</Alert> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
              {t.file}
              <input
                ref={input}
                type="file"
                accept={ATTACHMENT_MIME_TYPES.join(",")}
                className="w-full rounded-md border border-line bg-surface p-2 text-sm text-muted file:mr-3 file:rounded file:border-0 file:bg-graphite file:px-3 file:py-1.5 file:text-paper"
              />
            </label>
            <Button type="button" variant="secondary" onClick={upload} disabled={busy} aria-busy={busy}>
              {busy ? m.common.saving : t.upload}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
