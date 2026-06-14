// Phone-side (PebbleKit JS). Clay renders the settings page and sends the
// chosen values to the watch; the moddable proxy carries fetch/location.
// Clay is wrapped in try/catch so a Clay failure can't take the weather proxy
// down with it.
var clay;
try {
  var Clay = require('@rebble/clay');
  var clayConfig = require('./config');
  clay = new Clay(clayConfig);   // auto-registers showConfiguration + webviewclosed
} catch (e) {}

var moddableProxy = require("@moddable/pebbleproxy");
Pebble.addEventListener('ready', moddableProxy.readyReceived);
Pebble.addEventListener('appmessage', moddableProxy.appMessageReceived);
