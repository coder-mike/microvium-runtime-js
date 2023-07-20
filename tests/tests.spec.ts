import Runtime from '../src/index';
import assert from 'assert/strict';
import fs from 'fs';
// Note: This library is developed in a sibling directory to Microvium, so that
// the two can change in lock-step. If you haven't already, you'll need to clone
// Microvium in a sibling directory and build it.
import { Microvium, addDefaultGlobals } from '../../microvium/dist/lib';
import { MemoryStats, memoryStatsFields } from '../src/memory-stats-fields';

const basicValues: any[] = [
  undefined,
  null,
  true,
  false,
  42,
  -42,
  420000,
  -420000,
  1.5,
  -0,
  NaN,
  Infinity,
  -Infinity,
  '__proto__',
  'length',
  'any string',
  '',
]

test('hello-world', async function () {
  const source = `
    const print = vmImport(1);
    vmExport(1, main);

    function main() {
      print("hello, world")
    }`

  const snapshot = compile(source, this.test!.title!);

  let print: string | undefined;
  const imports = {
    [1]: s => { print = s }
  };

  const vm = await Runtime.restore(snapshot, imports);

  const main = vm.exports[1];
  main();

  assert.equal(print, 'hello, world');
});

test('pass basic values', async function () {
  // This tests the passing of basic values in both directions across the
  // boundary and preserving in Microvium memory.

  const source = `
    let x;
    vmExport(1, () => x); // get
    vmExport(2, value => x = value); // set
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {});
  const { [1]: get, [2]: set } = vm.exports;

  const testValue = value => {
    assert.equal(set(value), value);
    assert.equal(get(), value);
    assert(Object.is(get(), value)); // Covers -0 as well
  }

  for (const value of basicValues) {
    testValue(value);
  }
});

test('fmod and pow', async function () {
  // The operators fmod and pow are outsourced from the VM to the host. This
  // tests that they work correctly

  const source = `
    vmExport(1, (x, y) => x % y); // fmod
    vmExport(2, (x, y) => x ** y); // pow
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {});
  const { [1]: fmod, [2]: pow } = vm.exports;

  assert.equal(fmod(0, 2), 0 % 2);
  assert.equal(fmod(10, 2), 10 % 2);
  assert.equal(fmod(10.5, 2), 10.5 % 2);
  assert.equal(fmod(-10.5, 2), -10.5 % 2);
  assert.equal(fmod(10.5, 1.5), 10.5 % 1.5);
  assert.equal(fmod(10.5, -1.5), 10.5 % -1.5);
  assert.equal(fmod(-10.5, 1.5), -10.5 % 1.5);
  assert.equal(fmod(-10.5, -1.5), -10.5 % -1.5);

  assert.equal(pow(0, 2), 0 ** 2);
  assert.equal(pow(10, 2), 10 ** 2);
  assert.equal(pow(10.5, 2), 10.5 ** 2);
  assert.equal(pow(-10.5, 2), (-10.5) ** 2);
  assert.equal(pow(10.5, 1.5), 10.5 ** 1.5);
  assert.equal(pow(10.5, -1.5), 10.5 ** -1.5);
  assert.equal(pow(-10.5, 1.5), (-10.5) ** 1.5);
  assert.equal(pow(-10.5, -1.5), (-10.5) ** -1.5);
});

test('performance 1', async function () {
  this.timeout(20000);

  const objCount = 1000;
  const repeatCount = 100;

  const source = `
    const arr = [];
    for (let i = 0; i < ${objCount}; i++) {
      arr[i] = { x: i, y: i, z: 0 }
    }
    vmExport(1, () => {
      for (let i1 = 0; i1 < ${repeatCount}; i1++) {
        for (let i2 = 0; i2 < ${objCount}; i2++) {
          arr[i2].z = arr[i2].x + arr[i2].y;
        }
      }
    })
  `;

  await measurePerformance(source, this.test!.title!);
})

