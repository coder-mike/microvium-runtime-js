#!/bin/bash
set -e

# Assumes that microvium has been cloned to a sibling directory
pushd ../microvium
npm run copy-files
popd

cp ../microvium/dist-c/microvium.c src/microvium/microvium.c
cp ../microvium/dist-c/microvium.h src/microvium/microvium.h
