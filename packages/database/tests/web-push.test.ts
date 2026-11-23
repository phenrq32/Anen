import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser } from "../src/index";

// Notificações push (migration 2400).
let db: PGlite;
let ana: string;
let rui: string;
let secret: string;

const subscribe = (user: string, endpoint: string) =>
  asUser(db, user, (tx) =>
    tx.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4) returning id`, [
      user,
      endpoint,
      "B".repeat(87),
      "a".repeat(22),
    ]),
  );
const notify = (user: string, key: string) =>
  db.query(`insert into public.notifications (user_id, kind, data, link, dedupe_key) values ($1, 'market_alert', '{"series":"IPC"}', '/mercado', $2)`, [user, key]);

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db, "ana@push.pt");
  rui = await createUser(db, "rui@push.pt");
  secret = (await db.query<{ value: string }>(`select value from private.app_secrets where key = 'push_dispatch'`)).rows[0]!.value;
});

describe("inscrições push", () => {
  it("cada pessoa vê e apaga só as suas; endereço https obrigatório; anónimos não", async () => {
    await subscribe(ana, "https://push.example/ana-1");
    await expect(subscribe(rui, "http://push.example/x")).rejects.toThrow(/check/);
    await expect(asUser(db, rui, (tx) => tx.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x/y', $2, $3)`, [ana, "B".repeat(87), "a".repeat(22)]))).rejects.toThrow(/row-level security/);
    expect((await asUser(db, rui, (tx) => tx.query(`select id from public.push_subscriptions`))).rows).toHaveLength(0);
    expect((await asUser(db, rui, (tx) => tx.query(`delete from public.push_subscriptions returning id`))).rows).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.push_subscriptions`))).rejects.toThrow(/permission denied/);
  });
});

describe("envio", () => {
  it("só com o segredo; cada notificação sai uma vez para cada aparelho da pessoa", async () => {
    await subscribe(ana, "https://push.example/ana-2");
    await notify(ana, "p1");
    await notify(rui, "p2"); // o Rui não tem aparelhos: não é escolhida
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.push_claim_batch('errado')`))).rejects.toThrow(/forbidden/);
    const first = await asUser(db, null, (tx) => tx.query<{ endpoint: string; language_code: string }>(`select * from public.push_claim_batch($1)`, [secret]));
    expect(first.rows.map((r) => r.endpoint).sort()).toEqual(["https://push.example/ana-1", "https://push.example/ana-2"]);
    expect(first.rows[0]!.language_code).toBe("pt-PT");
    const again = await asUser(db, null, (tx) => tx.query(`select * from public.push_claim_batch($1)`, [secret]));
    expect(again.rows).toHaveLength(0);
  });

  it("lidas, apagadas e antigas não saem", async () => {
    await notify(ana, "p3");
    await notify(ana, "p4");
    await notify(ana, "p5");
    await db.query(`update public.notifications set read_at = now() where dedupe_key = 'p3'`);
    await db.query(`update public.notifications set dismissed_at = now() where dedupe_key = 'p4'`);
    await db.query(`update public.notifications set created_at = now() - interval '3 days' where dedupe_key = 'p5'`);
    expect((await asUser(db, null, (tx) => tx.query(`select * from public.push_claim_batch($1)`, [secret]))).rows).toHaveLength(0);
  });

  it("aparelho que já não existe (410) é apagado; 5 falhas seguidas também", async () => {
    const ids = (await db.query<{ id: string }>(`select id from public.push_subscriptions where user_id = $1 order by endpoint`, [ana])).rows.map((r) => r.id);
    await asUser(db, null, (tx) => tx.query(`select public.push_report($1, $2, false, true)`, [secret, ids[0]]));
    for (let i = 0; i < 5; i++) await asUser(db, null, (tx) => tx.query(`select public.push_report($1, $2, false, false)`, [secret, ids[1]]));
    expect((await db.query(`select id from public.push_subscriptions where user_id = $1`, [ana])).rows).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select public.push_report('x', $1, true)`, [ids[0]]))).rejects.toThrow(/forbidden/);
  });

  it("o segredo não é legível por ninguém da aplicação", async () => {
    await expect(asUser(db, ana, (tx) => tx.query(`select value from private.app_secrets`))).rejects.toThrow(/permission denied/);
  });
});
