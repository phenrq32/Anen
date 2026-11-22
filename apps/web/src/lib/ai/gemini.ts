import "server-only";

/**
 * Adaptador do Google Gemini (API REST generateContent), sem SDK.
 * - Lista de modelos com recurso automático: se um estiver sobrecarregado (429/5xx), demorar demais
 *   ou já não existir (404), tenta o seguinte. Configurável em GEMINI_MODELS (separados por vírgula).
 * - As partes devolvidas pelo modelo são reenviadas tal como vieram (os modelos 3.x exigem o
 *   `thoughtSignature` de volta junto da chamada de função).
 * O fornecedor fica isolado aqui: trocar de IA é trocar este ficheiro e as variáveis de ambiente.
 */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerateResult {
  content: GeminiContent;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class AiUnavailableError extends Error {
  constructor(message = "ai_unavailable") {
    super(message);
  }
}

const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"];
const TIMEOUT_MS = 45_000;

export function geminiConfig(): { apiKey: string; models: string[] } | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const models = (process.env.GEMINI_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^[a-z0-9.-]+$/.test(m));
  return { apiKey, models: models.length ? models : DEFAULT_MODELS };
}

interface ApiResponse {
  candidates?: { content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string };
}

export async function generate(input: {
  system: string;
  contents: GeminiContent[];
  tools: FunctionDeclaration[];
  apiKey: string;
  models: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<GenerateResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: input.system }] },
    contents: input.contents,
    tools: input.tools.length ? [{ functionDeclarations: input.tools }] : undefined,
    generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } },
  });
  let lastError = "";
  for (const model of input.models) {
    let res: Response;
    try {
      res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
        body,
        signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (e) {
      lastError = `${model}: ${e instanceof Error ? e.name : "erro de rede"}`;
      continue; // tempo esgotado ou rede: tenta o próximo modelo
    }
    if (res.status === 429 || res.status === 404 || res.status >= 500) {
      lastError = `${model}: HTTP ${res.status}`;
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as ApiResponse;
    if (!res.ok || data.error) {
      throw new AiUnavailableError(`gemini ${res.status}: ${data.error?.message?.slice(0, 200) ?? ""}`);
    }
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const usage = data.usageMetadata ?? {};
    return {
      content: { role: "model", parts },
      model,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    };
  }
  throw new AiUnavailableError(lastError || "sem modelos");
}

/** Texto final visível (sem os "pensamentos" do modelo). */
export function visibleText(content: GeminiContent): string {
  return content.parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
}
