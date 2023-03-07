import Runtime from '../src/index';
import assert from 'assert/strict';
import { Microvium, addDefaultGlobals } from 'microvium';

it('hello-world', async () => {
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

function compile(sourceText: string) {
  const vm = Microvium.create();
  addDefaultGlobals(vm);

  vm.evaluateModule({ sourceText });
  const snapshot = vm.createSnapshot();
  return snapshot.data;
}