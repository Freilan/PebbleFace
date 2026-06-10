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

// ── Startup memory diagnostics (TEMPORARY — strip when stable) ──
// Dumps every XS instrumentation counter (chunk/slot heap, system free,
// display list, ...) to the app log at each startup stage, to find which
// stage hits the allocation wall and how big each pool actually is.
// Variadic trace (no string concat) keeps the report itself nearly free.
function memReport(tag) {
    trace("[MEM] ", tag, "\n");
    try {
        for (let i = 1; i < 64; i++) {
            const name = Instrumentation.name(i);
            if (!name) break;
            trace("  ", name, "=", Instrumentation.get(i), "\n");
        }
    } catch(e) {
        trace("  (instrumentation unavailable)\n");
    }
}
memReport("load:imports");

const render = new Poco(screen);

// ── Font ──────────────────────────────────────────────────────
function getFont(name, size) {
    const f = parseBMF(new Resource(`${name}-${size}.fnt`));
    f.bitmap = parseRLE(new Resource(`${name}-${size}-alpha.bm4`));
    return f;
}
const font = getFont("MarkerFelt10", 20);
memReport("load:font");

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
// Resource ids are assigned by the build's resource-ball order, which is a
// random ROTATION of the package.json media order — the offset changes from
// build to build (observed 0, 12, 17), with the MOD archive always last
// (id 27). So ids can be neither hardcoded nor taken from size classes in
// id order (a class can wrap around the rotation seam). Instead, scan from
// id 1 until an unambiguous anchor reveals the offset: the bee (the only
// PDC between 40 and 99px wide) or icon.png (the only id in 1..26 that
// fails to load as a draw-command image — ids past the table hard-fault,
// but 1..26 all exist). Probed images are dropped immediately (decoding
// costs app heap until GC reclaims it).
// Constants are 1-based package.json media POSITIONS — keep in sync.
const N_MEDIA     = 26;             // media entries (icon.png last)
const WX_MEDIA = {                  // weather icons, loaded lazily at draw
    "Cloudy":    1,
    "P. Cloudy": 2,
    "Clear":     3,
    "Rain":      4,
    "Snow":      5,
    "Storm":     6,
};
const PETAL_MEDIA = 7;              // petal_1..3: idle frames
const FALL_MEDIA  = 10;             // petal_fall_1..3: top-of-hour sequence
const FACE_MEDIA  = 13;             // face_12_11_1 .. face_2_1_2, set-major
const FACE_FRAMES = 2;              // frames per face set
const N_SETS      = 6;
const BEE_MEDIA   = 25;
const ICON_MEDIA  = 26;             // menu icon.png (not loadable as PDC)

function loadDCI(id) {
    try { return new Poco.PebbleDrawCommandImage(id); }
    catch(e) { return null; }
}

let rotation = 0;
for (let id = 1; id <= N_MEDIA; id++) {
    const dci = loadDCI(id);
    let m = 0;
    if (!dci) m = ICON_MEDIA;
    else if (dci.width >= 40 && dci.width < 100 && dci.height < 100) m = BEE_MEDIA;
    if (m) { rotation = (id - m + N_MEDIA) % N_MEDIA; break; }
}
// id of the 1-based media entry m under this build's rotation
function rid(m) { return ((m - 1 + rotation) % N_MEDIA) + 1; }

// Resident images: the 3 petal idle frames, the bee, and the current face
// set (2 frames, reloaded every two hours). Fall frames are loaded one at a
// time only while the top-of-hour drop plays — keeping all three alongside
// a repaint's clones has blown the heap before.
const petalFrames = [];
for (let i = 0; i < 3; i++) {
    const f = loadDCI(rid(PETAL_MEDIA + i));
    if (f) petalFrames.push(f);
}
if (!petalFrames.length || petalFrames[0].height < 100)
    trace("[RES] rotation mapping looks wrong (petal probe failed)\n");
const beeDCI = loadDCI(rid(BEE_MEDIA));
memReport("load:art");
const P_PX   = petalFrames.map(f => f.width >> 1);
const P_PY   = petalFrames.map(f => f.height);
const BEE_PX = beeDCI ? beeDCI.width  >> 1 : 0;
const BEE_PY = beeDCI ? beeDCI.height >> 1 : 0;

