/** Utilitários de administração para E2E: criar e limpar contas de teste (service role, só em execução). */
const url = () => required("E2E_SUPABASE_URL");
const key = () => required("E2E_SUPABASE_SECRET_KEY");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável ${name} em falta`);
  return value;
}

function headers(): Record<string, string> {
  return { apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": "application/json" };
}

export async function createConfirmedUser(email: string, password: string, fullName: string): Promise<string> {
  const res = await fetch(`${url()}/auth/v1/admin/users`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName, locale: "pt-PT" } }),
  });
  if (!res.ok) throw new Error(`Criar utilizador falhou: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function deleteOrganizationsCreatedBy(userId: string): Promise<void> {
  await fetch(`${url()}/rest/v1/organizations?created_by=eq.${userId}`, { method: "DELETE", headers: headers() });
}

export async function deleteUser(userId: string): Promise<void> {
  await fetch(`${url()}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: headers() });
}

/** Atribui um plano a uma pessoa (âmbito pessoal), como faria um administrador. */
export async function setPersonalPlan(userId: string, plan: "free" | "pro" | "max"): Promise<void> {
  await fetch(`${url()}/rest/v1/subscriptions?owner_user_id=eq.${userId}&status=eq.active`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ status: "canceled" }),
  });
  const res = await fetch(`${url()}/rest/v1/subscriptions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ owner_user_id: userId, plan_key: plan, source: "manual" }),
  });
  if (!res.ok) throw new Error(`Atribuir plano falhou: ${res.status} ${await res.text()}`);
}

/** O ficheiro criado pelo próprio teste ainda existe no Storage? (caminho exato, sem listar o bucket) */
export async function storageObjectExists(bucket: string, path: string): Promise<boolean> {
  const res = await fetch(`${url()}/storage/v1/object/info/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: headers() });
  if (res.status === 200) return true;
  if (res.status === 400 || res.status === 404) return false;
  throw new Error(`Consultar o Storage falhou: ${res.status} ${await res.text()}`);
}
