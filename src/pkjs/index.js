// Phone-side (PebbleKit JS). Clay renders the settings page and sends the
// chosen values to the watch; the moddable proxy carries fetch/location.
// Clay is wrapped in try/catch so a Clay failure can't take the weather proxy
// down with it.
//
// TEMPORARY MEMORY DIAGNOSTIC — Clay disabled.
// pkjs now runs in the Moddable XS sandbox, whose small hardened heap can't
// hold Clay's ~125 KB inline config page plus the ~420 KB transient peak
// generateUrl() hits when Settings opens (.replace copy + encodeURIComponent).
// That overflow is the "xsPlatform.c:125 fxAbort memory full" abort; once the
// VM dies the app reports "No JS found, can't show configuration". Commenting
// the Clay block out keeps it out of the bundle entirely, so this build should
// run the face + weather proxy with no memory abort (Settings will simply do
// nothing). If the abort is gone, Clay is confirmed as the cause — the real
// fix is to move the config page to a hosted URL. Restore this block after.
// var clay;
// try {
//   var Clay = require('@rebble/clay');
//   var clayConfig = require('./config');
//   clay = new Clay(clayConfig);   // auto-registers showConfiguration + webviewclosed
//   // Custom clickable image picker for the Yoshi color (type "yoshicolor" in
//   // config.js). Must be registered before the page is built (i.e. now, at app
//   // start, well before the user opens settings).
//   clay.registerComponent(require('./yoshiColorPicker'));
// } catch (e) {}

var moddableProxy = require("@moddable/pebbleproxy");
Pebble.addEventListener('ready', moddableProxy.readyReceived);
Pebble.addEventListener('appmessage', moddableProxy.appMessageReceived);
