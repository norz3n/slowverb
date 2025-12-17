#!/usr/bin/env python3
"""
SVG to PNG converter for Chrome extension icons.
Converts assets/icons/icon.svg to multiple PNG sizes.
Uses Node.js sharp library (no system dependencies on Windows).
"""

import subprocess
import sys
from pathlib import Path

# Icon sizes for Chrome extension
SIZES = [16, 48, 128]

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
ICONS_DIR = PROJECT_ROOT / "assets" / "icons"
SVG_FILE = ICONS_DIR / "icon.svg"


def check_sharp_installed():
    """Check if sharp is installed, install if not."""
    result = subprocess.run(
        ["npm", "list", "sharp"],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        shell=True
    )
    if "sharp" not in result.stdout:
        print("Installing sharp...")
        subprocess.run(
            ["npm", "install", "--save-dev", "sharp"],
            cwd=PROJECT_ROOT,
            shell=True
        )


def convert_svg_to_png():
    """Convert SVG icon to PNG files using Node.js sharp."""
    if not SVG_FILE.exists():
        print(f"Error: SVG file not found: {SVG_FILE}")
        return False

    check_sharp_installed()
    
    print(f"Converting: {SVG_FILE}")
    
    # Node.js inline script for conversion
    node_script = f"""
const sharp = require('sharp');
const sizes = {SIZES};
const svgPath = '{SVG_FILE.as_posix()}';
const outputDir = '{ICONS_DIR.as_posix()}';

(async () => {{
    for (const size of sizes) {{
        const outputPath = outputDir + '/icon' + size + '.png';
        await sharp(svgPath)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        console.log('  Created: icon' + size + '.png (' + size + 'x' + size + ')');
    }}
    console.log('Done!');
}})();
"""
    
    result = subprocess.run(
        ["node", "-e", node_script],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        shell=True
    )
    
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return False
    
    print(result.stdout)
    return True


if __name__ == "__main__":
    convert_svg_to_png()
