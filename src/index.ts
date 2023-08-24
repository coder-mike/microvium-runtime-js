// technically less efficient to use an embedded base64 string, the extra 12kB
// Note: run `npm run build` to create microvium-wasm-base64.ts. While it's
// or so probably won't make any realistic difference to anyone at the moment
// but it's incredibly convenient for users since there's currently no way to
// directly `import` a WASM file in JavaScript without setting up a bundler to
// handle it for you.
import { MemoryStats, memoryStatsFields } from './memory-stats-fields';
import { microviumWasmBase64 } from './microvium-wasm-base64';
import { mvm_TeError } from './microvium/runtime-types'
import { errorMessages } from './microvium/error-messages';

export type AnyFunction = (...args: any[]) => any;
export type Exports = Record<number, AnyFunction>;
export type Imports = Record<number, AnyFunction>;

type ProxyKind = 'object' | 'array' | 'function' | 'class';

type mvm_Value = number;

export interface MicroviumUint8Array {
  /**
   * The length of the Uint8Array.
   */
  readonly length: number;

  /**
   * Given an optional range, slice will return a copy of the given data as a
   * Uint8Array.
   *
   * @param begin The beginning index of the slice (inclusive). If omitted,
   * defaults to 0.
   * @param end The ending index of the slice (exclusive). If omitted, defaults
   * to the length of the array.
   */
  slice(begin?: number, end?: number): Uint8Array;

  /**
   * Sets the data in the Uint8Array to the given values.
   */
  set(array: ArrayLike<number>, offset?: number): void;
}

export default {
  restore
}

const VM_VALUE_UNDEFINED = 1;
const VM_VALUE_NULL = 5;
const VM_VALUE_ZERO = 3;
const MAX_INDEX = 0x3FFF;

enum mvm_TeBuiltins {
  BIN_INTERNED_STRINGS,
  BIN_ARRAY_PROTO,
  BIN_STR_PROTOTYPE, // If the string "prototype" is interned, this builtin points to it.
  BIN_ASYNC_CONTINUE, // A function used to construct a closure for the job queue to complete async operations
  BIN_ASYNC_CATCH_BLOCK, // A block, bundled as a function, for the root try-catch in async functions
  BIN_ASYNC_HOST_CALLBACK, // Bytecode to use as the callback for host async operations
  BIN_PROMISE_PROTOTYPE,

  BIN_BUILTIN_COUNT
};

let cachedModule: Promise<WebAssembly.Module> | undefined;
let getModule = (): PromiseLike<WebAssembly.Module> => {
  if (cachedModule) return cachedModule;
  const microviumWasmRaw = globalThis.atob(microviumWasmBase64);
  const rawLength = microviumWasmRaw.length;
  const microviumWasmBytes = new Uint8Array(new ArrayBuffer(rawLength));
  for (let i = 0; i < rawLength; i++) {
    microviumWasmBytes[i] = microviumWasmRaw.charCodeAt(i);
  }

  cachedModule = WebAssembly.compile(microviumWasmBytes.buffer);
  return cachedModule;
}

const noOpFunc = Object.freeze(() => {});

const notImplemented = (): never => { throw new Error('Not implemented') }
const notSupported = (msg: string): never => { throw new Error('Not implemented: ' + msg) }
const assert = x => { if (!x) throw new Error('Assertion failed') }
const unexpected = (): never => { throw new Error('Unexpected value or control path') }
const assertUnreachable = (value: never) => { throw new Error('Unexpected value or control path') }

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
  getModule = () => module;
}

