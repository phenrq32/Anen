"""
Música original para o vídeo da ANEN (sintetizada do zero, sem amostras de terceiros: uso comercial livre).
Estrutura alinhada com a linha do tempo do vídeo:
  0 → drop      : introdução com subida (ruído filtrado + tom ascendente)
  drop → cta    : groove (bombo, palmas, chimbal, baixo com "pumping", acordes, arpejo) em Am–F–C–G
  cta → fim     : impacto e acorde de Dó maior a desvanecer
Uso: python music.py <timeline.json> <saida.wav>
"""
import json
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR = 44100
tl = json.load(open(sys.argv[1]))
TOTAL = tl["total"]
DROP = tl["segments"][1]["start"]
CTA = tl["segments"][8]["start"]
N = int(TOTAL * SR) + SR
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(7)

# Grelha: 10 compassos entre o drop e a chamada final, se possível perto de 120 BPM.
bars = max(1, round((CTA - DROP) / 2.0))
BAR = (CTA - DROP) / bars
BEAT = BAR / 4


def t(sec):
    return np.arange(int(sec * SR)) / SR


def lp(x, f):
    return sosfilt(butter(2, f, "low", fs=SR, output="sos"), x)


def hp(x, f):
    return sosfilt(butter(2, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), x)


def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    L[i : i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 - pan))
    R[i : i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 + pan))


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def saw(f, tt, detune=0.0):
    ph = (f * (1 + detune)) * tt
    return 2 * (ph - np.floor(ph + 0.5))


# --- Instrumentos -----------------------------------------------------------
def kick():
    tt = t(0.45)
    f = 45 + 90 * np.exp(-tt * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt * 7) + 0.15 * np.exp(-tt * 300) * rng.standard_normal(len(tt))


def clap():
    tt = t(0.25)
    n = rng.standard_normal(len(tt))
    env = np.exp(-tt * 18)
    for off in (0.0, 0.011, 0.022):
        env += np.where(tt > off, np.exp(-(tt - off) * 90), 0) * 0.6
    return bp(n * env, 900, 3500) * 0.9


def hat(open_=False):
    tt = t(0.3 if open_ else 0.06)
    return hp(rng.standard_normal(len(tt)), 7000) * np.exp(-tt * (12 if open_ else 70)) * 0.35


def pluck_chord(notes, dur):
    tt = t(dur)
    s = sum(saw(midi(n), tt, d) for n in notes for d in (-0.004, 0.004))
    env = np.exp(-tt * 9)
    return lp(s * env, 3200) * 0.12


def pad(notes, dur, cutoff=1800):
    tt = t(dur)
    s = sum(saw(midi(n), tt, d) for n in notes for d in (-0.006, 0.0, 0.006))
    a = np.minimum(1, tt / 0.25)
    rel = np.minimum(1, (dur - tt) / 0.4)
    return lp(s * a * rel, cutoff) * 0.035


def bass(note, dur):
    tt = t(dur)
    s = saw(midi(note), tt) + 0.6 * np.sin(2 * np.pi * midi(note - 12) * tt)
    env = np.minimum(1, tt / 0.005) * np.exp(-tt * 3)
    return lp(s * env, 700) * 0.35


def bell(note):
    tt = t(0.5)
    f = midi(note)
    return (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt * 7) * 0.12


# Progressão vi–IV–I–V em Dó: Am, F, C, G
CHORDS = [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [67, 72, 76]), (55, [67, 71, 74])]

# --- Introdução: subida até ao drop -----------------------------------------
tt = t(DROP)
noise = rng.standard_normal(len(tt))
riser = np.zeros(len(tt))
# ruído filtrado com frequência a subir (em blocos)
blocks = 24
for b in range(blocks):
    a, z = int(b * len(tt) / blocks), int((b + 1) * len(tt) / blocks)
    fc = 400 + (b / blocks) ** 2 * 7000
    riser[a:z] = bp(noise[a:z], fc * 0.7, min(fc * 1.4, 18000))
