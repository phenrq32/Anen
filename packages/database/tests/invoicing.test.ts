import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { asUser, createTestDatabase, createUser } from "../src/index";

let db: PGlite;
let ana: string; // proprietária (finance.write)
let leo: string; // leitor (finance.read)
let eva: string; // funcionária (sem finanças)
let rui: string; // outra organização
let org: string;
let otherOrg: string;
let conn: string;

const one = async <T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> =>
  (await tx.query<T>(sql, params)).rows[0] as T;
const rows = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows;
const id = async (tx: Transaction, sql: string, params: unknown[] = []) => (await one<{ id: string }>(tx, sql, params)).id;

async function invite(email: string, role: string, user: string) {
  const token = await asUser(db, ana, async (tx) => {
    const r = await id(tx, `select id from public.roles where key = $1 and organization_id is null`, [role]);
    return (await one<{ token: string }>(tx, `select token from public.invite_member($1, $2, $3)`, [org, email, r])).token;
  });
  await asUser(db, user, (tx) => tx.query(`select public.accept_invitation($1)`, [token]));
}

const newDoc = (user: string, extra = "") =>
  asUser(db, user, (tx) =>
    id(tx, `insert into public.fiscal_documents (organization_id, connection_id, kind, provider_id, proprietary_uid, client_name, issue_date${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, 'invoice', $3, $4, 'Café Azul', '2026-11-22'${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [
      org,
      conn,
      Math.floor(Math.random() * 1e9),
      randomUUID(),
    ]),
  );

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@fat.pt");
  leo = await createUser(db, "leo@fat.pt");
  eva = await createUser(db, "eva@fat.pt");
  rui = await createUser(db, "rui@fat.pt");
  org = await asUser(db, ana, (tx) => id(tx, `select public.create_organization('business', 'Fatura Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  otherOrg = await asUser(db, rui, (tx) => id(tx, `select public.create_organization('business', 'Outra Lda', 'PT', 'EUR', 'Europe/Lisbon') as id`));
  await invite("leo@fat.pt", "viewer", leo);
  await invite("eva@fat.pt", "employee", eva);
  [conn] = await asUser(db, ana, async (tx) => [
    await id(tx, `insert into public.invoicing_connections (organization_id, account_name, api_key_ciphertext, api_key_hint) values ($1, 'faturalda', 'v1.aaaaaaaaaaaaaaaa.bbbb.cccc', 'x9k2') returning id`, [org]),
    await id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'Café Azul') returning id`, [org]),
  ]);
});

describe("ligação ao InvoiceXpress", () => {
  it("uma por organização; só finanças leem; quem não tem finanças, outra organização e anónimos não", async () => {
    expect(await asUser(db, leo, (tx) => rows(tx, `select account_name, api_key_hint from public.invoicing_connections`))).toEqual([{ account_name: "faturalda", api_key_hint: "x9k2" }]);
    expect(await asUser(db, eva, (tx) => rows(tx, `select id from public.invoicing_connections`))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.invoicing_connections where organization_id = $1`, [org]))).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.invoicing_connections`))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.invoicing_connections (organization_id, account_name, api_key_ciphertext, api_key_hint) values ($1, 'segunda', 'v1.aaaaaaaaaaaaaaaa.b.c', 'abcd')`, [org])),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      asUser(db, leo, (tx) => tx.query(`insert into public.invoicing_connections (organization_id, account_name, api_key_ciphertext, api_key_hint) values ($1, 'x', 'v1.aaaaaaaaaaaaaaaa.b.c', 'abcd')`, [org])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, ana, (tx) => tx.query(`update public.invoicing_connections set account_name = 'conta.evil.com' where id = $1`, [conn])),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("documentos fiscais", () => {
  let doc: string;

  it("rascunho com linhas; o leitor vê mas não escreve; sem finanças não vê", async () => {
    doc = await newDoc(ana);
    await asUser(db, ana, (tx) =>
      tx.query(`insert into public.fiscal_document_lines (document_id, position, name, quantity, unit_price_minor, tax_name, tax_percent) values ($1, 0, 'Serviço', 2, 5000, 'IVA23', 23)`, [doc]),
    );
    expect(await asUser(db, leo, (tx) => rows(tx, `select name from public.fiscal_document_lines where document_id = $1`, [doc]))).toEqual([{ name: "Serviço" }]);
    expect(await asUser(db, eva, (tx) => rows(tx, `select id from public.fiscal_documents`))).toHaveLength(0);
    expect(await asUser(db, eva, (tx) => rows(tx, `select id from public.fiscal_document_lines`))).toHaveLength(0);
    await expect(newDoc(leo)).rejects.toThrow(/row-level security/);
    expect(await asUser(db, leo, (tx) => rows(tx, `update public.fiscal_documents set client_name = 'x' where id = $1 returning id`, [doc]))).toHaveLength(0);
    expect(await asUser(db, rui, (tx) => rows(tx, `select id from public.fiscal_documents where id = $1`, [doc]))).toHaveLength(0);
  });

  it("não aceita ligação, cliente ou documento de origem de outra organização", async () => {
    const ruiConn = await asUser(db, rui, (tx) =>
      id(tx, `insert into public.invoicing_connections (organization_id, account_name, api_key_ciphertext, api_key_hint) values ($1, 'outra', 'v1.aaaaaaaaaaaaaaaa.b.c', 'abcd') returning id`, [otherOrg]),
    );
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.fiscal_documents (organization_id, connection_id, kind, provider_id, proprietary_uid, client_name, issue_date) values ($1, $2, 'invoice', 1, $3, 'x', '2026-11-22')`, [org, ruiConn, randomUUID()])),
    ).rejects.toThrow(/invoicing_not_connected/);
    const ruiClient = await asUser(db, rui, (tx) => id(tx, `insert into public.contacts (organization_id, kind, name) values ($1, 'client', 'X') returning id`, [otherOrg]));
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.fiscal_documents (organization_id, connection_id, kind, provider_id, proprietary_uid, client_name, issue_date, contact_id) values ($1, $2, 'invoice', 2, $3, 'x', '2026-11-22', $4)`, [org, conn, randomUUID(), ruiClient])),
    ).rejects.toThrow(/contact_invalid/);
    // Nota de crédito só a partir de uma fatura emitida.
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.fiscal_documents (organization_id, connection_id, kind, provider_id, proprietary_uid, client_name, issue_date, owner_document_id) values ($1, $2, 'credit_note', 3, $3, 'x', '2026-11-22', $4)`, [org, conn, randomUUID(), doc])),
    ).rejects.toThrow(/fiscal_document_invalid/);
    // Guia sem local de carga/descarga.
    await expect(
      asUser(db, ana, (tx) => tx.query(`insert into public.fiscal_documents (organization_id, connection_id, kind, provider_id, proprietary_uid, client_name, issue_date) values ($1, $2, 'transport', 4, $3, 'x', '2026-11-22')`, [org, conn, randomUUID()])),
    ).rejects.toThrow(/fiscal_documents_guide/);
  });

  it("depois de emitido, o conteúdo não muda; só anular com motivo", async () => {
    await asUser(db, ana, (tx) =>
      tx.query(`update public.fiscal_documents set status = 'final', sequence_number = 'FT 2026/1', atcud = 'ABCD-1', total_minor = 12300 where id = $1`, [doc]),
    );
    const final = await asUser(db, ana, (tx) => one<{ finalized_at: string | null }>(tx, `select finalized_at from public.fiscal_documents where id = $1`, [doc]));
    expect(final.finalized_at).not.toBeNull();
    for (const set of ["client_name = 'Outro'", "total_minor = 1", "atcud = 'X'", "issue_date = '2026-11-01'"]) {
      await expect(asUser(db, ana, (tx) => tx.query(`update public.fiscal_documents set ${set} where id = $1`, [doc]))).rejects.toThrow(/fiscal_document_locked/);
    }
    await expect(asUser(db, ana, (tx) => tx.query(`update public.fiscal_document_lines set quantity = 9 where document_id = $1`, [doc]))).rejects.toThrow(/fiscal_document_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`delete from public.fiscal_document_lines where document_id = $1`, [doc]))).rejects.toThrow(/fiscal_document_locked/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.fiscal_documents set status = 'draft' where id = $1`, [doc]))).rejects.toThrow(/fiscal_status_invalid/);
    await expect(asUser(db, ana, (tx) => tx.query(`update public.fiscal_documents set status = 'canceled' where id = $1`, [doc]))).rejects.toThrow(/fiscal_status_invalid/);
    // Emitido não se apaga.
    expect(await asUser(db, ana, (tx) => rows(tx, `delete from public.fiscal_documents where id = $1 returning id`, [doc]))).toHaveLength(0);
    await asUser(db, ana, (tx) => tx.query(`update public.fiscal_documents set status = 'canceled', cancel_reason = 'NIF errado' where id = $1`, [doc]));
    expect(await asUser(db, leo, (tx) => rows(tx, `select status, cancel_reason from public.fiscal_documents where id = $1`, [doc]))).toEqual([{ status: "canceled", cancel_reason: "NIF errado" }]);
  });

  it("rascunhos apagam-se (com as linhas)", async () => {
    const draft = await newDoc(ana);
    await asUser(db, ana, (tx) => tx.query(`insert into public.fiscal_document_lines (document_id, position, name, quantity, unit_price_minor) values ($1, 0, 'x', 1, 1)`, [draft]));
    expect(await asUser(db, ana, (tx) => rows(tx, `delete from public.fiscal_documents where id = $1 returning id`, [draft]))).toHaveLength(1);
    expect(await asUser(db, ana, (tx) => rows(tx, `select id from public.fiscal_document_lines where document_id = $1`, [draft]))).toHaveLength(0);
  });

  it("desligar a conta mantém os documentos; apagar a organização apaga tudo", async () => {
    await asUser(db, ana, (tx) => tx.query(`delete from public.invoicing_connections where id = $1`, [conn]));
    expect(await asUser(db, ana, (tx) => rows(tx, `select connection_id from public.fiscal_documents where id = $1`, [doc]))).toEqual([{ connection_id: null }]);
    await db.query(`delete from public.organizations where id = $1`, [org]);
    expect(Number((await db.query<{ n: number }>(`select count(*)::int as n from public.fiscal_documents where organization_id = $1`, [org])).rows[0]!.n)).toBe(0);
  });
});
