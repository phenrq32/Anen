# -*- coding: utf-8 -*-
"""Monta uma edição dos modelos de orçamento a partir da edição anterior e de uma lista de revisões.

- Um serviço da edição anterior que não é revisto passa tal como estava (mesmo nome, logo o mesmo id).
- K(...) revê o preço e a faixa de um serviço existente; a composição é a anterior, escalada para o novo preço.
- S(...) acrescenta um serviço novo, com a divisão do preço pelas linhas de custo da categoria (pesos).
- Cada serviço revisto ou novo leva a fonte do preço (guarda-se no JSON para rastreio).

Os valores da composição são calculados em cêntimos e somam sempre o preço recomendado exatamente.
"""
from decimal import Decimal, ROUND_FLOOR


def K(nome, preco, lo, hi, fonte, nota=None, mat=None):
    return ("K", nome, dict(preco=preco, lo=lo, hi=hi, fonte=fonte, nota=nota, mat=mat))


def S(nome, unidade, preco, lo, hi, pesos, mat, nota, fonte):
    return ("S", nome, dict(unidade=unidade, preco=preco, lo=lo, hi=hi, pesos=pesos, mat=mat, nota=nota, fonte=fonte))


def _num(x):
    """Decimal → int quando é inteiro, senão float com 2 casas (para o JSON)."""
    x = x.quantize(Decimal("0.01"))
    return int(x) if x == x.to_integral_value() else float(x)


def dividir(preco, pesos):
    """Divide o preço pelos pesos. Em unidades inteiras quando o preço é inteiro e ≥ 20; senão em cêntimos."""
    total = Decimal(str(preco))
    passo = Decimal("1") if total == total.to_integral_value() and total >= 20 else Decimal("0.01")
    soma = sum(Decimal(str(p)) for p in pesos)
    if soma <= 0:
        raise ValueError("pesos sem valor")
    partes = [((total * Decimal(str(p)) / soma) / passo).to_integral_value(ROUND_FLOOR) * passo for p in pesos]
    resto = total - sum(partes)
    i = max(range(len(pesos)), key=lambda k: pesos[k])
    partes[i] += resto
    assert sum(partes) == total and all(p >= 0 for p in partes)
    return [_num(p) for p in partes]


def montar(anterior, revisoes):
    """anterior: CATEGORIAS da edição anterior; revisoes: {nome da categoria: [K/S, ...]}."""
    nomes_cat = {c["nome"] for c in anterior}
    for cat in revisoes:
        if cat not in nomes_cat:
            raise KeyError(f"categoria desconhecida: {cat}")
    out = []
    for c in anterior:
        revs = revisoes.get(c["nome"], [])
        ks = {n: d for (t, n, d) in revs if t == "K"}
        novos = [(n, d) for (t, n, d) in revs if t == "S"]
        existentes = {s[0] for s in c["servicos"]}
        for n in ks:
            if n not in existentes:
                raise KeyError(f"{c['nome']}: serviço a rever não existe: {n}")
        servicos = []
        for (nome, un, vals, lo, hi, mat, nota) in c["servicos"]:
            if nome in ks:
                d = ks[nome]
                servicos.append((nome, un, dividir(d["preco"], [v if v else 0 for v in vals]), d["lo"], d["hi"],
                                 d["mat"] if d["mat"] is not None else mat,
                                 d["nota"] if d["nota"] is not None else nota, d["fonte"]))
            else:
                servicos.append((nome, un, vals, lo, hi, mat, nota, "Edição 2026-11 (sem alteração)"))
        for (nome, d) in novos:
            if nome in existentes or any(s[0] == nome for s in servicos):
                raise KeyError(f"{c['nome']}: serviço repetido: {nome}")
            if len(d["pesos"]) != len(c["linhas"]):
                raise ValueError(f"{c['nome']} / {nome}: {len(d['pesos'])} pesos para {len(c['linhas'])} linhas")
            servicos.append((nome, d["unidade"], dividir(d["preco"], d["pesos"]), d["lo"], d["hi"],
                             d["mat"] or "—", d["nota"], d["fonte"]))
        out.append({"nome": c["nome"], "linhas": c["linhas"], "servicos": servicos})
    return out