test('performance 2', async function () {
  this.timeout(20000);

  // This is similar to the previous performance test except using closures
  // instead of objects, since closures are a strong point in Microvium (they
  // are smaller and lighter, and access to closure variables is O(1)). And
  // also, the allocation is part of the loop so this is exercising the GC
  // allocator. Honestly I'm little surprised that node wins this one, given how
  // much more complicated closures are in node.

  const objCount = 1000;
  const repeatCount = 100;

  const source = `
    vmExport(1, () => {
      for (let i1 = 0; i1 < ${repeatCount}; i1++) {
        const arr = [];
        for (let i = 0; i < ${objCount}; i++) {
          arr[i] = adder(i, i);
        }
        for (let i = 0; i < ${objCount}; i++) {
          arr[i]();
        }
      }
      function adder(a, b) {
        return () => a + b;
      }
    })`;

  await measurePerformance(source, this.test!.title!);
})

test('memoryStats', async function () {
  const source = `
    const done = vmImport(1);
    const arr = [];
    vmExport(1, () => {
      for (let i = 0; i < 1000; i++)
        arr[i] = [];
      done();
    });
  `;

  const snapshot = compile(source, this.test!.title!);
  let stats2: MemoryStats = undefined as any;
  const vm = await Runtime.restore(snapshot, {
    [1]() {
      stats2 = vm.getMemoryStats();
    }
  });
  const stats1 = vm.getMemoryStats();
  for (const field of memoryStatsFields) {
    assert.equal(typeof stats1[field], 'number');
  }
  assert.equal(stats1.stackHeight, 0);
  assert.equal(stats1.totalSize, 86);
  vm.exports[1]();
  assert.equal(stats2.totalSize, 15580);
  assert.equal(stats2.stackHeight, 18);
})

test('createSnapshot', async function () {
  const source = `
    let counter = 0;
    vmExport(1, () => ++counter);
  `;

  const snapshot1 = compile(source, this.test!.title!);
  const vm1 = await Runtime.restore(snapshot1, {});
  // Counting
  assert.equal(vm1.exports[1](), 1);
  assert.equal(vm1.exports[1](), 2);
  assert.equal(vm1.exports[1](), 3);

  const snapshot2 = vm1.createSnapshot();

  const vm2 = await Runtime.restore(snapshot2, {});
  // Continue counting
  assert.equal(vm2.exports[1](), 4);
  assert.equal(vm2.exports[1](), 5);
  assert.equal(vm2.exports[1](), 6);
})

test('breakpoint', async function () {
  const source = `
    const print = vmImport(1);
    vmExport(1, () => {
      print('Hello, ');
      print('World!');
    });
  `;

  let printOut = '';
  const print = (s: string) => printOut += s;

  let breakpointWasHit: number = undefined as any;
  let printoutAtBreakpoint: string = undefined as any;
  const breakpointHit = (a: number) => {
    breakpointWasHit = a;
    printoutAtBreakpoint = printOut;
  }

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, { [1]: print }, { breakpointHit });

  // See build/dbg-breakpoint.disassembly for the addresses. Here I'm
  // breakpointing on the second call to `print`
  vm.setBreakpoint(0x006f);

  vm.exports[1]();
  assert.equal(breakpointWasHit, 0x006F);
  assert.equal(printoutAtBreakpoint, 'Hello, ');
  assert.equal(printOut, 'Hello, World!');
})

test('passing functions', async function () {
  // This tests the passing of function types between the host and VM

  const source = `
    const bar = vmImport(1);

    const foo = (a, b) => a + b;
    const getFoo = () => foo;
    const adder = a => b => a + b; // Curried adder
    const call = (f, x, y) => f(x, y);
    const getBar = () => bar;

    vmExport(1, getFoo);
    vmExport(2, adder);
    vmExport(3, call);
    vmExport(4, getBar);
  `;

  const bar = (a, b) => a + b + 5;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {
    [1]: bar
  });
  const { [1]: getFoo, [2]: adder, [3]: call, [4]: getBar } = vm.exports;

  // Passing a VM function out of the VM (TC_REF_FUNCTION)
  const foo = getFoo();
  assert.equal(typeof foo, 'function');
  assert.equal(foo(1,2), 3);

  // Passing a VM function into the VM (TC_REF_FUNCTION)
  assert.equal(call(foo, 5, 10), 15);

  // Passing a closure out of the VM (TC_REF_CLOSURE)
  const add = adder(1);
  assert.equal(typeof add, 'function');
  assert.equal(add(2), 3);

  // Passing a VM closure into the VM (TC_REF_CLOSURE)
  assert.equal(call(add, 5), 6);

  // Passing a new host function to the VM
  let err;
  try { call(() => {}); } catch (e) { err = e; }
  assert.equal(err.toString(), 'Error: Host functions cannot be passed to the VM')

  // Passing a known host function into the VM (TC_REF_HOST_FUNC)
  assert.equal(call(bar, 1, 2), 8);

  // Passing a host function out of the VM (TC_REF_HOST_FUNC)
  assert.equal(getBar(), bar);

});

