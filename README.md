# videojs-effects

A Video.js plugin that adds WebGL shader-based video effects with a control-bar button, modal UI, live preview grid, hotkeys, and persistent settings.

## Highlights
- WebGL shader effects (no CSS filters)
- Control bar button to open modal
- Modal with two tabs:
  - Effects: intensity control, live preview toggle, scrollable grid with live previews
  - Settings: default intensity, grid size, preview size, preview FPS, default effect, live previews, and custom hotkeys
- Hotkeys to toggle modal/effect, navigate effects, adjust intensity, toggle live previews
- Effects defined in a separate JS list (`videojs-effects-list.js`)
- Works with Video.js v8+

## Demo
Open `index.html` via a static server. Example (using Node):
```sh
npx http-server . -p 8080
```
Then visit `http://localhost:8080`.

## Installation
Include the assets after Video.js:
```html
<link href="./dist/videojs-effects.css" rel="stylesheet" />
<script src="https://vjs.zencdn.net/8.x/video.min.js"></script>
<script src="./dist/videojs-effects-list.js"></script>
<script src="./dist/videojs-effects.js"></script>
```

Initialize:
```html
<script>
var player = videojs('my-video');
player.ready(function(){
  player['videojs-effects']({
    defaultIntensity: 0.7,
    gridColumns: 4,
    previewSize: 120,
    previewFps: 6,
    livePreview: true,
    defaultEffectCode: 'cartoon'
  });
});
</script>
```

## Hotkeys (default)
- Toggle modal: `E`
- Toggle effect: `T`
- Next/Previous effect: `]` / `[` (BracketRight/BracketLeft)
- Intensity up/down: `=` / `-` (Equal/Minus)
- Toggle live previews: `P`

You can customize these in the Settings tab.

## Effects
Defined in `dist/videojs-effects-list.js` as an array of dictionaries with:
- `index`: numeric index
- `name`: display name
- `code`: short code name
- `fragment`: WebGL fragment shader string
- `description`: optional

Included effects (10): Cartoon, Dot Halftone, Edge Detect, Pixelate, Swirl, Vignette, Hue Shift, Emboss, Posterize, Chromatic Shift.

## Settings
- Default intensity (0..1)
- Grid columns
- Preview size (px)
- Preview FPS (for live previews)
- Default effect (by code)
- Grid live previews on/off
- Custom hotkeys for all actions

Settings persist in `localStorage` under `videojs-effects-settings-v1`.

## Project Structure (Video.js plugin conventions)
```
.
├── dist/
│   ├── videojs-effects.css
│   ├── videojs-effects.js
│   └── videojs-effects-list.js
├── src/
│   ├── videojs-effects.css
│   ├── videojs-effects.js
│   └── videojs-effects-list.js
├── index.html
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

- `src/`: editable sources
- `dist/`: distributable assets to publish/serve

## Development
- Edit files under `src/` and copy to `dist/` (or set up a bundler of your choice).
- For a full generator-style setup, consider `generator-videojs-plugin`. This repo keeps it simple with prebuilt `dist/` files.

## Notes
- Your media must be CORS-enabled for WebGL video texture uploads. The sample oceans video generally works; for local files, serve them via a local server with appropriate headers.
- The plugin registers as `videojs-effects` and is invoked via `player['videojs-effects'](options)` to support hyphenated names.

## License
MIT