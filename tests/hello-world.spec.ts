import Runtime from '../src/index';
import assert from 'assert/strict';
import { Microvium, addDefaultGlobals } from 'microvium';

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
})

test('pass basic values', async () => {
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

  testValue(undefined);
  testValue(null);
  testValue(true);
  testValue(false);
  testValue(42);
  testValue(420000);
  testValue(1.5);
  testValue(NaN);
  testValue(Infinity);
  testValue(-Infinity);
  // testValue('any string');
  // testValue('');
  // testValue('__proto__');
  // testValue('length');
})

// TODO: Test function call arguments and return value both directions
// TODO: Test fmod and pow
// TODO: Basic performance test



function compile(sourceText: string) {
  const vm = Microvium.create();
  addDefaultGlobals(vm);

  vm.evaluateModule({ sourceText });
  const snapshot = vm.createSnapshot();
  return snapshot.data;
}