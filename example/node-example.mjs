// import Microvium from '@microvium/runtime'
import Microvium from '../dist/index.mjs'

/*
This snapshot is a microvium compilation of the following script:

```
const print = vmImport(1);
vmExport(1, main);

function main() {
  print("hello, world")
}
```

*/
const snapshot = [0x07,0x1c,0x07,0x00,0x7c,0x00,0xaa,0xdb,0x03,0x00,0x00,0x00,0x1c,0x00,0x1e,0x00,0x22,0x00,0x22,0x00,0x28,0x00,0x2c,0x00,0x6a,0x00,0x72,0x00,0x01,0x00,0x01,0x00,0x5d,0x00,0x71,0x00,0x6d,0x00,0x01,0x00,0x39,0x00,0x31,0x00,0x00,0x00,0x05,0x40,0x70,0x75,0x73,0x68,0x00,0x00,0x0d,0x40,0x68,0x65,0x6c,0x6c,0x6f,0x2c,0x20,0x77,0x6f,0x72,0x6c,0x64,0x00,0x00,0x02,0x60,0x00,0x00,0x0d,0x50,0x04,0x31,0x30,0x30,0x88,0x1d,0x00,0x6b,0x12,0x6f,0x67,0x01,0x60,0x00,0x0d,0x50,0x03,0x89,0x00,0x00,0x01,0x88,0x39,0x00,0x78,0x02,0x67,0x01,0x60,0x00,0x49,0x00,0x02,0x00,0x19,0x00,0x01,0x00,0x08,0xc0,0x05,0x00,0x05,0x00,0x31,0x00,0x4d,0x00];

const imports = {
  [1]: console.log
};

const vm = await Microvium.restore(snapshot, imports);

const main = vm.exports[1];
main(); // prints hello-world