// Note: run `npm run build` to create microvium-wasm-base64.ts. While it's
// technically less efficient to use an embedded base64 string, the extra 12kB
// or so probably won't make any realistic difference to anyone at the moment
// but it's incredibly convenient for users since there's currently no way to
// directly `import` a WASM file in JavaScript without setting up a bundler to
// handle it for you.
import { MemoryStats, memoryStatsFields } from './memory-stats-fields';
import { microviumWasmBase64 } from './microvium-wasm-base64';
import { mvm_TeError } from './microvium/runtime-types'

export type AnyFunction = (...args: any[]) => any;
export type Exports = Record<number, AnyFunction>;
export type Imports = Record<number, AnyFunction>;

export default {
  restore
}

const VM_VALUE_UNDEFINED = 1;
const microviumWasmRaw = globalThis.atob(microviumWasmBase64);
const rawLength = microviumWasmRaw.length;
const microviumWasmBytes = new Uint8Array(new ArrayBuffer(rawLength));
for (let i = 0; i < rawLength; i++) {
  microviumWasmBytes[i] = microviumWasmRaw.charCodeAt(i);
}
let modulePromise: PromiseLike<WebAssembly.Module> = WebAssembly.compile(microviumWasmBytes.buffer);

const noOpFunc = Object.freeze(() => {});

const notImplemented = () => { throw new Error('Not implemented') }
const assert = x => { if (!x) throw new Error('Assertion failed') }

const TextEncoder_ = typeof require !== 'undefined'
  ? require('util').TextEncoder // node.js
  : globalThis.TextEncoder; // browser
const TextDecoder_ = typeof require !== 'undefined'
  ? require('util').TextDecoder // node.js
  : globalThis.TextDecoder; // browser

const textEncoder = new TextEncoder_();
const textDecoder = new TextDecoder_();

export interface RestoreOptions {
  breakpointHit?(address: number): void;
}

export function useWasmModule(module: PromiseLike<WebAssembly.Module>) {
  modulePromise = module;
}

