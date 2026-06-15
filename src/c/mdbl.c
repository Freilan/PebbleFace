#include <pebble.h>

// ── XS machine sizing ─────────────────────────────────────────
// The default machine (moddable_createMachine(NULL)) is a small fixed
// arena that the firmware host alone nearly fills. Explicit pool sizes
// make the firmware allocate each pool separately from the app heap;
// they are still FIXED (no growth). Chunk: the measured live set is ~6KB
// but the weather fetch holds ~10KB transiently, and a chunk ask that
// cannot be satisfied ABORTS the app — 14KB keeps the fetch peak clear.
// GC cadence is driven explicitly by the animation loop (see animTick).
// Slot: holds JS objects/closures + the preloaded module set. The mod grew
// (settings, the catch-up cascade, charging mode + the Battery module), and
// 28672 began aborting at LOAD with "Slot allocation: failed in fixed size
// heap" — raised to 36864. Pulled from the app heap (~103KB free at entry),
// which has the slack; the chunk pool is the one that must stay generous.
typedef struct {
  uint32_t recordSize;
  uint32_t stack;   // bytes
  uint32_t slot;    // bytes
  uint32_t chunk;   // bytes
  uint32_t flags;
  void *fxBuildFFI;
} MdblCreationRecord;

// ── Resource id table for the JS side ─────────────────────────
// Resource ids are assigned by the build's resource-ball order, which is
// NOT deterministic across builds (observed: exact media order, rotations
// of it, near-alphabetical — no rule survived five builds). The one
// authority is the generated resource_ids.auto.h (auto-included via
// pebble.h). This table snapshots those defines; the FFI hook below hands
// it to JS, where `new FFI().ids` yields it as an ArrayBuffer.
// LAYOUT MUST MATCH the R_* offsets in src/embeddedjs/main.js:
//   [0..2]   petal_1..3          [3..5]   petal_fall_1..3
//   [6..8]   petal_grow_1..3
//   [9..20]  face frames, set-major: 12_11, 10_9, 8_7, 6_5, 4_3, 2_1 (x2)
//   [21]     bee
//   [22..27] weather icons: cloudy, pcloudy, clear, rain, snow, storm
//   [28..59] yoshi heads, color-major: green, lblue, red, yellow (x8 dirs)
//   [60]     yoshi tongue
static const uint8_t s_resource_ids[] = {
  RESOURCE_ID_PETAL_1, RESOURCE_ID_PETAL_2, RESOURCE_ID_PETAL_3,
  RESOURCE_ID_FALL_1, RESOURCE_ID_FALL_2, RESOURCE_ID_FALL_3,
  RESOURCE_ID_GROW_1, RESOURCE_ID_GROW_2, RESOURCE_ID_GROW_3,
  RESOURCE_ID_FACE_12_11_1, RESOURCE_ID_FACE_12_11_2,
  RESOURCE_ID_FACE_10_9_1, RESOURCE_ID_FACE_10_9_2,
  RESOURCE_ID_FACE_8_7_1, RESOURCE_ID_FACE_8_7_2,
  RESOURCE_ID_FACE_6_5_1, RESOURCE_ID_FACE_6_5_2,
  RESOURCE_ID_FACE_4_3_1, RESOURCE_ID_FACE_4_3_2,
  RESOURCE_ID_FACE_2_1_1, RESOURCE_ID_FACE_2_1_2,
  RESOURCE_ID_BEE,
  RESOURCE_ID_WX_CLOUDY, RESOURCE_ID_WX_PCLOUDY, RESOURCE_ID_WX_CLEAR,
  RESOURCE_ID_WX_RAIN, RESOURCE_ID_WX_SNOW, RESOURCE_ID_WX_STORM,
  RESOURCE_ID_YOSHI_GREEN_0, RESOURCE_ID_YOSHI_GREEN_1, RESOURCE_ID_YOSHI_GREEN_2,
  RESOURCE_ID_YOSHI_GREEN_3, RESOURCE_ID_YOSHI_GREEN_4, RESOURCE_ID_YOSHI_GREEN_5,
  RESOURCE_ID_YOSHI_GREEN_6, RESOURCE_ID_YOSHI_GREEN_7,
  RESOURCE_ID_YOSHI_LBLUE_0, RESOURCE_ID_YOSHI_LBLUE_1, RESOURCE_ID_YOSHI_LBLUE_2,
  RESOURCE_ID_YOSHI_LBLUE_3, RESOURCE_ID_YOSHI_LBLUE_4, RESOURCE_ID_YOSHI_LBLUE_5,
  RESOURCE_ID_YOSHI_LBLUE_6, RESOURCE_ID_YOSHI_LBLUE_7,
  RESOURCE_ID_YOSHI_RED_0, RESOURCE_ID_YOSHI_RED_1, RESOURCE_ID_YOSHI_RED_2,
  RESOURCE_ID_YOSHI_RED_3, RESOURCE_ID_YOSHI_RED_4, RESOURCE_ID_YOSHI_RED_5,
  RESOURCE_ID_YOSHI_RED_6, RESOURCE_ID_YOSHI_RED_7,
  RESOURCE_ID_YOSHI_YELLOW_0, RESOURCE_ID_YOSHI_YELLOW_1, RESOURCE_ID_YOSHI_YELLOW_2,
  RESOURCE_ID_YOSHI_YELLOW_3, RESOURCE_ID_YOSHI_YELLOW_4, RESOURCE_ID_YOSHI_YELLOW_5,
  RESOURCE_ID_YOSHI_YELLOW_6, RESOURCE_ID_YOSHI_YELLOW_7,
  RESOURCE_ID_YOSHI_TONGUE,
};

