//sarva-tech-extension-ffmpeg/readme.md

# Sarva Tech Extension Example: FFmpeg

This is a functional prototype of the technology-extension format discussed
for Sarva.

## What it demonstrates

1. Sarva discovers a technology requirement from a prompt.
2. The extension declares the technology and download source.
3. Sarva downloads the binary payload into the user's extension directory.
4. The payload is verified with SHA-256 before installation.
5. `ffmpeg` and `ffprobe` are installed locally inside the extension.
6. Wizard hints tell the Prompt IDE which UI capabilities can be exposed.
7. Sarva core does not need FFmpeg in Cargo.toml and does not need to put
   `video_worker.rs` into the core.


## Instalasi

### Linux / macOS

    
    chmod +x install.sh
    ./install.sh ~/.local/share/sarva/extensions/org.sarva.tech.ffmpeg

The extension then provides:

    ~/.local/share/sarva/extensions/org.sarva.tech.ffmpeg/bin/ffmpeg
    ~/.local/share/sarva/extensions/org.sarva.tech.ffmpeg/bin/ffprobe

### Windows
.\install.ps1 $env:APPDATA\sarva\extensions\org.sarva.tech.ffmpeg

## Important architectural point

The manifest is NOT the executable itself. It is the contract that tells
Sarva:

- what technology exists,
- where its payload comes from,
- how to verify it,
- what capabilities it provides,
- which wizard hints it can activate,
- and which command paths the runtime should expose.

The Prompt IDE can therefore remain prompt-driven while the runtime handles
the actual technology installation and execution.
