# -*- coding: utf-8 -*-
"""Gera dados/modelos_orcamento_2026-12.json (PT + BR) a partir de dados.py e dados_br.py."""
import json, os, re, unicodedata, importlib

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "..", "dados", "modelos_orcamento_2026-12.json")


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


META = {
    "pt": ("dados", "EUR", "Portugal", False, "Valores SEM IVA (somar 23% no continente)."),
    "br": ("dados_br", "BRL", "Brasil", True, "Valor final ao cliente, impostos já inclusos."),
}

out = {"versao": "2026-12",
       "descricao": "Modelos de orçamento pré-prontos por categoria, com preço recomendado, faixa de mercado, "
                    "materiais e composição pelas linhas de custo do app.",
       "paises": {}}

for cod, (mod, moeda, nome, inc, nota) in META.items():
    cats = []
    for c in importlib.import_module(mod).CATEGORIAS:
        servicos = []
        for (n, u, vals, lo, hi, mat, nt, *fonte) in c["servicos"]:
            total = round(sum(vals), 2)
            assert lo <= total <= hi, f"{c['nome']} / {n}: {total} fora da faixa {lo}–{hi}"
            servicos.append({
                "id": slug(c["nome"]) + "__" + slug(n), "nome": n, "unidade": u,
                "preco_recomendado": total, "faixa_min": lo, "faixa_max": hi,
                "materiais": "" if mat == "—" else mat, "nota": nt, "fonte": fonte[0] if fonte else "",
                "composicao": [{"linha": l, "valor": v} for l, v in zip(c["linhas"], vals) if v],
            })
        cats.append({"id": slug(c["nome"]), "nome": c["nome"], "linhas_de_custo": c["linhas"], "servicos": servicos})
    out["paises"][cod] = {"pais": nome, "moeda": moeda, "impostos_inclusos": inc, "nota_impostos": nota, "categorias": cats}

with open(SAIDA, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print({k: sum(len(c["servicos"]) for c in v["categorias"]) for k, v in out["paises"].items()}, "→", SAIDA)
