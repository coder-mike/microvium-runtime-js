// Note: run `npm run build` to create this file
import { microviumWasmBase64 } from './microvium-wasm-base64';

export type AnyFunction = (...args: any[]) => any;
export type Exports = Record<number, AnyFunction>;
export type Imports = Record<number, AnyFunction>;

export default {
  restore
}

const microviumWasmRaw = globalThis.atob(microviumWasmBase64);
const rawLength = microviumWasmRaw.length;
const microviumWasmBytes = new Uint8Array(new ArrayBuffer(rawLength));
for (let i = 0; i < rawLength; i++) {
  microviumWasmBytes[i] = microviumWasmRaw.charCodeAt(i);
}
const modulePromise = WebAssembly.compile(microviumWasmBytes.buffer);

const noOpFunc = Object.freeze(() => {});

const notImplemented = () => { throw new Error('Not implemented') }
const assert = x => { if (!x) throw new Error('Assertion failed') }
const check = errorCode => { if (errorCode !== 0) throw new Error(`Microvium Error: ${errorCode}`) }

const TextEncoder = typeof require !== 'undefined'
  ? require('util').TextEncoder // node.js
  : globalThis.TextEncoder; // browser
const TextDecoder = typeof require !== 'undefined'
  ? require('util').TextDecoder // node.js
  : globalThis.TextDecoder; // browser

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function restore(snapshot: ArrayLike<number>, imports: Imports) {
	const memory = new WebAssembly.Memory({ initial: 3, maximum: 4 });
	const memArray = new Uint8Array(memory.buffer);
	const mem16 = new Uint16Array(memory.buffer);
  const readWord = address => mem16[address >>> 1];
  const writeWord = (address, value) => mem16[address >>> 1] = value;
  const objectProxyHandler = makeObjectProxyHandler();

  // This implementation assumes that the imports don't change over time.
  Object.freeze(imports);

	const wasmImports = {
		env: {
			memory: memory,
			mvm_fatalError: (vm, code) => {
        const msg = `Microvium fatal error: code ${code}`;
        console.error(msg);
        throw new Error(msg);
      },
      fmod: (x, y) => x % y,
      pow: (x, y) => x ** y,
      invokeHost,
      importRequired: (id) => {
        if (!(id in imports)) {
          throw new Error(`VM requires import ${id} but not provided`)
        }
      }
		}
	};

  const module = await modulePromise;
  const instance = await WebAssembly.instantiate(module, wasmImports);

  const exports = instance.exports;
  const {
    allocator_init,
    reserve_ram,
    reserve_rom,
    mvm_restore,
    generalPurpose1,
    generalPurpose2,
    generalPurpose3,
    mvm_resolveExports,
    mvm_call,
    mvm_newNumber,
    argsTemp,
  } = exports as any;
  const gp2 = generalPurpose2.value;
  const gp3 = generalPurpose3.value;
  const ramStart = reserve_ram.value;
  const romStart = reserve_rom.value;
  const pArgsTemp = argsTemp.value;

  // ROM is positioned in memory directly after RAM
  const ramSize = romStart - ramStart;

  // The RAM must be linked at address 0 and be exactly 64kB. The allocator is
  // hard-coded to use this range because it means that 16-bit Microvium
  // addresses directly correspond to memory offsets without any modification.
  assert(ramStart === 0);
  assert(ramSize === 0x10000);
  allocator_init(ramStart, ramSize);

  // Copy the snapshot into ROM
  assert(snapshot.length < 0x10000);
  memArray.set(snapshot, romStart);

  check(mvm_restore(
    generalPurpose1, // *result
    romStart, // snapshotBytecode
    snapshot.length, // bytecodeSize
    0, // context
    2, // resolveImport
  ));

  const vm = readWord(generalPurpose1);

  const cachedExports: Exports = {};
  const cachedValueToVm = new WeakMap();
  const cachedValueToHost = new Map<number, any>();


  debugger;

  return {
    exports: new Proxy({}, {
      get(_, p) {
        if (p in cachedExports) return cachedExports[p];
        if (typeof p === 'symbol') return undefined; // No symbol-keyed exports
        const i = parseInt(p);
        if ((i | 0) !== i) return 0; // No non-integer exports
        const vmExport = resolveExport(i);
        const hostExport = valueToHost(vmExport);
        return hostExport;
      }
    }) as Exports
  }

  function invokeHost(vm, hostFunctionID, out_vmpResult, vmpArgs, argCount) {
    const hostArgs: any[] = [];
    let vmpArg = vmpArgs;
    for (let i = 0; i < argCount; i++) {
      const vmArg = readWord(vmpArg);
      const hostArg = valueToHost(vmArg);
      hostArgs.push(hostArg);
      vmpArg += 2;
    }
    const resolveTo = imports[hostFunctionID];
    const result = resolveTo(...hostArgs);
    const vmResult = valueToVM(result);
    writeWord(out_vmpResult, vmResult);
    return 0;
  }

  function resolveExport(id) {
    writeWord(gp2, id);
    check(mvm_resolveExports(
      vm,
      gp2, /* *ids */
      gp3, /* *results */
      1, /* count */
    ));
    return readWord(gp3);
  }


  function print(s) {
    console.log(s);
  }

  function valueToVM(hostValue) {
    switch (typeof hostValue) {
      case 'undefined': return 0x01;
      case 'boolean': return hostValue ? 0x09 : 0x0D;
      case 'number': {
        // int14
        if ((hostValue | 0) === hostValue && hostValue >= -0x2000 && hostValue <= 0x1FFF1) {
          return (hostValue << 2) | 3;
        }
        return mvm_newNumber(vm, hostValue);
      }
      case 'string': {
        // I'm thinking to directly inject the string into Microvium memory
        // rather than going through mvm_newString, because mvm_newString would
        // require 2 copies: one to get it into the WASM memory and one to copy
        // it into Microvium.
        notImplemented();
      }

    }
    // TODO
    notImplemented();
  }

  function valueToHost(vmValue) {
    // TODO: Remember: for pointers to ROM, we don't need to wrap with a handle
    debugger;

    // Int14
    if ((vmValue & 3) === 3) {
      // Use the 16th bit as the sign bit
      return (vmValue << 16) >> 18;
    }

    let address;

    // Short pointer
    if ((vmValue & 1) === 0) {
      address = vmValue;
    }

    // Bytecode-mapped pointer
    else if ((vmValue & 3) === 1) {
      // Well known values
      if (vmValue <= 0x25) {
        switch (vmValue) {
          case 0x01: return undefined;
          case 0x05: return null;
          case 0x09: return true;
          case 0x0D: return false;
          case 0x11: return NaN;
          case 0x15: return -0;
          case 0x19: return undefined;
          case 0x1D: return 'length';
          case 0x21: return '__proto__';
          case 0x25: return noOpFunc;
        }
      }

      // TODO Indirection through handles

      // Plain bytecode pointer
      address = romStart + (vmValue & 0xFFFC);
    }

    if (address >= romStart && cachedValueToHost.has(address)) {
      return cachedValueToHost.get(address)!;
    }

    const result = addressValueToHost(vmValue, address);

    // Cache ROM values (TODO: I haven't thought through RAM values yet)
    if (address >= romStart) {
      cachedValueToHost.set(address, result);
    }

    return result;
  }

  function addressValueToHost(vmValue, address) {
    const headerWord = readWord(address - 2);
    const typeCode = headerWord >>> 12;
    const size = headerWord & 0xFFF;
    switch (typeCode) {
      // Int32
      case 0x1: return readWord(address) | readWord(address + 2);
      // Float64
      case 0x2: {
        const temp = new Float64Array(memory.buffer, address, 1);
        return temp[0];
      }
      // String
      case 0x3:
      case 0x4: {
        const temp = new Uint8Array(memory.buffer, address, size - 1);
        return textDecoder.decode(temp);
      }
      // Function
      case 0x5: {
        return (...hostArgs: any[]) => {
          // We only have space for 64 arguments in argsTemp
          if (hostArgs.length > 64) {
            throw new Error('Too many arguments')
          }
          for (let i = 0; i < hostArgs.length; i++) {
            const vmArg = valueToVM(hostArgs[i]);
            writeWord(pArgsTemp + i * 2, vmArg);
          }
          assert(address >= romStart); // Functions are stored in ROM so we don't need a handle
          check(mvm_call(vm, vmValue, gp2, pArgsTemp, hostArgs.length));
          const vmResult = readWord(gp2);
          const hostResult = valueToHost(vmResult);
          return hostResult;
        }
      }
      // Host function
      case 0x6: {
        const indexInImportTable = readWord(address);
        return imports[indexInImportTable];
      }
      // Uint8Array
      case 0x7: {
        // Note: this is passed out by-copy because the underlying uint8array
        // can move in memory. If we wanted it to be mutable, we'd have to
        // implement the whole Uint8Array interface on top of a Microvium
        // handle.
        return new Uint8Array(memory.buffer.slice(address, size - 1));
      }
      // Class
      case 0x9: {
        return notImplemented();
      }

      // Object
      case 0xC: {
        return notImplemented();
        // return new Proxy({}, objectProxyHandler);
      }

      default: notImplemented();
    }
  }

  function makeObjectProxyHandler() {

  }
}