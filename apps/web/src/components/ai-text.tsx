import type { ReactNode } from "react";

/** Markdown mínimo e seguro (sem HTML): **negrito**, listas com "- " ou "* " e parágrafos. */
export function AiText({ text }: { text: string }) {
  const inline = (line: string, key: string): ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
      chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4 ? <strong key={`${key}-${i}`}>{chunk.slice(2, -2)}</strong> : chunk,
    );
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${k}`} className="ml-5 list-disc space-y-1">
          {list.map((l, i) => <li key={i}>{inline(l, `li-${k}-${i}`)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const item = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (item) {
      list.push(item[1]!);
      return;
    }
    flush(i);
    if (!line.trim()) return;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      <p key={i} className={heading ? "font-semibold" : undefined}>
        {inline(heading ? heading[1]! : line, `p-${i}`)}
      </p>,
    );
  });
  flush(-1);
  return <div className="flex flex-col gap-2 break-words text-[15px] leading-relaxed">{blocks}</div>;
}
