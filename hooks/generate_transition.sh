#!/bin/bash
# sarva-tech-extention-ffmpeg/hooks/generate_transition.sh
# Generate filter_complex untuk transisi FFmpeg

IMAGES=("$@")
WIDTH="${WIDTH:-720}"
HEIGHT="${HEIGHT:-1280}"
DURATION="${DURATION:-2.0}"
TRANSITION="${TRANSITION:-fade}"

# Map transition name
case "$TRANSITION" in
    slide) XFADE="slideleft" ;;
    wipe) XFADE="wipeleft" ;;
    *) XFADE="fade" ;;
esac

# Calculate transition duration (40% of image duration, max 1s)
TRANS_DURATION=$(echo "$DURATION * 0.4" | bc)
if (( $(echo "$TRANS_DURATION > 1.0" | bc -l) )); then
    TRANS_DURATION=1.0
fi

# Build filter_complex
FILTER_COMPLEX=""
for i in "${!IMAGES[@]}"; do
    FILTER_COMPLEX+="[$i:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v$i];"
done

prev="v0"
for i in $(seq 1 $((${#IMAGES[@]} - 1))); do
    label=$( [ $i -eq $((${#IMAGES[@]} - 1)) ] && echo "vout" || echo "x$i" )
    offset=$(echo "$i * $DURATION - $i * $TRANS_DURATION" | bc)
    FILTER_COMPLEX+="[$prev][v$i]xfade=transition=${XFADE}:duration=${TRANS_DURATION}:offset=${offset}[$label];"
    prev="$label"
done

# Remove trailing semicolon
FILTER_COMPLEX="${FILTER_COMPLEX%;}"

# Output only the filter_complex string
echo "$FILTER_COMPLEX"