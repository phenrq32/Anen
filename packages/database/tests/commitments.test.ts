import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { occurrenceDate, type Frequency } from "@anen/financial-engine";
import { createTestDatabase } from "../src/index";

/**
 * Paridade: as ocorrências futuras que a interface mostra (motor) são as que o servidor vai gerar
 * (materialize_recurring usa start_on + passo × k).
 */
let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

describe("ocorrências de recorrentes: motor = Postgres", () => {
  const starts = ["2026-01-31", "2026-02-28", "2024-02-29", "2026-03-30", "2026-12-15", "2026-08-31"];
  const rules: { frequency: Frequency; intervalCount: number }[] = [
    { frequency: "weekly", intervalCount: 1 },
    { frequency: "weekly", intervalCount: 2 },
    { frequency: "monthly", intervalCount: 1 },
    { frequency: "monthly", intervalCount: 3 },
    { frequency: "yearly", intervalCount: 1 },
  ];
  for (const startOn of starts) {
    for (const r of rules) {
      it(`${startOn} ${r.frequency}/${r.intervalCount}`, async () => {
        const unit = r.frequency === "weekly" ? "weeks" : r.frequency === "monthly" ? "months" : "years";
        const res = await db.query<{ d: string }>(
          `select (($1::date + make_interval(${unit} => $2 * k)))::date::text as d from generate_series(0, 30) as k order by k`,
          [startOn, r.intervalCount],
        );
        const expected = Array.from({ length: 31 }, (_, k) => occurrenceDate({ startOn, ...r }, k));
        expect(res.rows.map((x) => x.d)).toEqual(expected);
      });
    }
  }
});
