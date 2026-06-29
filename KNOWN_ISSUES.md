# Known Issues

## Watchface aborts at boot with `fxAbort memory full` (PebbleOS firmware bug)

**Status:** blocked on an upstream firmware fix. The watchface ran fine before
the PebbleOS / Pebble-app update; the same code now reboot-loops on the
PebbleOS boot screen and the app log shows:

```
[ERROR] xsPlatform.c:125: fxAbort memory full:
```

### Root cause

`moddable_createMachine()` in PebbleOS — `src/fw/applib/moddable/moddable.c` —
**silently ignores the caller's custom `stack`/`slot`/`chunk` pool sizes** due to
a C variable-shadowing bug:

```c
struct xsCreationRecord creation = *defaultCreation;   // (A) the record actually used
if (NULL != cr) {
    ...
    if (stack || slot || chunk) {
        struct xsCreationRecord creation = *defaultCreation;   // (B) shadows (A)
        creation.stackCount      = stack / sizeof(xsSlot);     // writes to (B)
        creation.initialHeapCount = slot / sizeof(xsSlot);
        creation.initialChunkSize = chunk;
        ...
    }                                                          // (B) discarded here
    ...
}
xsMachine *the = modCloneMachine(&creation, NULL);             // clones (A) — defaults
```

The inner `creation` (B) shadows the outer one (A). The custom sizes are written
to (B), which goes out of scope at the end of the block, so the machine is always
cloned from (A) — the **default** pools (~8 KB chunk). Any Alloy app whose mod
needs a larger heap than the default aborts at boot. This is a regression: custom
pool sizing worked before the update.

### How it was confirmed (on-device, this project)

Using `kModdableCreationFlagLogInstrumentation` to log the pools:

- Changing `mdbl.c` `.chunk` from `14336` → `32768` left the logged
  **`Chunk available` byte-for-byte identical (5184, later 8192)** — proof the
  size fields are not applied.
- The app manifest's `creation` block (`chunk.initial`) was **also ignored**
  (`Chunk available` stayed `8192`).
- At the abort the machine is on the default pools and the base face (preloaded
  mod + font + draw buffers ≈ 5 KB) already nearly fills the ~8 KB chunk pool, so
  it overflows on the first resource decodes. ~95 KB of app heap was free but
  cannot be directed to the fixed chunk pool.

### Suggested upstream fix

In `moddable_createMachine`, delete the inner re-declarations of
`defaultCreation` and `creation` inside the `if (stack || slot || chunk)` block
so the `stackCount` / `initialHeapCount` / `initialChunkSize` assignments mutate
the **outer** `creation` that `modCloneMachine()` uses. One-line-class change.

File against: `github.com/coredevices/PebbleOS`.

### Workarounds applied in this repo (pending the firmware fix)

- **`src/c/mdbl.c`** — removed the unused resource-id FFI hook and pass
  `fxBuildFFI = NULL`. The face resolves resource ids by viewbox fingerprint, so
  the hook was dead code; `NULL` also makes the firmware allow the XS machine to
  use the **kernel heap** (`modMachineAllowKernelHeap(NULL == fxBuildFFI)`),
  which freed ~33 KB of app RAM on-device. The pool sizes remain set so the face
  runs as soon as the shadowing bug is fixed.

These do **not** make it boot on the current firmware (the pool is still capped
at the default), but they leave the project ready to run the moment the firmware
is patched, with no further changes.
