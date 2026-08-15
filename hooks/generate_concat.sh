#!/bin/bash
# sarva-tech-extention-ffmpeg/hooks/generate_concat.sh
# Generate concat list file untuk FFmpeg

OUTPUT_LIST="$1"
shift  # remaining args: image paths

if [ -z "$OUTPUT_LIST" ] || [ $# -eq 0 ]; then
    echo "Usage: $0 <output_list> <image1> <image2> ..."
    exit 1
fi

DURATION="${DURATION:-2.0}"

# Clear output file
> "$OUTPUT_LIST"

# Write each image with duration
for img in "$@"; do
    echo "file '$img'" >> "$OUTPUT_LIST"
    echo "duration $DURATION" >> "$OUTPUT_LIST"
done

# Last image without duration (FFmpeg quirk)
if [ $# -gt 0 ]; then
    echo "file '${@: -1}'" >> "$OUTPUT_LIST"
fi