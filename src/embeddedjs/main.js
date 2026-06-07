// ============================================================
//  Yoshi Flower Watch Face — Pebble Round 2 (Gabbro)
// ============================================================

import Poco from "commodetto/Poco";
import parseBMF from "commodetto/parseBMF";
import parseRLE from "commodetto/parseRLE";
import Timer from "timer";
import Location from "embedded:sensor/Location";

// Debug logging — set to the trace() form to re-enable.
const log = () => {};

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
// the PDC images and identify each by its unique viewbox size:
//   petal ~60x130, bee ~50x50, face ~130x130 (first tall image = base petal).
// We scan until the first miss — that is the menu bitmap (a PNG can't load as a
// draw-command image), which keeps us from ever touching an out-of-range id.
function loadDCI(id) {
    try { return new Poco.PebbleDrawCommandImage(id); }
    catch(e) { return null; }
}
let beeDCI = null, faceDCI = null, petalDCI = null, petalCurDCI = null;
for (let id = 1; id <= 64; id++) {
    const dci = loadDCI(id);
    if (!dci) break;       // first miss = menu bitmap; everything past it is the bitmap/MOD
    const w = dci.width, h = dci.height;
    if      (w >= 100 && h >= 100) faceDCI = dci;     // face ~130x130
    else if (h >= 100) {                              // tall: base petal (60w) or current (50w)
        if (w >= 55) petalDCI    = dci;              //   ~60 wide = base petal
        else         petalCurDCI = dci;              //   ~50 wide = current-hour petal
    }
    else if (w >= 40)              beeDCI = dci;      // bee ~50x50
    // ~24px-wide weather icons are skipped here; drawn via WX_IDS below
}

const PETAL_PX = petalDCI ? petalDCI.width  >> 1 : 0;
const PETAL_PY = petalDCI ? petalDCI.height      : 0;
const BEE_PX   = beeDCI   ? beeDCI.width  >> 1 : 0;
const BEE_PY   = beeDCI   ? beeDCI.height >> 1 : 0;

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
    render.fillRectangle(C_WHITE, x,     y,     7, 7);   // halo / backing
    render.fillRectangle(C_BLACK, x + 1, y + 1, 5, 5);   // ring (outer)
    render.fillRectangle(C_WHITE, x + 2, y + 2, 3, 3);   // hole
    render.fillRectangle(C_WHITE, x + 1, y + 1, 1, 1);   // round the 4 corners
    render.fillRectangle(C_WHITE, x + 5, y + 1, 1, 1);
    render.fillRectangle(C_WHITE, x + 1, y + 5, 1, 1);
    render.fillRectangle(C_WHITE, x + 5, y + 5, 1, 1);
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

    // Layer 2: petals. The "current-hour" petal (the one being pulled off this
    // hour, pos = currentH12 + 1) is drawn from a pull-off highlight frame that
    // advances as the hour progresses, then falls at the top of the hour. The
    // rest reuse ONE base-petal clone, rotated to each angle (cloning a fresh
    // ~8KB copy per petal once exhausted the heap and rebooted the watch).
    if (petalDCI) {
        const STEP   = 30 * Math.PI / 180;
        const curPos = currentH12 + 1;           // current-hour petal (>12 => none, at 12:00)
        // Static highlight: lift the current-hour petal a few px outward so it
        // stands out. A per-second wobble animation isn't viable here — the
        // per-repaint petal/bee clones accumulate faster than GC reclaims them
        // at 1fps and the watch reboots. A still highlight redraws only on the
        // minute tick (the proven-stable cadence), so nothing piles up. It's a
        // draw-position offset (not a rotation), so it can't perturb the chain.
        const LIFT = 22;                         // px the current petal juts out
        const ca   = (curPos - 1) * STEP;        // outward direction of that petal
        const lx   = (curPos <= 12) ? Math.round(Math.sin(ca)  * LIFT) : 0;
        const ly   = (curPos <= 12) ? Math.round(-Math.cos(ca) * LIFT) : 0;

        let pd = null, pdAngle = 0;
        for (let pos = 12; pos >= 1; pos--) {
            if (!petalVisible(pos)) continue;
            const ar = -(pos - 1) * STEP;
            if (pos === curPos && petalCurDCI) {
                // current-hour petal: its own distinct image, centered on its
                // own width (50 vs 60) and lifted out. Separate transient clone.
                const px = petalCurDCI.width >> 1, py = petalCurDCI.height;
                const cur = petalCurDCI.clone().rotate(ar, px, py);
                render.begin();
                render.drawDCI(cur, CX - px + lx, CY - py + ly);
                render.end();
                continue;
            }
            // base petal for the rest (one shared clone, rotated by delta)
            if (!pd) pd = petalDCI.clone().rotate(ar, PETAL_PX, PETAL_PY);
            else     pd.rotate(ar - pdAngle, PETAL_PX, PETAL_PY);
            pdAngle = ar;
            const isCur = (pos === curPos);   // (only if petalCurDCI is missing)
            render.begin();
            render.drawDCI(pd, CX - PETAL_PX + (isCur ? lx : 0), CY - PETAL_PY + (isCur ? ly : 0));
            render.end();
        }
    }

    // Layer 3: face + bee + text + weather icon
    const minutes  = now.getMinutes();
    const beeAngle = (minutes / 60) * TWO_PI;
    const beeX     = Math.round(CX + BEE_R * Math.sin(beeAngle));
    const beeY     = Math.round(CY - BEE_R * Math.cos(beeAngle));
    const bd = beeDCI ? beeDCI.clone().rotate(Math.PI - beeAngle, BEE_PX, BEE_PY) : null;

    render.begin();
    if (faceDCI) render.drawDCI(faceDCI, CX - (faceDCI.width >> 1), CY - (faceDCI.height >> 1));
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
    const DEG_GAP = 2, DEG_W = 7;
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
    log("draw: end ok");
  } catch(e) {
    log("draw ERROR: " + e);
    // Never let a draw error crash/reboot the watch; skip this frame.
    try { render.end(); } catch(_) {}
  }
}

// ── App behavior ──────────────────────────────────────────────
class AppBehavior extends Behavior {
    onDisplaying(application) {
        log("main: onDisplaying");
        loadCachedWeather();
        drawScreen();
        log("main: first draw returned");
        requestLocation();

        watch.addEventListener("minutechange", clock => {
            currentH12 = (clock.date.getHours() % 12) || 12;
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