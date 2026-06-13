// ============================================================
//  Yoshi Flower Watch Face — Pebble Round 2 (Gabbro)
// ============================================================

import Poco from "commodetto/Poco";
import parseBMF from "commodetto/parseBMF";
import parseRLE from "commodetto/parseRLE";
import Timer from "timer";
import Location from "embedded:sensor/Location";
import Accelerometer from "embedded:sensor/Accelerometer";
import Battery from "embedded:sensor/Battery";
import Message from "pebble/message";
import Instrumentation from "instrumentation";

// ── Memory telemetry (keep until the petal fall is verified) ──
// One-line snapshot, cheap enough to run during animation ticks.
let iFree = 0, iSlot = 0, iChunk = 0, iGC = 0;
try {
    iFree  = Instrumentation.map("System Free Memory");
    iSlot  = Instrumentation.map("XS Slot Heap Used");
    iChunk = Instrumentation.map("XS Chunk Heap Used");
    iGC    = Instrumentation.map("XS Garbage Collection Count");
} catch(e) {}
function memLine(tag) {
    if (!iFree) return;
    try {
        trace("[T ", tag, "] free=", Instrumentation.get(iFree),
              " slot=", Instrumentation.get(iSlot),
              " chunk=", Instrumentation.get(iChunk),
              " gc=", Instrumentation.get(iGC), "\n");
    } catch(e) {}
}

const render = new Poco(screen);

// ── Font ──────────────────────────────────────────────────────
function getFont(name, size) {
    const f = parseBMF(new Resource(`${name}-${size}.fnt`));
    f.bitmap = parseRLE(new Resource(`${name}-${size}-alpha.bm4`));
    return f;
}
const font = getFont("MarkerFelt10", 20);

// ── Colors & appearance settings ──────────────────────────────
const C_BLACK = render.makeColor(  0,   0,   0);
const C_WHITE = render.makeColor(255, 255, 255);

