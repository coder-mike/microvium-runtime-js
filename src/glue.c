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

mvm_TeError resolveImport(mvm_HostFunctionID hostFunctionID, void* context, mvm_TfHostFunction* out_hostFunction) {
  importRequired(hostFunctionID);
  // All exports resolve to `invokeHost`
  *out_hostFunction = &invokeHost;
  return MVM_E_SUCCESS;
}

const mvm_TfResolveImport pResolveImport = &resolveImport;

void initHandles() {
  // Add all the handles to the unusedHandles linked list
  mvm_Handle* next = 0;
  for (int i = 0; i < (sizeof handles / sizeof handles[0]); i++) {
    handles[i]._next = next;
    next = &handles[i];
  }
  unusedHandles = next;
}

// Implemented in Microvium
void* mvm_gc_allocateWithHeader(mvm_VM* vm, uint16_t sizeBytes, uint8_t typeCode);

// Returns the handle (or null) and writes the memory address to generalPurpose1
mvm_Handle* alloc(mvm_VM* vm, uint16_t sizeBytes, uint8_t typeCode) {
  // Allocations are attached to a handle so they don't get GC'd. For example,
  // if the host is passing multiple arguments to a function call, and the
  // allocation of the second argument causes a GC run that would otherwise
  // collect the first argument.
  mvm_Handle* handle = unusedHandles;
  unusedHandles = unusedHandles->_next;
  if (!handle) return 0;

  mvm_initializeHandle(vm, handle);
  generalPurpose1 = mvm_gc_allocateWithHeader(vm, sizeBytes, typeCode);
  // This makes some assumptions. Firstly, allocator.c is allocating everything
  // in the first page of memory, so pointers are all 16 bit. Also the port file
  // has MVM_RAM_PAGE_ADDR as 0 and MVM_USE_SINGLE_RAM_PAGE set, so that
  // mvm_Value pointers are encoded identically to the physical pointer. This
  // also means that the last bit is zero because pointers are 2-byte aligned.
  // This makes `ShortPtr_encode` a no-op, so we don't need to call it (and I
  // can't call it from here anyway because it's static inline to Microvium).
  assert(((uint16_t)generalPurpose1 & 0xFFFE) == (uint16_t)generalPurpose1);
  mvm_handleSet(handle, (uint16_t)generalPurpose1);

  return handle;
}

void release(mvm_VM* vm, mvm_Handle* handle) {
  if (!handle) return;
  mvm_releaseHandle(vm, handle);
  handle->_next = unusedHandles;
  unusedHandles = handle;
}