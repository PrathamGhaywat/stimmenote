# Stimmenote - An awesome and simple voice dictation app
Stimmenote is a simple voice dictation app that uses a whisper tiny model to convert your yapping into raw transcript, which you can convert into a beautiful, readable text into seconds with the more capable s1-mini model, which transforms the transcript into the way you like with multiple options on how to structure the text.

## Features
- Ultra fast and simple to use! Made possible by custom quantization of the s1-mini models and a llama.cpp + whisper.cpp based runtime!
- Convert raw transcript into 4 different styles: formal, semi-formal, semi-casual and casual.
- Written in Rust for tiny footprint and in React for a beautiful UI.

## Installation
System requirements:
- Minimum 8GB RAM (recommended 16GB RAM)
- Minimum 2GB Storage free (recommended 3GB, required for the models)
- Microphone (the less sound distortions the audio has, the better)

To install it, headover to the [releases](https://github.com/PrathamGhaywat/stimmenote/releases) tab, and get an appropriate installer for your computer.

### Note to Apple and Windows users:
Since this app has not been signed for either Windows or Apple maschines, it may trigger Anti Virus. 
#### Fix for windows:
When prompted to install the app, the windows defender might say that the app is not trusted, there will be a tiny option on the bottom right of the dialog that says: "Run anyway", you will have to click that.

#### Fix for Apple users:
You will have to find a way to install it by enabling an option somewhere in your settings or via the command line to trust this app, if the opening of the app fails

### Self-compiling:
System Requirements:
- Recommended 16GB RAM
- Atleast 10GB space
- [Git](https://git-scm.com) and [Git LFS](https://git-lfs.com) installed
- [Rust with cargo](https://rust-lang.org/tools/install/)
- [Bun v1.4](https://bun.com)
- [CMake](https://cmake.org)
- [Clang+LLVM](https://github.com/llvm/llvm-project)
- [Ninja](https://github.com/ninja-build/ninja)

1. Clone the repository alongside the models:
```bash
git clone https://github.com/PrathamGhaywat/stimmenote
cd stimmenote
git lfs pull
```

2. Windows compatibility
If your are on windows, please ensure to follow this step (otherwise you can skip it):
```bash
$env:LIBCLANG_PATH="path/to/libclang.dll" # the path to the DLL file of libclang
$env:CMAKE_GENERATOR="Ninja" # set the cmake generator as ninja (required for whisper.cpp and llama.cpp)
$env:PATH="path/to/ninja;"+$env:PATH # anywhere with Ninja installed (e.g C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja)
```

3. Install the dependencies
```bash
# Rust dependencies
cd src-tauri
cargo build
cd ..
# Bun dependencies
bun install
```


4. Build the project
```bash
bun tauri build # using bun. if you want to build using cargo use: cd src-tauri; cargo build: cd ..
```

## License
This project is opensource under the MIT License. See the [LICENSE file](LICENSE) for more details.

## Problems
If you encounter any issues while using the projects, whether it's bugs or feature ideas, please open an issue describing the matter in detail. I will try to take a look at it.

If you liked this project, please star it and follow me on [X (formerly Twitter)](https://x.com/@prathamghaywat). 