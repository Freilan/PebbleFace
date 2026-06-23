# config-images

Thumbnails for the **Yoshi Color** picker on the hosted settings page
(`docs/config.html`).

These are **not** watch resources — they are not in `package.json` and are never
bundled into the app (the watch is at its resource-slot ceiling). The settings
page hot-links them straight from this public repo via
`raw.githubusercontent.com/Freilan/PebbleFace/main/config-images/<file>`.

Drop four PNGs here, with these **exact** names:

| File               | Tile        |
|--------------------|-------------|
| `yoshi_green.png`  | Green       |
| `yoshi_lblue.png`  | Light Blue  |
| `yoshi_red.png`    | Red         |
| `yoshi_yellow.png` | Yellow      |

Square-ish, ~120×120 px is plenty (a head shot of each color works well). Until
they're added the picker still works — it just shows the color names with empty
thumbnail boxes.