test('objects', async function () {
  const source = `
    const romObj = { x: 1, y: 2 };
    let ramObj;

    const init = () => ramObj = { x: 3, z: 5 };
    const getRomObj = () => romObj;
    const getRamObj = () => ramObj;
    const getX = obj => obj.x;
    const getY = obj => obj.y;
    const getZ = obj => obj.z;
    const setX = (obj, v) => obj.x = v;
    const set = (obj, k, v) => obj[k] = v;
    const get = (obj, k) => obj[k];
    const identity = obj => obj;

    vmExport(1, init);
    vmExport(2, getRomObj);
    vmExport(3, getRamObj);
    vmExport(4, getX);
    vmExport(5, getY);
    vmExport(6, getZ);
    vmExport(7, setX);
    vmExport(8, set);
    vmExport(9, get);
    vmExport(10, identity);
  `;

  const bar = () => {}

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {
    [1]: bar
  });
  const { [1]: init, [2]: getRomObj, [3]: getRamObj, [4]: getX, [5]: getY, [6]: getZ, [7]: setX, [8]: set, [9]: get, [10]: identity } = vm.exports;

  const romObj = getRomObj();
  assert.equal(typeof romObj, 'object');
  assert.equal(getX(romObj), 1);
  assert.equal(getY(romObj), 2);
  assert.equal(getZ(romObj), undefined);
  // The difference between `getX(obj)` and `get(obj, 'x')` is that the latter involves marshalling the key across the membrane.
  assert.equal(get(romObj, 'x'), 1);
  assert.equal(get(romObj, 'y'), 2);
  assert.equal(get(romObj, 'z'), undefined);
  assert.equal(get(romObj, 'a'), undefined); // non-interned string
  // This accesses the values through the proxy getter. This directly calls Microvium's getProperty function.
  assert.equal(romObj.x, 1);
  assert.equal(romObj.y, 2);
  assert.equal(romObj.z, undefined);
  assert.equal(romObj.a, undefined); // non-interned string

  // Initialize the ramObj
  init();

  // Do all the same/similar tests again with the ramObj. I.e. an object created
  // after the snapshot rather than before. Actually in the current Microvium
  // implementation, I think all object land up in RAM, but it's worth testing
  // anyway.
  const ramObj = getRamObj();
  assert.equal(typeof ramObj, 'object');
  assert.equal(getX(ramObj), 3);
  assert.equal(getY(ramObj), undefined);
  assert.equal(getZ(ramObj), 5);
  assert.equal(get(ramObj, 'x'), 3);
  assert.equal(get(ramObj, 'y'), undefined);
  assert.equal(get(ramObj, 'z'), 5);
  assert.equal(get(ramObj, 'a'), undefined); // non-interned string
  assert.equal(ramObj.x, 3);
  assert.equal(ramObj.y, undefined);
  assert.equal(ramObj.z, 5);
  assert.equal(ramObj.a, undefined); // non-interned string

  assert.equal(setX(ramObj, 10), 10);
  assert.equal(ramObj.x, 10);
  assert.equal(set(ramObj, 'x', 20), 20);
  assert.equal(ramObj.x, 20);
  ramObj.x = 30;
  assert.equal(ramObj.x, 30);

  // Host objects
  const hostObj = { x: 42, y: 43, a: 44 };
  // Each of these will actually be passing in a copy of the object
  assert.equal(getX(hostObj), 42);
  assert.equal(getY(hostObj), 43);
  assert.equal(getZ(hostObj), undefined);
  assert.equal(get(hostObj, 'x'), 42);
  assert.equal(get(hostObj, 'y'), 43);
  assert.equal(get(hostObj, 'z'), undefined);
  assert.equal(get(hostObj, 'a'), 44); // a is a non-interned string

  // Checking that assignment to the host object doesn't do something stupid
  setX(hostObj, 50);
  assert.equal(hostObj.x, 42); // Unfortunate, but expected in the current implementation

  // Object passed to VM and back. Going in, this will be a copy, but coming out
  // it will be a proxy to the VM object.
  const objCopy = identity(hostObj);
  assert.equal(getX(objCopy), 42);
  assert.equal(getY(objCopy), 43);
  assert.equal(getZ(objCopy), undefined);
  assert.equal(get(objCopy, 'x'), 42);
  assert.equal(get(objCopy, 'y'), 43);
  assert.equal(get(objCopy, 'z'), undefined);
  assert.equal(get(objCopy, 'a'), 44); // a is a non-interned string
  setX(objCopy, 50);
  assert.equal(hostObj.x, 42); // Unfortunate, but expected in the current implementation
  assert.equal(objCopy.x, 50);
});

