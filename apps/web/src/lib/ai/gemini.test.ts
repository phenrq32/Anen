import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { AiUnavailableError, generate, visibleText } = await import("./gemini");

const ok = (parts: unknown[]) =>
  new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3 } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("adaptador Gemini", () => {
  it("passa ao modelo seguinte quando um está sobrecarregado, indisponível ou demora", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u.split("/models/")[1]!.split(":")[0]!);
      if (u.includes("modelo-a")) return new Response("{}", { status: 503 });
      if (u.includes("modelo-b")) throw new DOMException("timeout", "TimeoutError");
      if (u.includes("modelo-c")) return new Response("{}", { status: 404 });
      return ok([{ text: "Olá" }]);
    }) as unknown as typeof fetch;
    const r = await generate({ system: "s", contents: [], tools: [], apiKey: "k", models: ["modelo-a", "modelo-b", "modelo-c", "modelo-d"], fetchImpl });
    expect(calls).toEqual(["modelo-a", "modelo-b", "modelo-c", "modelo-d"]);
    expect(r.model).toBe("modelo-d");
    expect(r.inputTokens).toBe(10);
    expect(r.outputTokens).toBe(8);
    expect(visibleText(r.content)).toBe("Olá");
  });

  it("falha clara quando nenhum modelo responde; erro do pedido não tenta outro", async () => {
    const busy = vi.fn(async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(generate({ system: "s", contents: [], tools: [], apiKey: "k", models: ["a", "b"], fetchImpl: busy })).rejects.toBeInstanceOf(AiUnavailableError);
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 })) as unknown as typeof fetch;
    await expect(generate({ system: "s", contents: [], tools: [], apiKey: "k", models: ["a", "b"], fetchImpl: bad })).rejects.toThrow(/API key/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("mantém a assinatura de pensamento e esconde os pensamentos do texto", async () => {
    const fetchImpl = vi.fn(async () =>
      ok([{ thought: true, text: "a pensar" }, { functionCall: { name: "pendentes", args: { tipo: "todos" } }, thoughtSignature: "SIG" }, { text: "Resposta" }]),
    ) as unknown as typeof fetch;
    const r = await generate({ system: "s", contents: [], tools: [], apiKey: "k", models: ["m"], fetchImpl });
    expect(r.content.parts[1]).toEqual({ functionCall: { name: "pendentes", args: { tipo: "todos" } }, thoughtSignature: "SIG" });
    expect(visibleText(r.content)).toBe("Resposta");
  });
});
