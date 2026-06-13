// Phone-side (PebbleKit JS). Clay renders the settings page and sends the
// chosen values to the watch; the moddable proxy carries fetch/location.
//
// Clay is wrapped in try/catch so that, if it ever fails to load, the weather
// proxy below still runs (and the error is logged) instead of the whole pkjs
// silently dying. The extra showConfiguration listener is a diagnostic: it
// logs whenever the phone asks us to open settings, so a "nothing happens"
// report can be traced — if [CFG] open never logs, the event isn't reaching
// us (capability/stale-install); if it logs but no page appears, Clay's
// openURL is the problem. (console.log lands in the phone JS log.)
var clay;
try {
  var Clay = require('@rebble/clay');
  var clayConfig = require('./config');
  clay = new Clay(clayConfig);   // auto-registers showConfiguration + webviewclosed
} catch (e) {
  console.log('[CFG] Clay setup failed: ' + e);
}

Pebble.addEventListener('showConfiguration', function () {
  console.log('[CFG] open requested; clay=' + (clay ? 'ready' : 'MISSING'));
});

var moddableProxy = require("@moddable/pebbleproxy");
Pebble.addEventListener('ready', moddableProxy.readyReceived);
Pebble.addEventListener('appmessage', moddableProxy.appMessageReceived);
