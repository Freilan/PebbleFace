#include <pebble.h>

// Yoshi Flower is an Alloy (Moddable) watchface: all rendering and logic live
// in the JS mod (src/embeddedjs/main.js). This C stub just opens a window and
// starts the XS virtual machine that runs the mod.
//
// ── XS machine sizing — current firmware ──────────────────────
// We deliberately do NOT hand-size the slot/chunk/stack pools here, because the
// updated firmware can't apply them. moddable_createMachine() in PebbleOS
// (src/fw/applib/moddable/moddable.c) has a variable-shadowing bug: when the
// ModdableCreationRecord carries custom stack/slot/chunk, they are written into
// a RE-DECLARED inner `creation` that goes out of scope and is discarded, so the
// machine is always cloned from the DEFAULT creation. Proven on-device with the
// instrumentation flag below: bumping .chunk from 14336 to 32768 left the logged
// "Chunk available" byte-for-byte identical (5184). Custom pool sizes are a
// no-op until that firmware bug is fixed. (Reported upstream.)
//
// ── The lever we DO have: fxBuildFFI ──────────────────────────
// moddable.c does:  modMachineAllowKernelHeap(NULL == fxBuildFFI);
// so a NULL FFI hook lets the XS machine draw from the kernel heap instead of
// being confined to the small app-RAM arena. The face has no FFI dependency --
// it resolves resource ids at runtime by a viewbox fingerprint (see main.js),
// and this firmware exposes no FFI/Natives anyway -- so the old resource-id FFI
// hook was pure dead weight that ALSO denied the machine the kernel heap. Drop
// it: fxBuildFFI = NULL. That, not pool sizing, is our real shot at fitting.
//
// flags = kModdableCreationFlagLogInstrumentation logs slot/chunk/stack via
// app_log (only while a BT log listener is attached). Set .flags = 0 for the
// final release build once the boot is confirmed.
typedef struct {
  uint32_t recordSize;
  uint32_t stack;   // bytes (0 = firmware default)
  uint32_t slot;    // bytes (0 = firmware default)
  uint32_t chunk;   // bytes (0 = firmware default)
  uint32_t flags;
  void *fxBuildFFI;
} MdblCreationRecord;

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);

  MdblCreationRecord cr = {
    .recordSize = sizeof(MdblCreationRecord),
    .stack = 0, .slot = 0, .chunk = 0,   // defaults (custom sizes are ignored by
                                         //   the firmware shadowing bug regardless)
    .flags = kModdableCreationFlagLogInstrumentation,
    .fxBuildFFI = NULL,                  // no FFI hook -> machine may use kernel heap
  };
  moddable_createMachine((ModdableCreationRecord *)&cr);

  window_destroy(w);
}
