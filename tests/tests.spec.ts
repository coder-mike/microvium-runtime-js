import Runtime from '../src/index';
import assert from 'assert/strict';
// TODO: this relative import is temporary
import { Microvium, addDefaultGlobals } from '../../microvium/dist/lib';

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

test('hello-world', async () => {
  const source = `
    const print = vmImport(1);
    vmExport(1, main);

    function main() {
      print("hello, world")
    }`

  const snapshot = compile(source);

  let print: string | undefined;
  const imports = {
    [1]: s => { print = s }
  };

  const vm = await Runtime.restore(snapshot, imports);

  const main = vm.exports[1];
  main();

  assert.equal(print, 'hello, world');
});

test('pass basic values', async () => {
  // This tests the passing of basic values in both directions across the
  // boundary and preserving in Microvium memory.

  const source = `
    let x;
    vmExport(1, () => x); // get
    vmExport(2, value => x = value); // set
  `;

  const snapshot = compile(source);
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

test('fmod and pow', async () => {
  // The operators fmod and pow are outsourced from the VM to the host. This
  // tests that they work correctly

  const source = `
    vmExport(1, (x, y) => x % y); // fmod
    vmExport(2, (x, y) => x ** y); // pow
  `;

  const snapshot = compile(source);
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

  await measurePerformance(source);
})

test('performance 2', async function () {
  this.timeout(20000);

  // This is similar to the previous performance test except using closures
  // instead of objects, since closures are a strong point in Microvium (they
  // are smaller and lighter, and access to closure variables is O(1)). And
  // also, the allocation is part of the loop so this is exercising the GC
  // allocator. Honestly I'm little surprised that node wins this one, given how
  // much more complicated closures are in node.

  const objCount = 100;
  const repeatCount = 1000;

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

  await measurePerformance(source);
})

function loadOnNode(source) {
  const exports: any = {};
  eval(`((vmExport) => {${source}})`)((k, v) => exports[k] = v);
  return { exports };
}

function compile(sourceText: string) {
  const vm = Microvium.create();
  addDefaultGlobals(vm);

  vm.evaluateModule({ sourceText });
  const snapshot = vm.createSnapshot();
  return snapshot.data;
}

async function measurePerformance(source: string) {
  // Node.js
  const onNode = loadOnNode(source);
  const startNode = process.hrtime.bigint();
  onNode.exports[1]();
  const endNode = process.hrtime.bigint();
  console.log(`      Node: ${((Number(endNode) - Number(startNode))/1000_000).toFixed(1)} ms`)

  // Microvium on wasm
  const snapshot = compile(source);
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