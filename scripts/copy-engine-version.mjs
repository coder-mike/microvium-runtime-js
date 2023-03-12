#!/usr/bin/env node

/*
This script copies the version number from microvium.h to package.json. The
microvium.h doesn't contain a patch version, so the patch version of
package.json is persisted as long as the major or minor versions don't change.
So the patch version can be used for bug fixes in the wrapper library itself.

An underlying assumption here is that the wrapper library doesn't make breaking
changes when the engine doesn't make breaking changes, and that the wrapper
library doesn't add features when the engine doesn't add features. Basically
this means that the wrapper library is not an independent library but should be
released in lockstep to the engine itself, just like the C interface.
*/

import fs from 'fs';
import assert from 'assert/strict';

const microviumH = fs.readFileSync('src/microvium/microvium.h', 'utf8');

const majorPattern = /#define MVM_ENGINE_MAJOR_VERSION (\d+)\b/;
const minorPattern = /#define MVM_ENGINE_MINOR_VERSION (\d+)\b/;
const versionPattern = /^  "version": "(\d+\.\d+\.\d+)",$/m;

let m = microviumH.match(majorPattern);
if (!m) throw new Error('Could not find major engine version in microvium.h');
const majorVersion = parseInt(m[1]);

m = microviumH.match(minorPattern);
if (!m) throw new Error('Could not find minor engine version in microvium.h');
const minorVersion = parseInt(m[1]);

const packageJson = fs.readFileSync('package.json', 'utf8');
m = packageJson.match(versionPattern);
if (!m) throw new Error('Could not version in package file');
const packageVersion = m[1].split('.');
let packageMajor = parseInt(packageVersion[0]);
let packageMinor = parseInt(packageVersion[1]);
let packagePatch = parseInt(packageVersion[2]);

// console.log({packageMajor, packageMinor, packagePatch, majorVersion, minorVersion})

if (majorVersion < packageMajor) throw new Error('Package regression. Please update versions by hand');
if (majorVersion > packageMajor) {
  packageMajor = majorVersion;
  packageMinor = minorVersion;
  packagePatch = 0;
} else {
  assert(majorVersion === packageMajor);
  if (minorVersion < packageMinor) throw new Error('Package regression. Please update versions by hand');
  if (minorVersion > packageMinor) {
    packageMinor = minorVersion;
    packagePatch = 0;
  } else {
    assert(minorVersion === packageMinor);
    /* keep patch version */
  }
}

const updatedPackageJson = packageJson.replace(versionPattern, `  "version": "${packageMajor}.${packageMinor}.${packagePatch}",`)
fs.writeFileSync('package.json', updatedPackageJson);