// ── Minimal FFI ABI ───────────────────────────────────────────
// Mirrors sxSlot/sxMachine/sxAPI from xsffi.h (member ORDER is the ABI —
// keep all 25 entries even though only a few are used). When the JS side
// constructs `new FFI()`, the firmware calls prv_build_ffi with the
// machine and this API table of firmware-side entry points.
typedef struct { void *data[4]; } FfiSlot;
typedef struct { FfiSlot *stack; FfiSlot *scope; FfiSlot *frame; } FfiMachine;
typedef struct {
  FfiSlot *(*this_)(FfiMachine *the);
  int32_t (*argc)(FfiMachine *the);
  FfiSlot *(*argv)(FfiMachine *the, int32_t index);
  void (*pop)(FfiMachine *the);
  void (*push)(FfiMachine *the, FfiSlot *slot);
  FfiSlot *(*result)(FfiMachine *the);

  void (*abort_)(FfiMachine *the, int status);
  void (*defineID)(FfiMachine *the, int32_t id, uint8_t flag, uint8_t mask);
  int32_t (*id)(FfiMachine *the, char *name);
  FfiSlot *(*newHostFunction)(FfiMachine *the, void *callback, int32_t length,
                              int32_t name, int32_t profileID);

  void (*fromBigInt64)(FfiMachine *the, FfiSlot *slot, int64_t value);
  void (*fromBigUint64)(FfiMachine *the, FfiSlot *slot, uint64_t value);
  void (*fromInteger)(FfiMachine *the, FfiSlot *slot, int32_t value);
  void (*fromNumber)(FfiMachine *the, FfiSlot *slot, double value);
  void (*fromUnsigned)(FfiMachine *the, FfiSlot *slot, uint32_t value);

  int64_t (*toBigInt64)(FfiMachine *the, FfiSlot *slot);
  uint64_t (*toBigUint64)(FfiMachine *the, FfiSlot *slot);
  int32_t (*toInteger)(FfiMachine *the, FfiSlot *slot);
  double (*toNumber)(FfiMachine *the, FfiSlot *slot);
  uint32_t (*toUnsigned)(FfiMachine *the, FfiSlot *slot);

  void (*fromString)(FfiMachine *the, FfiSlot *slot, char *value);
  void (*fromStringX)(FfiMachine *the, FfiSlot *slot, char *value);
  char **(*toStringHandle)(FfiMachine *the, FfiSlot *slot);

  void *(*fromArrayBuffer)(FfiMachine *the, FfiSlot *slot, void *data,
                           int32_t byteLength, int32_t maxByteLength);
  void **(*toArrayBufferHandle)(FfiMachine *the, FfiSlot *slot, size_t size);
} FfiApi;

// Define `this.ids` = ArrayBuffer(s_resource_ids) on the new FFI instance.
// Protocol mirrors the xsDefine macro: push target, push value, defineID
// (which consumes both). The value slot is created in place ON the XS
// stack so the allocation is GC-rooted from the moment it exists.
static void prv_build_ffi(FfiMachine *the, FfiApi *api) {
  // If this line never shows in the app log, the firmware predates the
  // fxBuildFFI hook and the JS falls back to viewbox fingerprints.
  APP_LOG(APP_LOG_LEVEL_INFO, "[FFI] hook running");
  FfiSlot *self = api->this_(the);
  api->push(the, self);                       // target object
  api->push(the, self);                       // placeholder -> value
  api->fromArrayBuffer(the, the->stack, (void *)s_resource_ids,
                       sizeof(s_resource_ids), 0);
  api->defineID(the, api->id(the, "ids"), 0, 0);
}

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);
  MdblCreationRecord cr = {
    .recordSize = sizeof(MdblCreationRecord),
    .stack = 6144,
    .slot  = 36864,
    .chunk = 14336,
    .flags = 0,
    .fxBuildFFI = (void *)prv_build_ffi,
  };
  moddable_createMachine((ModdableCreationRecord *)&cr);
  window_destroy(w);
}
