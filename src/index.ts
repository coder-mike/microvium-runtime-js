// Note: run `npm run build` to create microvium-wasm-base64.ts. While it's
// technically less efficient to use an embedded base64 string, the extra 12kB
// or so probably won't make any realistic difference to anyone at the moment
// but it's incredibly convenient for users since there's currently no way to
// directly `import` a WASM file in JavaScript without setting up a bundler to
// handle it for you.
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

const TextEncoder_ = typeof require !== 'undefined'
  ? require('util').TextEncoder // node.js
  : globalThis.TextEncoder; // browser
const TextDecoder_ = typeof require !== 'undefined'
  ? require('util').TextDecoder // node.js
  : globalThis.TextDecoder; // browser

const textEncoder = new TextEncoder_();
const textDecoder = new TextDecoder_();



async function restore(snapshot: ArrayLike<number>, imports: Imports) {
	const memory = new WebAssembly.Memory({ initial: 4, maximum: 4 });
	const memArray = new Uint8Array(memory.buffer);
	const mem16 = new Uint16Array(memory.buffer);
  const readWord = address => mem16[address >>> 1];
  const writeWord = (address, value) => mem16[address >>> 1] = value;
  const objectProxyHandler = makeObjectProxyHandler();
  const tempBuffer = new Uint8Array(8);
  const tempFloat64Buffer = new Float64Array(tempBuffer.buffer);

  class HandleWrapper {
    constructor(private handle: number) {}
    release() { release(vm, this.handle); }
    get value() { return readWord(this.handle + 4); } // the second field inside the handle is the value it refers to
    get _dbgValue() { return valueToHost(this.value); }
  }

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
    alloc,
    release,
    initHandles,
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
  initHandles();

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
    let vmResult = valueToVM(result);
    // We can release the handle immediately because we're about to pass the
    // value back to the VM and no GC cycle can happen between now and when the
    // VM uses the returned value.
    if (vmResult instanceof HandleWrapper) {
      const value = vmResult.value;
      vmResult.release();
      vmResult = value;
    }
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

  function gcAllocate(size: number, typeCode: number) {
    assert((size & 0xFFF) === size);
    assert((typeCode & 0xF) === typeCode);

    // Note: the VM returns a Microvium handle because handles are stable across
    // garbage collection cycles. The glue code has 2048 available handles as of
    // this writing.
    const handle = alloc(vm, size, typeCode);
    if (!handle) {
      throw new Error('Microvium: runtime has run out of handles. This could happen if there are too many objects in the VM that are being referenced by live references in the host')
    }
    // Pointer to the allocated memory in the GC heap
    const ptr = readWord(generalPurpose1);
    const handleWrapper = new HandleWrapper(handle);
    assert(handleWrapper.value === ptr);

    return handleWrapper;
  }

  // Returns an mvm_Value (number) or a HandleWrapper
  function valueToVM(hostValue) {
    switch (typeof hostValue) {
      case 'undefined': return 0x01;
      case 'boolean': return hostValue ? 0x09 : 0x0D;
      case 'number': {
        // int14
        if ((hostValue | 0) === hostValue && hostValue >= -0x2000 && hostValue <= 0x1FFF1) {
          return (hostValue << 2) | 3;
        }
        if (isNaN(hostValue)) return 0x11;
        if (Object.is(hostValue, -0)) return 0x15;
        return mvm_newNumber(vm, hostValue);
      }
      case 'string': {
        if (hostValue === '__proto__') return 0x21;
        if (hostValue === 'length') return 0x1D;

        const bytes = textEncoder.encode(hostValue);
        const size = bytes.length + 1; // Size including added null terminator
        const handle = gcAllocate(size, 0x03);
        const ptr = handle.value;
        memArray.set(bytes, ptr);
        memArray[ptr + size - 1] = 0; // Null terminator

        return handle;
      }
      case 'object': {
        if (hostValue === null) return 0x05;
        break;
      }

    }
    // TODO
    notImplemented();
  }

  function valueToHost(vmValue) {
    // TODO: Remember: for pointers to ROM, we don't need to wrap with a handle

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
      case 0x1:
        return readWord(address) | (readWord(address + 2) << 16);
      // Float64
      case 0x2: {
        // Copy from the VM memory to the new buffer. Note: we need to copy the
        // data out because `Float64Array` can't be
        tempBuffer.set(memArray.subarray(address, address + 8));
        return tempFloat64Buffer[0];
      }
      // String
      case 0x3:
      case 0x4: {
        // Note: the `-1` is to remove the extra null terminator that Microvium
        // adds to all strings.
        const temp = new Uint8Array(memory.buffer, address, size - 1);
        return textDecoder.decode(temp);
      }
      // Function
      case 0x5: {
        return (...hostArgs: any[]) => {
          // We only have space for 64 arguments in argsTemp
          const maxArgs = 64;
          if (hostArgs.length > maxArgs) {
            throw new Error(`Too many arguments (Microvium WASM runtime library only supports ${maxArgs} arguments)`)
          }
          let argHandlesToRelease: HandleWrapper[] | undefined;
          for (let i = 0; i < hostArgs.length; i++) {
            let vmArg = valueToVM(hostArgs[i]);
            if (vmArg instanceof HandleWrapper) {
              argHandlesToRelease ??= [];
              argHandlesToRelease.push(vmArg);
              vmArg = vmArg.value;
            }
            writeWord(pArgsTemp + i * 2, vmArg);
          }
          assert(address >= romStart); // Functions are stored in ROM so we don't need a handle
          check(mvm_call(vm, vmValue, gp2, pArgsTemp, hostArgs.length));
          const vmResult = readWord(gp2);
          if (argHandlesToRelease) {
            for (const handle of argHandlesToRelease) handle.release();
          }
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