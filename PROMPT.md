# FFmpeg Tech Extension — Prompt Contract

## Capability

When this extension is installed, Sarva may expose FFmpeg capabilities to an
AI Twin or Prompt IDE. The model must not call `ffmpeg` from PATH. It must use
the registered extension command supplied by Sarva.

## Capability Hints

- `media.video.render_slideshow` — Render slideshow from images
- `media.video.extract_frame` — Extract frame from video
- `media.audio.extract` — Extract audio from video
- `media.inspect` — Inspect media metadata

## Wizard Hints

If the prompt asks for video processing, the wizard may expose:

- Convert Video
- Extract Frame
- Resize Video
- Transcode Video

If the prompt asks for image processing, the wizard may expose:

- Extract Frame from Video
- Convert Image

If the prompt asks for audio processing, the wizard may expose:

- Extract Audio
- Convert Audio

## Important

The extension is not Rust source code added to `src-tauri/src`.
It is an independently installed technology package.

The extension is installed under:

`~/.local/share/sarva/extensions/org.sarva.tech.ffmpeg/`

Sarva core remains unchanged.

## Pending Action Flow

When image dimensions are mixed, the extension will:

1. Detect mixed dimensions via ffprobe.
2. Create a pending action with all render parameters.
3. Ask user: "Apakah Anda ingin melanjutkan dengan rasio XxY?"
4. User confirms with "ya" or provides a different ratio.
5. Extension resumes render with final parameters.