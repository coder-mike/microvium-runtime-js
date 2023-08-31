# @microvium/runtime

A JavaScript library for executing snapshots created by the [Microvium compiler](https://github.com/coder-mike/microvium) in the browser or Node.js.


## Install

```sh
npm install @microvium/runtime
```


## Example Usage

Write a guest script:

```js
// guest.mjs

const print = vmImport(1);

function sayHello(name) {
  print(`Hello, ${name}!`)
}

vmExport(1, sayHello);
```

Compile the guest script using the [Microvium CLI](https://github.com/coder-mike/microvium):

```sh
microvium guest.mjs --output-bytes
```

Write a host script:

```js
// host.mjs

import Microvium from '@microvium/runtime';

function print(str) {
  console.log(str);
}

// Restore the snapshot
const snapshot = [/* paste snapshot bytes here */];
const imports = { 1: print };
const vm = await Microvium.restore(snapshot, imports);
const { 1: sayHello } = vm.exports;

// Call the guest
sayHello('World');
```

Run the host script:

```sh
node host.mjs   # prints "Hello, World!"
```

## Limitations

- As on a microcontroller, scripts running in Microvium can only use up to 64kB of RAM.
- The WebAssembly memory is pre-allocated as 256 kB (see [memory usage](#memory-usage) below), no matter how small the actual script is.
- Objects and arrays passed into the VM from the host are always passed by copy, not by reference. Only plain-old-data objects can be passed this way.
- Objects and functions passed out of the VM to the host are not identity-preserving, meaning that if you pass the same object multiple times, you get a different proxy in the host each time.
- Object prototypes are not preserved when passing objects between the VM and host.



## API

Terminology:

- **Host**: the program **outside** the Microvium VM. E.g. the node.js app or browser app.
- **Guest**: the program **inside** the Microvium VM.

### Restore a snapshot

```js
const vm = Microvium.restore(snapshot, imports, opts);
```

Restore a given snapshot to a running VM. Does not execute any code in the VM.

Returns the VM instance.

The snapshot can be either a `Uint8Array` or a plain array of bytes.

The imports object is a map of numeric function IDs to host functions. The function IDs must be in the range 0 to 0xFFFF. The host functions are called with the arguments passed by the Microvium script, and the return value is passed back to the Microvium script.

The `opts` object is optional and can contain the following properties:

- `opts.breakpointHit`: See [Debug interface](#debug-interface) below.

The returned `vm` has an `exports` property which has a similar structure to the `imports` except contains the functions exported by the Microvium script.

### Snapshotting

```
vm.createSnapshot()
```

Returns a `Uint8Array` that is suitable to pass back to `Microvium.restore` or run on an embedded device.


### Gas Counter

- `vm.stopAfterNInstructions(number)` stop the VM after `number` instructions have been executed. Each time this is called will reset the counter to the given value. Pass `-1` to disable the gas counter.

- `vm.getRemainingInstructions()` returns the number of instructions remaining before the VM will stop. Returns `-1` if the gas counter is disabled.


### Other properties and functions

- `engineVersion`: The version of the Microvium engine.
- `requiredEngineVersion`: The version of the Microvium engine that the snapshot was compiled for.
- `exports`: The exports of the Microvium script (see [Restore a snapshot](#restore-a-snapshot) above).
- `runGC()`: Run the garbage collector.
- `getMemoryStats()`: Get the memory usage statistics.


### Breakpoints

Pass a breakpoint callback handler to the `opts` provided to `Microvium.restore` to enable debugging. The breakpoint handler is called when a breakpoint is hit. The breakpoint handler is called with the address of the breakpoint that was hit.

The currently running bytecode address can also be inspected with `vm.currentAddress`.

Set a breakpoint with `vm.setBreakpoint(address)` or remove it with `vm.removeBreakpoint(address)`.

The addresses correspond to the Microvium bytecode addresses that you see if you compile a script with the option `--output-disassembly`. There is no way at present to map these addresses back to the original source code (but feel free to make a PR if want to implement this for me -- it would be really useful).


## Passing values to and from the VM

Values can be passed to and from the Microvium VM as function arguments and return values. The library wrapper code does its best to convert Microvium JavaScript types to host JavaScript types and vice versa.

Primitive values are always passed **by copy** (by value).

Everything passed **into** Microvium is passed **by copy**, since a Microvium VM has no `Proxy` type that would allow it to have mutable references to host objects.

Plain objects, arrays, and classes are passed **out** of Microvium **by reference** -- the wrapper library maintains a `Proxy` of the Microvium object, so that the host may mutate the Microvium object by interacting with the proxy. The proxy does not preserve the original prototype of the object.

The passing of an object to the guest by copy means each of the plain-old-data fields are copied individually. That does not include class methods or any other fields from the prototype. For certain kinds of objects such as `Promise`, `Map`, and `Set`, passing from the host to the guest in this manner will very likely not be what was intended, so Microvium will throw an error rather than copying all the own enumerable properties into a new guest object.

`Uint8Array` is passed out of Microvium not as a host `Uint8Array` but as a `MicroviumUint8Array` which has methods `slice` and `set` to read and write to it respectively. The `slice` method returns a **copy** of the requested data range as a host `Uint8Array`.

Functions and closures are be passed **out** of Microvium **by reference**. Host functions cannot be passed into Microvium at all at runtime, but can be imported from the host at build-time using `vmImport` and then satisfied by the `importMap`.


## Async-await

As noted above, a host `Promise` cannot be passed from the host to the guest. However, the guest can directly call a host `async` function and the result will be a guest promise which the guest can safely `await`. This allows the host to expose asynchronous APIs to a guest. Example:


```js
// guest.js

const hostAsyncFunction = vmImport(1);
const print = vmImport(2);
vmExport(1, run);

async function run() {
  const result = await hostAsyncFunction();
  print(`The result is ${result}`);
}
```

```js
// host.js

async function hostAsyncFunction() {
  // Delay 1000ms
  await new Promise(resolve => setTimeout(resolve, 1000));
  // Return 42
  return 42;
}

const imports = { 1: hostAsyncFunction, 2: console.log };
const vm = Microvium.restore(snapshot, imports);
const { 1: run } = vm.exports;

run();
```


## Memory usage

The bundled library (`dist/index.js`) is about 83kB and has no external dependencies. It's implemented as a lightweight JavaScript wrapper around a WebAssembly build of `microvium.c`, to run in the browser or in Node.js.

Each Microvium instance is a fixed size and takes 4 pages of WASM memory (a total of 256kB):

  - Page 0: Main RAM page for the Microvium VM and heap
  - Page 1: A copy of the snapshot
  - Page 2: Working memory for C runtime (C stack, .data memory, etc)
  - Page 3: Reserved for future use

Page 0 is used for the Microvium heap because Microvium pointer values are internally 16-bit integers and this this allows them to map directly to WASM memory offsets without any translation, making it very efficient.


## Contributing

Please help me develop/maintain this!

See also [./src/developer-notes.md](src/developer-notes.md).