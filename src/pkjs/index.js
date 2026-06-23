// Phone-side (PebbleKit JS). Two jobs:
//   1. The Moddable proxy carries fetch/location for the watch.
//   2. Configuration is a HOSTED page (docs/config.html on GitHub Pages),
//      opened with Pebble.openURL.
//
// We deliberately do NOT use Clay. pkjs now runs in the Moddable XS sandbox,
// whose small hardened heap can't hold Clay's ~125 KB inline config page or
// the ~420 KB transient peak generateUrl() hits when Settings opens -- that
// overflow is the "xsPlatform.c:125 fxAbort memory full" abort, after which
// the app reports "No JS found, can't show configuration". A hosted page keeps
// the heavy HTML/CSS/JS off the XS heap entirely: this VM only builds a short
// URL and parses a small JSON reply.

var moddableProxy = require("@moddable/pebbleproxy");
Pebble.addEventListener('ready', moddableProxy.readyReceived);
Pebble.addEventListener('appmessage', moddableProxy.appMessageReceived);

// Hosted settings page. Served by GitHub Pages from docs/ on the default
// branch (Settings -> Pages -> Deploy from a branch -> main -> /docs). Must be
// HTTPS for openURL to load it in the app's webview.
var CONFIG_URL = 'https://freilan.github.io/PebbleFace/config.html';

// messageKeys order in package.json -> numeric app-message codes 10000+i,
// matching SETTINGS_KEYS and the Message channel on the watch
// (src/embeddedjs/main.js). The page speaks these same NAMED keys; we map them
// to the numeric codes here, exactly as Clay used to.
var KEY_CODE = {
  BackgroundColor: 10000,
  ShowDots:        10001,
  DotColor:        10002,
  ShowDate:        10003,
  ShowWeather:     10004,
  TemperatureUnit: 10005,
  YoshiMode:       10006,
  YoshiColor:      10007
};

// Settings persist on the phone so the page can prefill the current values.
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('settings')) || {}; }
  catch (e) { return {}; }
}

Pebble.addEventListener('showConfiguration', function () {
  var v = encodeURIComponent(JSON.stringify(loadSettings()));
  Pebble.openURL(CONFIG_URL + '?v=' + v);
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) { return; }   // Cancel / dismissed -> leave settings as-is

  var settings;
  try { settings = JSON.parse(decodeURIComponent(e.response)); }
  catch (err) {
    try { settings = JSON.parse(e.response); }   // some app builds don't URI-encode
    catch (err2) { return; }
  }

  // Remember for next time the page opens.
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch (err) {}

  // Map named keys -> the numeric codes the watch's Message channel decodes.
  var msg = {};
  Object.keys(settings).forEach(function (k) {
    if (KEY_CODE.hasOwnProperty(k)) { msg[KEY_CODE[k]] = settings[k]; }
  });

  Pebble.sendAppMessage(msg, function () {
    console.log('Sent config to watch');
  }, function (err) {
    console.log('Failed to send config: ' + JSON.stringify(err));
  });
});
