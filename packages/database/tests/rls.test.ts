import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { PERMISSION_KEYS } from "@anen/types";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária da organização Alfa
let bruno: string; // convidado
let carla: string; // utilizadora sem relação com Alfa
let alfa: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> => {
  const r = await tx.query<T>(sql, params);
  return r.rows[0] as T;
};
const count = async (tx: Transaction, sql: string, params: unknown[] = []): Promise<number> =>
  (await tx.query(sql, params)).rows.length;

async function roleId(key: string): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from public.roles where organization_id is null and key = $1`, [key]);
  return r.rows[0]!.id;
}
async function memberId(org: string, user: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select id from public.organization_members where organization_id = $1 and user_id = $2`,
    [org, user],
  );
  return r.rows[0]!.id;
}
async function createOrg(user: string, args: Partial<Record<string, string | null>> = {}): Promise<string> {
  return asUser(db, user, async (tx) => {
    const r = await one<{ id: string }>(
      tx,
      `select public.create_organization(
        p_kind => $1::public.organization_kind, p_name => $2, p_country_code => $3, p_currency_code => $4,
        p_timezone => $5, p_tax_id => $6, p_region_id => $7::uuid) as id`,
      [
        args.kind ?? "business",
        args.name ?? "Alfa Obras Lda",
        args.country ?? "PT",
        args.currency ?? "EUR",
        args.timezone ?? "Europe/Lisbon",
        args.taxId ?? null,
        args.regionId ?? null,
      ],
    );
    return r.id;
  });
}
async function invite(user: string, org: string, email: string, role: string): Promise<string> {
  return asUser(db, user, async (tx) => {
    const r = await one<{ token: string }>(tx, `select token from public.invite_member($1, $2, $3)`, [org, email, role]);
    return r.token;
  });
}

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@alfa.pt", { full_name: "Ana Alves" });
  bruno = await createUser(db, "bruno@exemplo.com.br", { full_name: "Bruno Braga", locale: "pt-BR" });
  carla = await createUser(db, "carla@exemplo.pt", { full_name: "Carla Costa" });
});

describe("dados de referência", () => {
  it("são legíveis por anónimos e não editáveis", async () => {
    const countries = await asUser(db, null, (tx) => count(tx, `select * from public.countries`));
    expect(countries).toBe(2);
    const regions = await asUser(db, null, (tx) => count(tx, `select * from public.regions`));
    expect(regions).toBe(30);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.currencies (code, name, symbol, minor_unit) values ('XXX','x','x',2)`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("o catálogo de permissões coincide com @anen/types", async () => {
    const r = await db.query<{ key: string }>(`select key from public.permissions order by key`);
    expect(r.rows.map((x) => x.key)).toEqual([...PERMISSION_KEYS].sort());
  });
});

describe("registo", () => {
  it("cria perfil e preferências conforme o idioma", async () => {
    const prefs = await asUser(db, bruno, (tx) =>
      one<{ language_code: string; currency_code: string; country_code: string }>(
        tx,
        `select language_code, currency_code, country_code from public.user_preferences`,
      ),
    );
    expect(prefs).toEqual({ language_code: "pt-BR", currency_code: "BRL", country_code: "BR" });
    const profile = await asUser(db, bruno, (tx) => one<{ full_name: string }>(tx, `select full_name from public.users_profiles`));
    expect(profile.full_name).toBe("Bruno Braga");
  });

  it("cada utilizador só vê o próprio perfil e preferências", async () => {
    expect(await asUser(db, carla, (tx) => count(tx, `select * from public.users_profiles`))).toBe(1);
    expect(await asUser(db, carla, (tx) => count(tx, `select * from public.user_preferences`))).toBe(1);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.users_profiles`))).rejects.toThrow(/permission denied/);
  });

  it("não é possível alterar o perfil de outra pessoa nem o próprio id", async () => {
    await asUser(db, carla, (tx) => tx.query(`update public.users_profiles set full_name = 'X' where id = $1`, [ana]));
    const r = await db.query<{ full_name: string }>(`select full_name from public.users_profiles where id = $1`, [ana]);
    expect(r.rows[0]!.full_name).toBe("Ana Alves");
    await expect(
      asUser(db, carla, (tx) => tx.query(`update public.users_profiles set id = gen_random_uuid() where id = $1`, [carla])),
    ).rejects.toThrow(/permission denied/);
  });

  it("valida preferências", async () => {
    await expect(asUser(db, carla, (tx) => tx.query(`update public.user_preferences set timezone = 'Marte/Base'`))).rejects.toThrow(/timezone_invalid/);
    await expect(asUser(db, carla, (tx) => tx.query(`update public.user_preferences set currency_code = 'USD'`))).rejects.toThrow(/unsupported_reference/);
  });
});

