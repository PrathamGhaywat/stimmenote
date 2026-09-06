# Stimmenote

Stimmenote is a small, local voice dictation app. Record from any available microphone, transcribe the recording with Whisper, edit the result, and copy it wherever you need it.

Transcription runs locally. Audio is converted to 16 kHz mono and passed to a native `whisper.cpp` command-line runtime.

## Features

- Local speech-to-text with Whisper tiny
- Microphone selection with device hot-plug support
- Editable transcript output
- Copy-to-clipboard
- Windows, macOS, and Linux build targets

## Requirements

For a release build, use the published installer for your platform. The first Windows launch can download the Whisper model and runtime from the app.

For development:

- Git and Git LFS
- Rust and Cargo
- Bun
- CMake and a C/C++ toolchain

## Development

Clone the repository and fetch the model files:

```bash
git clone https://github.com/PrathamGhaywat/stimmenote.git
cd stimmenote
git lfs pull
bun install
```

Start the desktop app:

```bash
bun run tauri dev
```

Build an installer:

```bash
bun run tauri build
```

### Whisper runtime

Release builds bundle a platform-native `whisper-cli` executable in `src-tauri/binaries` during CI. For local development, place the executable for your platform there:

- Windows: `whisper-cli.exe`
- macOS/Linux: `whisper-cli`

The runtime must accept:

```text
whisper-cli -m <model> -f <wav> -otxt -of <output-prefix>
```

The Whisper model is downloaded to the platform app-data directory when it is missing. Model and runtime downloads are never committed to the repository.

## Troubleshooting

- If no audio is recorded, choose another device from the Input menu and check the operating system microphone permission.
- If transcription cannot start, download the Whisper model and runtime, or confirm that `whisper-cli` is present in `src-tauri/binaries` for a local build.
- Unsigned development and release installers may trigger operating-system security warnings.

## License

This project is released under the MIT License. See [LICENSE](LICENSE).