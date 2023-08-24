# Microvium Runtime - Developer Notes

Note: although I'm on Windows, I'm using WSL (Ubuntu) to build because the installation instructions for Clang seems simpler on Ubuntu, and for the life of me I can't figure out how to install `wasm-ld` on Windows, when on linux it seems to come with LLVM by default. But I'm still using Windows (git-bash) to test because the tests import `../microvium` to compile JS to bytecode.

The WASM build of Microvium uses **Clang** directly, not Emscripten, since Emscripten apparently adds a bunch of extra stuff, and I wanted to keep the build output small (that's what Microvium's all about!). But also, Microvium is much more efficient if it can be compiled to execute in a single, pre-defined page of RAM, and I felt that this would be easier to control with Clang than with Emscripten. It was still more difficult than I thought - [see below](#memory-layout).

## Updating when Microvium changes

As new features or changes are made to Microvium, we need to keep this library in sync.

Note: if you haven't set up your environment yet, set it up according to [Environment Setup](#environment-setup) below.

1. In WSL: `npm run update-microvium`.
2. In WSL: `npm run build`.
3. Find calls to `assumeVersion` and check that their assumptions still hold, and update the version number for each.
3. In git-bash: `npm test`.
4. Add tests and make changes to the library.
5. Follow the release process as described below.

## Release Process

- Make sure terser is enabled in the rollup config.
- Change `build.sh` back to release mode (change the build command to use the commented-out release-mode build).
- Unskip the performance tests.

```sh
npm run update-microvium   # (wsl)
npm run build              # (wsl)
npm test                   # (git-bash)
```

- Update the readme where it says "the bundled size of the library is about" to the actual size (the size of `dist/index.js`). If this looks bigger than expected, make sure you remembered to enable terser and rebuild the WASM with optimizations.

- Optional patch version bump in package.json. The major and minor version should be tied to the Microvium version, and are updated automatically with the` npm run update-microvium` command.

```sh
npm login                  # (git-bash)
npm publish                # (git-bash)
```

## Environment Setup

### LLVM

I used this command to install llvm:

```sh
sudo bash -c "$(wget -O - https://apt.llvm.org/llvm.sh)"
```

I also installed clang using `sudo apt install clang`. Honestly I'm not sure if this is required.

Note: I'm using llvm 15, including `wasm-ld-15` which the build script invokes with this name.

### WABT

Also requires [wabt](https://github.com/WebAssembly/wabt) to be installed and on the path, for `wat2wasm` and `wasm2wat`. (Note: on npm there is a package called `wasm-wat` that also contains these tools, but they maybe aren't the latest because I get a warning when using them that some byte is not understood or something).

From a `WSL` terminal, follow the steps in the wabt readme for `cloning` and `building using CMake directly`. Don't forget the submodules.

It seems you also need to add the wabt bin directory to the path. For me this meant adding this to my `~/.profile`:

```sh
# Include WABT on the PATH
if [ -d "$HOME/wabt/bin" ] ; then
  PATH="$PATH:$HOME/wabt/bin"
fi
```

Edit: I also had some issues that `~/.profile` wasn't being loaded by default, so needed to add `source ~/.profile` to my `~/.bash_profile`. Not sure if this is the right way to do it.


## Building

I run the following from WSL:

```sh
npm run update-microvium  # Only if Microvium has changed since the last build
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
    - `isspace`
  - Implemented in JS wrapper code:
    - `fmod` as JS `x % y`
    - `pow` as JS `x ** y`
    - `snprintf` as JS `'' + x`, since it's only used for numbers
  - Wrappers around WASM builtins:
    - `INFINITY`
    - `isfinite`
    - `isnan`
    - `isinf`
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

You can debug the mocha tests using the `Mocha` launch profile in VS Code, but you can't yet do WASM debugging in VS Code.

WASM debugging seems to have recently taken a leap forward in Chrome devtools 114 (May 2023), thank goodness.

- In `scripts/build.sh`, comment out the "Release mode" mode build command and uncomment the "Debug mode" build command. This adds relevant symbols and turns off optimization.
- Comment out `terser()` in `rollup.config.mjs`
- `npm run build` (in WSL) -- builds both the WASM and the wrapper library
  - Or if only the TypeScript is changing, `ctrl+shift+B` runs the default build task which is a rollup watch run.
- Modify [tests/debug-test.html](./tests/debug-test.html)
  - Each unit test has corresponding debug bytes in `./build/dbg-xxx-bytes.js` which is output as the test runs. Copy these into the html file script section.
- git-bash `npx serve .` (in project root)
- Open `http://localhost:3000/tests/debug-test.html`

This gives you C source level debugging. `debug-test.html` uses the unmodified WASM output from Clang which includes source maps. It uses `WebAssembly.compileStreaming` which references the actual WASM file instead of the base64 string, which I think helps devtools to find the corresponding C source files.

The unit tests use a `compile` function to compile snapshots, which also has the intended effect of outputting the snapshot bytes to `./build/dbg-xxx-bytes.js` so the appropriate snapshot can be pasted into `./tests/debug-test.html`.


## Membrane Caching, Handles, and Identity Preservation

The C glue code allocates space for 2048 Microvium handles (about 8 bytes each) that the host can use to hold references to GC-allocated values in the VM. This includes objects and strings, etc.

When the host calls into the VM, the translation of the arguments from the host to the VM may involve adding new allocations to the Microvium heap, such as for copying across strings or objects. These handles are released after the function call.

If the host calls the VM with multiple arguments, such as `say('hello', 'world')`, the allocation of a later argument may trigger a GC collection which causes the memory of the first argument to move, so this must be accounted for by using handles all the way until the very last moment before the call, where the handles are resolved to pass the raw values across the membrane.

When the VM calls the host, the return value may similarly need to be allocated on the VM heap, but the handle for this is released immediately because when it crosses the boundary, Microvium will be responsible for tracking it.

When an object is passed from the VM to the host, a proxy is created in the host. The proxy owns a handle to the corresponding object in the VM. When the host proxy is garbage collected, the handle must be freed as well, to allow the VM to free the corresponding object. This is done using a finalization registry.

If the host passes the same proxy back into the VM, the membrane must recognize that it's a VM object and so translate it to the corresponding handle. This is done using a `WeakMap` table called `cachedValueToVm1`, mapping proxies to their corresponding handle. The handles in this table are only accessible so long as the key is live.

As mentioned earlier, the handle should only be resolved at the very last moment since the conversion of other arguments may trigger a GC cycle which moves things around. During the call, the handle is owned by both the proxy and the call machinery, so handles are reference counted.

Unfortunately, if the same VM object is passed to the host multiple times, it will get a new proxy every time. This is because Microvium doesn't have a data structure like a `WeakMap` that can be used to cache the conversion information. We could maintain the identity by searching all the open handles, but this would be an expensive linear search, so instead I'm settling for the fact that translations from Microvium to the host are not necessarily identity-preserving.

Functions are more complicated. Closure functions behave like objects: they are GC-allocated and stateful. They follow the same rules as objects - they are marshalled to the host by-reference with a wrapper proxy which owns a handle. They appear in the `cachedValueToVm1` table so that if/when they're transferred back to the VM, the original VM value is restored via the handle.

VM functions (in the bytecode) are non-moving but they're still associated with a handle because it's convenient to use the same machinery for closures and non-moving functions. They are cached in `cachedValueToVm2` which is a `Map` rather than a `WeakMap`, primarily so that it can also map strings and other ROM allocations, and because the function is in ROM so it exists permanently, so it's ok for the proxy to be allocated permanently.

On the topic of strings, strings in the ROM internal table are also cached in `cachedValueToVm2` at startup so that translation of host strings to VM strings can be efficient when the string is a property key or other well-known string (e.g. strings used as enum values etc). See `cacheInternedStrings`.

Host function references in the VM (`TC_REF_HOST_FUNC`) must refer to a function in the host which is in the import table. When passed to the host, these are unwrapped to their original host function value and added to the `cachedValueToVm1` table with an allocated handle. The reason to use a handle is that `TC_REF_HOST_FUNC` is a heap-allocated type, so the target can move.

Going the other direction, if a function is passed from the host to the VM, it will:

  1. First check `cachedValueToVm1` which will find any pre-existing `TC_REF_HOST_FUNC` functions previously passed out of the VM.
  2. Then check `cachedValueToVm2` which will find any VM bytecode functions that have been passed out of the VM.
  3. Then it will check the import table. If the function is an import but was not found by (1), then we can allocate a new `TC_REF_HOST_FUNC` and add it to `cachedValueToVm1` for future.
  4. Otherwise, it will throw. Arbitrary host functions can't be passed to the VM at the moment because there is currently no way of referencing them from the VM runtime. In future, it could probably be done using `TC_REF_VIRTUAL`, but this isn't implemented yet.

Note: a `TC_REF_HOST_FUNC` record contains the *index* of the host function in the import table, not the ID. To get the index, the library reads the index table at startup and builds a map from the provided host function to the corresponding index in the index table.