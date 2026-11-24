# -*- coding: utf-8 -*-
import json, csv, re, unicodedata
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, KeepTogether, NextPageTemplate)
from reportlab.platypus.tableofcontents import TableOfContents
import sys, importlib
PAIS = sys.argv[1] if len(sys.argv) > 1 else "pt"
from config import CFG as _C
C = _C[PAIS]
CATEGORIAS = importlib.import_module(C["modulo"]).CATEGORIAS

import os
F = os.environ.get("FONT_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")) + "/"
for n, f in [("Fira", "FiraSans-Regular.ttf"), ("Fira-B", "FiraSans-Bold.ttf"),
             ("Fira-SB", "FiraSans-SemiBold.ttf"), ("Fira-M", "FiraSans-Medium.ttf"),
             ("Fira-L", "FiraSans-Light.ttf")]:
    pdfmetrics.registerFont(TTFont(n, F + f))

LARANJA = colors.HexColor("#FF8A1F")
ESCURO = colors.HexColor("#141414")
CINZA = colors.HexColor("#6B6B6B")
CLARO = colors.HexColor("#F4F2EF")
LINHA = colors.HexColor("#E3DFDA")
PESSEGO = colors.HexColor("#FFF1E4")

def fmt(v):
    if PAIS == "br":
        if abs(v - round(v)) < 1e-9:
            n = f"{int(round(v)):,}".replace(",", ".")
        else:
            n = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return "R$ " + n
    if abs(v - round(v)) < 1e-9:
        s = f"{int(round(v)):,}".replace(",", " ")
    else:
        s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", " ")
    return s + " €"

def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

S = lambda **k: ParagraphStyle("x", **k)
st_h1 = S(fontName="Fira-B", fontSize=24, leading=28, textColor=ESCURO, spaceAfter=4)
st_lead = S(fontName="Fira-L", fontSize=10.5, leading=15, textColor=CINZA)
st_body = S(fontName="Fira", fontSize=9.5, leading=14, textColor=ESCURO)
st_h2 = S(fontName="Fira-SB", fontSize=12, leading=16, textColor=ESCURO, spaceBefore=10, spaceAfter=4)
st_cell = S(fontName="Fira", fontSize=8.2, leading=10.5, textColor=ESCURO)
st_name = S(fontName="Fira-SB", fontSize=8.8, leading=11.2, textColor=ESCURO)
st_mat = S(fontName="Fira", fontSize=7.4, leading=9.6, textColor=CINZA)
st_note = S(fontName="Fira-M", fontSize=7.4, leading=9.6, textColor=colors.HexColor("#B85A00"))
st_comp = S(fontName="Fira", fontSize=7.4, leading=9.8, textColor=ESCURO)
st_price = S(fontName="Fira-B", fontSize=10.5, leading=12, textColor=ESCURO, alignment=TA_RIGHT)
st_range = S(fontName="Fira", fontSize=7.6, leading=10, textColor=CINZA, alignment=TA_RIGHT)
st_unit = S(fontName="Fira", fontSize=8, leading=10, textColor=CINZA)
st_th = S(fontName="Fira-SB", fontSize=7.4, leading=9, textColor=colors.white)
st_th_r = S(fontName="Fira-SB", fontSize=7.4, leading=9, textColor=colors.white, alignment=TA_RIGHT)
st_cat = S(fontName="Fira-B", fontSize=20, leading=24, textColor=ESCURO)
st_chips = S(fontName="Fira", fontSize=8.5, leading=12, textColor=CINZA)
st_bul = S(fontName="Fira", fontSize=9.5, leading=14, textColor=ESCURO, leftIndent=10, bulletIndent=0)

W, H = A4
ML = MR = 16 * mm

class Doc(BaseDocTemplate):
    def afterFlowable(self, f):
        if getattr(f, "_toc", None):
            self.canv.bookmarkPage(f._key)
            self.canv.addOutlineEntry(f._toc.split("  (")[0], f._key, level=0)
            self.notify("TOCEntry", (0, f._toc, self.page, f._key))

