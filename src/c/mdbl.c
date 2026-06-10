#include <pebble.h>

// The default XS machine (moddable_createMachine(NULL)) puts the JS slot
// heap, chunk heap, and stack in ONE small fixed static arena (~24KB) with
// growth disabled. The firmware host alone uses ~16KB of slots + ~3.3KB of
// chunk before the watchface runs a line, so our mod died at load with
// "Chunk allocation: failed" while ~96KB of system heap sat free.
//
// Passing explicit pool sizes makes the firmware allocate each pool
// separately from the app heap. They are still FIXED (no growth), so size
// with headroom and verify against the in-app [MEM] instrumentation report.
// Local struct mirrors ModdableCreationRecord (recordSize = versioning).
typedef struct {
  uint32_t recordSize;
  uint32_t stack;   // bytes
  uint32_t slot;    // bytes
  uint32_t chunk;   // bytes
  uint32_t flags;
  void *fxBuildFFI;
} MdblCreationRecord;

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);
  // Chunk sizing: measured live set is ~6KB but the weather fetch holds
  // ~10KB of chunk transiently, and a chunk ask that fails when the pool
  // is full of yet-uncollected garbage aborts the app (observed: a 120B
  // ask died at 10,128/10,240 used during fetch). 14KB keeps the fetch
  // peak clear of the ceiling. Chunk pressure is NOT a usable GC throttle
  // (steady-state chunk garbage is only ~300B/tick); the animation loop
  // nudges the GC explicitly instead — see animTick in main.js.
  MdblCreationRecord cr = {
    .recordSize = sizeof(MdblCreationRecord),
    .stack = 6144,
    .slot  = 28672,
    .chunk = 14336,
    .flags = 0,
    .fxBuildFFI = NULL,
  };
  moddable_createMachine((ModdableCreationRecord *)&cr);
  window_destroy(w);
}
