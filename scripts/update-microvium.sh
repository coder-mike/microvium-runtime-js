#!/bin/bash
set -e

# Assumes that microvium has been cloned to a sibling directory
pushd ../microvium
npm run copy-files
npm run preprocess-microvium
popd

cp ../microvium/dist-c/microvium.c src/microvium/microvium.c
cp ../microvium/dist-c/microvium.h src/microvium/microvium.h
cp ../microvium/lib/runtime-types.ts src/microvium/runtime-types.ts
node ./scripts/copy-engine-version.mjs
node ./scripts/extract-memory-stats-layout.mjs