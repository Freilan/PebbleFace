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
const R_PETAL = 0;     // petal_1..3
const R_FALL  = 3;     // petal_fall_1..3
const R_FACE  = 6;     // 6 sets x 2 frames, set-major: 12_11 .. 2_1
const R_BEE   = 18;
const R_WX    = 19;    // cloudy, pcloudy, clear, rain, snow, storm
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

let RES = null;
try { RES = new Uint8Array(Natives.ids); } catch(e) {}
if (!RES || RES.length < 25) {
    // Would mean the FFI hook vanished from mdbl.c — media order is the
    // least-wrong guess, but expect scrambled art until the hook returns.
    trace("[RES] FFI id table unavailable; falling back to media order\n");
    RES = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
           19, 20, 21, 22, 23, 24, 25, 1, 2, 3, 4, 5, 6];
}

function loadDCI(id) {
    try { return new Poco.PebbleDrawCommandImage(id); }
    catch(e) { return null; }
}

// Resident images: the 3 petal idle frames, the bee, and the current face
// set (2 frames, reloaded every two hours). Fall frames are loaded one at a
// time only while the top-of-hour drop plays — keeping all three alongside
// a repaint's clones has blown the heap before.
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

// Face sets are named for the CLOCK HOURS they show: face_2_1 covers 1 & 2
// o'clock ... face_12_11 covers 11 & 12. Media order runs face_12_11 (set
// index 0) down to face_2_1 (5), so the hour maps in reverse.
let faceSet = [], faceSetIdx = -1;
function loadFaceSet(h12) {
    let si = (12 - h12) >> 1;
    if (si >= N_SETS) si = N_SETS - 1;
    if (si === faceSetIdx) return;
    faceSetIdx = si;
    faceSet = [];                        // release the old set before loading
    for (let f = 0; f < FACE_FRAMES; f++) {
        const img = loadDCI(RES[R_FACE + si * FACE_FRAMES + f]);
        if (img) faceSet.push(img);
    }
}

// ── Lookup tables ─────────────────────────────────────────────
const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ── State ─────────────────────────────────────────────────────
let weather      = null;
let lastDate     = new Date();
let currentH12   = (lastDate.getHours() % 12) || 12;
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

// All petals advance together (~1x/sec, offset 2 ticks from the face flip
// so the whole flower doesn't change at once). Per-petal staggered rates
// were dropped: each distinct frame on screen costs one clone PER TICK
// (~1.7KB of app heap each), and three chains churned ~5.4KB/tick — more
// than the GC reclaimed in time.
function petalFrameIdx() {
    if (!animLeft || petalFrames.length < 2) return 0;
    return ((tickCount + 2) >> 2) % petalFrames.length;
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
    // heap behind each clone — and chunk garbage is just ~300B/tick, so
    // the pool alone would let native garbage pile up for many ticks.
    // Nudge the GC every other tick (small ask: an over-pool chunk
    // allocation aborts rather than throws).
    if (!(tickCount & 1)) {
        try { new ArrayBuffer(1024); } catch(e) {}
    }
    if (!(tickCount & 3)) memLine(tickCount);
}

function startAnim() {
    animLeft = ANIM_TICKS;
    if (!animTimer) animTimer = Timer.repeat(animTick, TICK_MS);
}

// ── Petal fall (top of the hour) ──────────────────────────────
// The petal that just vanished plays the 3 fall frames at its position,
// one frame resident at a time.
const FALL_MS = 400;
let fallDCI = null, fallPos = 0, fallStep = 0, fallTimer = null;

function startFall(pos) {
    fallPos  = pos;
    fallStep = 0;
    fallDCI  = loadDCI(RES[R_FALL]);
    if (fallTimer) Timer.clear(fallTimer);
    fallTimer = Timer.repeat(() => {
        fallStep++;
        if (fallStep >= 3) {
            Timer.clear(fallTimer);
            fallTimer = null;
            fallDCI   = null;            // petal has fallen
        }
        else fallDCI = loadDCI(RES[R_FALL + fallStep]);
        drawScreen();
    }, FALL_MS);
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
// pos 1 = the top (12 o'clock) petal — always present: it is the last to
// remain and reblooms at 1:00. The other 11 fall one per hour starting at the
// 1 o'clock petal and going clockwise, so at 1:00 the flower is full and at
// 12:00 only the top petal is left.
function petalVisible(pos) {
    return pos === 1 || pos > currentH12;
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

    // Layer 2: petals. All petals show the same idle frame (frame 0
    // outside the animation window): ONE clone per repaint, rotated
    // incrementally to each position.
    if (petalFrames.length) {
        const STEP = 30 * Math.PI / 180;
        const fi   = petalFrameIdx();
        let pd = null, pdAngle = 0;
        for (let pos = 12; pos >= 1; pos--) {
            if (!petalVisible(pos)) continue;
            const ar = -(pos - 1) * STEP;
            if (!pd) pd = petalFrames[fi].clone().rotate(ar, P_PX[fi], P_PY[fi]);
            else     pd.rotate(ar - pdAngle, P_PX[fi], P_PY[fi]);
            pdAngle = ar;
            render.begin();
            render.drawDCI(pd, CX - P_PX[fi], CY - P_PY[fi]);
            render.end();
        }
        // The petal that dropped at the top of this hour, mid-fall. Frames
        // may be a different size than the petals (~50x130), so center on
        // their own bottom-center anchor.
        if (fallDCI) {
            const px = fallDCI.width >> 1, py = fallDCI.height;
            const fd = fallDCI.clone().rotate(-(fallPos - 1) * STEP, px, py);
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
        loadFaceSet(currentH12);
        drawScreen();
        requestLocation();
        startAnim();    // launching the face means the user is looking

        watch.addEventListener("minutechange", clock => {
            const h = (clock.date.getHours() % 12) || 12;
            if (h !== currentH12) {
                currentH12 = h;
                loadFaceSet(h);              // sets switch on odd hours
                if (h !== 1) startFall(h);   // at 1:00 the flower reblooms — nothing falls
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