# Slowverb

Open-source alternative to [SlowedAndReverb.Studio](https://slowedandreverb.studio/) as a browser extension.

Apply Slowed + Reverb effects to any audio/video right in your browser — YouTube, SoundCloud, Spotify Web, and any other website.

## Features

- 🎚️ Playback speed control (0.5x - 1.5x)
- 🔊 Reverb effect (0% - 100%)
- 🎸 Bass Boost (0% - 100%)
- 💾 Auto-save settings
- 🎨 Modern UI with Montserrat font

## Installation

1. Clone the repository:
```bash
git clone https://gitlab.com/norz3n/slowverb.git
cd slowverb
```

2. Install dependencies:
```bash
npm install
```

3. Load extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the project folder

## Usage

1. Click the extension icon in the browser toolbar
2. Enable audio processing with the toggle
3. Adjust Speed, Reverb, and Bass Boost to your taste
4. Enjoy your music in Slowed + Reverb style

## Development

```bash
# Run tests
npm test

# Generate icons from SVG
node -e "const sharp = require('sharp'); [16,48,128].forEach(s => sharp('assets/icons/icon.svg').resize(s,s).png().toFile('assets/icons/icon'+s+'.png'))"
```

## Tech Stack

- Chrome Extension Manifest V3
- Web Audio API
- Vanilla JavaScript (ES Modules)

## License

MIT
