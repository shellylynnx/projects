# Riso Preview

Preview artwork in risograph ink colors and simulate overprint. Upload an image, assign up to three ink layers, and see how they combine with multiply blending, the same way riso ink layers interact on paper.

## Features

- **3 ink layers**: choose from 23 standard risograph ink colors per layer
- **Multiply-blend overprint**: simulates how layered riso inks combine on paper
- **Mask painting**: brush, eraser, and magic wand tools to assign areas of the image to individual layers for color separation
- **Magic wand** with tolerance, contiguous mode, and live hover preview
- **Color layer preview**: toggle per-layer ink color overlays on the source image
- **B&W plate export**: download grayscale separation plates (black = ink, white = paper) for each layer, ready for riso printing
- **Color layer export**: download individual color layers or the combined overprint as PNG
- **Mobile & tablet friendly**: responsive layout with touch support

## How It Works

1. Upload a JPEG, PNG, or GIF image (max 10 MB)
2. Pick ink colors for each layer using the swatch grids
3. Optionally enable masks to paint color separations. Assign different areas of the image to different layers.
4. Preview individual layers and the overprint composite
5. Download color layers, overprint, or B&W plates

## Project Structure

```
riso-preview/
  index.html          # Single-page app markup
  styles/style.css    # All styles
  scripts/
    app.js            # Main application logic, mask painting, UI wiring
    engine.js         # Riso color processing & multiply-blend overprint
    colors.js         # 23 risograph ink color definitions
    ui.js             # Toast notification helper
```

## Running Locally

Serve the directory with any static HTTP server:

```sh
npx serve .
```

Then open `http://localhost:3000` in a browser. No build step required.

## Ink Colors

23 standard risograph ink colors: Black, Burgundy, Blue, Green, Medium Blue, Federal Blue, Teal, Flat Gold, Hunter Green, Red, Scarlet, Fl. Pink, Fl. Orange, Yellow, Orange, Purple, Violet, Aqua, Mint, Light Teal, Coral, Brick, and Risofederal Blue.

Colors are approximate screen representations. Actual print results will vary.

## Built With

- Vanilla JavaScript (ES modules), HTML, CSS. No frameworks or build tools.
- Canvas API for pixel-level image processing

## References

- Ink color RGB values sourced from [Stencil](https://stencil.wiki/colors) riso ink swatch references
- Overprint simulation uses multiply blending, matching how risograph ink layers physically combine on paper