// Face sets keyed by petals remaining: set 0 = 12 & 11 left (hours 1-2),
// set 1 = 10 & 9 (hours 3-4), ... set 5 = 2 & 1 left (hours 11-12).
let faceSet = [], faceSetIdx = -1;
function loadFaceSet(h12) {
    let si = (h12 - 1) >> 1;
    if (si >= N_SETS) si = N_SETS - 1;
    if (si === faceSetIdx) return;
    faceSetIdx = si;
    faceSet = [];                        // release the old set before loading
    for (let f = 0; f < FACE_FRAMES; f++) {
        const img = loadDCI(rid(FACE_MEDIA + si * FACE_FRAMES + f));
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
// Per-petal frame period in ticks (2..6 = 0.5s..1.5s). Neighbours (incl. 12
// next to 1) always differ, so adjacent petals visibly run out of step; the
// +pos phase in petalFrameIdx desyncs petals that share a period.
const PETAL_TICKS = [4,2,5,3,6,2,4,6,3,5,2,5];
let tickCount = 0, animLeft = 0, animTimer = null;
let accel = null;          // keep the instance alive — GC would unsubscribe tap

function petalFrameIdx(pos) {
    if (!animLeft || petalFrames.length < 2) return 0;
    return (((tickCount / PETAL_TICKS[pos - 1]) | 0) + pos) % petalFrames.length;
}

function animTick() {
    tickCount++;
    if (--animLeft <= 0) {     // window over: stop the timer; this last
        Timer.clear(animTimer); // draw paints the resting (frame 0) state
        animTimer = null;
        animLeft = 0;
    }
    drawScreen();
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
    fallDCI  = loadDCI(rid(FALL_MEDIA));
    if (fallTimer) Timer.clear(fallTimer);
    fallTimer = Timer.repeat(() => {
        fallStep++;
        if (fallStep >= 3) {
            Timer.clear(fallTimer);
            fallTimer = null;
            fallDCI   = null;            // petal has fallen
        }
        else fallDCI = loadDCI(rid(FALL_MEDIA + fallStep));
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
    try {
        new Location({
            onSample() {
                locating = false;
                try {
                    const s = this.sample();
                    this.close();
                    fetchWeather(s.latitude, s.longitude);
                } catch(e) {}
            }
        });
    } catch(e) { locating = false; }
}

async function fetchWeather(lat, lon) {
    try {
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
        drawScreen();
    } catch(e) {}
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

    // Layer 2: petals. Each visible petal shows one of the 3 idle frames
    // (per-petal rate/phase; frame 0 outside the animation window). One
    // clone per frame IMAGE in use — not per petal: petals sharing a frame
    // reuse its clone, rotated incrementally to each position (per-petal
    // clones would churn too much memory per repaint).
    if (petalFrames.length) {
        const STEP   = 30 * Math.PI / 180;
        const clones = [null, null, null], angles = [0, 0, 0];
        for (let pos = 12; pos >= 1; pos--) {
            if (!petalVisible(pos)) continue;
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

    // Layer 3: face + bee + text + weather icon
    const minutes  = now.getMinutes();
    const beeAngle = (minutes / 60) * TWO_PI;
    const beeX     = Math.round(CX + BEE_R * Math.sin(beeAngle));
    const beeY     = Math.round(CY - BEE_R * Math.cos(beeAngle));
    const bd = beeDCI ? beeDCI.clone().rotate(Math.PI - beeAngle, BEE_PX, BEE_PY) : null;

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
        const iconMedia = WX_MEDIA[weather.desc];
        if (iconMedia !== undefined) {
            const icon = loadDCI(rid(iconMedia));
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
        memReport("disp:enter");
        try { accel = new Accelerometer({ onTap: startAnim }); } catch(e) {}
        memReport("disp:accel");
        openMessageChannel();
        memReport("disp:msg");

        loadCachedWeather();
        loadFaceSet(currentH12);
        drawScreen();
        memReport("disp:draw1");
        requestLocation();
        startAnim();    // launching the face means the user is looking
        memReport("disp:anim");

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
    }
}

const FaceApplication = Application.template($ => ({
    Behavior: AppBehavior,
}));
memReport("load:pre-app");

export default new FaceApplication(null, {
    displayListLength: 4096,    // background draws per dot-row band, so the
    touchCount: 0,              // worst begin/end is ~90 rects, not ~700
    pixels: screen.width * 4,
});