# Vídeo de divulgação (redes sociais)

- `ANEN_divulgacao_30s.mp4`: vertical 1080×1920, 30 fps, 27,4 s, H.264 + AAC, áudio normalizado (≈ −15 LUFS). Pronto para Reels, TikTok e Shorts.
- `ANEN_divulgacao_30s.srt`: legendas à parte (as legendas também estão gravadas no vídeo).

## Como foi feito

1. `fonte/capture.mjs`: cria uma conta de demonstração temporária (pt-BR, R$), regista dados de exemplo pela interface da ANEN, tira as capturas no formato iPhone e apaga a conta no fim. Os dados são de exemplo.
2. `fonte/script.json`: texto da narração. Voz: Piper `pt_BR-faber-medium` (dados CC0; modelo de base treinado com Hi-Fi TTS, CC BY 4.0), gerada localmente.
3. `fonte/timeline.json`: início e fim de cada frase (a partir da duração real do áudio).
4. `fonte/promo.html` + `fonte/render.mjs`: animação (cores e fontes da marca: Manrope nos títulos, Inter no texto, laranja #FF851B, fundo #090909), renderizada fotograma a fotograma a 30 fps.
5. `ffmpeg`: junta a narração e os fotogramas.

Sem música (não havia uma faixa com licença). Os ecrãs são da versão em desenvolvimento, com dados de exemplo.
