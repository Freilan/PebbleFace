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
  MdblCreationRecord cr = {
    .recordSize = sizeof(MdblCreationRecord),
    .stack = 6144,
    .slot  = 28672,
    .chunk = 16384,
    .flags = 0,
    .fxBuildFFI = NULL,
  };
  moddable_createMachine((ModdableCreationRecord *)&cr);
  window_destroy(w);
}
