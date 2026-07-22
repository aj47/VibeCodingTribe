#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/video-promo/renders"
TMP_DIR="$OUT_DIR/.tmp"
FONT_BOLD="/System/Library/Fonts/Menlo.ttc"
FONT_REG="/System/Library/Fonts/Menlo.ttc"

mkdir -p "$OUT_DIR" "$TMP_DIR"
rm -f "$TMP_DIR"/*.mp4 "$TMP_DIR"/*.txt "$TMP_DIR"/concat.txt "$TMP_DIR"/*.aiff "$TMP_DIR"/*.wav

cat > "$TMP_DIR/vo.txt" <<'EOF'
You built it. Now break it. Before you ship your vibe-coded app, get real people to test it. Vibe Coding Tribe connects builders with testers who catch the bugs AI misses. Post a mission. Give feedback. Earn credits and reputation. Build faster, with proof. Join the tribe at vibe coding tribe dot com.
EOF

say -v Samantha -r 178 -f "$TMP_DIR/vo.txt" -o "$TMP_DIR/vo.aiff"

render_scene() {
  local index="$1"
  local duration="$2"
  local image="$3"
  local kicker="$4"
  local title="$5"
  local footer="$6"
  local bg="$7"
  local output="$TMP_DIR/scene-${index}.mp4"

  printf '%b\n' "$title" > "$TMP_DIR/title-${index}.txt"

  ffmpeg -y -hide_banner -loglevel error \
    -loop 1 -i "$image" \
    -f lavfi -i "color=c=${bg}:s=1080x1920:r=30" \
    -t "$duration" \
    -filter_complex "
      [0:v]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,
      zoompan=z='min(zoom+0.00045,1.06)':d=1:s=960x540:fps=30[card];
      [1:v][card]overlay=60:730:eval=frame,
      drawbox=x=60:y=730:w=960:h=540:color=0x4a8dff@0.55:t=2,
      drawbox=x=60:y=1287:w=960:h=4:color=0x0a66c2@0.9:t=fill,
      drawtext=fontfile='${FONT_REG}':text='${kicker}':x=60:y=110:fontsize=25:fontcolor=0x70a8c4:shadowcolor=0x000000@0.75:shadowx=2:shadowy=2,
      drawtext=fontfile='${FONT_BOLD}':textfile='${TMP_DIR}/title-${index}.txt':x=60:y=170:fontsize=78:line_spacing=12:fontcolor=0xf6f5f0:shadowcolor=0x000000@0.8:shadowx=3:shadowy=4,
      drawtext=fontfile='${FONT_REG}':text='${footer}':x=60:y=1370:fontsize=28:line_spacing=8:fontcolor=0xd6dee7,
      drawtext=fontfile='${FONT_REG}':text='VIBECODINGTRIBE.COM':x=60:y=1805:fontsize=22:fontcolor=0x70a8c4,
      drawbox=x=865:y=1775:w=155:h=68:color=0x0a66c2@1.0:t=fill,
      drawtext=fontfile='${FONT_BOLD}':text='JOIN':x=900:y=1794:fontsize=25:fontcolor=0xffffff
    " \
    -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
    "$output"
}

render_scene 1 4.5 "$ROOT/public/x-campaign/01-catch-bugs.png" \
  "THE BUILDER DILEMMA" "YOU BUILT IT.\\nNOW BREAK IT." \
  "Real users > imaginary confidence" "#070b10"

render_scene 2 5.0 "$ROOT/public/x-campaign/02-send-a-mission.png" \
  "SHIPPING SOON?" "STOP SHIPPING\\nINTO THE VOID." \
  "Find the people who will actually use it." "#070b10"

render_scene 3 5.0 "$ROOT/public/x-campaign/03-verified-feedback.png" \
  "VIBECODINGTRIBE" "POST A MISSION.\\nGET REAL FEEDBACK." \
  "Share your build  •  Get a tester  •  Fix what matters" "#070b10"

render_scene 4 5.0 "$ROOT/public/x-campaign/04-human-agent-room.png" \
  "THE LOOP" "BUILD → TEST →\\nSHIP BETTER." \
  "Builder-to-builder feedback for products in the making." "#070b10"

render_scene 5 5.0 "$ROOT/public/x-campaign/05-earn-reputation.png" \
  "THE PAYOFF" "EARN CREDITS.\\nBUILD REPUTATION." \
  "Help another builder. Level up your own product." "#070b10"

render_scene 6 5.5 "$ROOT/public/og-image.png" \
  "THE TRIBE FOR PEOPLE WHO SHIP" "JOIN THE\\nTRIBE." \
  "Build faster, with proof." "#07101c"

for scene in "$TMP_DIR"/scene-*.mp4; do
  printf "file '%s'\n" "$scene" >> "$TMP_DIR/concat.txt"
done

ffmpeg -y -hide_banner -loglevel error \
  -f concat -safe 0 -i "$TMP_DIR/concat.txt" \
  -i "$TMP_DIR/vo.aiff" \
  -f lavfi -i "aevalsrc=0.045*sin(2*PI*110*t)+0.018*sin(2*PI*220*t)+0.06*sin(2*PI*880*t)*exp(-120*mod(t\\,1))+0.13*sin(2*PI*1400*t)*exp(-250*mod(t\\,5)):s=48000:d=30" \
  -filter_complex "[1:a]aresample=48000,volume=1.0[vo];[2:a]volume=0.35[bed];[vo][bed]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.8[a]" \
  -map 0:v -map "[a]" -t 30 \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  "$OUT_DIR/vibe-coding-tribe-vertical-promo-v1.mp4"

ffmpeg -y -hide_banner -loglevel error \
  -i "$OUT_DIR/vibe-coding-tribe-vertical-promo-v1.mp4" \
  -vf "fps=0.5,scale=270:-1,tile=4x4:padding=6:margin=6" \
  -frames:v 1 "$OUT_DIR/contact-sheet.jpg"

ffprobe -v error -show_entries format=duration,size:stream=width,height,r_frame_rate,codec_name,codec_type -of json \
  "$OUT_DIR/vibe-coding-tribe-vertical-promo-v1.mp4" > "$OUT_DIR/ffprobe.json"

echo "Rendered: $OUT_DIR/vibe-coding-tribe-vertical-promo-v1.mp4"
