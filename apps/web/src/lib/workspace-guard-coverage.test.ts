import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * QA-03: todas as ações que gravam dados de um workspace começam por guardWorkspace(...) e todos os
 * formulários que chamam ações enviam o workspace que estava no ecrã. Este teste falha se aparecer
 * uma ação nova sem guarda ou um formulário sem o campo.
 */
const root = resolve(__dirname, "..");
const appDir = join(root, "app", "(app)");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Ações da conta ou da plataforma, que não pertencem a um workspace (não precisam de guarda). */
const ACCOUNT_LEVEL = new Set([
  "switchContextAction",
  "createOrganizationAction",
  "updateProfileAction",
  "updatePreferencesAction",
  "updateHiddenModulesAction",
  "acceptInvitationAction",
  "acceptMyInvitationAction",
  "deleteMyAccountAction",
  "openNotificationAction",
  "markNotificationReadAction",
  "markAllNotificationsReadAction",
  "dismissNotificationsAction",
  "saveNotificationSettingsAction",
  "acceptAiConsentAction",
  "runMarketAgentAction",
  "confirmTransferAction", // administrador da plataforma
  "savePushSubscriptionAction", // subscrições de push por aparelho
  "removePushSubscriptionAction",
  "sendTestPushAction",
]);

// actions.ts, push-actions.ts, bank-actions.ts…: qualquer ficheiro de ações do servidor.
const actionFiles = walk(appDir).filter((f) => f.endsWith("actions.ts"));

/** Fim da tag de abertura, ignorando ">" dentro de {…} (por exemplo, "=>" em onSubmit). */
function tagEnd(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return src.length;
}

describe("guarda de workspace nas ações", () => {
  const exported = actionFiles.flatMap((file) => {
    const src = readFileSync(file, "utf8");
    return [...src.matchAll(/export async function (\w+)\(/g)].map((m) => {
      const bodyStart = src.indexOf("{\n", src.indexOf(")", m.index! + m[0].length - 1) - 0);
      // Primeira instrução do corpo da função
      const firstLine = src.slice(bodyStart + 2).split("\n").find((l) => l.trim() !== "") ?? "";
      return { file: relative(root, file), name: m[1]!, firstLine: firstLine.trim() };
    });
  });

  it("encontra as ações (o teste não está vazio)", () => {
    expect(exported.length).toBeGreaterThan(80);
  });

  it("cada ação de workspace começa por guardWorkspace", () => {
    const missing = exported
      .filter((a) => !ACCOUNT_LEVEL.has(a.name))
      .filter((a) => !a.firstLine.startsWith("await guardWorkspace("))
      .map((a) => `${a.file}#${a.name}`);
    expect(missing).toEqual([]);
  });

  it("as ações de conta continuam sem guarda (para não bloquear mudar de contexto, perfil ou notificações)", () => {
    const guarded = exported.filter((a) => ACCOUNT_LEVEL.has(a.name) && a.firstLine.startsWith("await guardWorkspace(")).map((a) => a.name);
    expect(guarded).toEqual([]);
    const names = new Set(exported.map((a) => a.name));
    expect([...ACCOUNT_LEVEL].filter((n) => !names.has(n))).toEqual([]);
  });
});

describe("campo de workspace nos formulários", () => {
  const tsx = [...walk(appDir), ...walk(join(root, "components"))].filter((f) => f.endsWith(".tsx"));

  it("ActionForm e InlineAction incluem o campo automaticamente", () => {
    const forms = readFileSync(join(root, "components", "forms.tsx"), "utf8");
    expect(forms.match(/<WorkspaceField \/>/g)?.length).toBe(2);
  });

  it("cada <form> que chama uma ação de workspace inclui <WorkspaceField />", () => {
    const allowedWithout = /action=\{(switchContextAction|acceptAiConsentAction|openNotificationAction)\}/;
    const offenders: string[] = [];
    for (const file of tsx) {
      if (file.endsWith(join("components", "forms.tsx"))) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<form\b/g)) {
        const tag = src.slice(m.index!, tagEnd(src, m.index!) + 1);
        if (/method="get"/.test(tag) || /action="\//.test(tag) || allowedWithout.test(tag)) continue;
        const after = src.slice(m.index! + tag.length, m.index! + tag.length + 40);
        // (o campo tem de vir logo a seguir à abertura do formulário)
        if (!after.includes("<WorkspaceField />")) offenders.push(`${relative(root, file)}: ${tag.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("as ações chamadas com objetos recebem o workspace do ecrã", () => {
    const callers = ["app/(app)/financas/attachments.tsx", "app/(app)/financas/importar/import-wizard.tsx"];
    for (const c of callers) {
      const src = readFileSync(join(root, c), "utf8");
      const calls = [...src.matchAll(/(prepareAttachmentAction|finishAttachmentAction|previewImportAction|importStatementAction)\(\{\s*workspace:/g)];
      expect(calls.length).toBeGreaterThan(0);
      expect(src).toContain("useWorkspaceKey()");
    }
  });
});
