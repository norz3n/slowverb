# Slowverb

Open-source alternative to [SlowedAndReverb.Studio](https://slowedandreverb.studio/) as a browser extension.

Apply Slowed + Reverb effects to any audio/video right in your browser — YouTube and YouTube Music.

## Features

- 🎚️ Playback speed control (0.5x - 1.5x)
- 🔊 Reverb effect (0% - 100%)
- 🎸 Bass Boost (0% - 100%)
- 💾 Auto-save settings
- 🎛️ Presets (Slowed & Reverb, Nightcore, custom)
- 🎨 Modern UI with Montserrat font

## Installation

### From Stores

- [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/slowverb/) (pending)
- [Opera Add-ons](https://addons.opera.com/extensions/details/slowverb/) (pending)

### From Source

1. Clone the repository:
```bash
git clone https://gitlab.com/norz3n/slowverb.git
cd slowverb
npm install
```

2. Build for your browser:
```bash
# Chrome/Opera
npm run build:chrome

# Firefox
npm run build:firefox
```

3. Load the extension:

**Chrome/Opera:**
- Open `chrome://extensions/` (or `opera://extensions/`)
- Enable "Developer mode"
- Click "Load unpacked"
- Select `dist/chrome` folder

**Firefox:**
- Open `about:debugging#/runtime/this-firefox`
- Click "Load Temporary Add-on"
- Select any file in `dist/firefox` folder

## Usage

1. Click the extension icon in the browser toolbar
2. Enable audio processing with the toggle
3. Adjust Speed, Reverb, and Bass Boost to your taste
4. Enjoy your music in Slowed + Reverb style

## Development

```bash
# Run tests
npm test

# Build all browsers
npm run build

# Development mode (watch)
npm run dev:chrome
npm run dev:firefox
```

## Tech Stack

- Chrome Extension Manifest V3
- Firefox WebExtensions API
- Web Audio API
- Vanilla JavaScript (ES Modules)

## License

MIT
