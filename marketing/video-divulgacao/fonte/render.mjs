// Renderiza promo.html fotograma a fotograma (30 fps) para PNG.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "/home/user/Anen/node_modules/playwright/index.mjs";

const dir = process.argv[2];
const only = process.argv[3]; // opcional: lista de tempos para pré-visualizar ("1.0,6.5,…")
const timeline = JSON.parse(readFileSync(`${dir}/timeline.json`, "utf8"));
const FPS = 30;
const out = `${dir}/frames`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(`file://${dir}/promo.html`);
await page.evaluate(() => document.fonts.ready);
await page.evaluate((t) => window.setup(t), timeline);
// Pré-carrega as imagens
await page.evaluate(async () => {
  const srcs = ["01-hoje", "01b-kpis", "03-registro-rapido", "04-a-receber-pagar", "05-calendario", "06-parcelas", "07-orcamento-modelos", "08-orcamento-total", "09-contexto"].map((n) => `shots/${n}.png`);
  await Promise.all(srcs.map((s) => new Promise((r) => { const i = new Image(); i.onload = r; i.onerror = r; i.src = s; })));
});
const times = only ? only.split(",").map(Number) : Array.from({ length: Math.ceil(timeline.total * FPS) }, (_, i) => i / FPS);
let n = 0;
for (const t of times) {
  await page.evaluate((x) => window.render(x), t);
  await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => (i.onload = i.onerror = r)))));
  const name = only ? `preview-${t.toFixed(2)}.png` : `f${String(n).padStart(5, "0")}.png`;
  await page.screenshot({ path: `${out}/${name}` });
  n++;
}
await browser.close();
console.log("frames", n);
