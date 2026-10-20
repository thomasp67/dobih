# Database of British and Irish Hills (DoBIH)

A high-performance, single-page web application and photo management system designed to catalog, filter, search, map, and view photographs for over 20,000 summits across the British Isles (Scotland, England, Wales, Ireland, and the Isle of Man).

---

## 1. Architectural Highlights

- **Zero Server-Side Runtime (Main Catalog)**: The main hill browser runs entirely in the browser using static HTML5, modern CSS3, and vanilla ES6+ JavaScript. It can be hosted on any static web server (Apache, Nginx, IIS, GitHub Pages, or local development servers).
- **High Performance at Scale**: Smoothly processes 20,000+ summit records via in-memory pre-indexing, debounced event listeners, virtualized infinite scrolling (batch size: 50), and Canvas-based Leaflet map rendering with spatial viewport clipping.
- **Deep DoBIH Classification Coverage**: Comprehensive categorization covering Munros, Munro Tops, Corbetts, Grahams, Donalds, Wainwrights, Hewitts, Marilyns, Simms, Tumps, County Tops, deleted/demoted lists (`ex-`), and more.
- **Integrated Topographic Mapping**: Embedded Leaflet map supporting OpenTopoMap contour relief, Esri World Imagery (satellite), and standard OpenStreetMap tiles, complete with custom fullscreen and recentre controls.
- **Dedicated Photos Management Workbench (`photos.html`)**: An integrated photo curation and processing studio providing 16:9 horizon-straightening/cropping (with strict minimum 1600×900 original crop boundary constraint), color grading, Windows Explorer EXIF Comments/Tags integration, multi-summit categorization (Primary, Secondary, Taken From), and lossless original archiving.

---

## 2. Directory & File Structure

```
dobih/
│
├── [PUBLIC / STATIC HOSTING ASSETS]   # Deployed to web hosting (100% static HTML, CSS, JS, JSON, images)
│   ├── index.html                     # Main hill catalog entry point and UI markup
│   ├── style.css                      # Main stylesheet (dark theme, responsive grid, CSS tokens)
│   ├── script.js                      # Main client engine (filtering, sorting, mapping, photo display)
│   ├── dobih.json                     # Precompiled DoBIH dataset (~20,000 summits)
│   ├── README.md                      # Complete project documentation and specifications
│   │
│   └── image/
│       └── hills/                     # Active 1600x900 cropped live photos for the website
│           ├── *.jpg                  # Production-optimized 16:9 images
│           └── photos.json            # Authoritative manifest mapping hill IDs to photos, roles, and captions
│
└── admin/                             # LOCAL ADMIN & DATA PREPARATION (Excluded from hosting upload)
    ├── index.html / photos.html       # Photo curation studio & data preparation workbench
    ├── photos.css                     # Workbench stylesheet
    ├── photos.js                      # Workbench controller & dataset compiler client
    │
    ├── api/
    │   └── photos.php                 # PHP backend API (staging queue, crop dispatch, live/archive meta, data compile)
    │
    ├── vendor/
    │   ├── cropper.min.css            # Cropper.js library stylesheet
    │   └── cropper.min.js             # Cropper.js image cropping library
    │
    ├── csv/
    │   ├── DoBIH_v18_5.csv            # Source DoBIH CSV release (source of truth)
    │   └── convert_csv_to_json.ps1    # PowerShell script converting CSV to streamlined UTF-8 non-BOM JSON
    │
    ├── scripts/
    │   ├── process_crop.ps1           # Worker script: EXIF orientation, crop, resample, EXIF metadata, photos.json
    │   └── optimize_photos.ps1        # Batch optimizer utility for bulk folder processing
    │
    └── staging/
        ├── *.jpg                      # Landing queue for raw camera/phone photos
        └── archive/                   # Permanent archive of original uncropped master photos
```

---

## 3. Data Pipeline & Schema