// Clay sends colors as a 24-bit RGB integer (the GColorFromHEX form).
function colorFromInt(v) {
    v = Number(v) & 0xFFFFFF;
    return render.makeColor((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF);
}

// User-configurable appearance, set from the phone config page (Clay) and
// persisted in localStorage "settings" so it survives the relaunch that
// happens every time the user leaves the face. Defaults match the original
// look: mint background, darker-green dots, everything shown, °F.
let bgInt = 0x55FFAA, dotInt = 0x00AA55;
let showDots = true, showDate = true, showWeather = true;
let useFahrenheit = true;
try {
    const s = JSON.parse(localStorage.getItem("settings"));
    if (s) {
        if (typeof s.bg  === "number") bgInt  = s.bg;
        if (typeof s.dot === "number") dotInt = s.dot;
        if (typeof s.showDots      === "boolean") showDots      = s.showDots;
        if (typeof s.showDate      === "boolean") showDate      = s.showDate;
        if (typeof s.showWeather   === "boolean") showWeather   = s.showWeather;
        if (typeof s.useFahrenheit === "boolean") useFahrenheit = s.useFahrenheit;
    }
} catch(e) {}
let C_BG  = colorFromInt(bgInt);
let C_DOT = colorFromInt(dotInt);

// ── Geometry ──────────────────────────────────────────────────
const W  = render.width;
const H  = render.height;
const CX = W >> 1;
const CY = H >> 1;
const PETAL_MID_R = Math.round(W * 0.31);
const BEE_R       = Math.round(W * 0.44);
const TWO_PI      = Math.PI * 2;
const DOT_GRID    = 27;
const DOT_R_SQ    = 126 * 126;

function petalAnchor(clockDeg) {
    const rad = (clockDeg - 90) * Math.PI / 180;
    return {
        x: Math.round(CX + PETAL_MID_R * Math.cos(rad)),
        y: Math.round(CY + PETAL_MID_R * Math.sin(rad))
    };
}

// ── Resources ─────────────────────────────────────────────────
// Resource ids are assigned by the build's resource-ball order, which is
// NOT deterministic across builds — observed: exact media order, rotations
// of it, near-alphabetical. No order- or art-based probe survived five
// builds. The build itself is the only authority: mdbl.c snapshots the
// generated RESOURCE_ID_* defines and hands them over through the FFI
// hook, so the ids here are compile-time-correct for THIS build, always.
// The host constructs `new FFI()` itself (running mdbl.c's hook, which
// defines .ids on that instance) and injects it into the mod's globals as
// `Natives` — the "ffi" module is NOT importable from a mod.
// Table layout (must match s_resource_ids in src/c/mdbl.c):
const R_PETAL = 0;     // petal_1..3 (idle frames)
const R_FALL  = 3;     // petal_fall_1..3 (PM shed transition)
const R_GROW  = 6;     // petal_grow_1..3 (AM bloom transition)
const R_FACE  = 9;     // 6 sets x 2 frames, set-major: 12_11 .. 2_1
const R_BEE   = 21;
const R_WX    = 22;    // cloudy, pcloudy, clear, rain, snow, storm
const R_LEN   = 28;    // table entries; media count is R_LEN + 1 (icon.png)
const FACE_FRAMES = 2; // frames per face set
const N_SETS  = 6;
const WX_OFFSET = {    // weather desc -> offset from R_WX
    "Cloudy":    0,
    "P. Cloudy": 1,
    "Clear":     2,
    "Rain":      3,
    "Snow":      4,
    "Storm":     5,
};

function loadDCI(id) {
    try { return new Poco.PebbleDrawCommandImage(id); }
    catch(e) { return null; }
}

let RES = null;
try { RES = new Uint8Array(Natives.ids); } catch(e) {}
if (!RES || RES.length < R_LEN) {
    // FFI table unavailable (firmware may predate the fxBuildFFI hook).
    // Identify resources by viewbox FINGERPRINT instead: every PDC in the
    // repo carries a unique (width, height), stamped by tools/tag_pdcs.py
    // (re-run it whenever art is added/replaced; keep its table in sync
    // with FP below). The mapping is fixed per build, so cache it and
    // verify anchors each launch; a new build fails the check and rescans.
    // Key is "resmap2": v1 maps were validated by petal_1+bee alone, which
    // let stale FACE ids through (wrong face art on screen) — the bump
    // discards every v1 cache in the wild.
    try {
        const c = JSON.parse(localStorage.getItem("resmap2"));
        if (c && c.length >= R_LEN) RES = c;
    } catch(e) {}
    if (RES) {
        // One anchor per art block — petal, fall, grow, the face block's
        // two ENDS, and the bee. Rebuilds reorder ids in blocks/rotations,
        // so endpoint drift catches shifts a 2-anchor check would miss.
        const chk = [
            [R_PETAL,      60, 130],   // petal_1
            [R_FALL,       63, 130],   // petal_fall_1
            [R_GROW,       50, 130],   // petal_grow_1
            [R_FACE,      104, 106],   // face_12_11_1 (face block start)
            [R_FACE + 11, 109, 107],   // face_2_1_2   (face block end)
            [R_BEE,        50,  50],   // bee
        ];
        for (let i = 0; RES && i < chk.length; i++) {
            const d = loadDCI(RES[chk[i][0]]);
            if (!d || d.width !== chk[i][1] || d.height !== chk[i][2])
                RES = null;                   // stale build — rescan
        }
    }
    if (!RES) {
        trace("[RES] fingerprint scan\n");
        const FP = {};                        // (w<<8)|h -> table index
        for (let i = 0; i < 3; i++) FP[((60 + i) << 8) | 130] = R_PETAL + i;
        for (let i = 0; i < 3; i++) FP[((63 + i) << 8) | 130] = R_FALL + i;
        for (let i = 0; i < 3; i++) FP[((50 + i) << 8) | 130] = R_GROW + i;
        for (let s = 0; s < 6; s++)
            for (let f = 0; f < 2; f++)
                FP[((104 + s) << 8) | (106 + f)] = R_FACE + s * 2 + f;
        FP[(50 << 8) | 50] = R_BEE;
        FP[(40 << 8) | 30] = R_WX;            // cloudy
        FP[(45 << 8) | 40] = R_WX + 1;        // pcloudy
        FP[(40 << 8) | 40] = R_WX + 2;        // clear
        FP[(40 << 8) | 41] = R_WX + 3;        // rain
        FP[(41 << 8) | 40] = R_WX + 4;        // snow
        FP[(42 << 8) | 40] = R_WX + 5;        // storm
        RES = new Array(R_LEN).fill(1);
        for (let id = 1; id <= R_LEN + 1; id++) {  // last id = icon.png,
            const dci = loadDCI(id);               // fails; never scan past
            if (!dci) continue;                    // the table (hard-faults)
            const idx = FP[(dci.width << 8) | dci.height];
            if (idx !== undefined) RES[idx] = id;
        }
        try { localStorage.setItem("resmap2", JSON.stringify(RES)); } catch(e) {}
    }
    // The scan/anchor decodes sit on the app heap, WeakRef-pinned until
    // this job ends — free them from a fresh job via chunk pressure
    // (small asks only: an over-pool chunk ask aborts).
    Timer.set(() => {
        try { for (let i = 0; i < 6; i++) new ArrayBuffer(2048); } catch(e) {}
    });
}

// Resident images: the 3 petal idle frames, the bee, and the current face
// set (2 frames, reloaded as the petal count crosses sets). Fall/grow
// frames are loaded one at a time only while a transition plays — keeping
// a whole sequence resident alongside a repaint's clones has blown the
// heap before.
const petalFrames = [];
for (let i = 0; i < 3; i++) {
    const f = loadDCI(RES[R_PETAL + i]);
    if (f) petalFrames.push(f);
}
if (!petalFrames.length || petalFrames[0].height < 100 || petalFrames[0].width < 55)
    trace("[RES] id table looks wrong (petal_1 isn't ~60x130)\n");
const beeDCI = loadDCI(RES[R_BEE]);
const P_PX   = petalFrames.map(f => f.width >> 1);
const P_PY   = petalFrames.map(f => f.height);
const BEE_PX = beeDCI ? beeDCI.width  >> 1 : 0;
const BEE_PY = beeDCI ? beeDCI.height >> 1 : 0;

// Face sets are named for the PETALS REMAINING they cover: face_12_11 shows
// while 12 or 11 petals are up ... face_2_1 while 2 or 1 are. Media order
// runs face_12_11 (set index 0) down to face_2_1 (5), so the count maps in
// reverse. There is no bare-flower set, so the midnight hour (0 petals)
// keeps face_2_1 (the clamp below).
let faceSet = [], faceSetIdx = -1;
function loadFaceSet(count) {
    let si = (12 - count) >> 1;
    if (si >= N_SETS) si = N_SETS - 1;
    if (si === faceSetIdx) return;
    faceSetIdx = si;
    faceSet = [];                        // release the old set before loading
    for (let f = 0; f < FACE_FRAMES; f++) {
        const img = loadDCI(RES[R_FACE + si * FACE_FRAMES + f]);
        if (!img) continue;
        // Self-check: face art is stamped (104+set)x(106+frame). A mismatch
        // means the cached id map is stale in a way the boot anchors missed
        // (only middle face slots moved) — drop the cache so the next launch
        // rescans. Keep drawing the wrong-but-loadable art meanwhile; a
        // blank face would be worse.
        if (img.width !== 104 + si || img.height !== 106 + f) {
            trace("[RES] face set ", si, " frame ", f, " has wrong art — resmap stale, will rescan\n");
            try { localStorage.setItem("resmap2", "[]"); } catch(e) {}
        }
        faceSet.push(img);
    }
}

// ── Lookup tables ─────────────────────────────────────────────
const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ── State ─────────────────────────────────────────────────────
let weather      = null;
let lastDate     = new Date();
let currentH24   = lastDate.getHours();   // 0..23 — the real bloom-cycle hour
let shownH24     = currentH24;            // the hour the FLOWER displays —
                                          // catches up when the user checks

// Demo / test hook. 0 = OFF (real-time hour sync — the shipping behavior).
// When > 0, every check (flick / menu-and-back / launch) pretends this many
// hours passed, so you can watch the catch-up cascade without waiting real
// hours: e.g. set to 4 to fire a 4-petal staggered fall/grow on each check.
// Real-time sync is paused while it's non-zero. KEEP AT 0 FOR RELEASE.
const DEMO_HOURS_PER_CHECK = 0;

// The watchface is killed and relaunched whenever the user visits another
// app, so the flower's state must survive restarts: without this every
// launch resets shownH24 to "now" and the same single transition replays
// (and in production a reboot would swallow missed transitions). In demo
// mode the simulated hour persists too, so each menu round-trip continues
// the cycle one hour further instead of repeating itself.
try {
    const s = JSON.parse(localStorage.getItem("flowerState"));
    if (s) {
        if (typeof s.shown === "number") shownH24 = s.shown % 24;
        if (DEMO_HOURS_PER_CHECK && typeof s.demoH === "number")
            currentH24 = s.demoH % 24;
    }
} catch(e) {}

function saveFlowerState() {
    try {
        localStorage.setItem("flowerState",
            JSON.stringify({ shown: shownH24, demoH: currentH24 }));
    } catch(e) {}
}

// ── Animation ─────────────────────────────────────────────────
// To save battery, the face only animates for a short window after a wrist
// flick / tap (accelerometer tap event — the Pebble battery-conservation
// pattern). Idle = static frame 0, repainted on the minute.
const TICK_MS    = 250;    // animation timebase
const ANIM_TICKS = 32;     // ~8s window per flick/tap
const FACE_TICKS = 4;      // face frame advances ~1x/sec
let tickCount = 0, animLeft = 0, animTimer = null;
let accel = null;          // keep the instance alive — GC would unsubscribe tap
let beeClone = null, beeCloneMin = -1;   // bee rotated once per minute

// Each petal is offset by its position, so the resting flower is already
// varied (frames 0,1,2,0,… around the wheel) and during the animation
// window the frame advance (~1x/sec, offset 2 ticks from the face flip)
// travels around the flower as a wave instead of a synchronized blink.
// Three distinct frames on screen = three clone chains per repaint
// (~5KB/tick of app heap the GC can't see) — affordable only because
// animTick presses the GC hard enough to collect every ~3 ticks.
function petalFrameIdx(pos) {
    const n = petalFrames.length;
    if (n < 2) return 0;
    const base = animLeft ? ((tickCount + 2) >> 2) : 0;
    return (base + pos) % n;
}

function animTick() {
    tickCount++;
    if (--animLeft <= 0) {     // window over: stop the timer; this last
        Timer.clear(animTimer); // draw paints the resting (frame 0) state
        animTimer = null;
        animLeft = 0;
    }
    // A running cascade repaints faster (and owns the overlay state), so let
    // it do the drawing while it plays — this just keeps tickCount advancing
    // so the face/petal frames it paints stay animated.
    if (!casTimer) drawScreen();
    // XS garbage-collects on CHUNK pressure only and cannot see the app
    // heap behind each clone — and organic chunk garbage is just
    // ~300B/tick, so the pool alone would let native garbage pile up for
    // many ticks. With three petal chains (~5KB/tick) the GC must run
    // every ~3 ticks: press it with 2KB per tick. Sized so a single ask
    // always fits the 14KB pool even at the fetch's ~11KB live peak —
    // an over-pool chunk allocation aborts rather than throws.
    try { new ArrayBuffer(2048); } catch(e) {}
    if (!(tickCount & 3)) memLine(tickCount);
}

function startAnim() {
    if (charging) return;      // charging runs its own loop; ignore taps/focus
    animLeft = ANIM_TICKS;
    if (!animTimer) animTimer = Timer.repeat(animTick, TICK_MS);
    if (DEMO_HOURS_PER_CHECK) {
        currentH24 = (currentH24 + DEMO_HOURS_PER_CHECK) % 24;
        saveFlowerState();
    }
    trace("[CHK] check: now=", currentH24, " shown=", shownH24, "\n");
    catchUp();    // the user is looking — play any missed petal transitions
}

// ── Charging mode ─────────────────────────────────────────────
// On the charger the watch can't be worn, so instead of the time the face
// becomes a charging PROGRESS BAR. Petals grow in clockwise from the top up to
// the petal that matches the current charge: 0% is just the top petal, 50%
// reaches the 6 o'clock petal, a full lap is 100% (whole flower). The leading
// petal keeps pulsing through the grow frames to show it's actively charging;
// nothing falls (a fill bar, not a spinner). Plugged in, so animating is free.
const CHARGE_FRAME_MS = 167;   // ~0.5s per petal (CHARGE_SPF grow frames each)
const CHARGE_SPF      = 3;     // animation frames per petal
const SPIN_FRAMES     = 12;    // a one-lap spin-up flourish before the bar fills (~2s)
const SPIN_ARC        = 3;     // petals in the spinning comet
let charging    = false;
let chargeTimer = null;
let chargePct   = 0;           // 0..100, from the battery sensor
let cf = 0;                    // charge frame counter
let battery     = null;        // keep the instance alive — GC would unsubscribe

// Charge % -> how many petals are filled (the last one is the leading petal,
// still growing/pulsing). 0% = top petal only, 50% = the 6 o'clock petal,
// 100% = all 12. Mapped over 11 steps so a full lap lands on the last petal.
function chargeLevel(pct) {
    const n = Math.round((pct / 100) * 11) + 1;
    return n < 1 ? 1 : (n > 12 ? 12 : n);
}

function chargeTick() {
    cf++;
    drawScreen();
    try { new ArrayBuffer(2048); } catch(e) {}    // same GC nudge as the anim loop
    if (!(cf & 15)) memLine(cf);                   // monitor a long charge
}

function setCharging(on) {
    on = !!on;
    if (on === charging) return;                  // battery % ticks fire this too
    charging = on;
    if (on) {
        cf = 0;
        if (animTimer) { Timer.clear(animTimer); animTimer = null; animLeft = 0; }
        if (casTimer) endCascade();               // abandon any catch-up cascade
        loadFaceSet(12);                          // cheerful full-flower face
        chargeTimer = Timer.repeat(chargeTick, CHARGE_FRAME_MS);
        trace("[BAT] charging — loader on\n");
        drawScreen();
    } else {
        if (chargeTimer) { Timer.clear(chargeTimer); chargeTimer = null; }
        loadFaceSet(petalCount());                // back to the real face
        trace("[BAT] unplugged — loader off\n");
        drawScreen();
        startAnim();                              // unplugged — user is likely looking
    }
}

// ── Petal transitions — a staggered cascade played on CHECK ────
// Petals don't change at the top of the hour. The flower holds the state
// from the user's last check (shownH24); when they next look (flick / focus
// / launch — or mid-animation when the hour flips), every petal missed since
// then animates. PM/midnight hours shed a petal with the fall frames, AM/noon
// hours bloom one with the grow frames.
//
// The petals are STAGGERED: the one furthest from now (the oldest missed
// hour) starts first, and each later one begins STAGGER_MS after it — so with
// several to play, the first goes immediately and they cascade rather than
// waiting in line. Each step commits its petal to the static flower the
// instant it starts (a fall's petal vanishes / a grow's appears on cue) and
// owns one resident overlay frame while it plays. Steps older than CATCHUP_MAX
// snap instantly (nobody wants to watch 23 of these after a day away).
const STAGGER_MS  = 500;   // delay between consecutive petals starting
const FRAME_MS    = 400;   // per overlay frame; 3 frames => 1200ms per petal
const STEP_FRAMES = 3;
const CAS_TICK    = 200;   // cascade driver cadence
const CATCHUP_MAX = 6;     // animate at most this many missed hours

let plan = [];             // ordered steps, oldest/furthest-from-now first
let casT0 = 0, casTimer = null;
const hideSet = [];        // positions whose static petal is suppressed while
                           // their grow overlay is drawing them in

function makeStep(h) {
    let base = R_GROW, pos = h + 1, grow = true;                  // AM bloom
    if (h === 0)       { base = R_FALL; pos = 12; grow = false; } // midnight: last petal
    else if (h > 12)   { base = R_FALL; pos = h - 12; grow = false; } // PM shed
    else if (h === 12) { pos = 1; }                               // noon: top petal
    return { base, pos, grow, target: h, started: false, frame: -1, dci: null, done: false };
}

function endCascade() {
    Timer.clear(casTimer);
    casTimer = null;
    plan = [];
    hideSet.length = 0;
    drawScreen();
}

function casTick() {
    const elapsed = Date.now() - casT0;
    for (let i = 0; i < plan.length; i++) {
        const s = plan[i];
        if (s.done) continue;
        const local = elapsed - i * STAGGER_MS;   // this petal's own clock
        if (local < 0) continue;                  // its turn hasn't come yet
        if (!s.started) {                         // commit it to the flower
            s.started = true;
            shownH24 = s.target;
            saveFlowerState();
            loadFaceSet(petalCount());            // face follows the flower
            if (s.grow) hideSet.push(s.pos);      // the overlay draws it now
            trace("[CHK] ", s.grow ? "grow" : "fall", " pos=", s.pos, " shown=", s.target, "\n");
        }
        const fr = (local / FRAME_MS) | 0;
        if (fr >= STEP_FRAMES) {                  // this petal finished
            s.done = true;
            s.dci  = null;
            if (s.grow) {
                const k = hideSet.indexOf(s.pos);
                if (k >= 0) hideSet.splice(k, 1);
            }
            continue;
        }
        if (s.frame !== fr) {                     // advance its overlay frame
            s.frame = fr;
            s.dci   = loadDCI(RES[s.base + fr]);
        }
    }
    drawScreen();
    // The overlay clones are app-heap garbage the GC can't see; nudge it
    // (small ask — an over-pool chunk allocation aborts uncatchably).
    try { new ArrayBuffer(2048); } catch(e) {}
    let allDone = true;
    for (let i = 0; i < plan.length; i++) if (!plan[i].done) { allDone = false; break; }
    if (allDone) endCascade();
}

function catchUp() {
    if (casTimer) return;                         // a cascade is already playing
    let gap = (currentH24 - shownH24 + 24) % 24;
    if (!gap) return;
    if (gap > CATCHUP_MAX) {                       // too old to narrate — snap
        shownH24 = (currentH24 - CATCHUP_MAX + 24) % 24;
        loadFaceSet(petalCount());
        gap = CATCHUP_MAX;
    }
    plan = [];
    let h = shownH24;
    for (let k = 0; k < gap; k++) { h = (h + 1) % 24; plan.push(makeStep(h)); }
    casT0 = Date.now();
    casTimer = Timer.repeat(casTick, CAS_TICK);
    casTick();                                    // start step 0 immediately
}

// ── Settings from the phone (Clay config page) ────────────────
// The config page (src/pkjs/config.js) sends these on save. The key ORDER
// must match package.json "messageKeys": the Message class maps keys[i] to
// app-message code 10000+i, which is exactly how Pebble numbers messageKeys.
// (The pebbleproxy uses codes 15000+, so the two channels never collide —
// incoming messages are routed to the matching Message instance by key.)
const SETTINGS_KEYS = [
    "BackgroundColor",   // 10000  color
    "ShowDots",          // 10001  toggle
    "DotColor",          // 10002  color
    "ShowDate",          // 10003  toggle
    "ShowWeather",       // 10004  toggle
    "TemperatureUnit",   // 10005  toggle (on = Fahrenheit)
];

function persistSettings() {
    try {
        localStorage.setItem("settings", JSON.stringify({
            bg: bgInt, dot: dotInt,
            showDots, showDate, showWeather, useFahrenheit
        }));
    } catch(e) {}
}

// Apply a received settings map. Colors arrive as 24-bit RGB ints; toggles as
// 0/1 (Clay converts booleans). Only fields present in the map are touched.
function applySettings(map) {
    if (map.has("BackgroundColor")) { bgInt  = Number(map.get("BackgroundColor")) & 0xFFFFFF; C_BG  = colorFromInt(bgInt); }
    if (map.has("DotColor"))        { dotInt = Number(map.get("DotColor"))        & 0xFFFFFF; C_DOT = colorFromInt(dotInt); }
    if (map.has("ShowDots"))        showDots    = !!map.get("ShowDots");
    if (map.has("ShowDate"))        showDate    = !!map.get("ShowDate");
    if (map.has("ShowWeather"))     showWeather = !!map.get("ShowWeather");
    if (map.has("TemperatureUnit")) {
        const next = !!map.get("TemperatureUnit");
        if (next !== useFahrenheit) {            // unit changed — refetch so the
            useFahrenheit = next;                // displayed temp updates now,
            requestLocation();                   // not at the next hourly fetch
        }
    }
    persistSettings();
    drawScreen();
}

// ── app_message channel ───────────────────────────────────────
// The FIRST Message created fixes the app_message buffer sizes for the app's
// life; the default is maximum (8200 in + 8200 out = 16.4KB of heap). Location
// passes no sizes, so open the channel small BEFORE anything else does. Safe:
// the phone proxy fragments HTTP responses to fit the inbox, and our weather
// JSON / Clay settings are a few hundred bytes. This same channel carries the
// settings (its keys route Clay's message here); kept alive for the app's life.
let msgChannel = null;
function openMessageChannel() {
    try {
        msgChannel = new Message({
            input: 2048, output: 1024,
            keys: SETTINGS_KEYS,
            onReadable() {
                try { applySettings(this.read()); trace("[CFG] settings applied\n"); }
                catch(e) { trace("[CFG] apply failed ", String(e), "\n"); }
            }
        });
    } catch(e) {}
}

// ── Petal visibility ──────────────────────────────────────────
// A 24-hour bloom cycle keyed off the hour the flower DISPLAYS (shownH24,
// 0..23 — lags currentH24 until the user checks the watch). pos 1 is the
// top (12 o'clock) petal; pos k (k=2..12) is the (k-1) o'clock petal.
//   Midnight:  bare — no petals.
//   AM (gain): one petal blooms each hour — the 1 o'clock petal at 1:00, the
//              2 o'clock at 2:00 … the 11 o'clock at 11:00.
//   Noon:      the 12 o'clock petal blooms too — full flower, all 12 showing.
//   PM (shed): one petal falls each hour — the 12 o'clock petal at 1:00, the
//              1 o'clock at 2:00 … the 11 o'clock at midnight, looping to bare.
function petalVisible(pos) {
    const h = shownH24;                            // 0..23
    if (h === 12) return true;                     // noon — full bloom
    if (h < 12)   return pos >= 2 && pos <= h + 1; // AM: o'clock petals 1..h have bloomed
    return pos >= h - 11;                          // PM: o'clock petals (h-12)..11 remain
}

// Petals on screen — drives which face set shows.
function petalCount() {
    const h = shownH24;
    return h === 12 ? 12 : (h < 12 ? h : 24 - h);
}

// ── Weather ───────────────────────────────────────────────────
function weatherDesc(code) {
    if (code === 0)  return "Clear";
    if (code <= 2)   return "P. Cloudy";
    if (code <= 48)  return "Cloudy";
    if (code <= 77)  return "Rain";
    if (code <= 82)  return "Snow";
    if (code <= 86)  return "Rain";
    return "Storm";
}

function loadCachedWeather() {
    try {
        const c = localStorage.getItem("weather");
        const t = localStorage.getItem("weatherTime");
        if (c && t && (Date.now() - Number(t) < 3600000))
            weather = JSON.parse(c);
    } catch(e) {}
}

// Only one Location sensor instance may exist at a time ("single instance
// only"). Skip if a sample is already in flight rather than close+reopen —
// rapid open/close over the app_message channel aborts ("output_begin failed").
let locating = false;
function requestLocation() {
    if (locating) return;
    locating = true;
    trace("[WX] locating\n");
    try {
        new Location({
            onSample() {
                locating = false;
                try {
                    const s = this.sample();
                    this.close();
                    trace("[WX] got location\n");
                    fetchWeather(s.latitude, s.longitude);
                } catch(e) {}
            }
        });
    } catch(e) { locating = false; }
}

async function fetchWeather(lat, lon) {
    try {
        trace("[WX] fetching\n");
        memLine("fetch");
        const u = useFahrenheit ? "&temperature_unit=fahrenheit" : "";
        const url = "http://api.open-meteo.com/v1/forecast"
            + "?latitude=" + lat + "&longitude=" + lon
            + "&current=temperature_2m,weather_code" + u;
        // Read as text + JSON.parse: this runtime's Response.json() throws
        // "invalid value" on valid JSON, but .text() returns the body fine.
        const text = await (await fetch(url)).text();
        const data = JSON.parse(text);
        weather = {
            temp: Math.round(data.current.temperature_2m),
            desc: weatherDesc(data.current.weather_code)
        };
        try {
            localStorage.setItem("weather", JSON.stringify(weather));
            localStorage.setItem("weatherTime", String(Date.now()));
        } catch(e) {}
        trace("[WX] applied\n");
        memLine("applied");
        // While an animation/cascade runs, the next tick repaints shortly —
        // skip the extra draw at this (heaviest) moment.
        if (!animTimer && !casTimer) drawScreen();
    } catch(e) { trace("[WX] failed ", String(e), "\n"); }
}

// ── strokeText ────────────────────────────────────────────────
function strokeText(str, x, y) {
    render.drawText(str, font, C_WHITE, x-2, y-2);
    render.drawText(str, font, C_WHITE, x,   y-2);
    render.drawText(str, font, C_WHITE, x+2, y-2);
    render.drawText(str, font, C_WHITE, x-2, y  );
    render.drawText(str, font, C_WHITE, x+2, y  );
    render.drawText(str, font, C_WHITE, x-2, y+2);
    render.drawText(str, font, C_WHITE, x,   y+2);
    render.drawText(str, font, C_WHITE, x+2, y+2);
    render.drawText(str, font, C_BLACK, x,   y  );
}

// ── Degree sign ───────────────────────────────────────────────
// MarkerFelt has no ° glyph, so draw a small ring with fillRectangle (cheap,
// no font/extra-memory cost): white backing for contrast, a black ring, a
// white centre, and white-ed corners to round it. (x,y) = top-left, ~7x7.
function drawDegree(x, y) {
    render.fillRectangle(C_WHITE, x,     y,     9, 9);   // halo / backing
    render.fillRectangle(C_BLACK, x + 1, y + 1, 7, 7);   // ring (outer) — 2px thick
    render.fillRectangle(C_WHITE, x + 3, y + 3, 3, 3);   // hole
    render.fillRectangle(C_WHITE, x + 1, y + 1, 1, 1);   // round the 4 corners
    render.fillRectangle(C_WHITE, x + 7, y + 1, 1, 1);
    render.fillRectangle(C_WHITE, x + 1, y + 7, 1, 1);
    render.fillRectangle(C_WHITE, x + 7, y + 7, 1, 1);
}

// ── Main draw ─────────────────────────────────────────────────
function drawScreen(event) {
    const now = (event && event.date) ? event.date : lastDate;
    if (event && event.date) lastDate = event.date;
  try {
    // Layer 1: background + dots, one horizontal band per dot row so the
    // display list stays small (~90 rects per band vs ~700 for the whole
    // field in one begin/end — that's what forced displayListLength=16384).
    // Bands meet halfway between rows and tile the screen exactly; a dot is
    // 9px tall on a 27px grid, so no dot ever straddles a band.
    for (let ddy = -126; ddy <= 126; ddy += DOT_GRID) {
        const yTop = (ddy === -126) ? 0 : CY + ddy - (DOT_GRID >> 1);
        const yBot = (ddy + DOT_GRID > 126) ? H : CY + ddy + DOT_GRID - (DOT_GRID >> 1);
        render.begin(0, yTop, W, yBot - yTop);
        render.fillRectangle(C_BG, 0, 0, W, H);
        if (showDots) {
            const row = Math.round((ddy + 126) / DOT_GRID);
            const ox  = (row % 2 === 0) ? 0 : DOT_GRID >> 1;
            for (let ddx = -126; ddx <= 126; ddx += DOT_GRID) {
                const ax = ddx + ox;
                if (ax * ax + ddy * ddy < DOT_R_SQ - 150) {
                    const px = CX + ax, py = CY + ddy;
                    render.fillRectangle(C_DOT, px-2, py-4, 4, 1);
                    render.fillRectangle(C_DOT, px-3, py-3, 6, 1);
                    render.fillRectangle(C_DOT, px-4, py-2, 8, 1);
                    render.fillRectangle(C_DOT, px-4, py-1, 8, 1);
                    render.fillRectangle(C_DOT, px-4, py,   8, 1);
                    render.fillRectangle(C_DOT, px-4, py+1, 8, 1);
                    render.fillRectangle(C_DOT, px-4, py+2, 8, 1);
                    render.fillRectangle(C_DOT, px-3, py+3, 6, 1);
                    render.fillRectangle(C_DOT, px-2, py+4, 4, 1);
                }
            }
        }
        render.end();
    }

    // Charging: a petal progress bar over the same background. Petals fill
    // clockwise from the top up to the charge level; the leading petal pulses.
    // Nothing falls. No time / date / weather / bee here.
    if (charging) {
        if (petalFrames.length) {
            const STEP = 30 * Math.PI / 180;
            const f0 = petalFrames[0];
            const fpx = f0.width >> 1, fpy = f0.height;
          if (cf < SPIN_FRAMES) {
            // Spin-up flourish: a short comet of petals sweeps clockwise once
            // around the whole circle before the bar settles to the charge level.
            const head = cf % 12;                       // leading position (0-based)
            let clone = null, ang = 0;
            for (let d = 0; d < SPIN_ARC; d++) {
                const pos = ((head - d) % 12 + 12) % 12 + 1;
                const ar  = -(pos - 1) * STEP;
                if (!clone) clone = f0.clone().rotate(ar, fpx, fpy);
                else        clone.rotate(ar - ang, fpx, fpy);
                ang = ar;
                render.begin(); render.drawDCI(clone, CX - fpx, CY - fpy); render.end();
            }
          } else {
            const bcf  = cf - SPIN_FRAMES;             // frames since the bar began
            const lvl  = chargeLevel(chargePct);
            const full = chargePct >= 100;
            // The fill frontier sweeps from the top out to `lvl`, one petal per
            // ~0.5s, then holds there. Petals behind it are fully grown.
            const step = (bcf / CHARGE_SPF) | 0;
            const ff       = full ? 12 : Math.min(1 + step, lvl);  // leading petal
            const solidMax = full ? 12 : ff - 1;                   // last grown petal
            let clone = null, ang = 0;
            for (let pos = 1; pos <= solidMax; pos++) {
                const ar = -(pos - 1) * STEP;
                if (!clone) clone = f0.clone().rotate(ar, fpx, fpy);
                else        clone.rotate(ar - ang, fpx, fpy);
                ang = ar;
                render.begin(); render.drawDCI(clone, CX - fpx, CY - fpy); render.end();
            }
            // Leading petal: growing in while the frontier advances, then pulsing
            // (0-1-2-1…) in place to show it's still charging. Skipped when full.
            if (!full) {
                const reached = (1 + step) >= lvl;
                let gfr;
                if (!reached) gfr = bcf % CHARGE_SPF;         // 0->1->2 growing in
                else { const c = cf & 3; gfr = c < 3 ? c : 1; } // pulse 0,1,2,1
                const gd = loadDCI(RES[R_GROW + gfr]);
                if (gd) {
                    const gx = gd.width >> 1, gy = gd.height;
                    const c = gd.clone().rotate(-(ff - 1) * STEP, gx, gy);
                    render.begin(); render.drawDCI(c, CX - gx, CY - gy); render.end();
                }
            }
          }
        }
        // Center face — the flower's smiley (fixed cheerful set).
        const cface = faceSet.length ? faceSet[0] : null;
        if (cface) {
            render.begin();
            render.drawDCI(cface, CX - (cface.width >> 1), CY - (cface.height >> 1));
            render.end();
        }
        return;
    }

    // Layer 2: petals. Each petal's frame is offset by its position, so
    // up to three distinct frames are on screen at once. One clone per
    // frame IMAGE in use — petals sharing a frame reuse its chain,
    // rotated incrementally to each position.
    if (petalFrames.length) {
        const STEP   = 30 * Math.PI / 180;
        const clones = [null, null, null], angles = [0, 0, 0];
        for (let pos = 12; pos >= 1; pos--) {
            if (!petalVisible(pos) || hideSet.indexOf(pos) >= 0) continue;
            const fi = petalFrameIdx(pos);
            const ar = -(pos - 1) * STEP;
            let pd = clones[fi];
            if (!pd) pd = clones[fi] = petalFrames[fi].clone().rotate(ar, P_PX[fi], P_PY[fi]);
            else     pd.rotate(ar - angles[fi], P_PX[fi], P_PY[fi]);
            angles[fi] = ar;
            render.begin();
            render.drawDCI(pd, CX - P_PX[fi], CY - P_PY[fi]);
            render.end();
        }
        // Petals mid-transition (falling or growing). Several cascade steps
        // can be showing a frame at once; each draws its own overlay, rotated
        // to its position. Frames may differ in size from the petals, so each
        // centers on its own bottom-center anchor.
        for (let i = 0; i < plan.length; i++) {
            const s = plan[i];
            if (!s.dci) continue;
            const px = s.dci.width >> 1, py = s.dci.height;
            const fd = s.dci.clone().rotate(-(s.pos - 1) * STEP, px, py);
            render.begin();
            render.drawDCI(fd, CX - px, CY - py);
            render.end();
        }
    }

    // Layer 3: face + bee + text + weather icon. The bee's angle only
    // changes on the minute, so its rotated clone is cached — re-cloning
    // it every animation tick was pure app-heap churn.
    const minutes  = now.getMinutes();
    const beeAngle = (minutes / 60) * TWO_PI;
    const beeX     = Math.round(CX + BEE_R * Math.sin(beeAngle));
    const beeY     = Math.round(CY - BEE_R * Math.cos(beeAngle));
    if (beeDCI && minutes !== beeCloneMin) {
        beeCloneMin = minutes;
        beeClone = beeDCI.clone().rotate(Math.PI - beeAngle, BEE_PX, BEE_PY);
    }
    const bd = beeClone;

    // Face: current set's frame, advancing ~1x/sec during the animation
    // window (resident — drawn straight from the set, no clone).
    const face = faceSet.length
        ? faceSet[(animLeft && faceSet.length > 1) ? ((tickCount / FACE_TICKS) | 0) % faceSet.length : 0]
        : null;

    render.begin();
    if (face) render.drawDCI(face, CX - (face.width >> 1), CY - (face.height >> 1));
    if (bd) render.drawDCI(bd, beeX - BEE_PX, beeY - BEE_PY);

    let w, a;

    if (showDate) {
        a = petalAnchor(300);
        const dayStr = DAYS[now.getDay()];
        w = render.getTextWidth(dayStr, font);
        strokeText(dayStr, a.x - (w >> 1), a.y - (font.height >> 1));

        a = petalAnchor(270);
        const dateStr = MONTHS[now.getMonth()] + " " + String(now.getDate()).padStart(2, "0");
        w = render.getTextWidth(dateStr, font);
        strokeText(dateStr, a.x - (w >> 1) - 5, a.y - (font.height >> 1));
    }

    if (showWeather) {
        a = petalAnchor(60);
        // Temperature number, then a hand-drawn degree ring just after it (the font
        // has no \u00B0 glyph). Center the number+degree together.
        const numStr = weather ? String(weather.temp) : "--";
        const DEG_GAP = 2, DEG_W = 9;
        w = render.getTextWidth(numStr, font);
        const tx = a.x - ((w + DEG_GAP + DEG_W) >> 1) + 5;
        const ty = a.y - (font.height >> 1);
        strokeText(numStr, tx, ty);
        drawDegree(tx + w + DEG_GAP, ty + 1);   // ty+1 nudges it to the digits' top

        // Weather condition — drawn as an icon based on the weather data,
        // replacing the old text label (e.g. "Cloudy"). Centered on the anchor.
        a = petalAnchor(90);
        if (weather) {
            const wx = WX_OFFSET[weather.desc];
            if (wx !== undefined) {
                const icon = loadDCI(RES[R_WX + wx]);
                if (icon) render.drawDCI(icon,
                    a.x - (icon.width  >> 1),
                    a.y - (icon.height >> 1));
            }
        }
    }

    render.end();
  } catch(e) {
    // Never let a draw error crash/reboot the watch; skip this frame.
    try { render.end(); } catch(_) {}
  }
}

// ── App behavior ──────────────────────────────────────────────
class AppBehavior extends Behavior {
    onDisplaying(application) {
        // Order matters for the heap: subscribe the accelerometer FIRST
        // (its session allocates from the app heap and failed when created
        // after app_message), then open the app_message channel small,
        // before Location/fetch can open it at maximum.
        // Wrist flick / tap → one short animation window. Created once and
        // kept for the app's life (the runtime allows only one instance;
        // close+reopen of sensors has proven fatal — see requestLocation).
        try { accel = new Accelerometer({ onTap: startAnim }); } catch(e) {}
        // Charging state. Subscribe before app_message (like the accelerometer,
        // the battery service allocates from the app heap). onSample fires on
        // every battery change; setCharging only acts when the flag flips.
        try {
            battery = new Battery({
                onSample() {
                    try {
                        const s = this.sample();
                        chargePct = s.percent;        // fill level follows the battery
                        setCharging(s.charging);
                    } catch(e) {}
                }
            });
        } catch(e) {}
        openMessageChannel();

        loadCachedWeather();
        loadFaceSet(petalCount());   // face tracks how many petals remain
        drawScreen();
        requestLocation();

        // Apply the initial charging state — onSample only fires on CHANGE, so
        // sample() once here. If already on the charger, start the loader;
        // otherwise begin the normal look (launching = the user is looking).
        let chgNow = false;
        try {
            const s = battery && battery.sample();
            if (s) { chgNow = !!s.charging; chargePct = s.percent; }
        } catch(e) {}
        if (chgNow) setCharging(true);
        else        startAnim();

        watch.addEventListener("minutechange", clock => {
            const h = clock.date.getHours();
            if (!DEMO_HOURS_PER_CHECK && h !== currentH24) {
                currentH24 = h;
                // The flower doesn't change yet — transitions play at the
                // next check. But if the user is looking RIGHT NOW (the
                // animation window is open), narrate immediately.
                if (animLeft) catchUp();
            }
            drawScreen(clock);
        });

        watch.addEventListener("hourchange", requestLocation);

        // Regaining the screen (back from the menu, notification dismissed)
        // also means the user is looking — and it's the one trigger that
        // works in the emulator, where nothing generates accel tap events.
        watch.addEventListener("didFocus", startAnim);
    }
}

const FaceApplication = Application.template($ => ({
    Behavior: AppBehavior,
}));

export default new FaceApplication(null, {
    displayListLength: 4096,    // background draws per dot-row band, so the
    touchCount: 0,              // worst begin/end is ~90 rects, not ~700
    pixels: screen.width * 4,
});