/**
 * @file
 *
 * This is a minimalist heap implementation to use a fixed-size 64kB block. It's
 * assumed that this chunk of memory is pre-allocated at address 0.
 *
 * Each block has a 2-byte block header that holds the size of the block
 * (including header) or null to indicate the terminating block. The low bit of
 * the header indicates whether the block is used or not - 0 means free.
 *
 * Note: this allocator may suffer from fragmentation. A longer-term solution is
 * not to use an allocator at all but instead have a mode where the Microvium GC
 * runs as a semi-space collector, using page 0 as the primary space and then
 * collecting into page 1 and then copying the collected data back to page 0. A
 * collection is already O(n) in the size of the living objects, so this doesn't
 * change the overall computational complexity, and block copying a single page
 * of memory will be pretty quick on a modern machine, and this would completely
 * eliminate fragmentation and also allow the user-space program to consume the
 * full 64kB if needed.
 */

#include "allocator.h"

#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <assert.h>

// Reserve space for "RAM" and "ROM". Note that RAM needs to be constrained to
// the first page of memory. Note that at the moment I don't know how to use the
// full first page of memory.
const uint8_t reserve_ram[0x10000]; // 64kB
const uint8_t reserve_rom[0x10000]; // 64kB

#define ALLOCATOR_START_ADDR ((volatile void*)0)
static volatile void* const allocatorStartAddr = ((volatile void*)0);

#define WORD_AT(vm, offset) (*(volatile uint16_t*)(0 + offset))

void allocator_init(void* ramStart, size_t ramSize) {
  // This allocator has been design to use exactly one page of memory, starting
  // at a fixed address which is page-aligned.
  assert(ramStart == &reserve_ram);
  assert(ramSize == 0x10000);

  memset((void*)allocatorStartAddr, 0, 0x10000);

  WORD_AT(vm, 0x0) = 0xFFFE; // First bucket
  WORD_AT(vm, 0xFFFE) = 0; // Terminates link list of allocations

  // allocator_checkHeap();
}

void allocator_deinit() {
}

void* allocator_malloc(size_t size) {
  // allocator_checkHeap();

  void* result = NULL;
  // The needed of the block needed. Blocks have even sizes since the last bit is
  // used as a flag. Blocks have an extra 2 bytes for their header
  uint16_t needed = (size + 3) & 0xFFFE;
  if (needed < size) goto EXIT; // Size overflowed

  volatile uint16_t* p = &WORD_AT(vm, 0x0);
  volatile uint16_t* prevUnused = NULL;
  while (*p) {
    uint16_t header = *p;
    bool used = header & 1;
    uint16_t blockSize = header & 0xFFFE;
    if (!used) {
      // 2 contiguous blocks are free. Combine them.
      if (prevUnused) {
        blockSize += *prevUnused;
        p = prevUnused; // Try the previous block again, now that it's bigger
        *p = blockSize;
        prevUnused = NULL;
      }

      if (blockSize >= needed) { // Big enough?
        uint16_t remainingSize = blockSize - needed;
        if (remainingSize >= 64) {
          // Break the block up
          volatile uint16_t* nextBlock = (uint16_t*)((intptr_t)p + needed);
          *p = needed;
          *nextBlock = remainingSize;
        }
        *p |= 1;
        p += 1;
        memset((void*)p, 0xDA, needed - 2);
        result = (void*)p;
        goto EXIT;
      } else { // Not used but not big enough
        prevUnused = p;
      }
    } else {
      prevUnused = NULL;
    }
    p = (volatile uint16_t*)((intptr_t)p + blockSize);
  }
EXIT:
  // allocator_checkHeap();
  return result;
}

void allocator_free(void* ptr) {
  assert((intptr_t)ptr - (intptr_t)ALLOCATOR_START_ADDR < 0x10000);
  uint16_t* p = (uint16_t*)ptr;
  p--; // Go to header
  assert((*p & 1) == 1); // Check that it's not already freed
  *p &= 0xFFFE; // Flag it to be unused
  uint16_t size = *p;
  memset(p + 1, 0xDB, size - 2);
  // allocator_checkHeap();
}

void allocator_checkHeap() {
  volatile uint16_t* start = &WORD_AT(vm, 0x0);
  volatile uint16_t* end = &WORD_AT(vm, 0xFFFE);
  volatile uint16_t* p = start;
  while (*p) {
    assert((p >= start) && (p <= end));
    p = (uint16_t*)((intptr_t)p + (*p & 0xFFFE));
  }
  assert(p == end);
}