test('snprintf', async function () {
  // The implementation of string coercion of numbers in Microvium is based on
  // snprintf. This just tests that that's working .
  const source = `
    vmExport(1, x => '' + x);
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {  });
  const { [1]: toStr } = vm.exports;

  assert.equal(toStr(0), '0');
  assert.equal(toStr(1), '1');
  assert.equal(toStr(-1), '-1');
  assert.equal(toStr((0x7FFFFFFF)), '2147483647');
  assert.equal(toStr((-0x80000000)), '-2147483648');

  assert.equal(toStr(NaN), 'NaN');
  assert.equal(toStr(Infinity), 'Infinity');
  assert.equal(toStr((-Infinity)), '-Infinity');
  assert.equal(toStr((-0.0)), '0');
  assert.equal(toStr(0.1), '0.1');
  assert.equal(toStr((-0.1)), '-0.1');
  assert.equal(toStr(1e30), '1e+30');
  assert.equal(toStr((-1e30)), '-1e+30');
  assert.equal(toStr(1e-30), '1e-30');
  assert.equal(toStr((-1e-30)), '-1e-30');
});

test('arrays', async function () {
  const source = `
    const romArr = [1, 2, 3];
    // Reflect.ownKeys in Microvium returns a fixed-length array
    const fixedLenArray = Reflect.ownKeys({a: 1, b: 2, c: 3});
    let ramArr;

    const init = () => ramArr = [4, 5, 6];
    const getRomArr = () => romArr;
    const getRamArr = () => ramArr;
    const getFixedLenArr = () => fixedLenArray;
    const get0 = (arr) => arr[0];
    const get1 = (arr) => arr[1];
    const get2 = (arr) => arr[2];
    const get3 = (arr) => arr[3];
    const get = (arr, i) => arr[i];
    const set = (arr, i, v) => arr[i] = v;
    const set0 = (arr, v) => arr[0] = v;
    const identity = arr => arr;

    vmExport(1, init);
    vmExport(2, getRomArr);
    vmExport(3, getRamArr);
    vmExport(4, get0);
    vmExport(5, get1);
    vmExport(6, get2);
    vmExport(7, get3);
    vmExport(8, get);
    vmExport(9, set);
    vmExport(10, set0);
    vmExport(11, getFixedLenArr);
    vmExport(12, identity);
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, { });
  const { [1]: init, [2]: getRomArr, [3]: getRamArr, [4]: get0, [5]: get1, [6]: get2, [7]: get3, [8]: get, [9]: set, [10]: set0, [11]: getFixedLenArr, [12]: identity } = vm.exports;

  const romArr = getRomArr();
  assert(Array.isArray(romArr));
  assert.equal(get0(romArr), 1);
  assert.equal(get1(romArr), 2);
  assert.equal(get2(romArr), 3);
  assert.equal(get3(romArr), undefined);
  assert.equal(get(romArr, 0), 1);
  assert.equal(get(romArr, 1), 2);
  assert.equal(get(romArr, 2), 3);
  assert.equal(get(romArr, 3), undefined);

  // This accesses the values through the proxy getter. This directly calls Microvium's getProperty function.
  assert.equal(romArr.length, 3);
  assert.equal(romArr[0], 1);
  assert.equal(romArr[1], 2);
  assert.equal(romArr[2], 3);
  assert.equal(romArr[3], undefined);
  assert.equal((romArr as any).x, undefined);

  // Initialize the ramArr
  init();

  // Do all the same/similar tests again with the ramArr. I.e. an array created
  // after the snapshot rather than before. Actually in the current Microvium
  // implementation, I think all object land up in RAM, but it's worth testing
  // anyway.
  const ramArr = getRamArr();
  assert(Array.isArray(ramArr));
  assert.equal(get0(ramArr), 4);
  assert.equal(get1(ramArr), 5);
  assert.equal(get2(ramArr), 6);
  assert.equal(get3(ramArr), undefined);
  assert.equal(get(ramArr, 0), 4);
  assert.equal(get(ramArr, 1), 5);
  assert.equal(get(ramArr, 2), 6);
  assert.equal(get(ramArr, 3), undefined);
  set(ramArr, 0, 7);
  assert.equal(get(ramArr, 0), 7);

  // This accesses the values through the proxy getter. This directly calls Microvium's getProperty function.
  assert.equal(ramArr.length, 3);
  assert.equal(ramArr[0], 7);
  assert.equal(ramArr[1], 5);
  assert.equal(ramArr[2], 6);
  assert.equal(ramArr[3], undefined);
  assert.equal((ramArr as any).x, undefined);
  ramArr[0] = 8;
  assert.equal(ramArr[0], 8);

  const fixedLenArray = getFixedLenArr();
  assert(Array.isArray(fixedLenArray));
  assert.equal(fixedLenArray.length, 3);
  assert.equal(fixedLenArray[0], 'a');
  assert.equal(fixedLenArray[1], 'b');
  assert.equal(fixedLenArray[2], 'c');
  assert.equal(fixedLenArray[3], undefined);
  assert.equal((fixedLenArray as any).x, undefined);
  // Fixed-length arrays are immutable
  assert.throws(() => fixedLenArray[0] = 5, { message: 'Microvium Error: MVM_E_TYPE_ERROR (12)' });
  assert.equal(fixedLenArray[0], 'a');
  assert.throws(() => fixedLenArray.length = 5, { message: 'Microvium Error: MVM_E_TYPE_ERROR (12)' });
  assert.throws(() => fixedLenArray[3] = 5, { message: 'Microvium Error: MVM_E_TYPE_ERROR (12)' });

  const hostArray = [42, 43, 44];
  // Each of these will actually be passing in a copy of the array
  assert.equal(get0(hostArray), 42);
  assert.equal(get1(hostArray), 43);
  assert.equal(get2(hostArray), 44);
  assert.equal(get3(hostArray), undefined);
  assert.equal(get(hostArray, 'length'), 3);
  assert.equal(get(hostArray, 0), 42);
  assert.equal(get(hostArray, 1), 43);
  assert.equal(get(hostArray, 2), 44);
  assert.equal(get(hostArray, 3), undefined);

  // Checking that assignment to the host array doesn't do something stupid
  set0(hostArray, 50);
  assert.equal(hostArray[0], 42); // Unfortunate, but expected in the current implementation

  // Array passed to VM and back. Going in, this will be a copy, but coming out
  // it will be a proxy to the VM array.
  const arrayCopy = identity(hostArray);
  assert.equal(get0(arrayCopy), 42);
  assert.equal(get1(arrayCopy), 43);
  assert.equal(get2(arrayCopy), 44);
  assert.equal(get3(arrayCopy), undefined);
  assert.equal(get(arrayCopy, 'length'), 3);
  assert.equal(get(arrayCopy, 0), 42);
  assert.equal(get(arrayCopy, 1), 43);
  assert.equal(get(arrayCopy, 2), 44);
  assert.equal(get(arrayCopy, 3), undefined);
  set0(arrayCopy, 50);
  assert.equal(hostArray[0], 42); // Unfortunate, but expected in the current implementation
  assert.equal(arrayCopy[0], 50);
});