describe("organizações", () => {
  it("a criadora fica proprietária e com a organização como contexto ativo", async () => {
    alfa = await createOrg(ana, { taxId: "123 456 789" });
    const org = await asUser(db, ana, (tx) => one<{ tax_id: string }>(tx, `select tax_id from public.organizations where id = $1`, [alfa]));
    expect(org.tax_id).toBe("123456789");
    const prefs = await asUser(db, ana, (tx) => one<{ active_organization_id: string }>(tx, `select active_organization_id from public.user_preferences`));
    expect(prefs.active_organization_id).toBe(alfa);
    const member = await asUser(db, ana, (tx) =>
      one<{ key: string }>(tx, `select r.key from public.organization_members m join public.roles r on r.id = m.role_id where m.organization_id = $1`, [alfa]),
    );
    expect(member.key).toBe("owner");
  });

  it("valida número fiscal, região e país no servidor", async () => {
    await expect(createOrg(ana, { taxId: "123456780" })).rejects.toThrow(/tax_id_invalid/);
    const madeira = (await db.query<{ id: string }>(`select id from public.regions where code = 'PT-30'`)).rows[0]!.id;
    await expect(
      createOrg(ana, { country: "BR", currency: "BRL", timezone: "America/Sao_Paulo", regionId: madeira }),
    ).rejects.toThrow(/region_country_mismatch/);
    const br = await createOrg(bruno, {
      name: "Beta Serviços",
      country: "BR",
      currency: "BRL",
      timezone: "America/Sao_Paulo",
      taxId: "12.ABC.345/01DE-35",
    });
    expect(br).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("isola organizações: não-membros e anónimos não veem nada", async () => {
    expect(await asUser(db, carla, (tx) => count(tx, `select * from public.organizations where id = $1`, [alfa]))).toBe(0);
    expect(await asUser(db, carla, (tx) => count(tx, `select * from public.organization_members where organization_id = $1`, [alfa]))).toBe(0);
    expect(await asUser(db, carla, (tx) => count(tx, `select * from public.audit_logs where organization_id = $1`, [alfa]))).toBe(0);
    // Ana não vê a organização do Bruno
    expect(await asUser(db, ana, (tx) => count(tx, `select * from public.organizations where name = 'Beta Serviços'`))).toBe(0);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.organizations`))).rejects.toThrow(/permission denied/);
  });

  it("não-membros não conseguem alterar, inserir-se ou convidar", async () => {
    await asUser(db, carla, (tx) => tx.query(`update public.organizations set name = 'Invadida' where id = $1`, [alfa]));
    expect((await db.query<{ name: string }>(`select name from public.organizations where id = $1`, [alfa])).rows[0]!.name).toBe("Alfa Obras Lda");

    const owner = await roleId("owner");
    await expect(
      asUser(db, carla, (tx) =>
        tx.query(`insert into public.organization_members (organization_id, user_id, role_id) values ($1, $2, $3)`, [alfa, carla, owner]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(invite(carla, alfa, "carla@exemplo.pt", owner)).rejects.toThrow(/forbidden/);
    await expect(
      asUser(db, carla, (tx) => tx.query(`delete from public.organizations where id = $1`, [alfa])),
    ).resolves.toBeDefined();
    expect(await db.query(`select 1 from public.organizations where id = $1`, [alfa]).then((r) => r.rows.length)).toBe(1);
  });

  it("não é possível ativar o contexto de uma organização alheia", async () => {
    await expect(
      asUser(db, carla, (tx) => tx.query(`update public.user_preferences set active_organization_id = $1`, [alfa])),
    ).rejects.toThrow(/forbidden/);
  });

  it("anónimos não chamam RPC de escrita", async () => {
    await expect(
      asUser(db, null, (tx) => tx.query(`select public.create_organization('business', 'X Lda', 'PT', 'EUR', 'Europe/Lisbon')`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("convites e membros", () => {
  let token: string;

  it("convite: só o hash é guardado e o token não é legível", async () => {
    token = await invite(ana, alfa, "Bruno@Exemplo.com.br", await roleId("viewer"));
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`select token_hash from public.organization_invitations`)),
    ).rejects.toThrow(/permission denied/);
    const pending = await asUser(db, ana, (tx) => one<{ email: string }>(tx, `select email from public.organization_invitations where organization_id = $1`, [alfa]));
    expect(pending.email).toBe("bruno@exemplo.com.br");
  });

  it("não permite convite duplicado nem convidar com função acima da própria", async () => {
    await expect(invite(ana, alfa, "bruno@exemplo.com.br", await roleId("viewer"))).rejects.toThrow(/invitation_pending/);
  });

  it("pré-visualização funciona sem sessão; token errado não revela nada", async () => {
    const preview = await asUser(db, null, (tx) => one<{ organization_name: string; role_key: string }>(tx, `select * from public.get_invitation($1)`, [token]));
    expect(preview).toMatchObject({ organization_name: "Alfa Obras Lda", role_key: "viewer" });
    expect(await asUser(db, null, (tx) => count(tx, `select * from public.get_invitation($1)`, ["0".repeat(64)]))).toBe(0);
  });

  it("só o email convidado pode aceitar", async () => {
    await expect(asUser(db, carla, (tx) => tx.query(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/invitation_email_mismatch/);
    const org = await asUser(db, bruno, (tx) => one<{ id: string }>(tx, `select public.accept_invitation($1) as id`, [token]));
    expect(org.id).toBe(alfa);
    await expect(asUser(db, bruno, (tx) => tx.query(`select public.accept_invitation($1)`, [token]))).rejects.toThrow(/invitation_invalid/);
  });

  it("membros veem a organização e os colegas, mas o leitor não vê convites nem auditoria", async () => {
    expect(await asUser(db, bruno, (tx) => count(tx, `select * from public.organizations where id = $1`, [alfa]))).toBe(1);
    expect(await asUser(db, bruno, (tx) => count(tx, `select * from public.users_profiles where id = $1`, [ana]))).toBe(1);
    expect(await asUser(db, bruno, (tx) => count(tx, `select id, email from public.organization_invitations where organization_id = $1`, [alfa]))).toBe(0);
    expect(await asUser(db, bruno, (tx) => count(tx, `select * from public.audit_logs where organization_id = $1`, [alfa]))).toBe(0);
    // Carla continua sem ver perfis de Alfa
    expect(await asUser(db, carla, (tx) => count(tx, `select * from public.users_profiles where id = $1`, [ana]))).toBe(0);
  });

  it("o leitor não altera a organização, não convida e não cria funções", async () => {
    await asUser(db, bruno, (tx) => tx.query(`update public.organizations set name = 'Mudado' where id = $1`, [alfa]));
    expect((await db.query<{ name: string }>(`select name from public.organizations where id = $1`, [alfa])).rows[0]!.name).toBe("Alfa Obras Lda");
    await expect(invite(bruno, alfa, "x@y.pt", await roleId("viewer"))).rejects.toThrow(/forbidden/);
    await expect(
      asUser(db, bruno, (tx) => tx.query(`select public.upsert_role($1, 'Hack', array['members.manage'])`, [alfa])),
    ).rejects.toThrow(/forbidden/);
  });

  it("a proprietária edita a organização", async () => {
    await asUser(db, ana, (tx) => tx.query(`update public.organizations set name = 'Alfa Obras e Remodelações' where id = $1`, [alfa]));
    expect((await db.query<{ name: string }>(`select name from public.organizations where id = $1`, [alfa])).rows[0]!.name).toBe("Alfa Obras e Remodelações");
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.organizations set created_by = $2 where id = $1`, [alfa, bruno])),
    ).rejects.toThrow(/permission denied/);
  });

  it("hierarquia: um administrador não gere a proprietária nem atribui a função de proprietário", async () => {
    const brunoMember = await memberId(alfa, bruno);
    await asUser(db, ana, (tx) => tx.query(`select public.update_member($1, $2, 'active')`, [brunoMember, roleIdCache.admin]));
    const anaMember = await memberId(alfa, ana);
    await expect(
      asUser(db, bruno, (tx) => tx.query(`select public.update_member($1, $2, 'active')`, [anaMember, roleIdCache.viewer])),
    ).rejects.toThrow(/rank_violation/);
    await expect(invite(bruno, alfa, "novo@alfa.pt", roleIdCache.owner)).rejects.toThrow(/rank_violation/);
    await expect(invite(bruno, alfa, "par@alfa.pt", roleIdCache.admin)).rejects.toThrow(/rank_violation/);
    await expect(
      asUser(db, bruno, (tx) => tx.query(`select public.remove_member($1)`, [anaMember])),
    ).rejects.toThrow(/rank_violation/);
    await expect(
      asUser(db, bruno, (tx) => tx.query(`select public.update_member($1, $2, 'active')`, [brunoMember, roleIdCache.owner])),
    ).rejects.toThrow(/forbidden/);
  });

  it("funções personalizadas: não se concede o que não se tem nem acima do próprio nível", async () => {
    await expect(
      asUser(db, bruno, (tx) => tx.query(`select public.upsert_role($1, 'Quase dono', array['organization.delete'])`, [alfa])),
    ).rejects.toThrow(/permission_not_held/);
    await expect(
      asUser(db, bruno, (tx) => tx.query(`select public.upsert_role($1, 'Par', array['members.invite'], null, null, 80)`, [alfa])),
    ).rejects.toThrow(/rank_violation/);
    const role = await asUser(db, bruno, (tx) =>
      one<{ id: string }>(tx, `select public.upsert_role($1, 'Recrutador', array['members.invite'], 'Convida pessoas', null, 50) as id`, [alfa]),
    );
    const perms = await asUser(db, bruno, (tx) => tx.query<{ permission_key: string }>(`select permission_key from public.role_permissions where role_id = $1`, [role.id]));
    expect(perms.rows.map((p) => p.permission_key)).toEqual(["members.invite"]);
    // Carla, de fora, não vê a função personalizada de Alfa
    expect(await asUser(db, carla, (tx) => count(tx, `select * from public.roles where id = $1`, [role.id]))).toBe(0);
    // Função em uso não pode ser eliminada
    await invite(bruno, alfa, "recrutador@alfa.pt", role.id);
    await expect(asUser(db, bruno, (tx) => tx.query(`select public.delete_role($1)`, [role.id]))).rejects.toThrow(/role_in_use/);
  });

  it("funções de outra organização não podem ser atribuídas", async () => {
    const betaRole = await asUser(db, bruno, async (tx) => {
      const beta = await one<{ active_organization_id: string }>(tx, `select o.id as active_organization_id from public.organizations o where o.name = 'Beta Serviços'`);
      return one<{ id: string }>(tx, `select public.upsert_role($1, 'Beta interna', array[]::text[]) as id`, [beta.active_organization_id]);
    });
    await expect(invite(ana, alfa, "z@alfa.pt", betaRole.id)).rejects.toThrow(/role_invalid/);
  });

  it("a organização não fica sem proprietário", async () => {
    const anaMember = await memberId(alfa, ana);
    await expect(asUser(db, ana, (tx) => tx.query(`select public.remove_member($1)`, [anaMember]))).rejects.toThrow(/last_owner/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`select public.update_member($1, $2, 'active')`, [anaMember, roleIdCache.viewer])),
    ).rejects.toThrow(/forbidden/);
  });

  it("auditoria regista as alterações e é visível a quem tem permissão", async () => {
    const r = await asUser(db, ana, (tx) =>
      tx.query<{ entity_type: string; action: string; actor_id: string }>(
        `select entity_type, action, actor_id from public.audit_logs where organization_id = $1`,
        [alfa],
      ),
    );
    const kinds = new Set(r.rows.map((x) => `${x.entity_type}:${x.action}`));
    expect(kinds).toContain("organizations:insert");
    expect(kinds).toContain("organizations:update");
    expect(kinds).toContain("organization_members:update");
    expect(kinds).toContain("organization_invitations:insert");
    expect(r.rows.some((x) => x.actor_id === bruno)).toBe(true);
    const leaked = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_logs where metadata::text like '%token_hash%'`);
    expect(leaked.rows[0]!.n).toBe(0);
    await expect(asUser(db, ana, (tx) => tx.query(`delete from public.audit_logs`))).rejects.toThrow(/permission denied/);
  });

  it("remover um membro retira-lhe o acesso e o contexto ativo", async () => {
    const brunoMember = await memberId(alfa, bruno);
    await asUser(db, bruno, (tx) => tx.query(`update public.user_preferences set active_organization_id = $1`, [alfa]));
    await asUser(db, ana, (tx) => tx.query(`select public.remove_member($1)`, [brunoMember]));
    expect(await asUser(db, bruno, (tx) => count(tx, `select * from public.organizations where id = $1`, [alfa]))).toBe(0);
    const prefs = await asUser(db, bruno, (tx) => one<{ active_organization_id: string | null }>(tx, `select active_organization_id from public.user_preferences`));
    expect(prefs.active_organization_id).toBeNull();
  });

  it("eliminar a organização apaga os dados e preserva a auditoria", async () => {
    await asUser(db, ana, (tx) => tx.query(`delete from public.organizations where id = $1`, [alfa]));
    expect((await db.query(`select 1 from public.organizations where id = $1`, [alfa])).rows.length).toBe(0);
    expect((await db.query(`select 1 from public.organization_members where organization_id = $1`, [alfa])).rows.length).toBe(0);
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_logs where organization_id = $1 and entity_type = 'organizations' and action = 'delete'`, [alfa]);
    expect(audit.rows[0]!.n).toBe(1);
  });
});

const roleIdCache: Record<"owner" | "admin" | "viewer", string> = { owner: "", admin: "", viewer: "" };
beforeAll(async () => {
  roleIdCache.owner = await roleId("owner");
  roleIdCache.admin = await roleId("admin");
  roleIdCache.viewer = await roleId("viewer");
});
