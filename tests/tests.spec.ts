import Runtime from '../src/index';
import assert from 'assert/strict';
// TODO: this relative import is temporary while I'm developing so I have the
// latest working copy of Microvium. Before the first release, I intend to
// change this back to just `microvium`
import { Microvium, addDefaultGlobals } from '../../microvium/dist/lib';
import fs from 'fs';
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

test.skip('performance 1', async function () {
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

test.skip('performance 2', async function () {
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
  assert.equal(stats1.totalSize, 82);
  vm.exports[1]();
  assert.equal(stats2.totalSize, 15576);
  assert.equal(stats2.stackHeight, 16);
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
  // This tests the passing of function-types between the host and VM

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

  const bar = () => {}

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {
    [1]: bar
  });
  const { [1]: getFoo, [2]: adder, [3]: call, [4]: getBar } = vm.exports;

  // Passing a VM function out of the VM (TC_REF_FUNCTION)
  const foo = getFoo();
  assert.equal(typeof foo, 'function');
  assert.equal(foo(1,2), 3);

  // TODO: finish off these tests

  // Passing a VM function into the VM (TC_REF_FUNCTION)
  // assert.equal(call(foo, 5, 10), 15);


  // Passing a closure out of the VM (TC_REF_CLOSURE)
  //const add = adder(1);
  //assert.equal(typeof add, 'function');
  //assert.equal(add(2), 3);

  // Passing a closure into the VM (TC_REF_CLOSURE)

  // Passing a host function into the VM (TC_REF_HOST_FUNC)

  // Passing a host function out of the VM (TC_REF_HOST_FUNC)
});

// TODO: why do we have two of these?
test('passing functions', async function () {
  // This tests the passing of function-types between the host and VM

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

  const bar = () => {}

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {
    [1]: bar
  });
  const { [1]: getFoo, [2]: adder, [3]: call, [4]: getBar } = vm.exports;

  // Passing a VM function out of the VM (TC_REF_FUNCTION)
  const foo = getFoo();
  assert.equal(typeof foo, 'function');
  assert.equal(foo(1,2), 3);

  // TODO: finish off these tests

  // Passing a VM function into the VM (TC_REF_FUNCTION)
  // assert.equal(call(foo, 5, 10), 15);


  // Passing a closure out of the VM (TC_REF_CLOSURE)
  //const add = adder(1);
  //assert.equal(typeof add, 'function');
  //assert.equal(add(2), 3);

  // Passing a closure into the VM (TC_REF_CLOSURE)

  // Passing a host function into the VM (TC_REF_HOST_FUNC)

  // Passing a host function out of the VM (TC_REF_HOST_FUNC)
});

test('objects-basic', async function () {
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

    vmExport(1, init);
    vmExport(2, getRomObj);
    vmExport(3, getRamObj);
    vmExport(4, getX);
    vmExport(5, getY);
    vmExport(6, getZ);
    vmExport(7, setX);
    vmExport(8, set);
    vmExport(9, get);
  `;

  const bar = () => {}

  const snapshot = compile(source, this.test!.title!);
  const vm = await Runtime.restore(snapshot, {
    [1]: bar
  });
  const { [1]: init, [2]: getRomObj, [3]: getRamObj, [4]: getX, [5]: getY, [6]: getZ, [7]: setX, [8]: set, [9]: get } = vm.exports;

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

  // Do all the same/similar tests again with the ramObj. I.e. an object create
  // after the snapshot rather than before.
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
  console.log(`      Node: ${((Number(endNode) - Number(startNode))/1000_000).toFixed(1)} ms`)

  // Microvium on wasm
  const snapshot = compile(source, testName);
  const wasmVm = await Runtime.restore(snapshot, {});
  const startWasmVm = process.hrtime.bigint();
  wasmVm.exports[1]();
  const endWasmVm = process.hrtime.bigint();
  console.log(`      Microvium on WASM: ${((Number(endWasmVm) - Number(startWasmVm))/1000_000).toFixed(1)} ms`)

  // Microvium native
  const nativeVm = Microvium.restore({ data: snapshot }, {});
  const startNativeVm = process.hrtime.bigint();
  nativeVm.resolveExport(1)();
  const endNativeVm = process.hrtime.bigint();
  console.log(`      Microvium native: ${((Number(endNativeVm) - Number(startNativeVm))/1000_000).toFixed(1)} ms`)
}