### 3.1 Source Dataset
The application is grounded in the **Database of British and Irish Hills (DoBIH)** v18.5 release. The dataset contains ~20,000 rows with over 100 columns covering elevations, coordinates, British National Grid (BNG) references, Irish Grid references, administrative counties, and binary flag columns for list memberships (`'1'` indicates membership).

### 3.2 CSV to JSON Conversion (`convert_csv_to_json.ps1`)
To ensure optimal client performance and minimal download size:
1. **Memory-Efficient Streaming**: Uses `[System.IO.StreamWriter]` to stream JSON records directly to disk row-by-row, avoiding memory pressure in PowerShell.
2. **UTF-8 Without BOM**: Outputs pure UTF-8 without Byte Order Marks (`[System.Text.UTF8Encoding]::new($false)`).
3. **Payload Pruning**: Null or empty attributes are omitted. External URLs (Google Maps, PeakFinder, Hill Bagging, MountainViews, Geograph, Streetmap) are generated dynamically at runtime from hill numbers and coordinates.
4. **Binary Flag Aggregation**: Over 60 individual binary classification columns (`M`, `C`, `G`, `W`, `Ma`, etc.) are aggregated into a compact `categories` dictionary.

### 3.3 `dobih.json` Record Schema
```json
{
  "number": 278,
  "name": "Ben Nevis",
  "country": "S",
  "feature": "cairn 20m NNE of trig point",
  "observations": "highest point is 0.09m above trig point benchmark",
  "survey": "1344.53m 2016",
  "administrative": {
    "county": "Highland",
    "section": "Loch Linnhe to Loch Ericht",
    "sectionNum": "04A",
    "topoSection": "Fort William to Loch Treig",
    "area": "Fort William to Loch Treig"
  },
  "location": {
    "gridRef": "NN166712",
    "gridRef10": "NN 16653 71279",
    "gridRefXY": "NN1665371279",
    "latitude": 56.79685,
    "longitude": -5.00351,
    "xCoord": 216653,
    "yCoord": 771279
  },
  "elevation": {
    "metres": 1344.5,
    "feet": 4411,
    "dropMetres": 1344.5,
    "colHeight": 0.0,
    "colGridRef": "Sea level"
  },
  "maps": {
    "map1_50k": "41",
    "map1_25k": "392"
  },
  "parent": {
    "smcId": 1,
    "marilynId": 278
  },
  "categories": {
    "Ma": true,
    "Hu": true,
    "Tu": true,
    "Sim": true,
    "M": true,
    "Hew": true,
    "CoH": true,
    "CoU": true,
    "CoA": true,
    "T100": true,
    "HHB": true
  }
}
```

### 3.4 Client-Side Normalization (`script.js`)
When loaded into the browser:
- **Bracket Parsing for Alternate Names**: Summit names with bracketed local or Gaelic names (e.g. `"Ben More [Mull]"`) are cleanly split into `name: "Ben More"` and `altName: "Mull"`.
- **Pre-Computed Search Index**: A lowercase string `_search` is constructed: `${name} ${altName} ${number} ${county} ${feature}` for rapid substring evaluation.

---

## 4. Photo Management & Workflow

### 4.1 Standardized Filename Convention
Camera and phone photos follow the standardized format:
```
YYYYMMDD_HHMMSS_<crc32> <area or trip destination>.jpg
```
Example: `20090403_112229_620e8e54 buachaille etive mor.jpg`

- **Date & Time (`20090403_112229`)**: Date and time the photograph was captured.
- **CRC32 Checksum (`620e8e54`)**: 8-hex character checksum uniquely identifying the image master.
- **Trip Destination (`buachaille etive mor`)**: Original hike destination/area, preserved for context when saving live photos.

### 4.2 Interactive Photos App (`photos.html`)
The photos workbench is structured into **three main areas** unified by the **CRC32 hash**:

1. **📥 Staging Area (`image/staging/`)**:
   - Landing area for uncurated photos.
   - **Processed to Live**: Cropped to 16:9 (with strict minimum 1600×900 original crop box constraint), horizon leveled, color tuned, tagged with categorized summits (Primary, Secondary, Taken From), captioned, saved under its **original trip filename** (normalized to `.jpg`) into `image/hills/`, and registered in `photos.json`. The original high-res master is moved into `image/staging/archive/`.
   - **Archive**: Moves uncurated photos directly into `image/staging/archive/` without publishing to the site.
   - Status indicators actively show if a photo's CRC32 is already live on site or already in the archive.

2. **🌐 Live Area (`image/hills/`)**:
   - Displays all active photos published to the website (saved under original trip filenames, e.g. `20090403_112229_620e8e54 buachaille etive mor.jpg`, with backwards compatibility for `<crc32>.jpg` and `<hillId>_001.jpg`).
   - Deeply linked via CRC32 to original files in `image/staging/archive/`.
   - Displays associated summits (Primary, Secondary, Taken From) and captions.
   - Features: **Full Size** preview, **Metadata** editing modal directly updating `photos.json`, **Edit** in Staging workbench, and one-click **Remove** from live.

3. **🗄️ Archived Area (`image/staging/archive/`)**:
   - Stores all high-resolution master originals.
   - Filterable by **All**, **Live**, or **Archived Only**.
   - Features: **Full Size** preview, one-click **Edit** to load master photo into Staging workbench for cropping, and permanent **Delete**.

### 4.3 Manifest Schema (`image/hills/photos.json`)
```json
{
  "196": [
    {
      "file": "20090403_112229_620e8e54 buachaille etive mor.jpg",
      "title": "Stob Dearg",
      "role": "primary"
    },
    {
      "file": "20090710_131119_fd3cdbdc bidean nam bian, stob coire sgreamhach.jpg",
      "title": "Stob Dearg from Bidean nam Bian",
      "role": "secondary"
    }
  ],
  "32": [
    {
      "file": "20070823_164018_b7c4ab51 ben lomond.jpg",
      "title": "View from Ben Lomond summit",
      "role": "from"
    }
  ]
}
```

### 4.4 Summit Categorization Roles
- **Primary (`role: "primary"`)**: The summit is the main subject of the photograph. Listed in the summit's **"Photos of"** tab with top display priority.
- **Secondary (`role: "secondary"`)**: The summit is visible in the background or ridgeline. Listed in the summit's **"Photos of"** tab after primary photos.
- **Taken From (`role: "from"`)**: The photograph was taken from this summit looking outward. Listed under the summit's dedicated **"Taken from"** tab.

---

## 5. Main Catalog User Interface & Features

### 5.1 Dark Design System
The application utilizes a dark theme palette (`style.css`):
- Background: `#0f172a` (Slate 900)
- Cards & Drawers: `#1e293b` (Slate 800)
- Inputs & Controls: `#334155` (Slate 700)
- Accent: `#10b981` (Emerald 500)
- Text: `#f8fafc` (Slate 50) and `#94a3b8` (Slate 400)

### 5.2 Sticky Header & Search
- **Live Search**: Debounced full-text search across summit names, alternate/Gaelic names, DoBIH numbers, counties, and features. Supports multi-term queries with `OR` or `|` operators.
- **State-Preserving Search & Deletion**: Modifying or clearing search text keeps the currently opened summit drawer (and active map/photo tab) open and in view as long as the selected summit is part of the updated results.
- **Sort Options**: Height (Highest First / Lowest First), Prominence / Drop, Name (A-Z), and DoBIH Database Number.

### 5.3 Filter Panel
- **Matching Mode Toggle**: Switch between **OR** (matches any criterion) and **AND** (must satisfy all active criteria).
- **Country Chips**: Scotland (`S`), England (`E`), Wales (`W`), Ireland (`I`), Isle of Man (`M`).
- **Major Classification Chips**: Munros, Corbetts, Grahams, Donalds, Wainwrights, Hewitts, Marilyns, Simms, Tumps, deleted lists (`xMT`, `xC`, `xG`), and more.
- **Other Lists**: Trail 100, High Hills of Britain, Birketts, County Tops, 100m Tump elevation bands, and **Has Photos** (`Ph`).
- **Detailed Form Filters**: Dynamic area dropdown, minimum height (m), and minimum prominence drop (m).

