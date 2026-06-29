#include <pebble.h>

// Yoshi Flower is an Alloy (Moddable) watchface: all rendering and logic live
// in the JS mod (src/embeddedjs/main.js). This C stub opens a window and starts
// the XS virtual machine that runs the mod.
//
// ── Blocked by a PebbleOS firmware bug — see KNOWN_ISSUES.md ───
// On the post-update firmware the pool sizes below are IGNORED:
// moddable_createMachine() (src/fw/applib/moddable/moddable.c) re-declares
// `creation` inside its size-handling block (variable shadowing), so the custom
// stack/slot/chunk are written to a discarded copy and the machine is always
// built from the small DEFAULT pools (~8 KB chunk) -- too little for this face,
// which then aborts at boot with "memory full". The manifest `creation` block
// is ignored too. Confirmed on-device with XS instrumentation (changing .chunk
// left the logged "Chunk available" unchanged). Nothing in this project can
// grow the pool until that one-line firmware bug is fixed; once it is, the
// sizes below apply and the face runs exactly as it did before the OS update.
//
// fxBuildFFI is deliberately NULL: the face resolves resource ids at runtime by
// a viewbox fingerprint (see main.js), not FFI, so the old resource-id hook was
// unused -- and NULL lets the XS machine use the kernel heap
// (moddable.c: modMachineAllowKernelHeap(NULL == fxBuildFFI)), which on-device
// freed ~33 KB of app RAM. So when the pool bug is fixed these sizes draw from a
// comfortable heap. (Set .flags = kModdableCreationFlagLogInstrumentation to log
// slot/chunk/stack via app_log when diagnosing memory.)
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
    .slot  = 40960,
    .chunk = 24576,    // preload eats ~9 KB; this leaves ~15 KB for runtime
    .flags = 0,        // instrumentation off for release
    .fxBuildFFI = NULL,
  };
  moddable_createMachine((ModdableCreationRecord *)&cr);

  window_destroy(w);
}
