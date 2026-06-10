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
  // Chunk size doubles as the GC throttle: XS only collects on chunk
  // pressure and cannot see the app-heap memory backing image clones
  // (~5KB per animation tick). A 16KB pool meant a GC only every ~6 ticks,
  // by which time ~30KB of invisible native garbage had exhausted the
  // heap (~1.5s after launch). 10KB fits the ~5.6KB live set comfortably
  // while forcing a GC every ~2-3 ticks, capping native garbage at ~15KB.
  MdblCreationRecord cr = {
    .recordSize = sizeof(MdblCreationRecord),
    .stack = 6144,
    .slot  = 28672,
    .chunk = 10240,
    .flags = 0,
    .fxBuildFFI = NULL,
  };
  moddable_createMachine((ModdableCreationRecord *)&cr);
  window_destroy(w);
}