export async function restore(snapshot: ArrayLike<number>, imports: Imports, opts?: RestoreOptions) {
	const memory = new WebAssembly.Memory({ initial: 4, maximum: 4 });
	const mem8 = new Uint8Array(memory.buffer);
	const mem16 = new Uint16Array(memory.buffer);
  const readWord = address => mem16[address >>> 1];
  const readByte = address => mem8[address];
  const writeWord = (address, value) => mem16[address >>> 1] = value;
  const tempBuffer = new Uint8Array(8);
  const tempFloat64Buffer = new Float64Array(tempBuffer.buffer);

  class Handle {
    refCount = 1;
    address: number;
    constructor(vmValue: number) {
      this.address = newHandle(vm, vmValue);
      if (!this.address) {
        throw new Error('Microvium: runtime has run out of handles. This could happen if there are too many objects in the VM that are being referenced by live references in the host')
      }
      assert(this.value === vmValue);
    }
    addRef() { this.refCount++; }
    release() {
      assert(this.address);
      if (--this.refCount === 0) {
        vmReleaseHandle(vm, this.address);
        this.address = 0;
      }
    }
    get value() { return readWord(this.address); } // the first field inside the handle is the value it refers to
    set value(value: number) { writeWord(this.address, value); }
    get _dbgValue() { return valueToHost(this.value); }
  }

  class ObjectProxyHandler implements ProxyHandler<{}> {
    constructor (private handle: Handle) {}

    get(target: any, p: string | symbol, receiver: any): any {
      if (typeof p !== 'string') return undefined;

      // The property name may need to be copied into the VM, but it might also
      // be resolved to one of the strings in ROM. The interned strings in the
      // snapshot are added to the cachedValueToVm at startup.
      // Note: valueToHandle is used for the convenience being able to get a
      // pointer to the value.
      const vmPropName = valueToHandle(valueToVM(p));

      // Note: `getProperty` trashes the object argument, so we can't pass our
      // owned handle directly, but we can use this temporary handle.
      const vmObject = new Handle(this.handle.value);

      const err = getProperty(vm, vmObject.address, vmPropName.address, gp2);
      check(err);
      const vmPropValue = readWord(gp2);
      const hostPropValue = valueToHost(vmPropValue);

      vmPropName.release();
      vmObject.release();

      return hostPropValue;
    }

    set(target: any, p: string | symbol, hostValue: any, receiver: any): boolean {
      if (typeof p !== 'string') return false;

      // The property name may need to be copied into the VM, but it might also
      // be resolved to one of the strings in ROM. The interned strings in the
      // snapshot are added to the cachedValueToVm at startup.
      // Note: valueToHandle is used for the convenience being able to get a
      // pointer to the value.
      const vmPropName = valueToHandle(valueToVM(p));
      const vmValue = valueToHandle(valueToVM(hostValue));

      // Note: `setProperty` trashes the object argument, so we can't pass our
      // owned handle directly, but we can use this temporary handle.
      const vmObject = new Handle(this.handle.value);

      const err = setProperty(vm, vmObject.address, vmPropName.address, vmValue.address);
      check(err);

      vmPropName.release();
      vmValue.release();
      vmObject.release();

      return true;
    }

  }

  // This implementation assumes that the imports don't change over time.
  imports = { ...imports };
  const idByImport = new Map([...Object.entries(imports)].map(([id, f]) => [f, id]));

	const wasmImports = {
		env: {
			memory: memory,
			mvm_fatalError: (code) => {
        check(code);
        // Check should throw because the code MVM_SUCCESS should not be used for fatal errors
        throw new Error('unexpected');
      },
      fmod: (x, y) => x % y,
      pow: (x, y) => x ** y,
      invokeHost,
      importRequired: (id) => {
        if (!(id in imports)) {
          throw new Error(`VM requires import ${id} but not provided`)
        }
      },
      breakpointHit: (vm, addr) => opts?.breakpointHit?.(addr)
		}
	};

  const module = await modulePromise;
  const instance = await WebAssembly.instantiate(module, wasmImports);

  const exports = instance.exports as any;
  const {
    allocator_init,
    reserve_ram,
    reserve_rom,
    restore,
    generalPurpose1,
    generalPurpose2,
    generalPurpose3,
    generalPurpose4,
    mvm_resolveExports,
    mvm_call,
    mvm_newNumber,
    argsTemp,
    mvm_gc_allocateWithHeader,
    vmReleaseHandle,
    initHandles,
    engineMinorVersion,
    engineMajorVersion,
    newHandle,
    getProperty,
    setProperty,
  } = exports;
  const engineVersion = `${readByte(engineMajorVersion.value)}.${readByte(engineMinorVersion.value)}.0`;

  const gp2 = generalPurpose2.value;
  const gp3 = generalPurpose3.value;
  const gp4 = generalPurpose4.value;
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
  mem8.set(snapshot, romStart);

  const requiredEngineVersion = `${readByte(romStart)}.${readByte(romStart + 2)}.0`;;

  check(restore(
    generalPurpose1, // *result
    romStart, // snapshotBytecode
    snapshot.length, // bytecodeSize
  ));

  const vm = readWord(generalPurpose1);

  exports.setBreakpointCallback(vm);

  const cachedExports: Exports = {};

  // The 2 different caches here: one targets handles, which are weakly held by
  // the map and should also be added to the handleFinalizationRegistry so that
  // when the source object is collected then the handle is also released. The
  // other cache targets ROM values which last forever, so it doesn't hurt to
  // hold a strong reference to the key. ROM values may include functions and
  // primitives.
  const cachedValueToVm1 = new WeakMap<Object, Handle>();
  const cachedValueToVm2 = new Map<any, number>();
  const cachedValueToHost = new Map<number, any>();
  const handleFinalizationRegistry = new FinalizationRegistry<Handle>(releaseHandle);

  cacheInternedStrings();
  cacheWellKnownValues();
  // cacheImports(); // TODO ? maybe. Or cached on-demand

  return {
    engineVersion,
    requiredEngineVersion,

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
    }) as Exports,

    // This is of limited use since the WASM library uses a constant amount of
    // GC. The reason I expose it is because there may be performance reasons
    // why you want to force the GC at convenient times rather than letting it
    // collect at random times.
    runGC() {
      exports.mvm_runGC(vm, false)
    },

    get currentAddress() {
      return exports.mvm_getCurrentAddress(vm) as Number
    },

    getMemoryStats(): MemoryStats {
      let addr = exports.memoryStats.value;
      exports.mvm_getMemoryStats(vm, addr);
      const stats: any = {};
      for (const field of memoryStatsFields) {
        // The WASM is compiled to be 32 bit.
        stats[field] = readWord(addr) | (readWord(addr + 2) << 16);
        addr += 4;
      }
      return stats;
    },

    createSnapshot() {
      const addr = exports.mvm_createSnapshot(vm, gp4);
      const size = readWord(gp4);
      assert(readWord(gp4 + 2) === 0); // High word of size should be zero
      const result = mem8.slice(addr, addr + size);
      exports.allocator_free(addr);
      return result;
    },

    setBreakpoint(bytecodeAddress: number) {
      exports.mvm_dbg_setBreakpoint(vm, bytecodeAddress)
    },

    removeBreakpoint(bytecodeAddress: number) {
      exports.mvm_dbg_removeBreakpoint(vm, bytecodeAddress)
    },
  }

  // Sometimes we need to pass a pointer to a value to the Microvium API.
  // Handles are useful in this respect as their slot is addressable, and
  // because there's already a mechanism for dynamically allocating them.
  function valueToHandle(value: number | Handle): Handle {
    if (value instanceof Handle) return value;
    return new Handle(value);
  }

  function releaseHandle(valueHeld: Handle) {
    valueHeld.release()
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
    if (vmResult instanceof Handle) {
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

    const value = mvm_gc_allocateWithHeader(vm, size, typeCode);
    // Note: the VM returns a Microvium handle because handles are stable across
    // garbage collection cycles. The glue code has 2048 available handles as of
    // this writing.
    return new Handle(value);
  }

  // Returns an mvm_Value (number) or a Handle. If a Handle, the caller is
  // responsible for releasing it.
  function valueToVM(hostValue: any): number | Handle {
    if (cachedValueToVm1.has(hostValue)) {
      const result = cachedValueToVm1.get(hostValue)!;
      result.addRef();
      return result;
    }
    if (cachedValueToVm2.has(hostValue)) {
      return cachedValueToVm2.get(hostValue)!;
    }


    switch (typeof hostValue) {
      case 'undefined': return 0x01;
      case 'boolean': return hostValue ? 0x09 : 0x0D;
      case 'number': {
        if (Object.is(hostValue, -0)) return 0x15;
        // int14
        if ((hostValue | 0) === hostValue && hostValue >= -0x2000 && hostValue <= 0x1FFF1) {
          return (hostValue << 2) | 3;
        }
        if (isNaN(hostValue)) return 0x11;
        return mvm_newNumber(vm, hostValue);
      }
      case 'string': {
        if (hostValue === '__proto__') return 0x21;
        if (hostValue === 'length') return 0x1D;

        const bytes = textEncoder.encode(hostValue);
        const size = bytes.length + 1; // Size including added null terminator
        const handle = gcAllocate(size, 0x03);
        const ptr = handle.value;
        mem8.set(bytes, ptr);
        mem8[ptr + size - 1] = 0; // Null terminator

        return handle;
      }
      case 'object': {
        if (hostValue === null) return 0x05;
        break;
      }
      case 'function': {
        const importId = idByImport.get(hostValue);
        if (importId !== undefined) {
          const hostFunc = gcAllocate(2, 0x6 /* TC_REF_HOST_FUNC */);
          writeWord(hostFunc.value, importId);
          return hostFunc;
        }
        return notImplemented();
      }

    }
    // TODO
    return notImplemented();
  }

  function valueToHost(vmValue) {
    // Int14
    if ((vmValue & 3) === 3) {
      // Use the 16th bit as the sign bit
      return (vmValue << 16) >> 18;
    }

    if (cachedValueToHost.has(vmValue)) {
      return cachedValueToHost.get(vmValue)!;
    }

    let address;

    // Short pointer
    if ((vmValue & 1) === 0) {
      address = vmValue;
    }

    // Bytecode-mapped pointer
    else if ((vmValue & 3) === 1) {
      // Note: Well-known values are part of the cachedValueToHost so it should
      // not get to this point in the code
      assert(vmValue > 0x25);

      // TODO Indirection through handles

      // Plain bytecode pointer
      address = romStart + (vmValue & 0xFFFC);
    }

    const result = addressValueToHost(vmValue, address);

    // Cache ROM values
    if (address >= romStart) {
      cachedValueToHost.set(vmValue, result);
      cachedValueToVm2.set(result, vmValue);
    }

    return result;
  }

  function addressValueToHost(vmValue: number, address: number): any {
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
        tempBuffer.set(mem8.subarray(address, address + 8));
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
      // TC_REF_FUNCTION
      case 0x5: {
        // TODO: Maybe this should technically be a proxy not just a wrapper
        // function. Firstly, it will look better in the debugger. Secondly, we
        // can throw errors when a user tries to set properties on it etc. TODO:
        // this logic can be factored out to work for closures as well.
        const f = (...hostArgs: any[]) => {
          // We only have space for 64 arguments in argsTemp
          const maxArgs = 64;
          if (hostArgs.length > maxArgs) {
            throw new Error(`Too many arguments (Microvium WASM runtime library only supports ${maxArgs} arguments)`)
          }
          // Note: we need to convert all the arguments before copying the first
          // value into VM memory, because it's possible for the conversion of
          // any arg to trigger a GC collection that invalidates the value of an
          // earlier arg.
          const converted = hostArgs.map(valueToVM);

          for (let i = 0; i < converted.length; i++) {
            let vmArg = converted[i];
            if (vmArg instanceof Handle) vmArg = vmArg.value;
            writeWord(pArgsTemp + i * 2, vmArg);
          }
          assert(address >= romStart); // Functions are stored in ROM so we don't need a handle
          check(mvm_call(vm, vmValue, gp2, pArgsTemp, hostArgs.length));
          const vmResult = readWord(gp2);
          for (const arg of converted) {
            if (arg instanceof Handle) arg.release();
          }
          const hostResult = valueToHost(vmResult);
          return hostResult;
        }

        // These functions are in ROM, so the value can't shift during GC, so we
        // can cache the value directly rather than through a handle.
        cachedValueToVm2.set(f, vmValue);

        return f;
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
        // TODO: This doesn't match the plan as documented in the readme.
        return new Uint8Array(memory.buffer.slice(address, size - 1));
      }
      // Class
      case 0x9: {
        return notImplemented();
      }

      // Object
      case 0xC: {
        const handle = new Handle(vmValue);
        const hostValue = new Proxy({}, new ObjectProxyHandler(handle));
        // When the proxy is freed, the handle should also be released.
        handleFinalizationRegistry.register(hostValue, handle);
        // If the host passes this object back to the VM, it will be passed
        // by-reference. Since the object can move, we need to cache it by the
        // handle. We don't need to `addRef` on the handle here because its
        // lifetime is already locked to the hostValue which is the cache key.
        cachedValueToVm1.set(hostValue, handle);

        // Note: we can't add it to cachedValueToHost because we have nothing
        // stable to cache it on (the vmValue changes over GC cycles).

        return hostValue;
      }

      default: return notImplemented();
    }
  }

  function check(errorCode: number) {
    if (errorCode === 0) return;

    if (errorCode === mvm_TeError.MVM_E_WRONG_BYTECODE_VERSION) {
      throw new Error(`Bytecode is targeting a different engine version. Engine version is ${engineVersion} but bytecode requires ^${requiredEngineVersion}.`);
    }

    const desc =
      errorCode in mvm_TeError ? `${mvm_TeError[errorCode]} (${errorCode})` :
      errorCode === undefined ? 'unknown error' :
      errorCode;

    throw new Error(`Microvium Error: ${desc}`)
  }

  function cacheInternedStrings() {
    // This function copies the string intern table into the membrane cache so
    // that property keys do not need to be physically copied across the
    // membrane.

    const assumedVersion = '7.7.0';
    if (engineVersion !== assumedVersion) {
      throw new Error(`The following code was written against engine version ${assumedVersion}. If this has changed, please check the logic still applies and then update the \`assumedVersion\` variable above.`);
    }
    // This is horribly hacky but should be pretty efficient
    const stringTableStart = romStart + readWord(romStart + 20);
    const stringTableEnd = romStart + readWord(romStart + 22);

    let cursor = stringTableStart;
    while (cursor < stringTableEnd) {
      const vmValue = readWord(cursor);
      // Just the act of converting it will cache it
      const hostValue = valueToHost(vmValue);
      assert(cachedValueToVm2.has(hostValue));
      assert(cachedValueToHost.has(vmValue));
      cursor += 2;
    }
  }

  function cacheWellKnownValues() {
    cachedValueToHost.set(0x01, undefined);
    cachedValueToHost.set(0x05, null);
    cachedValueToHost.set(0x09, true);
    cachedValueToHost.set(0x0D, false);
    cachedValueToHost.set(0x11, NaN);
    cachedValueToHost.set(0x15, -0);
    cachedValueToHost.set(0x19, undefined);
    cachedValueToHost.set(0x1D, 'length');
    cachedValueToHost.set(0x21, '__proto__');
    cachedValueToHost.set(0x25, noOpFunc);
  }
}