import { describe, expect, it } from "vitest";
import { currentPlanLimits } from "./plan-limits";

describe("limites em vigor", () => {
  it("usa a versão mais recente já começada e ignora as futuras", () => {
    const rows = [
      { plan_key: "free", limit_key: "projects", value: null, valid_from: "2026-11-27", source: "a" },
      { plan_key: "free", limit_key: "projects", value: 5, valid_from: "2027-01-01", source: "b" },
      { plan_key: "free", limit_key: "projects", value: 3, valid_from: "2026-12-01", source: "c" },
    ];
    expect(currentPlanLimits(rows, "2026-11-30").get("free")?.get("projects")?.value).toBeNull();
    expect(currentPlanLimits(rows, "2026-12-15").get("free")?.get("projects")?.value).toBe(3);
    expect(currentPlanLimits(rows, "2027-02-01").get("free")?.get("projects")?.value).toBe(5);
  });
});