def capa(c, d):
    c.saveState()
    c.setFillColor(ESCURO); c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(LARANJA); c.circle(W - 40 * mm, H - 55 * mm, 70 * mm, fill=1, stroke=0)
    c.setFillColor(ESCURO); c.circle(W - 40 * mm, H - 55 * mm, 52 * mm, fill=1, stroke=0)
    c.setFillColor(LARANJA); c.setFont("Fira-SB", 10)
    c.drawString(ML, H - 30 * mm, C["capa_tag"])
    c.setFillColor(colors.white); c.setFont("Fira-B", 38)
    c.drawString(ML, 150 * mm, "Tabela de serviços")
    c.drawString(ML, 136 * mm, "e preços recomendados")
    c.setFont("Fira-L", 13); c.setFillColor(colors.HexColor("#BDBDBD"))
    c.drawString(ML, 120 * mm, "19 categorias · " + str(sum(len(x["servicos"]) for x in CATEGORIAS)) +
                 " modelos prontos · materiais e composição de custos")
    c.drawString(ML, 113 * mm, C["capa_sub"])
    c.setFillColor(LARANJA); c.rect(ML, 100 * mm, 30 * mm, 1.2 * mm, fill=1, stroke=0)
    c.setFont("Fira", 8.5); c.setFillColor(colors.HexColor("#8A8A8A"))
    c.drawString(ML, 20 * mm, C["capa_rodape"])
    c.restoreState()

def pagina(c, d):
    c.saveState()
    c.setFillColor(LARANJA); c.rect(0, H - 6 * mm, W, 6 * mm, fill=1, stroke=0)
    c.setFont("Fira", 7.5); c.setFillColor(CINZA)
    c.drawString(ML, 10 * mm, C["rodape"])
    c.drawRightString(W - MR, 10 * mm, str(d.page))
    c.restoreState()

doc = Doc(C["pdf"], pagesize=A4,
          leftMargin=ML, rightMargin=MR, topMargin=16 * mm, bottomMargin=18 * mm,
          title=C["titulo"], author="ANEN")
fr = Frame(ML, 18 * mm, W - ML - MR, H - 34 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate("capa", [Frame(0, 0, W, H)], onPage=capa),
                      PageTemplate("normal", [fr], onPage=pagina)])

story = [NextPageTemplate("normal"), PageBreak()]

# ---------- Como usar ----------
story += [Paragraph("Como usar esta tabela", st_h1),
          Paragraph("Cada categoria do aplicativo tem uma lista de serviços pré-definidos. Ao escolher um serviço, o orçamento já vem preenchido "
                    "com o <b>preço recomendado</b>, a <b>unidade</b>, os <b>materiais/produtos típicos</b> e a <b>divisão do valor pelas linhas de custo</b> "
                    "que a categoria já usa no app (ex.: Materiais · Mão de obra · Deslocação).", st_lead), Spacer(1, 8)]

regras = C["regras"]
t = Table([[Paragraph(f"<b>{a}</b>", st_cell), Paragraph(b, st_cell)] for a, b in regras],
          colWidths=[38 * mm, W - ML - MR - 38 * mm])
t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINHA),
                       ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                       ("BACKGROUND", (0, 0), (0, -1), CLARO)]))
story += [t, Spacer(1, 10)]

# Exemplo
story += [Paragraph("Exemplo no app", st_h2)]
ex = C["exemplo"]
te = Table([[Paragraph(a, st_cell), Paragraph(b, S(fontName="Fira", fontSize=8.2, leading=10.5, alignment=TA_RIGHT))] for a, b in ex],
           colWidths=[110 * mm, 40 * mm])
