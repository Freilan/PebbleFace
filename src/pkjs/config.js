// Clay configuration page for Yoshi Flower.
//
// Each item's `messageKey` must exist in package.json "messageKeys"; Clay
// sends the chosen values to the watch as an app message when the page is
// saved. The KEY ORDER in package.json defines the numeric codes (10000+i),
// which must line up with SETTINGS_KEYS in src/embeddedjs/main.js.
//
// Colors are delivered to the watch as a 24-bit RGB integer; toggles as 0/1.
// Defaults below match the face's original look.
module.exports = [
  {
    "type": "heading",
    "defaultValue": "Yoshi Flower"
  },
  {
    "type": "text",
    "defaultValue": "Make the face your own."
  },
  {
    "type": "section",
    "items": [
      { "type": "heading", "defaultValue": "Background" },
      {
        "type": "color",
        "messageKey": "BackgroundColor",
        "defaultValue": "55ffaa",
        "label": "Background Color",
        "sunlight": true
      },
      {
        "type": "toggle",
        "messageKey": "ShowDots",
        "label": "Show Dots",
        "defaultValue": true
      },
      {
        "type": "color",
        "messageKey": "DotColor",
        "defaultValue": "00aa55",
        "label": "Dot Color",
        "sunlight": true
      }
    ]
  },
  {
    "type": "section",
    "items": [
      { "type": "heading", "defaultValue": "Display" },
      {
        "type": "toggle",
        "messageKey": "ShowDate",
        "label": "Show Date",
        "defaultValue": true
      },
      {
        "type": "toggle",
        "messageKey": "ShowWeather",
        "label": "Show Weather",
        "defaultValue": true
      },
      {
        "type": "toggle",
        "messageKey": "TemperatureUnit",
        "label": "Fahrenheit (off = Celsius)",
        "defaultValue": true
      }
    ]
  },
  {
    "type": "submit",
    "defaultValue": "Save"
  }
];
