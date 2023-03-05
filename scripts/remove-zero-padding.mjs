#!/usr/bin/env node

import fs from 'fs'

// The `reserve_ram` and `reserve_rom` constants in the allocator result in
// massive constants. I tried doing this with sed but it said that the regex is too big.
const find = /\(data \$.rodata \(i32.const 0\) "(\\00){131072}/;
const replaceWith = '(data $.rodata (i32.const 131072) "';
const inFile = 'build/microvium1.wat';
const outFile = 'build/microvium.wat';

// Delete the output if it already exists (so if something goes wrong then we don't have a stale output file)
if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

let s = fs.readFileSync(inFile, 'utf8');
if (!find.test(s))
  throw new Error('Could not find the constants for reserve_ram and reserve_rom')
s = s.replace(find, replaceWith);
fs.writeFileSync(outFile, s);