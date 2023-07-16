# @microvium/runtime

*Run Microvium snapshots on a JavaScript host*

************ UNDER DEVELOPMENT. NOT READY FOR USE. **********

JavaScript library for executing [Microvium](https://github.com/coder-mike/microvium) snapshots. It does not include the Microvium compiler to produce those snapshots (see [Microvium](https://github.com/coder-mike/microvium)).

Implemented as a lightweight JavaScript wrapper around a WebAssembly build of `microvium.c`, to run in the browser or in Node.js.


## Limitations

- As on a microcontroller, scripts running in Microvium can only use up to 64kB of RAM.
- The WebAssembly memory is pre-allocated as 256 kB (see [memory usage](#memory-usage) below), no matter how small the actual script is.
- Objects and functions passed from the VM to the host are not identity-preserving, meaning that if you pass the same object multiple times, you may get a different proxy in the host each time.


## Install

```sh
npm install @microvium/runtime
```

## Usage

```js
import Microvium from '@microvium/runtime';

// Snapshot can be Uint8Array or plain array from running
// `microvium script.js --output-bytes`
const snapshot = [/* ...bytes... */];

// Functions in the host that the snapshot can call, each
// associated with a numeric ID in the range 0 to 0xFFFF.
const importMap = {
  [4321]: (arg) => console.log(arg);
};

// Restore a snapshot
const vm = Microvium.restore(snapshot, importMap);

// Resolve functions that the snapshot exports
const sayHello = vm.exports[1234];

// Call functions in the vm
sayHello('Hello');
```


## Passing values to and from the VM

Values can be passed to and from the Microvium VM as function arguments and return values. The library wrapper code does its best to convert Microvium JavaScript types to host JavaScript types and vice versa.

Primitive values are always passed **by copy** (by value).

Everything passed **into** Microvium is passed **by copy**, since a Microvium VM has no `Proxy` type that would allow it to have mutable references to host objects.

Plain objects and arrays are passed **out** of Microvium **by reference** -- the wrapper library maintains a `Proxy` of the Microvium object, so that the host may mutate the Microvium object by interacting with the proxy.

`Uint8Array` is passed out of Microvium not as a host `Uint8Array` but as a `MicroviumUint8Array` which has methods `slice` and `set` to read and write to it respectively.

Functions and closures are be passed **out** of Microvium **by reference**. Host functions cannot be passed into Microvium at all at runtime, but can be imported from the host at build-time using `vmImport` and then satisfied by the `importMap`.


## Memory usage

The bundled library (`dist/index.js`) is about 60kB and has no external dependencies.

Each Microvium instance is a fixed size and takes 4 pages of memory (a total of 256kB):

  - Page 0: Main RAM page for the Microvium VM and heap
  - Page 1: A copy of the snapshot
  - Page 2: Working memory for C runtime (C stack, .data memory, etc)
  - Page 3: Reserved for future use

Page 0 is used for the Microvium heap because Microvium pointer values are internally 16-bit integers and this this allows them to map directly to WASM memory offsets without any translation, making it very efficient.


## Contributing

Please help me develop/maintain this!

See also [./src/developer-notes.md](src/developer-notes.md) and [./todo](todo).