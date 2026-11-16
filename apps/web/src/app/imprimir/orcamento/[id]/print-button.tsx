"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="h-10 rounded-md bg-[#111] px-4 text-sm font-semibold text-white hover:bg-[#333]">
      {label}
    </button>
  );
}