riser *= np.linspace(0.05, 0.9, len(tt)) ** 2 * 0.5
tone = np.sin(2 * np.pi * np.cumsum(220 + 440 * (tt / DROP) ** 2) / SR) * (tt / DROP) ** 3 * 0.12
add(riser + tone, 0.0)
add(pad([69, 72, 76], DROP, 900), 0.0, 0.8)
# batidas suaves de "relógio" no gancho
for i in range(int(DROP / 0.5)):
    add(hat(), 0.25 + i * 0.5, 0.6, 0.3 if i % 2 else -0.3)

# --- Impacto no drop --------------------------------------------------------
def impact():
    tt2 = t(1.6)
    boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-tt2 * 6)) / SR) * np.exp(-tt2 * 2.5)
    crash = hp(rng.standard_normal(len(tt2)), 3000) * np.exp(-tt2 * 2.2) * 0.25
    return boom * 0.8 + crash


add(impact(), DROP, 0.9)

# --- Groove -----------------------------------------------------------------
sidechain = np.ones(N)
for b in range(bars):
    bar_t = DROP + b * BAR
    root, chord = CHORDS[b % 4]
    for beat in range(4):
        bt = bar_t + beat * BEAT
        add(kick(), bt, 0.9)
        # "pumping": baixa acordes e baixo logo a seguir a cada bombo
        i = int(bt * SR)
        dip = 1 - 0.75 * np.exp(-t(BEAT) * 14)
        sidechain[i : i + len(dip)] = np.minimum(sidechain[i : i + len(dip)], dip)
        if beat in (1, 3):
            add(clap(), bt, 0.55, 0.05)
        add(hat(), bt + BEAT / 2, 0.8, 0.25)
        if beat == 3:
            add(hat(True), bt + BEAT * 0.75, 0.4, -0.25)
    # baixo em colcheias
    for e in range(8):
        add(bass(root - 12, BEAT / 2 * 0.95), bar_t + e * BEAT / 2, 0.9)
    # acordes: pad contínuo + stabs nos contratempos
    add(pad(chord, BAR), bar_t, 1.0, -0.15)
    for e in (1, 3, 5, 7):
        add(pluck_chord(chord, BEAT * 0.45), bar_t + e * BEAT / 2, 1.0, 0.15)
    # arpejo luminoso na segunda metade (mais energia)
    if b >= bars // 2:
        arp = chord + [chord[0] + 12]
        for s in range(16):
            add(bell(arp[s % 4] + 12), bar_t + s * BEAT / 4, 0.8, 0.4 if s % 2 else -0.4)

# aplica o sidechain só ao que é tonal: simplificação — aplica a tudo exceto bombo (bombo já está somado;
# atenua de forma leve para manter o efeito sem tirar o peso)
L *= 0.55 + 0.45 * sidechain
R *= 0.55 + 0.45 * sidechain

# --- Chamada final: impacto e acorde aberto --------------------------------
add(impact(), CTA, 0.8)
tail = TOTAL - CTA + 0.5
add(pad([60, 64, 67, 72], tail, 2400) * np.exp(-t(tail) * 0.6), CTA, 2.2)
add(bass(36, 1.2), CTA, 1.0)
for i, n in enumerate([72, 76, 79, 84]):
    add(bell(n), CTA + 0.12 * i, 1.0, -0.3 + 0.2 * i)

# --- Finalização ------------------------------------------------------------
out = np.stack([L, R], axis=1)[: int(TOTAL * SR)]
fade = int(0.8 * SR)
out[-fade:] *= np.linspace(1, 0, fade)[:, None]
out /= np.max(np.abs(out)) + 1e-9
out *= 0.89
sf.write(sys.argv[2], out.astype(np.float32), SR)
print("música", round(len(out) / SR, 2), "s;", bars, "compassos de", round(BAR, 3), "s (", round(240 / BAR, 1), "BPM )")
