#pragma once

extern void mvm_fatalError(int e);
#define assert(x) if (!(x)) mvm_fatalError(17)