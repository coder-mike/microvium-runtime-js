import Runtime from '../src/index';
import assert from 'assert/strict';
import { Microvium, addDefaultGlobals } from 'microvium';

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

// TODO: Test fmod and pow
// TODO: Basic performance test



function compile(sourceText: string) {
  const vm = Microvium.create();
  addDefaultGlobals(vm);

  vm.evaluateModule({ sourceText });
  const snapshot = vm.createSnapshot();
  return snapshot.data;
}