te.setStyle(TableStyle([("SPAN", (0, 0), (1, 0)), ("BACKGROUND", (0, 0), (-1, 0), ESCURO),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                        ("BACKGROUND", (0, len(ex)-2), (-1, -1), PESSEGO), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINHA),
                        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
te._cellvalues[0][0] = Paragraph("<font color='white'><b>" + ex[0][0] + "</b></font>", st_cell)
story += [te, PageBreak()]

# ---------- Índice ----------
toc = TableOfContents()
toc.levelStyles = [S(fontName="Fira", fontSize=10.5, leading=17, textColor=ESCURO, leftIndent=0)]
toc.dotsMinLevel = 0
story += [Paragraph("Índice de categorias", st_h1), Spacer(1, 6), toc, PageBreak()]

# ---------- Categorias ----------
CW = W - ML - MR
cols = [64 * mm, 16 * mm, 56 * mm, CW - 136 * mm]
export = []
for i, c in enumerate(CATEGORIAS):
    ttl = Paragraph(f"<font color='#FF8A1F'>{i+1:02d}</font>  {c['nome']}", st_cat)
    ttl._toc = f"{i+1:02d}  {c['nome']}  ({len(c['servicos'])} serviços)"
    ttl._key = slug(c["nome"])
    chips = Paragraph("Linhas de custo: " + " · ".join(c["linhas"]), st_chips)
    rows = [[Paragraph("SERVIÇO · MATERIAIS / PRODUTOS", st_th), Paragraph("UNID.", st_th),
             Paragraph("COMPOSIÇÃO DO PREÇO", st_th), Paragraph("PREÇO REC. · FAIXA", st_th_r)]]
    for (nome, un, vals, lo, hi, mat, nota) in c["servicos"]:
        total = round(sum(vals), 2)
        blk = [Paragraph(nome, st_name), Paragraph(mat, st_mat)]
        if nota:
            blk.append(Paragraph("→ " + nota, st_note))
        comp = "<br/>".join(f"{l}: <b>{fmt(v)}</b>" for l, v in zip(c["linhas"], vals) if v)
        rows.append([blk, Paragraph(un, st_unit), Paragraph(comp, st_comp),
                     [Paragraph(fmt(total), st_price), Paragraph(f"por {un}", st_range),
                      Paragraph(f"{fmt(lo)} – {fmt(hi)}", st_range)]])
        export.append({"categoria": c["nome"], "servico": nome, "unidade": un,
                       C["chave_preco"]: total, "faixa_min": lo, "faixa_max": hi,
                       "materiais_produtos": mat, "nota": nota,
                       "composicao": {l: v for l, v in zip(c["linhas"], vals) if v}})
    tb = Table(rows, colWidths=cols, repeatRows=1)
    sty = [("BACKGROUND", (0, 0), (-1, 0), ESCURO), ("VALIGN", (0, 0), (-1, -1), "TOP"),
           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
           ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
           ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINHA), ("BACKGROUND", (3, 1), (3, -1), PESSEGO)]
    for r in range(2, len(rows), 2):
        sty.append(("BACKGROUND", (0, r), (2, r), colors.HexColor("#FAF9F7")))
    tb.setStyle(TableStyle(sty))
    if i:
        story.append(PageBreak())
    story += [ttl, Spacer(1, 3), chips, Spacer(1, 8), tb]

# ---------- Fontes ----------
story += [PageBreak(), Paragraph("Metodologia e fontes", st_h1),
          Paragraph(C["metodologia"], st_lead), Spacer(1, 8)]
fontes = C["fontes"]
for f in fontes:
    story.append(Paragraph(f, st_bul, bulletText="•"))
story += [Spacer(1, 10), Paragraph(C["aviso"], st_body)]

doc.multiBuild(story)

json.dump(export, open(C["json"], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(C["csv"], "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow(["Categoria", "Serviço", "Unidade", C["col_preco"], "Mínimo", "Máximo",
                "Materiais / produtos", "Nota", "Composição"])
    for e in export:
        w.writerow([e["categoria"], e["servico"], e["unidade"], str(e[C["chave_preco"]]).replace(".", ","),
                    str(e["faixa_min"]).replace(".", ","), str(e["faixa_max"]).replace(".", ","),
                    e["materiais_produtos"], e["nota"],
                    " | ".join(f"{k}: {str(v).replace('.', ',')}" for k, v in e["composicao"].items())])
print(len(export))
