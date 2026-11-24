# Vídeo de divulgação (redes sociais)

Duas versões com o mesmo vídeo, a mesma música e o mesmo texto. Só muda a voz.

| Ficheiro | Voz | Duração |
| --- | --- | --- |
| `ANEN_divulgacao_voz_feminina.mp4` | Kokoro `pf_dora` (pt-BR) | 28,2 s |
| `ANEN_divulgacao_voz_masculina.mp4` | Kokoro `pm_alex` (pt-BR) | 28,6 s |

- Formato vertical 1080×1920 a 30 fps, H.264 + AAC 192 kbps.
- Áudio normalizado a −14 LUFS (pico −1,5 dBFS), o nível recomendado para Reels, TikTok e Shorts.
- Os ficheiros `.srt` têm as legendas à parte (que também estão gravadas no vídeo).

## Licenças

- **Voz:** modelo Kokoro-82M, com licença Apache 2.0 (permite uso comercial). Foi gerada localmente.
- **Música:** composição original sintetizada do zero por `fonte/music.py`, sem amostras nem trechos de terceiros. Tem uso comercial livre e não deve gerar reclamações de direitos de autor nas redes.
  - Groove pop/house a cerca de 120 BPM com a progressão Lá menor, Fá, Dó, Sol.
  - Começa com uma subida no gancho, entra no ritmo na segunda frase e termina com um impacto na chamada final.
  - A música baixa automaticamente quando há narração (*ducking*).

## Como foi feito

1. `fonte/capture.mjs` cria uma conta de demonstração temporária (pt-BR, R$), regista dados de exemplo pela interface da ANEN, tira as capturas no formato iPhone e apaga a conta no fim.
2. `fonte/script.json` contém o texto da narração, sintetizado com Kokoro, frase a frase.
3. `fonte/build_voice.sh <voz> <nome>`:
   1. gera a linha do tempo a partir da duração real de cada frase;
   2. renderiza `fonte/promo.html` fotograma a fotograma com `fonte/render.mjs` (cores e fontes da marca);
   3. gera a música com `fonte/music.py` alinhada a essa linha do tempo;
   4. mistura tudo com `ffmpeg` (compressão por *sidechain* e `loudnorm`).

Os ecrãs são da versão em desenvolvimento, com dados de exemplo.