### 5.4 Inline Summit Drawer (70% Media / 30% Details Split)
Clicking any table row expands an inline drawer:
- **Left Section (70%)**:
  - **Top Row**: Summit carousel controls (`◀ Prev`, `N / Total`, `Next ▶`), Background Map Pins mode (`None`, `Filtered`, `All`), and dynamic external links (Google Maps, PeakFinder, Hill Bagging, MountainViews, Geograph, Streetmap).
  - **16:9 Media Display**: Renders Leaflet Map or Summit Photo.
  - **Bottom Bar**: View toggle tabs (`[ Map ]`, `[ Photos of ]`, `[ Taken from ]`), centered photo caption, and photo navigation controls.
- **Right Section (30%)**:
  - Comprehensive summit metadata: alternate names, area, drop, parent hill, grid references, coordinates, and Ordnance Survey map sheets (with shop links).
  - Notes list: DoBIH number, non-major list badges, summit features, observations, and survey records.

---

## 6. Leaflet Map System

### 6.1 Tile Providers
1. **OpenTopoMap** (`https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png`): Contours and elevation hillshading.
2. **Esri World Imagery** (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`): Satellite imagery.
3. **OpenStreetMap** (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`): Standard cartographic street map.

### 6.2 Custom Controls & Performance
- **Fullscreen Mode (`⛶`)**: Expands map to full viewport (`100vw × 100vh`). Pressing `Escape` exits fullscreen.
- **Recentre (`🎯`)**: Instantly re-centers on the selected summit coordinate at zoom level 13.
- **Canvas Background Pins & Spatial Viewport Clipping**: Uses `L.canvas({ padding: 0.5 })` and viewport bounds padding (`leafletMap.getBounds().pad(0.3)`) to maintain 60 FPS performance when displaying thousands of surrounding summits.

---

## 7. Keyboard Shortcuts

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `ArrowLeft` | Summit Drawer Open | Navigate to Previous hill in list |
| `ArrowRight` | Summit Drawer Open | Navigate to Next hill in list |
| `Escape` | Map in Fullscreen | Exit fullscreen map mode |
| `Escape` | Summit Drawer Open | Close summit drawer |
| `Enter` | Search or Filter Input | Apply filter immediately |

---

## 8. Setup & Reproduction Guide

### Prerequisites
- A local web server (PHP 7.4+ enabled for admin data preparation & photo workflow; any static web server for catalog viewing).
- PowerShell 5.1+ / PowerShell Core (for CSV conversion and photo processing scripts).

### Quick Start
1. **Clone or place files** into your web root directory (e.g. `C:\home\htdocs\dobih\`).
2. **Generate Database**:
   - Via Admin Web Interface: Navigate to `http://localhost/dobih/admin/` and click **Data Prep** -> **Rebuild dobih.json**.
   - OR via PowerShell:
     ```powershell
     cd admin/csv
     pwsh ./convert_csv_to_json.ps1
     ```
     *(Automatically streams and copies the updated dataset to `dobih.json`)*
3. **Access the Applications**:
   - **Main Hill Catalog (Static Website)**: `http://localhost/dobih/index.html`
   - **Admin & Photo Workbench**: `http://localhost/dobih/admin/`

### Deploying to Web Hosting
When publishing the site to remote web hosting (e.g., Apache, Nginx, GitHub Pages, Netlify, or static S3 bucket):
- **Include**:
  - `index.html`
  - `style.css`
  - `script.js`
  - `dobih.json`
  - `image/hills/` (live cropped 16:9 images and `photos.json`)
- **Exclude**:
  - `admin/` (completely excluded from upload)
