# Microvium Runtime - Developer Notes

Note: although I'm on Windows, I'm using WSL (Ubuntu) to build because the installation instructions for Clang seems simpler on Ubuntu, and for the life of me I can't figure out how to install `wasm-ld` on Windows, when on linux it seems to come with LLVM by default.

The WASM build of Microvium uses **Clang** directly, not Emscripten, since Emscripten apparently adds a bunch of extra stuff, and I wanted to keep the build output small (that's what Microvium's all about!). But also, Microvium is much more efficient if it can be compiled to execute in a single, pre-defined page of RAM, and I felt that this would be easier to control with Clang than with Emscripten. It was still more difficult than I thought - [see below](#notes-about-memory-layout).


## Environment Setup

### LLVM

I used this command to install llvm:

```sh
sudo bash -c "$(wget -O - https://apt.llvm.org/llvm.sh)"
```

I also installed clang using `sudo apt install clang`. Honestly I'm not sure if this is required.

Note: I'm using llvm 15, including `wasm-ld-15` which the build script invokes with this name.

### WABT

Also requires [wabt](https://github.com/WebAssembly/wabt) to be installed and on the path, for `wat2wasm` and `wasm2wat`. (Note: on npm there is a package called `wasm-wat` that also contains these tools, but they maybe aren't the latest because I get a warning when using them that some byte is not understood or something). Follow the steps in the wabt readme for `cloning` and `building`. Don't forget the submodules.

If you're running in WSL, WABT also needs to be in WSL (and WABT is easier to install in WSL anyway).

It seems you also need to add the wabt bin directory to the path. For me this meant adding this to my `~/.profile`:

```sh
# Include WABT on the PATH
if [ -d "$HOME/wabt/bin" ] ; then
  PATH="$PATH:$HOME/wabt/bin"
fi
```



## Building

```sh
./scripts/build.sh
```

## C Standard library

Microvium only uses a handful of functions and definitions from the C standard library (libc). Clang doesn't provide a libc by default. There exists something called wasi-libc which implements libc for WebAssembly, but it does so assuming the environment supports WASI, which is a system-level API for accessing things like file IO etc, none of which Microvium uses.

So the solution I went with in the end was to implement the few functions and definitions that were needed.

  - Standard integer definitions:
    - `int8_t`
    - `uint8_t`
    - `int16_t`
    - `uint16_t`
    - `int32_t`
    - `uint32_t`
    - `INT32_MIN`
  - Implemented in C:
    - `memcmp`
    - `strlen`
    - `isdigit`
  - Implemented in JS wrapper code:
    - `fmod` as JS `x % y`
    - `pow` as JS `x ** y`
  - Wrappers around WASM builtins:
    - `INFINITY`
    - `isfinite`
    - `isnan`
    - `signbit`
    - `memset`
    - `memcpy`

## Memory layout

For Microvium to run most efficiently, the Microvium heap should use all and only the first page of WASM memory, since this is the page that is directly accessible by a 16-bit unsigned integer, which is the Microvium native value type.

The allocator (`allocator.c`) is hard-coded to assume that the Microvium heap RAM is in this range (addresses 0 to 0xFFFF).

The linker is what controls the memory layout, and the WASM linker for Clang is called `wasm-ld`, which apparently a "port" of the normal `lld` linker but for WASM. Unfortunately, it doesn't seem that `wasm-ld` supports any way of manually laying out the memory, but I achieved it in the following hacky way:

  - The variable `reserve_ram` in `allocator.c` reserves 64kB of space for the Microvium heap.
  - `reserve_ram` is declared `const` even though the memory is writable, because `const` puts it into the `.data` section, which `wasm-ld` seems to put first.
  - `reserve_ram` is the first variable in `allocator.c` so that it's at the earliest address for this compilation unit.
  - `allocator.o` is the first compilation unit linked by linker command, so that `reserve_ram` is the first variable in the `.data`.
  - By default, the `.data` section seems to be put at address `0x400`, but the linker option `--global-base=0` moves this to address 0.
  - Putting `reserve_ram` in the `.data` section has the side effect of capturing the whole initial value (64kB of zeros) into the WASM file. So the build process strips this by converting WASM to WAT and then manually modifying this initializer, and then converting back to WASM.


## Testing

`npm test` uses mocha with ts-node. It also leverages `microvium` as a library to do the compilation.


## Debugging

Mostly I haven't found a good way to do debugging. The tests can only really run on node.js because they leverage the Microvium compiler to compile the snapshot. But WASM debugging in node.js is non-existent at the moment.

The best I've come up with is `./tests/debug-test.html`. Edit that file with the test you want to debug. It uses the unmodified wasm output from Clang and could in principle use source maps if I can one day figure out how to do that. It uses `WebAssembly.compileStreaming` instead of the default module from the base64 string, again to make it easier to debug. The unit tests use a `compile` function to compile snapshots, which also has the side effect of outputting the snapshot bytes to `./build/dbg-xxx-bytes.js` so the appropriate snapshot can be pasted into `./tests/debug-test.html`.