test('Uint8Array', async function () {
  const source = `
    const romArr = Microvium.newUint8Array(3);
    romArr[0] = 1;
    romArr[1] = 2;
    romArr[2] = 3;
    let ramArr;

    const init = () => {
      ramArr = Microvium.newUint8Array(3);
      ramArr[0] = 4;
      ramArr[1] = 5;
      ramArr[2] = 6;
    }
    const getRomArr = () => romArr;
    const getRamArr = () => ramArr;
    const get0 = (arr) => arr[0];
    const get1 = (arr) => arr[1];
    const get2 = (arr) => arr[2];
    const get3 = (arr) => arr[3];
    const get = (arr, i) => arr[i];
    const set = (arr, i, v) => arr[i] = v;
    const set0 = (arr, v) => arr[0] = v;
    const identity = arr => arr;

    vmExport(1, init);
    vmExport(2, getRomArr);
    vmExport(3, getRamArr);
    vmExport(4, get0);
    vmExport(5, get1);
    vmExport(6, get2);
    vmExport(7, get3);
    vmExport(8, get);
    vmExport(9, set);
    vmExport(10, set0);
    vmExport(12, identity);
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, { });
  const { [1]: init, [2]: getRomArr, [3]: getRamArr, [4]: get0, [5]: get1, [6]: get2, [7]: get3, [8]: get, [9]: set, [10]: set0, [12]: identity } = vm.exports;

  const romArr_ = getRomArr();
  assert(romArr_.length === 3);
  const romArr = romArr_.slice();
  assert(romArr instanceof Uint8Array);
  assert.equal(get0(romArr_), 1);
  assert.equal(get1(romArr_), 2);
  assert.equal(get2(romArr_), 3);
  assert.equal(get3(romArr_), undefined);
  assert.equal(get(romArr_, 0), 1);
  assert.equal(get(romArr_, 1), 2);
  assert.equal(get(romArr_, 2), 3);
  assert.equal(get(romArr_, 3), undefined);

  // Check different slices
  assert.deepEqual(romArr_.slice(0), new Uint8Array([1, 2, 3]));
  assert.deepEqual(romArr_.slice(1), new Uint8Array([2, 3]));
  assert.deepEqual(romArr_.slice(2), new Uint8Array([3]));
  assert.deepEqual(romArr_.slice(3), new Uint8Array([]));
  assert.deepEqual(romArr_.slice(0, 0), new Uint8Array([]));
  assert.deepEqual(romArr_.slice(0, 1), new Uint8Array([1]));
  assert.deepEqual(romArr_.slice(0, 2), new Uint8Array([1, 2]));
  assert.deepEqual(romArr_.slice(0, 3), new Uint8Array([1, 2, 3]));
  assert.deepEqual(romArr_.slice(0, 4), new Uint8Array([1, 2, 3]));
  assert.deepEqual(romArr_.slice(1, 1), new Uint8Array([]));
  assert.deepEqual(romArr_.slice(1, 2), new Uint8Array([2]));
  // Negative indices
  assert.deepEqual(romArr_.slice(-1), new Uint8Array([3]));
  assert.deepEqual(romArr_.slice(-2, -1), new Uint8Array([2]));
  assert.deepEqual(romArr_.slice(0, -1), new Uint8Array([1, 2]));
  // Out of range
  assert.deepEqual(romArr_.slice(0, 5), new Uint8Array([1, 2, 3]));
  assert.deepEqual(romArr_.slice(1, 5), new Uint8Array([2, 3]));
  assert.deepEqual(romArr_.slice(4, 5), new Uint8Array([]));

  assert.equal(romArr.length, 3);
  assert.equal(romArr[0], 1);
  assert.equal(romArr[1], 2);
  assert.equal(romArr[2], 3);
  assert.equal(romArr[3], undefined);
  assert.equal((romArr as any).x, undefined);

  // Initialize the ramArr
  init();

  // Do all the same/similar tests again with the ramArr. I.e. an array created
  // after the snapshot rather than before. Actually in the current Microvium
  // implementation, I think all object land up in RAM, but it's worth testing
  // anyway.
  const ramArr_ = getRamArr();
  assert(ramArr_.length === 3);
  const ramArr = ramArr_.slice();
  assert(ramArr instanceof Uint8Array);
  assert.equal(get0(ramArr_), 4);
  assert.equal(get1(ramArr_), 5);
  assert.equal(get2(ramArr_), 6);
  assert.equal(get3(ramArr_), undefined);
  assert.equal(get(ramArr_, 0), 4);
  assert.equal(get(ramArr_, 1), 5);
  assert.equal(get(ramArr_, 2), 6);
  assert.equal(get(ramArr_, 3), undefined);
  set(ramArr_, 0, 7);
  assert.equal(get(ramArr_, 0), 7);
  assert.equal(ramArr_.slice(0, 1)[0], 7);

  assert.equal(ramArr.length, 3);
  assert.equal(ramArr[0], 4); // Note: still has the old value because it's a copy
  assert.equal(ramArr[1], 5);
  assert.equal(ramArr[2], 6);
  assert.equal(ramArr[3], undefined);

  // Check mutation using `set`
  ramArr_.set([8, 9, 10]);
  assert.deepEqual(ramArr_.slice(), new Uint8Array([8, 9, 10]));
  assert.throws(() => ramArr_.set([11, 12, 13], 1), { message: 'offset is out of bounds' });
  ramArr_.set([11, 12], 1);
  assert.deepEqual(ramArr_.slice(), new Uint8Array([8, 11, 12]));

  const hostArray = new Uint8Array([42, 43, 44]);
  // Each of these will actually be passing in a copy of the array
  assert.equal(get0(hostArray), 42);
  assert.equal(get1(hostArray), 43);
  assert.equal(get2(hostArray), 44);
  assert.equal(get3(hostArray), undefined);
  assert.equal(get(hostArray, 'length'), 3);
  assert.equal(get(hostArray, 0), 42);
  assert.equal(get(hostArray, 1), 43);
  assert.equal(get(hostArray, 2), 44);
  assert.equal(get(hostArray, 3), undefined);

  // Checking that assignment to the host array doesn't do something stupid
  set0(hostArray, 50);
  assert.equal(hostArray[0], 42); // Unfortunate, but expected in the current implementation
});

test('Classes', async function () {
  const source = `
    class A {
      constructor() { this.x = 1; }
      getX() { return this.x; }
      static getY() { return this.y; }
      static getZ() { return this.z; }
    }
    A.y = 2;
    const getA = () => A;
    const getAInst = () => new A();
    const construct = X => new X();
    const isInstanceOf = (obj, Class) => obj.__proto__ === Class.prototype;
    vmExport(0, getA);
    vmExport(1, getAInst);
    vmExport(2, construct);
    vmExport(3, isInstanceOf);
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, { });
  const { [0]: getA, [1]: getAInst, [2]: construct, [3]: isInstanceOf } = vm.exports;

  const A = getA();
  const a = getAInst();

  assert.equal(A.y, 2);
  assert.equal(A.z, undefined);
  assert.equal(A.getY(), 2);
  assert.equal(A.getZ(), undefined);
  assert.equal(a.x, 1);
  assert.equal(a.getX(), 1);
  assert(isInstanceOf(a, A));

  a.x = 3;
  assert.equal(a.x, 3);
  assert.equal(a.getX(), 3);

  A.z = 4;
  assert.equal(A.z, 4);
  assert.equal(A.getZ(), 4);

  // Test construction
  const inst2 = construct(A); // Passing the class back into the VM
  assert.equal(inst2.x, 1);
  assert.equal(inst2.getX(), 1);
  assert(isInstanceOf(inst2, A));

  // Test construction in the host
  const inst3 = new A();
  assert.equal(inst3.x, 1);
  assert.equal(inst3.getX(), 1);
  assert(isInstanceOf(inst3, A));

  // Not supported: prototype consistency
  //
  // This is actually quite complicated to do correctly, I think, because we
  // cannot currently maintain the identity of VM objects in the host, and the
  // identity of prototypes is important for `instanceof`.
  assert.equal(Reflect.getPrototypeOf(a), Object.prototype);

  // Not supported: passing a host class to the VM
  class A2 {}
  assert.throws(() => construct(A2), { message: 'Host functions cannot be passed to the VM' });
});

