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
├── index.html   — page structure
├── style.css    — styles and layout
├── script.js    — upload logic and canvas rendering
└── README.md    — this file
```