export async function restore(snapshot: ArrayLike<number>, imports: Imports, opts?: RestoreOptions) {
  // Note: I have no idea why the WASM module compiles to need "4" pages, when
  // it only seems to make use of 3. I'm ignoring this for the moment because
  // the extra page doesn't really hurt on a desktop-class machine.
	const memory = new WebAssembly.Memory({ initial: 4, maximum: 4 });
	const mem8 = new Uint8Array(memory.buffer);
	const mem16 = new Uint16Array(memory.buffer);
  const readWord = address => mem16[address >>> 1];
  const readByte = address => mem8[address];
  const writeWord = (address, value) => mem16[address >>> 1] = value;
  const writeByte = (address, value) => mem8[address] = value;
  const tempBuffer = new Uint8Array(8);
  const tempFloat64Buffer = new Float64Array(tempBuffer.buffer);

  class Handle {
    refCount = 1;
    address: number;
    constructor(guestValue: number) {
      this.address = newHandle(vm, guestValue);
      if (!this.address) {
        throw new Error('Microvium: runtime has run out of handles. This could happen if there are too many objects in the VM that are being referenced by live references in the host')
      }
      assert(this.value === guestValue);
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

  function makeProxy(guestValue: mvm_Value, kind: ProxyKind, valueIsConst: boolean) {
    const handle = new Handle(guestValue);
    const wrappedValue =
      kind === 'object' ? {} :
      kind === 'class' ? function Class () {} :
      kind === 'array' ? [] :
      kind === 'function' ? () => {} :
      assertUnreachable(kind);

    const hostValue = new Proxy(wrappedValue, new MicroviumProxyHandler(handle, kind));
    // When the proxy is freed, the handle should also be released.
    handleFinalizationRegistry.register(hostValue, handle);

    // If the host passes this object back to the VM, it will be passed
    // by-reference. Since the object can move, we need to cache it by the
    // handle. We don't need to `addRef` on the handle here because its
    // lifetime is already locked to the hostValue which is the cache key.
    cachedValueToGuest1.set(hostValue, handle);

    if (valueIsConst) {
      cachedValueToGuest2.set(hostValue, guestValue);
    }

    return hostValue;
  }

  class MicroviumProxyHandler implements ProxyHandler<any> {
    constructor (private handle: Handle, private kind: ProxyKind) {}

    getPrototypeOf(target: any): object | null {
      switch (this.kind) {
        case 'array': return Array.prototype;
        case 'object': return Object.prototype;
        case 'class': return Function.prototype;
        case 'function': return Function.prototype;
        default: return assertUnreachable(this.kind);
      }
    }

    ownKeys(target: any): ArrayLike<string | symbol> {
      const hInOut = new Handle(this.handle.value)
      check(vm_objectKeys(vm, hInOut.address));
      const keysProxy = valueToHost(hInOut.value);
      const arr = [...keysProxy];
      return arr;
    }

    getOwnPropertyDescriptor(target: any, p: string | symbol): PropertyDescriptor | undefined {
      // All properties are treated as mutable POD properties
      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: this.get(target, p)
      }
    }

    makeCall(thisArg: any, hostArgs: any[]): any {
      // We only have space for 64 arguments in argsTemp
      const maxArgs = 64;
      if (hostArgs.length > maxArgs) {
        throw new Error(`Too many arguments (Microvium WASM runtime library only supports ${maxArgs} arguments)`)
      }
      // Note: we need to convert all the arguments before copying the first
      // value into VM memory, because it's possible for the conversion of
      // any arg to trigger a GC collection that invalidates the value of an
      // earlier arg.
      const converted = hostArgs.map(valueToGuest);

      for (let i = 0; i < converted.length; i++) {
        let vmArg = converted[i];
        if (vmArg instanceof Handle) vmArg = vmArg.value;
        writeWord(pArgsTemp + i * 2, vmArg);
      }

      let thisValue: mvm_Value;

      // A design choice here is that only Microvium objects can be used as the
      // `this` value. It doesn't really make sense from a usage perspective to
      // pass the `this` value in by-copy, and host objects in the current
      // design are only ever passed by-copy.
      if (cachedValueToGuest1.has(thisArg)) {
        thisValue = cachedValueToGuest1.get(thisArg)!.value;
      } else if (cachedValueToGuest2.has(thisArg)) {
        thisValue = cachedValueToGuest2.get(thisArg)!;
      } else {
        thisValue = VM_VALUE_UNDEFINED;
      }

      const err = mvm_callEx(vm, this.handle.value, thisValue, gp2, pArgsTemp, hostArgs.length);
      const vmResult = readWord(gp2);
      const hostResult = valueToHost(vmResult);
      if (err === 44 /* MVM_E_UNCAUGHT_EXCEPTION */) {
        throw hostResult;
      } else {
        check(err);
      }

      for (const arg of converted) {
        if (arg instanceof Handle) arg.release();
      }
      return hostResult;
    }

    apply(target: any, thisArg: any, hostArgs: any[]): any {
      if (this.kind !== 'function') {
        throw new Error(`Cannot call non-function`);
      }

      return this.makeCall(thisArg, hostArgs);
    }

    construct(target: any, hostArgs: any[], newTarget?: any): object {
      if (this.kind !== 'class') {
        throw new Error(`Cannot construct non-class`);
      }

      // The microvium engine will automatically `new` if the target is a class.
      return this.makeCall(undefined, hostArgs);
    }

    get(target: any, p: number | string | symbol): any {
      if (p === Symbol.iterator) {
        let arr = new Proxy(target, this);
        return function*() {
          let index = 0;
          while (index < arr.length) {
            yield arr[index++];
          }
        }
      }

      // Symbols not supported
      if (typeof p !== 'string') return undefined;

      if (this.kind === 'function') {
        // Functions in microvium don't have properties
        return undefined;
      }

      if (/^\d+$/g.test(p)) {
        // Array index
        const index = parseInt(p);
        if (index >= 0 && index <= MAX_INDEX) {
          p = index;
        }
      }

      // The property name may need to be copied into the VM, but it might also
      // be resolved to one of the strings in ROM. The interned strings in the
      // snapshot are added to the cachedValueToVm at startup.
      // Note: valueToHandle is used for the convenience being able to get a
      // pointer to the value.
      const vmPropName = valueToHandle(valueToGuest(p));

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

    set(target: any, p: string | symbol | number, hostValue: any, receiver: any): boolean {
      if (typeof p !== 'string') return false;

      if (this.kind === 'function') {
        // Functions in microvium don't have properties
        return false;
      }

      if (/^\d+$/g.test(p)) {
        // Array index
        const index = parseInt(p);
        if (index >= 0 && index <= 0xffff) {
          p = index;
        }
      }

      // The property name may need to be copied into the VM, but it might also
      // be resolved to one of the strings in ROM. The interned strings in the
      // snapshot are added to the cachedValueToVm at startup.
      // Note: valueToHandle is used for the convenience being able to get a
      // pointer to the value.
      const vmPropName = valueToHandle(valueToGuest(p));
      const guestValue = valueToHandle(valueToGuest(hostValue));

      // Note: `setProperty` trashes the object argument, so we can't pass our
      // owned handle directly, but we can use this temporary handle.
      const vmObject = new Handle(this.handle.value);

      const err = setProperty(vm, vmObject.address, vmPropName.address, guestValue.address);
      check(err);

      vmPropName.release();
      guestValue.release();
      vmObject.release();

      return true;
    }
  }

  // This implementation assumes that the imports don't change over time.
  imports = { ...imports };

	const wasmImports = {
		env: {
			memory: memory,
			mvm_fatalError: (code) => {
        check(code);
        // Shouldn't get here because the above check should already throw
        // because the code MVM_SUCCESS should not be used for fatal errors
        throw new Error('unexpected');
      },
      fmod: (x, y) => x % y,
      pow: (x, y) => x ** y,
      mvm_snprintf,
      invokeHost,
      importRequired: (id) => {
        if (!(id in imports)) {
          throw new Error(`VM requires import ${id} but not provided`)
        }
      },
      breakpointHit: (vm, addr) => opts?.breakpointHit?.(addr)
		}
	};

  const module = await getModule();
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
    mvm_callEx,
    mvm_newNumber,
    argsTemp,
    mvm_allocate,
    vmReleaseHandle,
    initHandles,
    engineMinorVersion,
    engineMajorVersion,
    newHandle,
    getProperty,
    setProperty,
    mvm_stopAfterNInstructions,
    mvm_getInstructionCountRemaining,
    vm_objectKeys,
    mvm_asyncStart,
    mvm_subscribeToPromise,
  } = exports;
  const engineVersion = `${readByte(engineMajorVersion.value)}.${readByte(engineMinorVersion.value)}.0`;
  const assumeVersion = (assumedVersion: string) => {
    if (engineVersion !== assumedVersion) {
      throw new Error(`The following code was written against engine version ${assumedVersion}. Please check the logic still applies and then update calls to \`assumeVersion()\`.`);
    }
  }

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
  const cachedValueToGuest1 = new WeakMap<Object, Handle>();
  const cachedValueToGuest2 = new Map<any, number>();
  const cachedValueToHost = new Map<number, any>();
  const handleFinalizationRegistry = new FinalizationRegistry<Handle>(releaseHandle);

  // Table of function indexes imported by the VM
  const { indexByImport, importByIndex } = indexImports();

  // This is horribly hacky but should be pretty efficient
  assumeVersion('8.0.0');
  const romGlobalVariablesStart = romStart + readWord(romStart + 24); // BCS_GLOBALS
  const romGlobalVariablesEnd = romStart + readWord(romStart + 26);

  cacheInternedStrings();
  cacheWellKnownValues();

  return {
    engineVersion,
    requiredEngineVersion,

    exports: new Proxy({}, {
      get(_, p) {
        if (p in cachedExports) return cachedExports[p];
        if (typeof p === 'symbol') return undefined; // No symbol-keyed exports
        const i = parseInt(p);
        if ((i | 0) !== i) return undefined; // No non-integer exports
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

    /**
     * If using the gas counter, this will return the number of instructions
     * remaining. If not using the gas counter, this will return -1.
     */
    getInstructionCountRemaining() {
      return mvm_getInstructionCountRemaining(vm)
    },

    /**
     * Set the gas counter -- the number of instructions to execute before
     * erroring out with a MVM_E_INSTRUCTION_COUNT_REACHED error. If this is set
     * to -1, then the gas counter is disabled.
     */
    stopAfterNInstructions(n: number) {
      if (typeof n !== 'number') throw new Error(`Expected number, got ${n}`);
      mvm_stopAfterNInstructions(vm, n);
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

  function mvm_snprintf(bufAddr: number, bufSize: number, formatStringAddr: number, x: number) {
    const format = readString(formatStringAddr);
    assert(format === '%d' || format === '%ld' || format === "%.15g");
    const str = '' + x;
    const encodedBytes = textEncoder.encode(str);
    const bytesToWrite = Math.min(encodedBytes.length, bufSize - 1);
    mem8.set(encodedBytes.subarray(0, bytesToWrite), bufAddr);
    return encodedBytes.length;
  }

  // Read a null-terminated string from the given memory address
  function readString(address: number) {
    let endAddress = address;

    // Find the null-termination (byte value is 0)
    while (mem8[endAddress] !== 0) {
      endAddress++;
    }

    // Create a subarray from the address to the endAddress (excluding the null-terminator)
    const bytes = mem8.subarray(address, endAddress);

    // Convert the byte array to a UTF-8 string
    return textDecoder.decode(bytes);
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
    let result: any;
    let errorCode;
    try {
      if (Reflect.getPrototypeOf(resolveTo)?.constructor?.name === 'AsyncFunction') {
        const callback_ = mvm_asyncStart(vm, out_vmpResult);
        // Note: The host value will hold a handle to the callback
        const callback = valueToHost(callback_);
        const promise = resolveTo(...hostArgs);
        assert(typeof callback === 'function');
        Promise.resolve(promise).then(
          result => callback(true, result),
          error => callback(false, error),
        );
        return; // Bypass the normal return path
      } else { // Normal function
        result = resolveTo(...hostArgs);
      }
      errorCode = 0;
    } catch (e) {
      result = e;
      errorCode = 44 /* MVM_E_UNCAUGHT_EXCEPTION */;
    }
    let vmResult = valueToGuest(result);
    // We can release the handle immediately because we're about to pass the
    // value back to the VM and no GC cycle can happen between now and when the
    // VM uses the returned value.
    if (vmResult instanceof Handle) {
      const value = vmResult.value;
      vmResult.release();
      vmResult = value;
    }
    writeWord(out_vmpResult, vmResult);
    return errorCode;
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

  // Returns a Handle with refCount 1, which the caller must release. The
  // allocated memory is not initialized.
  function gcAllocate(size: number, typeCode: number) {
    assert((size & 0xFFF) === size);
    assert((typeCode & 0xF) === typeCode);

    const value = mvm_allocate(vm, size, typeCode);
    // Note: the VM returns a Microvium handle because handles are stable across
    // garbage collection cycles. The glue code has 2048 available handles as of
    // this writing.
    return new Handle(value);
  }

  // Returns an mvm_Value (number) or a Handle. If a Handle, the caller is
  // responsible for releasing it.
  function valueToGuest(hostValue: any): number | Handle {
    if (cachedValueToGuest1.has(hostValue)) {
      const result = cachedValueToGuest1.get(hostValue)!;
      result.addRef();
      return result;
    }
    if (cachedValueToGuest2.has(hostValue)) {
      return cachedValueToGuest2.get(hostValue)!;
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
        if (Array.isArray(hostValue)) {
          // Create an empty array
          const guestValue = gcAllocate(4, 0x0D /* TC_REF_ARRAY */);
          writeWord(guestValue.value, VM_VALUE_NULL); // dpData
          writeWord(guestValue.value + 2, VM_VALUE_ZERO); // viLength
          const proxy = valueToHost(guestValue.value);
          for (const [index, value] of hostValue.entries()) {
            proxy[index] = value;
          }
          return guestValue;
        } else if (hostValue instanceof Uint8Array) {
          const handle = gcAllocate(hostValue.length, 0x07 /* TC_REF_UINT8_ARRAY */);
          const ptr = handle.value;
          mem8.set(hostValue, ptr);
          return handle;
        } else if (hostValue instanceof Set) {
          throw new Error('Sets are not supported');
        } else if (hostValue instanceof Map) {
          throw new Error('Maps are not supported');
        } else if (ArrayBuffer.isView(hostValue)) {
          throw new Error('Type arrays other than Uint8Array are not supported');
        } else if (hostValue instanceof Promise) {
          // Promises can in theory be supported, by constructing a Microvium
          // promise and then subscribing to the host promise. However, I think
          // this is low priority for me because host async functions can
          // already be awaited without requiring the marshalling of promises
          // (see `invokeHost`).
          throw new Error('Promises are not supported');
        } else {
          // Create an empty object
          const guestValue = gcAllocate(4, 0x0C /* TC_REF_PROPERTY_LIST */);
          writeWord(guestValue.value, VM_VALUE_NULL); // dpNext
          writeWord(guestValue.value + 2, VM_VALUE_NULL); // dpProto
          const proxy = valueToHost(guestValue.value);
          for (const [index, value] of Object.entries(hostValue)) {
            proxy[index] = value;
          }
          if (hostValue instanceof Error) {
            // Hack because these are a non-enumerable property on Error
            proxy['message'] = hostValue.message;
            proxy['stack'] = hostValue.stack;
          }
          return guestValue;
        }
        break;
      }
      case 'function': {
        const importIndex = indexByImport.get(hostValue);
        if (importIndex !== undefined) {
          const hostFunc = gcAllocate(2, 0x6 /* TC_REF_HOST_FUNC */);
          writeWord(hostFunc.value, importIndex);
          return hostFunc;
        }

        // Microvium doesn't have a way to represent a general host function
        throw new Error('Host functions cannot be passed to the VM');
      }
      default: return notSupported(typeof hostValue);
    }
  }

  function valueToAddress(guestValue) {
    if ((guestValue & 3) === 3) {
      throw new Error('Expected address value but got int14');
    }

    // Short pointer
    if ((guestValue & 1) === 0) {
      return guestValue;
    }

    // Bytecode-mapped pointer
    else if ((guestValue & 3) === 1) {
      // Note: Well-known values are part of the cachedValueToHost so it should
      // not get to this point in the code
      assert(guestValue > 0x25);

      const address = romStart + (guestValue & 0xFFFC);
      if (address >= romGlobalVariablesStart && address < romGlobalVariablesEnd) {
        // Probably the caller should have called `resolveValue` to resolve the
        // indirection, but we can do it here for them. The only catch is that
        // this will throw if the value is not a pointer.
        const resolved = resolveValue(guestValue);
        assert(resolved !== guestValue); // The ROM handles can't point to themselves
        return valueToAddress(resolved);
      }

      return address;
    }
  }

  /**
   * Resolves any indirections through the ROM handle indirection table to give
   * you the "actual" value. This is idempotent so it's safe to use "just in
   * case".
   */
  function resolveValue(guestValue: mvm_Value): mvm_Value {
    // Indirections are only done by bytecode-mapped pointers
    if ((guestValue & 3) !== 1) {
      return guestValue;
    }

    let address = romStart + (guestValue & 0xFFFC);

    // Indirections are only done by pointers that point to ROM variables
    if (address < romGlobalVariablesStart || address >= romGlobalVariablesEnd) {
      return guestValue;
    }

    // To get the actual value, we address the equivalent variable in RAM
    // rather than the variable in ROM.

    // The `globals` pointer is the first in the `mvm_VM` structure. Also, since
    // the RAM is limited to 64k, this will only be a 16-bit pointer.
    // Assuming here that the WASM is little-endian, so we only need to read
    // the lower word.
    assumeVersion('8.0.0');
    const ramGlobalVariablesStart = readWord(vm);

    // Remap from ROM space to RAM space to get the runtime value
    address = address - romGlobalVariablesStart + ramGlobalVariablesStart;

    // Read the value at the address of the variable in RAM
    return readWord(address);
  }

  function valueToHost(guestValue: mvm_Value) {
    guestValue = resolveValue(guestValue);

    // Int14
    if ((guestValue & 3) === 3) {
      // Use the 16th bit as the sign bit
      return (guestValue << 16) >> 18;
    }

    if (cachedValueToHost.has(guestValue)) {
      return cachedValueToHost.get(guestValue)!;
    }

    const address = valueToAddress(guestValue);

    const result = addressValueToHost(guestValue, address);

    // Cache ROM values
    if (address >= romStart) {
      // If we pass the same ROM value back to the VM, we want to map it to the
      // same host value.
      cachedValueToHost.set(guestValue, result);
      // If the host passes the value back.
      cachedValueToGuest2.set(result, guestValue);
    }

    return result;
  }

  function addressValueToHost(guestValue: number, address: number): any {
    const headerWord = readWord(address - 2);
    const typeCode = headerWord >>> 12;
    const size = headerWord & 0xFFF;
    const valueIsConst = address >= romStart;
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

      case 0x5: // TC_REF_FUNCTION
      case 0xF: // TC_REF_CLOSURE
      {
        return makeProxy(guestValue, 'function', valueIsConst);
      }

      // Host function
      case 0x6: {
        const indexInImportTable = readWord(address);
        const result = importByIndex.get(indexInImportTable) ?? unexpected();
        return result;
      }

      // Uint8Array
      case 0x7: {
        return wrapUint8Array(guestValue, size, valueIsConst);
      }
      // MVM_REF_CLASS
      case 0x9: {
        return makeProxy(guestValue, 'class', valueIsConst);
      }

      // Object
      case 0xC: {
        // Brand check
        const vPrototype = readWord(address + 2);

        // Promise object
        if (vPrototype === getBuiltin(mvm_TeBuiltins.BIN_PROMISE_PROTOTYPE)) {
          // Microvium doesn't support having callbacks from the guest to call
          // the host, so we can't create a host promise that is subscribed to
          // the guest promise. We still create a host promise, but it will
          // throw if awaited. The host promise can still be used by passing it
          // back into the VM.

          const handle = new Handle(guestValue);
          // Allocate a handle. Bind the handle lifetime to the promise. Add a
          // subscriber to the promise which resolves/rejects the host promise.
          const hostValue = Promise.reject('Microvium does not support having the host subscribe to guest promises');
          // When the promise is freed then the handle can be released
          handleFinalizationRegistry.register(hostValue, handle);
          cachedValueToGuest1.set(hostValue, handle);
          if (valueIsConst) {
            cachedValueToGuest2.set(hostValue, guestValue);
          }
          return hostValue;
        }

        return makeProxy(guestValue, 'object', valueIsConst);
      }

      // TC_REF_ARRAY
      // TC_REF_FIXED_LENGTH_ARRAY
      case 0xD:
      case 0xE: {
        return makeProxy(guestValue, 'array', valueIsConst);
      }

      default: return unexpected();
    }
  }

  function getBuiltin(builtin: mvm_TeBuiltins): mvm_Value {
    assumeVersion('8.0.0');
    const builtinsStart = romStart + readWord(romStart + 18); // BCS_BUILTINS
    const builtinsEnd = romStart + readWord(romStart + 20);

    const addr = builtinsStart + builtin * 2;
    return readWord(addr);
  }

  function check(errorCode: number) {
    if (errorCode === 0) return;

    if (errorCode === mvm_TeError.MVM_E_WRONG_BYTECODE_VERSION) {
      throw new Error(`Bytecode is targeting a different engine version. Engine version is ${engineVersion} but bytecode requires ^${requiredEngineVersion}.`);
    }

    const [name, message] = errorMessages[errorCode] ?? [];

    const desc =
      message && name && errorCode ? `${name} (${errorCode}): ${message}` :
      name && errorCode ? `${name} (${errorCode})` :
      errorCode ? `${errorCode}` :
      'unknown error';

    throw new Error(`Microvium Error: ${desc}`)
  }

  function cacheInternedStrings() {
    // This function copies the string intern table into the membrane cache so
    // that property keys do not need to be physically copied across the
    // membrane.

    // This is horribly hacky but should be pretty efficient
    assumeVersion('8.0.0');
    const stringTableStart = romStart + readWord(romStart + 20); // BCS_STRING_TABLE
    const stringTableEnd = romStart + readWord(romStart + 22);

    let cursor = stringTableStart;
    while (cursor < stringTableEnd) {
      const guestValue = readWord(cursor);
      // Just the act of converting it will cache it
      const hostValue = valueToHost(guestValue);
      assert(cachedValueToGuest2.has(hostValue));
      assert(cachedValueToHost.has(guestValue));
      cursor += 2;
    }
  }

  function indexImports() {
    // This function builds a map of host exports by their index in the import
    // table. The index is what is referenced by the TC_REF_HOST_FUNCTION type,
    // which we construct dynamically in valueToGuest.

    const importById = new Map([...Object.entries(imports)].map(([id, f]) => [parseInt(id), f]));
    const indexByImport = new Map<AnyFunction, number>();
    const importByIndex = new Map<number, AnyFunction>();

    // This is horribly hacky but should be pretty efficient
    assumeVersion('8.0.0');
    const importTableStart = romStart + readWord(romStart + 12);
    const importTableEnd = romStart + readWord(romStart + 14);

    let cursor = importTableStart;
    let index = 0;
    while (cursor < importTableEnd) {
      const importId = readWord(cursor);
      const importValue = importById.get(importId);
      if (!importValue) {
        throw new Error(`Import ${importId} is required by the VM but not provided by the host`);
      }
      indexByImport.set(importValue, index);
      importByIndex.set(index, importValue);
      cursor += 2;
      index++;
    }

    return { indexByImport, importByIndex };
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

  function wrapUint8Array(guestValue: mvm_Value, size: number, valueIsConst: boolean): MicroviumUint8Array {
    const handle = new Handle(guestValue);

    const hostValue: MicroviumUint8Array = {
      slice(begin, end) {
        if (begin === undefined) begin = 0;
        if (end === undefined) end = size;
        if (begin < 0) begin += size;
        if (end < 0) end += size;
        if (begin < 0) begin = 0;
        if (end < begin) end = begin;
        if (end > size) end = size;
        const address = valueToAddress(handle.value);
        // Note: array buffer is slice will create a copy
        return new Uint8Array(memory.buffer.slice(address + begin, address + end));
      },

      get length() {
        return size;
      },

      set(array, offset = 0) {
        if (!(array instanceof Uint8Array) &&
            !Array.isArray(array)
        ) {
          throw new Error(`Expected Uint8Array or Array`);
        }
        if (array.length + offset > size) throw new RangeError('offset is out of bounds');
        const address = valueToAddress(handle.value);
        mem8.set(array, address + offset);
      }
    }

    // When the MicroviumUint8Array is freed, the handle should also be released.
    handleFinalizationRegistry.register(hostValue, handle);

    // If the host passes this object back to the VM, it will be passed
    // by-reference. Since the object can move, we need to cache it by the
    // handle. We don't need to `addRef` on the handle here because its
    // lifetime is already locked to the hostValue which is the cache key.
    cachedValueToGuest1.set(hostValue, handle);

    if (valueIsConst) {
      cachedValueToGuest2.set(hostValue, guestValue);
    }

    return hostValue;
  }
}