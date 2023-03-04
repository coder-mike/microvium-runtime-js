#!/bin/bash
set -e

# Assumes that microvium has been cloned to a sibling directory
pushd ../microvium
npm run build
popd

cp ../microvium/microvium.c src/microvium/microvium.c
cp ../microvium/microvium.h src/microvium/microvium.h
