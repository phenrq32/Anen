#!/bin/bash
# Uso: build_voice.sh <voz> <nome-saida>
set -euo pipefail
S=/tmp/claude-0/-home-user-Anen/3290cebd-d9b0-52ea-9ad7-33c8854642eb/scratchpad; V=$S/video; K=$S/kokoro
VOICE=$1; NAME=$2; W=$V/v_$VOICE
mkdir -p $W; cd $W
for f in promo.html fonts logo.svg shots render.mjs; do ln -sfn $V/$f $f; done
# Linha do tempo a partir da duração real de cada frase
python3 -I - "$K/$VOICE" "$V/script.json" > timeline.json <<'PY'
import json,sys,subprocess
d,script=sys.argv[1],sys.argv[2]
t=0.25; out=[]
for s in json.load(open(script)):
    dur=float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f"{d}/{s['id']}.wav"]).decode())
    out.append({"id":s["id"],"text":s["text"],"start":round(t,3),"end":round(t+dur,3)}); t+=dur+0.35
print(json.dumps({"segments":out,"total":round(out[-1]["end"]+1.4,2)},ensure_ascii=False))
PY
echo "total $(python3 -I -c 'import json;print(json.load(open("timeline.json"))["total"])')"
# Fotogramas
rm -rf frames; node render.mjs $W | tail -1
# Narração posicionada
python3 -I - timeline.json "$K/$VOICE" > mix.sh <<'PY'
import json,sys
t=json.load(open(sys.argv[1])); a=sys.argv[2]
ins=" ".join(f"-i {a}/{s['id']}.wav" for s in t["segments"])
parts=";".join(f"[{i}]aresample=48000,adelay={int(s['start']*1000)}|{int(s['start']*1000)}[d{i}]" for i,s in enumerate(t["segments"]))
mix="".join(f"[d{i}]" for i in range(len(t["segments"])))
print(f'ffmpeg -nostdin -v error -y {ins} -filter_complex "{parts};{mix}amix=inputs={len(t["segments"])}:normalize=0,apad,atrim=0:{t["total"]}" -ar 48000 -ac 2 voz.wav')
PY
sh mix.sh
# Música original
$S/venv/bin/python -I $V/music.py timeline.json musica.wav
# Mistura: música baixa quando há voz (sidechain), voz por cima; normaliza para redes sociais
ffmpeg -nostdin -v error -y -i voz.wav -i musica.wav -filter_complex \
 "[0]asplit=2[v][vsc];[1]aresample=48000,volume=0.32[m];[m][vsc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350:makeup=1[md];[v]equalizer=f=3000:t=q:w=1:g=2,acompressor=threshold=0.1:ratio=3:attack=5:release=80[vv];[vv][md]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11" \
 -ar 48000 -ac 2 final.wav
ffmpeg -nostdin -v error -y -framerate 30 -i frames/f%05d.png -i final.wav -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -movflags +faststart -c:a aac -b:a 192k -shortest $V/$NAME.mp4
ffprobe -v error -show_entries format=duration,size -of compact $V/$NAME.mp4
