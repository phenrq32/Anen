import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientCookie, parseTextSize, parseTheme } from "./appearance";

const root = join(__dirname, "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("aparência", () => {
  it("valores desconhecidos no cookie voltam ao padrão (escuro, texto normal)", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("pink")).toBe("pink");
    expect(parseTheme("roxo")).toBe("dark");
    expect(parseTheme(undefined)).toBe("dark");
    expect(parseTextSize("xlarge")).toBe("xlarge");
    expect(parseTextSize("<script>")).toBe("normal");
  });

  it("cookie de 1 ano, para todo o site", () => {
    expect(clientCookie("anen-theme", "light")).toBe("anen-theme=light; Path=/; Max-Age=31536000; SameSite=Lax");
  });

  it("toda cor do tema escuro tem par no tema claro e no automático (menos o laranja e os gráficos)", () => {
    const theme = read("packages", "ui", "src", "theme.css");
    const globals = read("apps", "web", "src", "app", "globals.css");
    const keep = new Set(["--color-brand", "--color-brand-hover", "--color-on-brand", "--color-chart-income", "--color-chart-expense"]);
    const tokens = [...theme.matchAll(/(--color-[\w-]+):/g)].map((m) => m[1]!).filter((t) => !keep.has(t));
    expect(tokens.length).toBeGreaterThan(10);
    const block = (selector: string) => {
      const start = globals.indexOf(selector);
      expect(start).toBeGreaterThan(-1);
      return globals.slice(start, globals.indexOf("}", start));
    };
    const light = block('html[data-theme="light"] {');
    const system = block('html[data-theme="system"] {');
    const pink = block('html[data-theme="pink"] {');
    for (const t of tokens) {
      expect(light, `${t} no tema claro`).toContain(`${t}:`);
      expect(pink, `${t} no tema rosa claro`).toContain(`${t}:`);
      expect(system, `${t} no tema automático`).toContain(`${t}:`);
    }
  });

  it("o texto sobre o laranja continua preto em qualquer tema", () => {
    const globals = read("apps", "web", "src", "app", "globals.css");
    expect(globals).not.toContain("--color-on-brand:");
  });
});
