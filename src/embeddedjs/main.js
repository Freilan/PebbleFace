// ============================================================
//  Yoshi Flower Watch Face — Pebble Round 2 (Gabbro)
// ============================================================

import Poco from "commodetto/Poco";
import parseBMF from "commodetto/parseBMF";
import parseRLE from "commodetto/parseRLE";
import Timer from "timer";
import Location from "embedded:sensor/Location";

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
// Resource IDs from .N suffix in .reso filenames (stable, assigned by CloudPebble):
// petal=2, bee=3, face=4, icon_clear=5, icon_cloudy=6
// icon_pcloudy=7, icon_rain=8, icon_snow=9, icon_storm=10
const petalDCI = new Poco.PebbleDrawCommandImage(2);
const beeDCI   = new Poco.PebbleDrawCommandImage(3);
const faceDCI = new Poco.PebbleDrawCommandImage(4); 

const PETAL_PX = petalDCI.width  >> 1;
const PETAL_PY = petalDCI.height;
const BEE_PX   = beeDCI.width  >> 1;
const BEE_PY   = beeDCI.height >> 1;

// Weather icon resource IDs — loaded lazily at draw time
const WX_IDS = {
    "Clear":     5,
    "Cloudy":    6,
    "P. Cloudy": 7,
    "Rain":      8,
    "Snow":      9,
    "Storm":     10,
};

// ── Lookup tables ─────────────────────────────────────────────
const DAYS   = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ── State ─────────────────────────────────────────────────────
let weather      = null;
let lastDate     = new Date();
let petalsToDrop = 0;
let dropTimer    = null;
let currentH12   = (lastDate.getHours() % 12) || 12;
let useFahrenheit = true;
try {
    const s = localStorage.getItem("settings");
    if (s) useFahrenheit = JSON.parse(s).useFahrenheit !== false;
} catch(e) {}

// ── Petal visibility ──────────────────────────────────────────
function petalVisible(pos) {
    return currentH12 === 12 || pos > currentH12;
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

function requestLocation() {
    try {
        new Location({
            onSample() {
                const s = this.sample();
                this.close();
                fetchWeather(s.latitude, s.longitude);
            }
        });
    } catch(e) {}
}

async function fetchWeather(lat, lon) {
    try {
        const u = useFahrenheit ? "&temperature_unit=fahrenheit" : "";
        const url = "http://api.open-meteo.com/v1/forecast"
            + "?latitude=" + lat + "&longitude=" + lon
            + "&current=temperature_2m,weather_code" + u;
        const data = await (await fetch(url)).json();
        weather = {
            temp: Math.round(data.current.temperature_2m),
            desc: weatherDesc(data.current.weather_code)
        };
        localStorage.setItem("weather", JSON.stringify(weather));
        localStorage.setItem("weatherTime", String(Date.now()));
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

// ── Main draw ─────────────────────────────────────────────────
function drawScreen(event) {
    const now = (event && event.date) ? event.date : lastDate;
    if (event && event.date) lastDate = event.date;

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

    // Layer 2: petals — one render pass per petal, 1 clone at a time
    for (let pos = 12; pos >= 1; pos--) {
        if (!petalVisible(pos)) continue;
        const ar = -(pos - 1) * 30 * Math.PI / 180;
        if (!petalDCI) continue;
        const pd = petalDCI.clone().rotate(ar, PETAL_PX, PETAL_PY);
        render.begin();
        render.drawDCI(pd, CX - PETAL_PX, CY - PETAL_PY);
        render.end();
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
    const tempStr = weather ? weather.temp + (useFahrenheit ? "\u00B0F" : "\u00B0C") : "--\u00B0";
    w = render.getTextWidth(tempStr, font);
    strokeText(tempStr, a.x - (w >> 1) + 5, a.y - (font.height >> 1));

    a = petalAnchor(90);
    const condStr = weather ? weather.desc : "";
    if (condStr) {
        w = render.getTextWidth(condStr, font);
        strokeText(condStr, a.x - (w >> 1), a.y - (font.height >> 1));
    }

if (condStr) {
        const iconId = WX_IDS[condStr];
        if (iconId !== undefined) {
            try {
                const icon = new Poco.PebbleDrawCommandImage(iconId);
                render.drawDCI(icon,
                    a.x - (icon.width >> 1),
                    a.y + (font.height >> 1) + 3);
                render.end();
            } catch(e) {}
        }
    }

    render.end();

    
}

// ── Petal drop animation ──────────────────────────────────────
function dropNextPetal() {
    petalsToDrop--;
    drawScreen();
    dropTimer = petalsToDrop > 0 ? Timer.set(420, dropNextPetal) : null;
}

// ── App behavior ──────────────────────────────────────────────
class AppBehavior extends Behavior {
    onDisplaying(application) {
        loadCachedWeather();
        drawScreen();
        requestLocation();

        watch.addEventListener("minutechange", clock => {
            const d    = clock.date;
            const h24  = d.getHours();
            const h12  = (h24 % 12) || 12;
            const prev = (lastDate.getHours() % 12) || 12;

            if (h12 !== prev && !(h24 === 0 && lastDate.getHours() === 23)) {
                let diff = h12 - prev;
                if (diff < 0) diff += 12;
                petalsToDrop = diff;
                currentH12   = h12;
                if (dropTimer) Timer.clear(dropTimer);
                dropTimer = Timer.set(0, dropNextPetal);
            } else {
                currentH12 = h12;
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