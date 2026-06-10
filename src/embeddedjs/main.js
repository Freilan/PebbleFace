// ============================================================
//  Yoshi Flower Watch Face — Pebble Round 2 (Gabbro)
// ============================================================

import Poco from "commodetto/Poco";
import parseBMF from "commodetto/parseBMF";
import parseRLE from "commodetto/parseRLE";
import Timer from "timer";
import Location from "embedded:sensor/Location";
import Accelerometer from "embedded:sensor/Accelerometer";

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
// Resource ids depend on package.json `media` ORDER and have proven fragile:
// a wrong/out-of-range id hard-faults and crash-loops the watch (a native
// fault that a JS try/catch cannot trap). So rather than hardcode ids, probe
// the PDC images and classify each by viewbox size:
//   face frames ~130x130, petal idle frames ~60x130 (>= 55 wide),
//   fall frames ~50x130 (< 55 wide), bee ~50x50.
// Within a class, frame order = media order (ids ascend). We scan until the
// first miss — that is the menu bitmap (a PNG can't load as a draw-command
// image), which keeps us from ever touching an out-of-range id. The probe
// keeps only ids, not images, so the scan leaves nothing resident.
function loadDCI(id) {
    try { return new Poco.PebbleDrawCommandImage(id); }
    catch(e) { return null; }
}
const petalIds = [], fallIds = [], faceIds = [];
let beeId = 0;
for (let id = 1; id <= 64; id++) {
    const dci = loadDCI(id);
    if (!dci) break;       // first miss = menu bitmap; everything past it is the bitmap/MOD
    const w = dci.width, h = dci.height;
    if      (w >= 100 && h >= 100) faceIds.push(id);
    else if (h >= 100)             (w >= 55 ? petalIds : fallIds).push(id);
    else if (w >= 40)              beeId = id;
    // ~24px-wide weather icons are skipped here; drawn via WX_IDS below
}

// Resident images: the 3 petal idle frames, the bee, and the current face
// set (3 frames, reloaded every two hours). Fall frames are loaded one at a
// time only while the top-of-hour drop plays — keeping all three alongside
// a repaint's clones has blown the heap before.
const petalFrames = petalIds.map(id => new Poco.PebbleDrawCommandImage(id));
const beeDCI = beeId ? new Poco.PebbleDrawCommandImage(beeId) : null;
const P_PX   = petalFrames.map(f => f.width >> 1);
const P_PY   = petalFrames.map(f => f.height);
const BEE_PX = beeDCI ? beeDCI.width  >> 1 : 0;
const BEE_PY = beeDCI ? beeDCI.height >> 1 : 0;

// Face sets keyed by petals remaining: set 0 = 12 & 11 left (hours 1-2),
// set 1 = 10 & 9 (hours 3-4), ... set 5 = 2 & 1 left (hours 11-12).
let faceSet = [], faceSetIdx = -2;
function loadFaceSet(h12) {
    const nSets = (faceIds.length / 3) | 0;
    let si = (h12 - 1) >> 1;
    if (si >= nSets) si = nSets - 1;
    if (si === faceSetIdx) return;
    faceSetIdx = si;
    faceSet = [];                        // release the old set before loading
    if (si < 0) {                        // fewer than 3 face images in build
        if (faceIds.length) faceSet.push(new Poco.PebbleDrawCommandImage(faceIds[0]));
        return;
    }
    for (let f = 0; f < 3; f++)
        faceSet.push(new Poco.PebbleDrawCommandImage(faceIds[si * 3 + f]));
}

// Weather icon resource IDs — loaded lazily at draw time
const WX_IDS = {
    "Clear":     3,
    "Cloudy":    1,
    "P. Cloudy": 2,
    "Rain":      4,
    "Snow":      5,
    "Storm":     6,
};

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
    if (!fallIds.length) return;
    fallPos  = pos;
    fallStep = 0;
    fallDCI  = loadDCI(fallIds[0]);
    if (fallTimer) Timer.clear(fallTimer);
    fallTimer = Timer.repeat(() => {
        fallStep++;
        if (fallStep >= fallIds.length) {
            Timer.clear(fallTimer);
            fallTimer = null;
            fallDCI   = null;            // petal has fallen
        }
        else fallDCI = loadDCI(fallIds[fallStep]);
        drawScreen();
    }, FALL_MS);
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
    // Layer 1: background + dots
    render.begin();
    render.fillRectangle(C_BG, 0, 0, W, H);
    for (let ddy = -126; ddy <= 126; ddy += DOT_GRID) {
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
        const iconId = WX_IDS[weather.desc];
        if (iconId !== undefined) {
            try {
                const icon = new Poco.PebbleDrawCommandImage(iconId);
                render.drawDCI(icon,
                    a.x - (icon.width  >> 1),
                    a.y - (icon.height >> 1));
            } catch(e) {}
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
        loadCachedWeather();
        loadFaceSet(currentH12);
        drawScreen();
        requestLocation();

        // Wrist flick / tap → one short animation window. Created once and
        // kept for the app's life (the runtime allows only one instance;
        // close+reopen of sensors has proven fatal — see requestLocation).
        try { accel = new Accelerometer({ onTap: startAnim }); } catch(e) {}
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
    }
}

const FaceApplication = Application.template($ => ({
    Behavior: AppBehavior,
}));

export default new FaceApplication(null, {
    displayListLength: 16384,
    touchCount: 0,
    pixels: screen.width * 4,
});