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

Note: [there does exist](https://developer.chrome.com/blog/wasm-debugging-2020/) a way to get C source-level debugging in devtools, but I can't get it working for some reason.

## Membrane Caching, Handles, and Identity Preservation

The C glue code allocates space for 2048 Microvium handles (about 8 bytes each) that the host can use to hold references to GC-allocated values in the VM. This includes objects and strings, etc.

When the host calls into the VM, the translation of the arguments from the host to the VM may involve adding new allocations to the Microvium heap, such as for copying across strings or objects. These handles are released after the function call.

If the host calls the VM with multiple arguments, such as `say('hello', 'world')`, the allocation of a later argument may trigger a GC collection which causes the memory of the first argument to move, so this must be accounted for by using handles all the way until the very last moment before the call, where the handles are resolved to pass the raw values across the membrane.

When the VM calls the host, the return value may similarly need to be allocated on the VM heap, but the handle for this is released immediately because when it crosses the boundary, Microvium will be responsible for tracking it.

When an object is passed from the VM to the host, a proxy is created in the host. The proxy owns a handle to the corresponding object in the VM. When the host proxy is garbage collected, the handle must be freed as well, to allow the VM to free the corresponding object. This is done using a finalization registry.

If the host passes the same proxy back into the VM, the membrane must recognize that it's a VM object and so translate it to the corresponding handle. This is done using a `WeakMap` table called `cachedValueToVm1`, mapping proxies to their corresponding handle. The handles in this table are only accessible so long as the key is live, which guarantees that the handle is not garbage collected.

As mentioned earlier, the handle should only be resolved at the very last moment since the conversion of other arguments may trigger a GC cycle which moves things around. During the call, the handle is owned by both the proxy and the call machinery, so handles are reference counted.

Unfortunately, if the same VM object is passed to the host multiple times, it will get a new proxy every time. This is because Microvium doesn't have a data structure like a `WeakMap` that can be used to cache the conversion information. We could maintain the identity by searching all the open handles, but this would be an expensive linear search, so instead I'm settling for the fact that translations from Microvium to the host are not necessarily identity-preserving.

Functions are more complicated. Closure functions behave like objects: they are GC-allocated and stateful. They follow the same rules as objects - the are marshalled to the host by-reference with a wrapper proxy which owns a handle. They appear in the `cachedValueToVm1` table so that if/when they're transferred back to the VM, the original VM value is restored via the handle.

VM functions (in the bytecode) are non-moving so they aren't associated with a handle. The are cached in `cachedValueToVm2` which is a `Map` rather than a `WeakMap`, primarily so that it can also map strings and other ROM allocations.

On the topic of strings, strings in the ROM internal table are also cached in `cachedValueToVm2` at startup so that translation of host strings to VM strings can be efficient when the string is a property key or other well-known string (e.g. strings used as enum values etc).

Host function references in the VM (`TC_REF_HOST_FUNC`) must refer to a function in the host which is in the import table. When passed to the host, these are unwrapped to their original host function value and added to the `cachedValueToVm1` table with an allocated handle (TODO). The reason to use a handle is that `TC_REF_HOST_FUNC` is a heap-allocated type, so the target can move.

Going the other direction, if a function is passed from the host to the VM, it will:

  1. First check `cachedValueToVm1` which will find any pre-existing `TC_REF_HOST_FUNC` functions previously passed out of the VM.
  2. Then check `cachedValueToVm2` which will find any VM bytecode functions that have been passed out of the VM.
  3. The it will check the import table (TODO). If the function is an import but was not found by (1), then we can allocate a new `TC_REF_HOST_FUNC` and add it to `cachedValueToVm1` for future.
  4. Otherwise, it will throw. Arbitrary host functions can't be passed to the VM at the moment because there is currently no way of referencing them from the VM runtime. In future, it could probably be done using `TC_REF_VIRTUAL`, but this isn't implemented yet.

