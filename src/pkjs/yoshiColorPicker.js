'use strict';

// Custom Clay component: a clickable Yoshi-color picker.
//
// Renders four thumbnail tiles (one per color). Tapping a tile selects it and
// writes the value (0..3) into a hidden input that the built-in 'val'
// manipulator reads/writes -- so to the rest of Clay this behaves exactly like
// a normal value component bound to the YoshiColor messageKey.
//
// The thumbnails are HOT-LINKED from the public repo (raw.githubusercontent),
// so they cost ZERO watch resource slots (we're at the resource ceiling). If an
// image is missing or slow, the tile still works -- the color name is always
// shown beneath it. Modeled on Clay's own `color` component.

var IMG_BASE =
  'https://raw.githubusercontent.com/Freilan/PebbleFace/main/config-images/';

var COLORS = [
  { value: '0', name: 'Green',      file: 'yoshi_green.png'  },
  { value: '1', name: 'Light Blue', file: 'yoshi_lblue.png'  },
  { value: '2', name: 'Red',        file: 'yoshi_red.png'    },
  { value: '3', name: 'Yellow',     file: 'yoshi_yellow.png' }
];

function tile(c) {
  return '<i class="yoshicolor-opt" data-value="' + c.value + '">' +
           '<span class="yoshicolor-thumb" style="background-image:url(' +
             IMG_BASE + c.file + ')"></span>' +
           '<span class="yoshicolor-name">' + c.name + '</span>' +
         '</i>';
}

module.exports = {
  name: 'yoshicolor',
  template:
    '<div class="component yoshicolor">' +
      '<span class="label">{{label}}</span>' +
      '<input type="hidden" data-manipulator-target value="0"/>' +
      '<div class="yoshicolor-row">' +
        tile(COLORS[0]) + tile(COLORS[1]) + tile(COLORS[2]) + tile(COLORS[3]) +
      '</div>' +
    '</div>',
  style:
    '.yoshicolor-row{display:flex;justify-content:space-between;margin-top:8px}' +
    '.yoshicolor-opt{flex:1;margin:0 3px;text-align:center;cursor:pointer;' +
      'opacity:.4;padding:6px 2px;border-radius:8px;' +
      'transition:opacity .12s,background .12s}' +
    '.yoshicolor-opt.selected{opacity:1;background:rgba(0,0,0,.14)}' +
    '.yoshicolor-thumb{display:block;width:100%;padding-bottom:100%;' +
      'background-size:contain;background-position:center;' +
      'background-repeat:no-repeat}' +
    '.yoshicolor-name{display:block;font-size:12px;margin-top:5px}',
  manipulator: 'val',
  defaults: { label: 'Yoshi Color' },
  initialize: function(minified, clay) {
    var self = this;
    var $el = self.$element;

    function highlight() {
      var v = self.get();
      $el.select('.yoshicolor-opt').set('-selected');
      $el.select('.yoshicolor-opt[data-value="' + v + '"]').set('+selected');
    }

    // Bind each tile with the value captured in a closure, so it doesn't matter
    // whether the click lands on the tile, its thumbnail, or its name label.
    ['0', '1', '2', '3'].forEach(function(v) {
      $el.select('.yoshicolor-opt[data-value="' + v + '"]')
        .on('click', function() { self.set(v); });
    });

    self.on('change', highlight);
    highlight();
  }
};
