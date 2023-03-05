#!/bin/bash
set -e

CC="clang \
	--target=wasm32 \
	-nostdlib \
	-O3 \
	-I ./src \
	-I ./src/microvium \
	-I ./src/clib \
	-Werror \
	-nostdlib \
	-mbulk-memory"

mkdir -p build
mkdir -p dist

$CC -o build/microvium.o -c src/microvium/microvium.c
$CC -o build/allocator.o -c src/allocator.c
$CC -o build/clib.o -c src/clib/clib.c
$CC -o build/glue.o -c src/glue.c

wasm-ld-15 \
	--no-entry \
	--export-all \
	--lto-O3 \
	--allow-undefined \
	--import-memory \
	--Map build/microvium.map \
	-o build/microvium1.wasm \
	--global-base=0 \
	build/allocator.o \
	build/glue.o \
	build/microvium.o \
	build/clib.o

wasm2wat build/microvium1.wasm -o build/microvium1.wat

node scripts/remove-zero-padding.mjs

wat2wasm build/microvium.wat -o dist/microvium.wasm

node scripts/output-base64.mjs

npx rollup --config rollup.config.js

