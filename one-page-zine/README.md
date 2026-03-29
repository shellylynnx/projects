# One Page Zine

A browser-based tool for creating a one-page zine. Upload 8 images and download a print-ready file.

---

## How to Use

### 1. Open the website
Open `index.html` in your browser. No installation or internet connection required (except for the PDF download feature).

### 2. Upload your 8 pages
The grid shows 8 slots arranged in a 4×2 layout, each labeled with its zine page position:

| Page 6 | Page 5 | Page 4 | Page 3 |
|--------|--------|--------|--------|
| Back Cover | Front Cover | Page 1 | Page 2 |

- **Click** any slot to open a file picker
- **Drag and drop** an image directly onto a slot
- Accepted formats: **JPG, PNG, GIF**
- To replace or remove an image, click the **×** button in the top-right corner of the slot

> **Note:** Pages 6, 5, 4, and 3 (the top row) are automatically rotated 180° — this is intentional for the zine fold.

### 3. Download your zine
Once all 8 slots are filled, two download buttons will become active:

- **Download Zine PDF** — exports a landscape 11" × 8.5" PDF, ready to print. Requires an internet connection to load the PDF library.
- **Download Zine Image** — exports a `zine.png` image at 150 DPI. Works fully offline.

### 4. Print and fold
Print the downloaded file on a single sheet of 8.5" × 11" paper, then fold and cut to assemble your zine.

---

## File Structure

```
one-page-zine/
├── index.html               — page structure
├── scripts/
│   ├── app.js               — entry point, initializes all modules
│   ├── grid.js              — grid slot creation, drag-and-drop, slot interactions
│   ├── files.js             — file validation, image loading, format/size checks
│   ├── canvas.js            — canvas compositing, rotation, PNG/PDF export
│   ├── storage.js           — localStorage persistence for uploaded images
│   └── ui.js                — toast notifications, button states, download triggers
├── styles/
│   └── style.css            — all styling (~277 lines)
├── tests/
│   └── test.html            — browser-based test suite
└── README.md
```

## Architecture

The application is split into focused modules:

| Module | Responsibility |
|--------|---------------|
| `app.js` | Entry point — initializes grid, restores saved state, wires up download buttons |
| `grid.js` | Creates the 8-slot grid, handles click-to-upload, drag-and-drop, and slot remove buttons |
| `files.js` | Validates file type (JPG/PNG/GIF) and size, reads files as data URLs, handles corrupted images |
| `canvas.js` | Composites all 8 images onto an offscreen canvas with 180° rotation for top row, exports as PNG or PDF |
| `storage.js` | Saves/restores uploaded images to localStorage so work persists across page reloads |
| `ui.js` | Toast notification system, download button enable/disable, and loading states |

### Toast Notifications

User-facing messages (invalid file type, file too large, corrupted image, PDF generation failure, "All images cleared") surface via non-blocking toast notifications that auto-dismiss. Respects `prefers-reduced-motion`.

### Persistence

Uploaded images are saved to `localStorage` as data URLs. When you reopen the page, your previous images are automatically restored. Use the "Clear All" button to remove saved state.

## Testing

Open `tests/test.html` in a browser to run the test suite. Tests cover file validation, grid interactions, canvas rendering, and storage persistence.
