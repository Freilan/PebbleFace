// ============================================================
//  Yoshi Flower Watch Face — Pebble Round 2 (Gabbro)
// ============================================================

import Poco from "commodetto/Poco";
import parseBMF from "commodetto/parseBMF";
import parseRLE from "commodetto/parseRLE";
import Timer from "timer";
import Location from "embedded:sensor/Location";
import Accelerometer from "embedded:sensor/Accelerometer";
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

// ── Colors ────────────────────────────────────────────────────
const C_BG    = render.makeColor( 85, 255, 170);
const C_BLACK = render.makeColor(  0,   0,   0);
const C_WHITE = render.makeColor(255, 255, 255);
const C_DOT   = render.makeColor(  0, 170,  85);

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
let useFahrenheit = true;
try {
    const s = localStorage.getItem("settings");
    if (s) useFahrenheit = JSON.parse(s).useFahrenheit !== false;
} catch(e) {}

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
    drawScreen();
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

// TEMPORARY demo hook — the cloud emulator disconnects after ~5-10 idle
// minutes, so hour boundaries can't be reached naturally. With this on,
// every check (flick / menu-and-back / launch) pretends one hour passed:
// each didFocus plays the next petal transition (grow through the AM,
// fall through the PM). Real-time hour sync is paused meanwhile.
// SET TO false BEFORE RELEASE.
const DEMO_HOUR_PER_CHECK = true;

function startAnim() {
    animLeft = ANIM_TICKS;
    if (!animTimer) animTimer = Timer.repeat(animTick, TICK_MS);
    if (DEMO_HOUR_PER_CHECK) currentH24 = (currentH24 + 1) % 24;
    trace("[CHK] check: now=", currentH24, " shown=", shownH24, "\n");
    catchUp();    // the user is looking — play any missed petal transitions
}

// ── Petal transitions — played when the user CHECKS the watch ──
// Petals no longer change at the top of the hour. The flower keeps showing
// the state from the user's last check (shownH24); when they next look
// (flick / focus / launch — or mid-animation when the hour flips), the
// missed transitions play one hour-step at a time: PM steps shed a petal
// with the fall frames, AM steps bloom one with the grow frames. So the
// flower itself tells you how long it's been. One overlay frame is
// resident at a time, and steps older than CATCHUP_MAX apply instantly
// (nobody wants to watch 23 of these after a day away).
const FRAME_MS    = 400;   // per overlay frame (3 frames per step)
const CATCHUP_MAX = 6;     // animate at most this many hour-steps
let ovlDCI = null, ovlPos = 0, ovlStep = 0, ovlTimer = null;
let hidePos = 0;           // suppress this petal's static draw while its
                           // grow overlay plays (it's already "visible")

function playStep(base, pos, hide, done) {
    ovlPos  = pos;
    ovlStep = 0;
    hidePos = hide ? pos : 0;
    ovlDCI  = loadDCI(RES[base]);
    ovlTimer = Timer.repeat(() => {
        ovlStep++;
        if (ovlStep >= 3) {
            Timer.clear(ovlTimer);
            ovlTimer = null;
            ovlDCI   = null;
            hidePos  = 0;
            drawScreen();
            done();
            return;
        }
        ovlDCI = loadDCI(RES[base + ovlStep]);
        drawScreen();
    }, FRAME_MS);
}

function stepCatchUp() {
    if (shownH24 === currentH24) return;       // caught up
    shownH24 = (shownH24 + 1) % 24;
    loadFaceSet(petalCount());                 // face follows the flower
    const h = shownH24;
    let base = R_GROW, pos = h + 1, hide = true;                  // AM bloom
    if (h === 0)       { base = R_FALL; pos = 12; hide = false; } // midnight: last petal
    else if (h > 12)   { base = R_FALL; pos = h - 12; hide = false; } // PM shed
    else if (h === 12) { pos = 1; }                               // noon: top petal
    trace("[CHK] ", base === R_FALL ? "fall" : "grow", " pos=", pos, " shown=", h, "\n");
    playStep(base, pos, hide, stepCatchUp);
    drawScreen();
}

function catchUp() {
    if (ovlTimer) return;                      // a sequence is already playing
    let gap = (currentH24 - shownH24 + 24) % 24;
    if (!gap) return;
    if (gap > CATCHUP_MAX) {                   // too old to narrate — skip ahead
        shownH24 = (currentH24 - CATCHUP_MAX + 24) % 24;
        loadFaceSet(petalCount());
    }
    stepCatchUp();
}

// ── app_message channel ───────────────────────────────────────
// The FIRST Message created fixes the app_message buffer sizes for the
// app's life; the default is maximum (8200 in + 8200 out = 16.4KB of heap).
// Location passes no sizes, so open the channel small BEFORE anything else
// does. Safe: the phone proxy fragments HTTP responses to fit the inbox,
// and our weather JSON / Clay settings are a few hundred bytes. Kept alive
// for the app's life (module-level ref).
let msgChannel = null;
function openMessageChannel() {
    try { msgChannel = new Message({ input: 2048, output: 1024 }); }
    catch(e) {}
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
        // While the animation runs, the next tick repaints within 250ms —
        // skip the extra draw at this (heaviest) moment.
        if (!animTimer) drawScreen();
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
        render.end();
    }

    // Layer 2: petals. Each petal's frame is offset by its position, so
    // up to three distinct frames are on screen at once. One clone per
    // frame IMAGE in use — petals sharing a frame reuse its chain,
    // rotated incrementally to each position.
    if (petalFrames.length) {
        const STEP   = 30 * Math.PI / 180;
        const clones = [null, null, null], angles = [0, 0, 0];
        for (let pos = 12; pos >= 1; pos--) {
            if (!petalVisible(pos) || pos === hidePos) continue;
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
        // The petal mid-transition (falling or growing). Frames may be a
        // different size than the petals, so center on their own
        // bottom-center anchor.
        if (ovlDCI) {
            const px = ovlDCI.width >> 1, py = ovlDCI.height;
            const fd = ovlDCI.clone().rotate(-(ovlPos - 1) * STEP, px, py);
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

    a = petalAnchor(300);
    const dayStr = DAYS[now.getDay()];
    w = render.getTextWidth(dayStr, font);
    strokeText(dayStr, a.x - (w >> 1), a.y - (font.height >> 1));

    a = petalAnchor(270);
    const dateStr = MONTHS[now.getMonth()] + " " + String(now.getDate()).padStart(2, "0");
    w = render.getTextWidth(dateStr, font);
    strokeText(dateStr, a.x - (w >> 1) - 5, a.y - (font.height >> 1));

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
        openMessageChannel();

        loadCachedWeather();
        loadFaceSet(petalCount());   // face tracks how many petals remain
        drawScreen();
        requestLocation();
        startAnim();    // launching the face means the user is looking

        watch.addEventListener("minutechange", clock => {
            const h = clock.date.getHours();
            if (!DEMO_HOUR_PER_CHECK && h !== currentH24) {
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