test('Error handling', async function () {
  const source = `
    class Error { constructor(message) { this.message = message } }
    const thrower = () => { throw new Error('foo'); };

    const hostThrower = vmImport(0);
    const catcher = () => {
      try {
        hostThrower();
      } catch (e) {
        return e.message;
      }
    };
    const callHostNoCatch = () => {
      hostThrower();
    };

    vmExport(0, thrower);
    vmExport(1, catcher);
    vmExport(2, callHostNoCatch);
  `;
  const snapshot = compile(source, this.test!.title!);
  const hostThrower = () => { throw new Error('host error'); };
  const vm = await Runtime.restore(snapshot, { [0]: hostThrower });
  const { [0]: thrower, [1]: catcher, [2]: callHostNoCatch } = vm.exports;

  // Exception thrown by VM and caught by host
  assert.throws(() => thrower(), e => (e as any).message === 'foo');

  // Exception thrown by host and caught by VM
  assert.equal(catcher(), 'host error');

  // Exception thrown by host and not caught by VM
  assert.throws(() => callHostNoCatch(), e => (e as any).message === 'host error');
});

test('gas-counter', async function () {
  const source = `
    const infiniteLoop = () => { while (true) {} };
    const shortLoop = () => { for (let i = 0; i < 10; i++) {} };

    vmExport(0, infiniteLoop);
    vmExport(1, shortLoop);
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, { });
  const { [0]: infiniteLoop, [1]: shortLoop } = vm.exports;

  vm.stopAfterNInstructions(200);
  assert.equal(vm.getInstructionCountRemaining(), 200);
  shortLoop();
  assert.equal(vm.getInstructionCountRemaining(), 60);
  assert.throws(() => infiniteLoop(), { message: 'Microvium Error: MVM_E_INSTRUCTION_COUNT_REACHED (51)' });
  assert.equal(vm.getInstructionCountRemaining(), 0);
});

test('reflect-ownkeys', async function () {
  const source = `
    const x = { a: 1, b: 2 };
    const getX = () => x;
    vmExport(0, getX);
    vmExport(1, x);
  `;

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, { });
  const { [0]: getX, [1]: x2 } = vm.exports as any;

  const x = getX();
  assert.deepEqual(Reflect.ownKeys(x), ['a', 'b']);

  // With the addition of Reflect.keys support, the following now works:
  assert.deepEqual(x, { a: 1, b: 2 });
  assert.deepEqual({ ...x }, { a: 1, b: 2 });
  assert.deepEqual(JSON.stringify(x), '{"a":1,"b":2}');

  // And actually it looks like we can export the object directly and it just works.
  assert.deepEqual(x2, { a: 1, b: 2 });
});

function loadOnNode(source) {
  const exports: any = {};
  eval(`((vmExport) => {${source}})`)((k, v) => exports[k] = v);
  return { exports };
}

function compile(sourceText: string, testName: string) {
  const vm = Microvium.create();
  addDefaultGlobals(vm);

  vm.evaluateModule({ sourceText });
  const snapshot = vm.createSnapshot();
  const { disassembly } = Microvium.decodeSnapshot(snapshot);
  fs.writeFileSync(`build/dbg-${testName.replace(/ /g, '-')}.disassembly`, disassembly);


  // Save the snapshot to a file, in case we need to debug.
  fs.writeFileSync(`build/dbg-${testName.replace(/ /g, '-')}-bytes.js`,
    `const snapshot = [${[...snapshot.data].map(d => `0x${d.toString(16)}`).join(',')}];`)

  return snapshot.data;
}

async function measurePerformance(source: string, testName: string) {
  // Node.js
  const onNode = loadOnNode(source);
  const startNode = process.hrtime.bigint();
  onNode.exports[1]();
  const endNode = process.hrtime.bigint();
  console.log(`      Node: ${((Number(endNode) - Number(startNode))/1000_000).toFixed(1)} ms`);

  // Microvium on wasm
  const snapshot = compile(source, testName);
  const wasmVm = await Runtime.restore(snapshot, {});
  const startWasmVm = process.hrtime.bigint();
  wasmVm.exports[1]();
  const endWasmVm = process.hrtime.bigint();
  const wasmTotalMs = ((Number(endWasmVm) - Number(startWasmVm))/1000_000);
  console.log(`      Microvium on WASM: ${wasmTotalMs.toFixed(1)} ms`)

  // Microvium native
  const nativeVm = Microvium.restore({ data: snapshot }, {});
  const startNativeVm = process.hrtime.bigint();
  nativeVm.resolveExport(1)();
  const endNativeVm = process.hrtime.bigint();
  const nativeTotalMs = ((Number(endNativeVm) - Number(startNativeVm))/1000_000);
  console.log(`      Microvium native: ${nativeTotalMs.toFixed(1)} ms (${(nativeTotalMs / wasmTotalMs).toFixed(1)}x WASM)`);
}