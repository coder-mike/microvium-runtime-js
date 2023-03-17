#include <stdint.h>
#include <assert.h>
#include "microvium.h"

// Variables in memory that can be used by the embedder for any purpose, e.g.
// for output parameters
void* generalPurpose1;
uint16_t generalPurpose2;
uint16_t generalPurpose3;
size_t generalPurpose4;

// Space to put arguments
mvm_Value argsTemp[64];
// Note: handles are kept in a singly-linked list with O(n) removal time, so you
// probably don't want too many of them anyway. They're about 8 bytes each.
mvm_Handle handles[2048];
mvm_Handle* unusedHandles;

mvm_TsMemoryStats memoryStats;

uint8_t engineMinorVersion = MVM_ENGINE_MINOR_VERSION;
uint8_t engineMajorVersion = MVM_ENGINE_MAJOR_VERSION;

extern mvm_TeError invokeHost(mvm_VM* vm, mvm_HostFunctionID hostFunctionID, mvm_Value* result, mvm_Value* args, uint8_t argCount);
extern void importRequired(mvm_HostFunctionID hostFunctionID);
extern void breakpointHit(mvm_VM* vm, uint16_t bytecodeAddress);

// Implemented in Microvium
void* mvm_gc_allocateWithHeader(mvm_VM* vm, uint16_t sizeBytes, uint8_t typeCode);
mvm_TeError getProperty(mvm_VM* vm, mvm_Value* pObjectValue, mvm_Value* pPropertyName, mvm_Value* out_propertyValue);
mvm_TeError setProperty(mvm_VM* vm, mvm_Value* pOperands);

mvm_TeError resolveImport(mvm_HostFunctionID hostFunctionID, void* context, mvm_TfHostFunction* out_hostFunction) {
  importRequired(hostFunctionID);
  // All exports resolve to `invokeHost`
  *out_hostFunction = &invokeHost;
  return MVM_E_SUCCESS;
}

const mvm_TfResolveImport pResolveImport = &resolveImport;

mvm_TeError restore(mvm_VM** result, MVM_LONG_PTR_TYPE snapshotBytecode, size_t bytecodeSize) {
  return mvm_restore(result, snapshotBytecode, bytecodeSize, NULL, resolveImport);
}

void initHandles() {
  // Add all the handles to the unusedHandles linked list
  mvm_Handle* next = 0;
  for (int i = 0; i < (sizeof handles / sizeof handles[0]); i++) {
    handles[i]._next = next;
    next = &handles[i];
  }
  unusedHandles = next;
}

mvm_Handle* newHandle(mvm_VM* vm, mvm_Value value) {
  mvm_Handle* handle = unusedHandles;
  unusedHandles = unusedHandles->_next;
  if (!handle) return 0;

  mvm_initializeHandle(vm, handle);
  mvm_handleSet(handle, value);

  return handle;
}

void vmReleaseHandle(mvm_VM* vm, mvm_Handle* handle) {
  if (!handle) return;
  mvm_releaseHandle(vm, handle);
  handle->_next = unusedHandles;
  unusedHandles = handle;
}

void setBreakpointCallback(mvm_VM* vm) {
  mvm_dbg_setBreakpointCallback(vm, &breakpointHit);
}

mvm_TeError getProp(mvm_VM* vm, mvm_Handle* pObjectValue, mvm_Handle* pPropertyName, mvm_Handle* out_propertyValue) {
  return getProperty(vm, &pObjectValue->_value, &pPropertyName->_value, &out_propertyValue->_value);
}

//mvm_TeError setProperty(mvm_VM* vm, mvm_Value* pOperands);