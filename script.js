/**
 * ============================================================================
 * Database of British and Irish Hills (DoBIH) - Core Client Script
 * ============================================================================
 * 
 * This script powers the interactive hill database web application:
 * 1. Data Normalization & Ingestion:
 *    - Parses `dobih.json` into a fast, normalized in-memory model.
 *    - Pre-indexes names, numbers, counties, and features for high-speed searching.
 * 2. Search & Filtering Engine:
 *    - Multi-keyword search supporting space-separated terms, pipe (|), and OR syntax.
 *    - Multi-criteria filtering: Country, Major Lists, Other Lists, Area, Height, Drop.
 *    - Configurable matching modes: OR (union) vs AND (intersection).
 * 3. Responsive Data Table & Virtual Infinite Scrolling:
 *    - Fast DOM rendering in batches of 50 items.
 *    - Dynamic classification badge pills with customized category colors.
 * 4. Inline Drawer Expansion:
 *    - Two-column responsive split (70% left media column / 30% right details column).
 *    - Top toolbar: Carousel Prev/Next, pin mode selector, dynamic external links.
 * 5. Interactive Leaflet Map:
 *    - Topographic relief, satellite imagery, and standard OpenStreetMap base layers.
 *    - High-performance canvas-rendered background pins clipped to current viewport.
 *    - Fullscreen mode and one-click recentre controls.
 * 6. Photo Management & Binary EXIF / Metadata Parser:
 *    - Loads pre-compiled `photos.json` manifest.
 *    - Binary client-side parser to read JPEG comment/XPComment metadata directly.
 *    - Multi-photo carousel with numeric suffix prioritization (_001 before tagged).
 * 7. Keyboard Navigation & Accessibility:
 *    - Arrow Left / Right to traverse summits, Escape to close drawer or exit fullscreen.
 * ============================================================================
 */

/* ============================================================================
   1. UTILITY FUNCTIONS
   ============================================================================ */

/**
 * Reusable debounce helper.
 * Delays invoking `fn` until after `wait` milliseconds have elapsed since
 * the last time the debounced function was invoked. Used on search and numeric
 * input fields to prevent expensive filter recalculations on every keystroke.
 * 
 * @param {Function} fn - The function to debounce.
 * @param {number} wait - Debounce delay in milliseconds (default: 180ms).
 * @returns {Function} Debounced wrapper function.
 */
function debounce(fn, wait = 180) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ============================================================================
   2. GLOBAL APPLICATION STATE
   ============================================================================ */

/** @type {Array<Object>} All loaded hills from dobih.json in normalized form */
let allHills = [];

/** @type {Array<Object>} Subset of hills matching active search, filters, and sort */
let filteredHills = [];

/** @type {number} Current number of rows rendered in the table (for infinite scroll) */
let displayedCount = 50;

/** @type {number} Number of rows added per scroll increment */
const batchSize = 50;

/** @type {Set<string>} Active classification list codes (e.g. 'M', 'C', 'G') */
let activeLists = new Set();

/** @type {Set<string>} Active country codes (e.g. 'S', 'E', 'W', 'I', 'M') */
let activeCountries = new Set();

/** @type {string} Active filter combination mode: 'OR' (any match) or 'AND' (all match) */
let matchMode = 'OR';

/** @type {string} Map pin display mode: 'none' (active only), 'filtered', or 'all' */
let mapPinMode = 'filtered';

/** @type {number} Index in filteredHills of the currently expanded hill (-1 if none) */
let currentSelectedIndex = -1;

/** @type {string|number|null} Database number of currently expanded hill to preserve selection */
let currentlyLoadedHillNumber = null;

/** @type {Set<string>} Set of hill numbers confirmed to possess photos */
let knownPhotos = new Set();

/* Leaflet Map State */
/** @type {L.Map|null} Leaflet map instance */
let leafletMap = null;

/** @type {L.Marker|null} Prominent marker pinned at the selected hill's summit */
let activeMarker = null;

/** @type {L.LayerGroup|null} Leaflet layer group holding background canvas circle pins */
let canvasLayerGroup = null;

/** @type {L.Canvas|null} High-performance canvas renderer for background map pins */
let canvasRenderer = null;

/* ============================================================================
   3. CLASSIFICATION DICTIONARIES & METADATA CONFIGURATION
   ============================================================================ */

/**
 * Mapping of classification short codes to friendly display names.
 */
const CLASSIFICATION_MAP = {
  'M': 'Munro',
  'MT': 'Munro Top',
  'C': 'Corbett',
  'G': 'Graham',
  'D': 'Donald',
  'DT': 'Donald Top',
  'Mur': 'Murdo',
  'HF': 'Highland Five',
  'GT': 'Graham Top',
  'xMT': 'Deleted Munro Top',
  'xC': 'Deleted Corbett',
  'xG': 'Deleted Graham',
  'xN': 'Deleted Nuttall',
  'xDT': 'Deleted Donald Top',
  'F': 'Furth',
  'Hew': 'Hewitt',
  'N': 'Nuttall',
  'W': 'Wainwright',
  'WO': 'Wainwright Outlying Fell',
  'B': 'Birkett',
  'Sy': 'Synge',
  'Fel': 'Fellranger',
  'Dew': 'Dewey',
  'DDew': 'Donald Dewey',
  'E': 'Ethel',
  'A': 'Arderin',
  'VL': 'Vandeleur-Lynam',
  'Dil': 'Dillon',
  'Ca': 'Carn',
  'Bin': 'Binnions',
  'Ma': 'Marilyn',
  'Hu': 'Hump',
  'Sim': 'Simm',
  'Tu': 'Tump',
  '5': 'Dodd',
  'T100': 'Trail 100',
  'HHB': 'High Hill of Britain',
  'CoH': 'Historic County Top',
  'CoA': 'Admin County Top',
  'CoU': 'Current County / Unitary Top',
  'CoL': 'London Borough Top',
  'SIB': 'Significant Islands of Britain',
  '4': '400-499m Tump',
  '3': '300-399m Tump',
  '2': '200-299m Tump',
  '1': '100-199m Tump',
  '0': '0-99m Tump',
  'sMa': 'Sub-Marilyn',
  'sHu': 'Sub-Hump',
  'sSim': 'Sub-Simm',
  's5': 'Sub-Dodd',
  's4': 'Sub-400m Tump',
  'CT': 'Current Top',
  'BL': 'Buxton & Lewis',
  'Bg': 'Bridge',
  'Y': 'Yeaman',
  'Cm': 'Clem',
  'Un': 'Unclassified hills',
  'O': 'Other miscellaneous lists',
  'Ph': 'Has Photos'
};

/**
 * Detailed descriptions and qualification criteria for tooltips.
 */
const CLASSIFICATION_DESCRIPTIONS = {
  'M': 'Munro (Scottish mountains 3,000 ft)',
  'MT': 'Munro Top (Subsidiary summits of Munros 3,000 ft)',
  'C': 'Corbett (Scottish hills 2,500-3,000 ft with 500 ft drop)',
  'G': 'Graham (Scottish hills 2,000-2,500 ft with 150 m drop)',
  'D': 'Donald (Hills over 2,000 ft in the Scottish Lowlands with specified criteria)',
  'DT': 'Donald Top (Subsidiary summits of Donalds in the Scottish Lowlands)',
  'Mur': 'Murdo (Scottish hills over 3,000 ft with 30 m drop)',
  'HF': 'Highland Five (Scottish Highlands hills between 500m-609m with 30m drop)',
  'GT': 'Graham Top (Subsidiary summits of Grahams)',
  'xMT': 'Deleted Munro Top (Demoted or removed former Munro Tops)',
  'xC': 'Deleted Corbett (Former Corbetts)',
  'xG': 'Deleted Graham (Former Grahams)',
  'xN': 'Deleted Nuttall (Former Nuttalls)',
  'xDT': 'Deleted Donald Top',
  'F': 'Furth (Mountains in England, Wales, and Ireland over 3,000 ft with 30m drop)',
  'Hew': 'Hewitt (Hills in England, Wales, and Ireland over 2,000 ft with 30m drop)',
  'N': 'Nuttall (Hills in England and Wales over 2,000 ft with 15m drop)',
  'W': 'Wainwright (The 214 classic Lake District fells by Alfred Wainwright)',
  'WO': 'Wainwright Outlying Fell (Additional 116 outlying fells in the Lake District)',
  'Dew': 'Dewey (Hills in England, Wales, and Isle of Man between 500m-610m with 30m drop)',
  'DDew': 'Donald Dewey (Scottish Lowlands hills between 500m-609m with 30m drop)',
  'E': 'Ethel (Hills in the Peak District over 400m named after Ethel Haythornthwaite)',
  'A': 'Arderin (Irish mountains above 500m with 30m drop)',
  'VL': 'Vandeleur-Lynam (Irish hills over 600m with 15m drop)',
  'Dil': 'Dillon (Irish hills over 2,000 ft from Paddy Dillon\'s guidebook)',
  'Ca': 'Carn (Irish summits between 100m-400m with 30m drop)',
  'Bin': 'Binnion (Irish coastal and regional summits)',
  'Ma': 'Marilyn (British and Irish hills with 150m drop regardless of height)',
  'Hu': 'Hump (Hills of any height with 100m drop)',
  'Sim': 'Simm (Hills of any height with 30m drop)',
  'Tu': 'Tump (Thirty & Upward Metre Prominences-all British hills with 30m drop)',
  '5': 'Dodd (Hills between 500m-599m with 30m drop)',
  'T100': 'Trail 100 (Curated list of 100 iconic British mountain summits)',
  'HHB': 'High Hills of Britain (Major prominent summits across the UK)',
  'B': 'Birkett (Lake District hills over 1,000 ft by Bill Birkett)',
  'Sy': 'Synge (Hills in Ireland compiled by Tom Synge)',
  'Fel': 'Fellranger (Regional hill classifications by Mark Richards)',
  'CoH': 'Historic County Top (Pre-1974 historic county high points)',
  'CoA': 'Admin County Top (1974-1990s administrative county high points)',
  'CoU': 'Current County / Unitary Top (Current county/unitary authority high points)',
  'CoL': 'London Borough Top (Highest points of London boroughs)',
  'SIB': 'Significant Islands of Britain (Prominent islands across British waters)',
  '4': '400-499m Tump',
  '3': '300-399m Tump',
  '2': '200-299m Tump',
  '1': '100-199m Tump',
  '0': '0-99m Tump',
  'sMa': 'Sub-Marilyn (Marilyns just short of 150m drop, 140m-149m)',
  'sHu': 'Sub-Hump (Humps just short of 100m drop, 90m-99m)',
  'sSim': 'Sub-Simm (Simms just short of 30m drop, 20m-29m)',
  's5': 'Sub-Dodd',
  's4': 'Sub-400m Tump',
  'CT': 'Current Top',
  'BL': 'Buxton & Lewis',
  'Bg': 'Bridge',
  'Y': 'Yeaman',
  'Cm': 'Clem',
  'Un': 'Unclassified hills',
  'O': 'Other miscellaneous lists',
  'Ph': 'Has Photos'
};

/**
 * Styling configuration for major classifications.
 * Defines the distinctive color theme for each category's table badge and map pin.
 */
const MAJOR_CATEGORIES_CONFIG = [
  { code: 'M', name: 'Munro', color: '#34d399' },
  { code: 'MT', name: 'Munro Top', color: '#facc15' },
  { code: 'C', name: 'Corbett', color: '#60a5fa' },
  { code: 'G', name: 'Graham', color: '#fbbf24' },
  { code: 'D', name: 'Donald', color: '#a78bfa' },
  { code: 'DT', name: 'Donald Top', color: '#c084fc' },
  { code: 'Mur', name: 'Murdo', color: '#06b6d4' },
  { code: 'HF', name: 'Highland Five', color: '#22d3ee' },
  { code: 'GT', name: 'Graham Top', color: '#fbbf24' },
  { code: 'F', name: 'Furth', color: '#f87171' },
  { code: 'Hew', name: 'Hewitt', color: '#2dd4bf' },
  { code: 'N', name: 'Nuttall', color: '#fb923c' },
  { code: 'W', name: 'Wainwright', color: '#38bdf8' },
  { code: 'WO', name: 'Wainwright Outlying', color: '#818cf8' },
  { code: 'Dew', name: 'Dewey', color: '#a3e635' },
  { code: 'DDew', name: 'Donald Dewey', color: '#4ade80' },
  { code: 'E', name: 'Ethel', color: '#fbbf24' },
  { code: 'A', name: 'Arderin', color: '#34d399' },
  { code: 'VL', name: 'Vandeleur-Lynam', color: '#60a5fa' },
  { code: 'Dil', name: 'Dillon', color: '#a78bfa' },
  { code: 'Ca', name: 'Carn', color: '#f472b6' },
  { code: 'Bin', name: 'Binnion', color: '#38bdf8' },
  { code: 'Ma', name: 'Marilyn', color: '#f472b6' },
  { code: 'Hu', name: 'Hump', color: '#818cf8' },
  { code: 'Sim', name: 'Simm', color: '#fb7185' },
  { code: 'Tu', name: 'Tump', color: '#38bdf8' },
  { code: '5', name: 'Dodd', color: '#f43f5e' },
  { code: 'xMT', name: 'Deleted Munro Top', color: '#facc15' },
  { code: 'xC', name: 'Deleted Corbett', color: '#60a5fa' },
  { code: 'xG', name: 'Deleted Graham', color: '#fbbf24' },
  { code: 'xN', name: 'Deleted Nuttall', color: '#fb923c' },
  { code: 'xDT', name: 'Deleted Donald Top', color: '#c084fc' }
];

/** Fast Map lookup for category metadata by short code */
const MAJOR_CATEGORIES_MAP = new Map(MAJOR_CATEGORIES_CONFIG.map(c => [c.code, c]));

/**
 * Returns the descriptive explanation for a given category code or name.
 * 
 * @param {string} codeOrName - Classification code (e.g. 'M') or display name.
 * @returns {string} Explanatory description.
 */
function getCodeDescription(codeOrName) {
  if (CLASSIFICATION_DESCRIPTIONS[codeOrName]) return CLASSIFICATION_DESCRIPTIONS[codeOrName];
  for (let key in CLASSIFICATION_MAP) {
    if (CLASSIFICATION_MAP[key] === codeOrName && CLASSIFICATION_DESCRIPTIONS[key]) {
      return CLASSIFICATION_DESCRIPTIONS[key];
    }
  }
  return codeOrName;
}

/* ============================================================================
   4. UI STATE TOGGLES & BADGES
   ============================================================================ */

/**
 * Toggles the collapsible filter options panel open or closed.
 */
function toggleOptionsPanel() {
  const panel = document.getElementById('options-panel');
  panel.classList.toggle('open');
}

/**
 * Computes and updates the active filter count badge on the "Filters" button.
 * If active filters > 0, shows badge (e.g. "3 active"), otherwise hides it.
 */
function updateActiveBadge() {
  let count = activeCountries.size + activeLists.size;
  if (document.getElementById('filter-county').value) count++;
  if (document.getElementById('filter-min-height').value) count++;
  if (document.getElementById('filter-min-drop').value) count++;

  const badge = document.getElementById('accordion-active-badge');
  if (count > 0) {
    badge.textContent = `${count} active`;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

/* ============================================================================
   5. DATA NORMALIZATION & INGESTION
   ============================================================================ */

/**
 * Parses a comma-separated string of counties into a clean array of strings.
 * 
 * @param {string} raw - Comma-delimited county string (e.g. "Highland, Perth and Kinross").
 * @returns {Array<string>} Array of individual trimmed county names.
 */
function parseCounties(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Normalizes an individual raw hill object from dobih.json into a consistent client schema.
 * - Extracts alternate names from brackets (e.g. "Ben More [Mull]" -> name: "Ben More", altName: "Mull").
 * - Parses elevation numbers (metres, feet, drop/prominence).
 * - Extracts coordinates and OS grid references.
 * - Resolves classification tokens and category flags.
 * - Pre-computes a lowercase search index (`_search`) for high-speed multi-field queries.
 * 
 * @param {Object} item - Raw JSON object from dobih.json.
 * @returns {Object} Normalized hill record.
 */
function normalize(item) {
  const num = item.number ?? item.Number ?? item.id ?? item.ID ?? item.DOBIH ?? item.Dobih ?? '';
  const rawHillName = String(item.name ?? item.Name ?? item.hill ?? item.Hill ?? 'Unnamed').trim();
  
  // Extract alternate name from square brackets if present
  let hillName = rawHillName;
  let altName = item.alternateName ?? item.altName ?? '';
  if (rawHillName.includes('[') || rawHillName.includes(']')) {
    const matches = [...rawHillName.matchAll(/\[(.*?)\]/g)].map(m => m[1].replace(/[\[\]]/g, '').trim()).filter(Boolean);
    if (matches.length > 0 && !altName) {
      altName = matches.join(', ');
    }
    hillName = rawHillName.replace(/\s*\[.*?\]+/g, '').replace(/[\[\]]/g, '').trim();
  }

  const countryVal = item.country ?? item.Country ?? item.COUNTRY ?? '';

  const admin = item.administrative || item.Admin || item.ADMIN || {};
  const countyVal = admin.county ?? item.County ?? item.county ?? admin.County ?? item.AREA ?? item.Area ?? '';

  const elev = item.elevation || item.Elevation || item.ELEVATION || {};
  const metresVal = elev.metres ?? item.Metres ?? item.metres ?? elev.Metres ?? item.HEIGHT ?? item.Height ?? null;
  const dropVal = elev.dropMetres ?? elev.drop ?? item.Drop ?? item.drop ?? elev.DropMetres ?? item.DROP ?? null;
  const feetVal = elev.feet ?? item.Feet ?? item.feet ?? elev.Feet ?? (metresVal !== null ? Math.round(metresVal * 3.28084) : null);

  const classVal = item.classification ?? item.Classification ?? item.class ?? item.Class ?? item.CLASSIFICATION ?? '';

  const loc = item.location || item.Location || item.LOCATION || {};
  const latVal = loc.latitude ?? item.Latitude ?? item.latitude ?? loc.lat ?? loc.LAT ?? item.LATITUDE ?? null;
  const lonVal = loc.longitude ?? item.Longitude ?? item.longitude ?? loc.lng ?? loc.lon ?? loc.LONG ?? item.LONGITUDE ?? null;
  const gridRefVal = loc.gridRef ?? item['Grid ref'] ?? item.gridRef ?? loc.GridRef ?? item.GRIDREF ?? '';
  const xCoordVal = loc.xCoord ?? loc.xcoord ?? item.Xcoord ?? item.xCoord ?? null;
  const yCoordVal = loc.yCoord ?? loc.ycoord ?? item.Ycoord ?? item.yCoord ?? null;
  const gridRefXYVal = loc.gridRefXY ?? loc.gridrefXY ?? item.GridrefXY ?? '';

  const mapsObj = item.maps || item.Maps || elev.maps || {};
  const map50kVal = mapsObj.map1_50k ?? mapsObj['1:50k'] ?? item.map1_50k ?? item['map1_50k'] ?? item['Map 1:50k'] ?? '';
  const map25kVal = mapsObj.map1_25k ?? mapsObj['1:25k'] ?? item.map1_25k ?? item['map1_25k'] ?? item['Map 1:25k'] ?? '';

  const parentObj = item.parent || item.Parent || {};
  const marilynId = parentObj.marilynId ?? parentObj['marilynId'] ?? item.marilynId ?? item['Marilyn ID'] ?? null;
  const mvNumber = parentObj.mvNumber ?? parentObj.mvnumber ?? item.MVNumber ?? null;

  const cats = item.categories || item.Categories || {};
  let resolvedTokens = [];
  if (typeof classVal === 'string' && classVal.trim() !== '') {
    resolvedTokens = classVal.split(',').map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(classVal)) {
    resolvedTokens = classVal.map(s => String(s).trim()).filter(Boolean);
  }
  
  Object.keys(cats).forEach(k => {
    if ((cats[k] === true || cats[k] === 1 || cats[k] === 'true') && !resolvedTokens.includes(k)) {
      resolvedTokens.push(k);
    }
  });

  const featureVal = String(item.feature ?? item.Feature ?? item.FEATURE ?? '').trim();

  // Pre-indexed search string for fast filtering (including alternate names)
  const searchIndex = `${hillName} ${altName} ${num} ${countyVal} ${featureVal}`.toLowerCase();

  return {
    number: String(num).trim(),
    name: String(hillName).trim(),
    altName: altName,
    country: String(countryVal).trim(),
    classTokens: resolvedTokens,
    county: String(countyVal).trim(),
    countiesList: parseCounties(countyVal),
    metres: metresVal !== null ? parseFloat(metresVal) : null,
    feet: feetVal !== null ? parseInt(feetVal) : null,
    drop: dropVal !== null ? parseFloat(dropVal) : null,
    marilynId: marilynId !== null ? String(marilynId).trim() : null,
    gridRef: String(gridRefVal).trim(),
    latitude: latVal !== null ? parseFloat(latVal) : null,
    longitude: lonVal !== null ? parseFloat(lonVal) : null,
    xCoord: xCoordVal !== null ? parseInt(xCoordVal) : null,
    yCoord: yCoordVal !== null ? parseInt(yCoordVal) : null,
    gridRefXY: String(gridRefXYVal).trim(),
    mvNumber: mvNumber !== null ? String(mvNumber).trim() : null,
    map1_50k: String(map50kVal).trim(),
    map1_25k: String(map25kVal).trim(),
    feature: featureVal,
    survey: String(item.survey ?? item.Survey ?? '').trim(),
    observations: String(item.observations ?? item.Observations ?? item.OBSERVATIONS ?? '').trim(),
    categories: cats,
    _search: searchIndex
  };
}

/**
 * Initializes the dataset from the parsed JSON array.
 * Populates global arrays, updates the Area dropdown, sorts, and renders the initial batch.
 * 
 * @param {Array<Object>} rawJson - Array of raw hill objects.
 */
function loadDataset(rawJson) {
  if (!Array.isArray(rawJson)) return;
  
  allHills = rawJson.map(item => normalize(item));
  filteredHills = [...allHills];
  updateCountyDropdown();
  currentSelectedIndex = -1;
  currentlyLoadedHillNumber = null;
  sortHills(null);
  displayedCount = batchSize;
  render();
}

/* ============================================================================
   6. FILTERING, SEARCH, & SORTING ENGINE
   ============================================================================ */

/**
 * Switches the background pin mode on the Leaflet map ('none', 'filtered', or 'all').
 * 
 * @param {string} mode - 'none' (only current summit), 'filtered', or 'all'.
 */
function setMapPinMode(mode) {
  mapPinMode = mode;
  const currentHill = filteredHills[currentSelectedIndex];
  updateBackgroundHillMarkers(currentHill);
  
  document.querySelectorAll('.pin-mode-btn').forEach(btn => {
    if (btn.getAttribute('data-mode') === mode) {
      btn.classList.add('active');
      btn.style.backgroundColor = 'var(--accent)';
      btn.style.color = '#fff';
    } else {
      btn.classList.remove('active');
      btn.style.backgroundColor = 'transparent';
      btn.style.color = 'var(--text-secondary)';
    }
  });
}

/**
 * Dynamically updates the Area/County select dropdown options.
 * When specific countries are selected, restricts the dropdown options to areas
 * present in those countries.
 */
function updateCountyDropdown() {
  const countySelect = document.getElementById('filter-county');
  if (!countySelect) return;
  const currentVal = countySelect.value;
  const distinctCounties = new Set();
  
  const pool = activeCountries.size > 0 
    ? allHills.filter(h => activeCountries.has(h.country))
    : allHills;

  pool.forEach(h => {
    h.countiesList.forEach(c => distinctCounties.add(c));
  });

  const sorted = Array.from(distinctCounties).sort((a, b) => a.localeCompare(b));
  countySelect.innerHTML = '<option value="">All Areas</option>';
  sorted.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === currentVal) opt.selected = true;
    countySelect.appendChild(opt);
  });
}

/**
 * Switches matching mode between 'OR' (union) and 'AND' (intersection).
 * 
 * @param {string} mode - 'OR' or 'AND'.
 */
function setMatchMode(mode) {
  matchMode = mode;
  document.getElementById('mode-or').classList.toggle('active', mode === 'OR');
  document.getElementById('mode-and').classList.toggle('active', mode === 'AND');
  applyFilters();
}

/**
 * Checks whether a given hill satisfies a classification tag.
 * Special case: 'Ph' checks if the hill has photos attached.
 * 
 * @param {Object} h - Normalized hill record.
 * @param {string} tag - Classification code (e.g. 'M', 'C', 'Ph').
 * @returns {boolean} True if the hill matches the classification.
 */
function checkHillMatchesList(h, tag) {
  if (tag === 'Ph') {
    return (h.categories && (h.categories['Ph'] === true || h.categories['Ph'] === 1)) ||
           h.classTokens.includes('Ph') ||
           knownPhotos.has(String(h.number).trim());
  }
  return (h.categories && (h.categories[tag] === true || h.categories[tag] === 1)) || h.classTokens.includes(tag);
}

/**
 * Checks whether a given hill is located in a specific country.
 * 
 * @param {Object} h - Normalized hill record.
 * @param {string} countryCode - Country code ('S', 'E', 'W', 'I', 'M').
 * @returns {boolean} True if the hill belongs to the country.
 */
function checkHillMatchesCountry(h, countryCode) {
  return h.country === countryCode;
}

/**
 * Core filtering function.
 * Evaluates:
 * 1. Search text: splits by OR or | into search tokens.
 * 2. Min Height and Min Drop/Prominence.
 * 3. Area dropdown selection.
 * 4. Active Country and Classification chips evaluated under matchMode (OR vs AND).
 * Resets table view to top and triggers render().
 */
function applyFilters() {
  // Capture target summit number BEFORE filteredHills is filtered
  const targetHillNumber = currentlyLoadedHillNumber;

  const rawSearch = document.getElementById('filter-search').value.trim();
  const county = document.getElementById('filter-county').value;
  const minHeight = parseFloat(document.getElementById('filter-min-height').value) || null;
  const minDrop = parseFloat(document.getElementById('filter-min-drop').value) || null;

  let searchTerms = [];
  if (rawSearch !== '') {
    searchTerms = rawSearch.split(/\s+OR\s+|\|/i).map(s => s.toLowerCase().trim()).filter(Boolean);
  }

  const hasCountryFilter = activeCountries.size > 0;
  const hasListFilter = activeLists.size > 0;

  filteredHills = allHills.filter(h => {
    // Fast pre-indexed substring check
    if (searchTerms.length > 0) {
      let matchesSearch = false;
      for (let term of searchTerms) {
        if (h._search.includes(term)) {
          matchesSearch = true;
          break;
        }
      }
      if (!matchesSearch) return false;
    }

    if (minHeight !== null && (h.metres === null || h.metres < minHeight)) return false;
    if (minDrop !== null && (h.drop === null || h.drop < minDrop)) return false;
    if (county && !h.countiesList.includes(county)) return false;

    if (matchMode === 'OR') {
      if (hasCountryFilter || hasListFilter) {
        let matchedAny = false;

        for (let c of activeCountries) {
          if (checkHillMatchesCountry(h, c)) {
            matchedAny = true;
            break;
          }
        }

        if (!matchedAny && hasListFilter) {
          for (let tag of activeLists) {
            if (checkHillMatchesList(h, tag)) {
              matchedAny = true;
              break;
            }
          }
        }

        if (!matchedAny) return false;
      }
    } else {
      if (hasCountryFilter) {
        for (let c of activeCountries) {
          if (!checkHillMatchesCountry(h, c)) return false;
        }
      }
      if (hasListFilter) {
        for (let tag of activeLists) {
          if (!checkHillMatchesList(h, tag)) return false;
        }
      }
    }

    return true;
  });

  updateActiveBadge();

  // Sort and resolve the selected hill position using the preserved ID
  sortHills(targetHillNumber);

  if (currentSelectedIndex === -1) {
    displayedCount = batchSize;
    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }
  }

  render();

  if (currentSelectedIndex !== -1) {
    scrollToSelectedRow(false);
  }
}

/**
 * Scrolls the page to keep the selected summit's header visible below the sticky top bar.
 * 
 * @param {boolean} force - If true, always aligns the row below the sticky top bar.
 *                          If false, only scrolls if the row is outside the visible viewport.
 */
function scrollToSelectedRow(force = false) {
  if (currentSelectedIndex === -1) return;
  requestAnimationFrame(() => {
    const selectedRow = document.getElementById(`row-${currentSelectedIndex}`);
    if (!selectedRow) return;
    const topBar = document.getElementById('sticky-top-bar');
    const topBarHeight = topBar ? topBar.offsetHeight : 0;
    const rect = selectedRow.getBoundingClientRect();

    // Check if the selected row header is comfortably visible below the sticky top bar
    const isInView = (rect.top >= topBarHeight - 10 && rect.top <= window.innerHeight - 80);

    if (force || !isInView) {
      const elementPosition = rect.top + window.pageYOffset;
      window.scrollTo({
        top: elementPosition - topBarHeight - 12,
        behavior: 'auto'
      });
    }
  });
}

/**
 * Sorts filteredHills based on the user's selected dropdown order:
 * - 'height-desc': Highest summits first.
 * - 'height-asc': Lowest summits first.
 * - 'drop-desc': Most prominent summits first.
 * - 'name-asc': Alphabetical A-Z.
 * - 'number-asc': Database ID order.
 * Preserves the index of the currently opened hill in the newly sorted order.
 * 
 * @param {string|number|null} targetHillNumber - Optional hill ID to preserve selection for.
 */
function sortHills(targetHillNumber = null) {
  const hillToPreserve = targetHillNumber !== null 
    ? targetHillNumber 
    : currentlyLoadedHillNumber;

  const order = document.getElementById('sort-order').value;
  filteredHills.sort((a, b) => {
    if (order === 'height-desc') return (b.metres ?? -1) - (a.metres ?? -1);
    if (order === 'height-asc') return (a.metres ?? 9999) - (b.metres ?? 9999);
    if (order === 'drop-desc') return (b.drop ?? -1) - (a.drop ?? -1);
    if (order === 'name-asc') return a.name.localeCompare(b.name);
    if (order === 'number-asc') return (parseInt(a.number) || 0) - (parseInt(b.number) || 0);
    return 0;
  });

  if (hillToPreserve !== null) {
    const newIdx = filteredHills.findIndex(h => String(h.number) === String(hillToPreserve));
    if (newIdx !== -1) {
      currentSelectedIndex = newIdx;
      currentlyLoadedHillNumber = filteredHills[newIdx].number;
      if (newIdx >= displayedCount) {
        displayedCount = Math.ceil((newIdx + 1) / batchSize) * batchSize;
      }
    } else {
      currentSelectedIndex = -1;
      currentlyLoadedHillNumber = null;
    }
  } else {
    currentSelectedIndex = -1;
    currentlyLoadedHillNumber = null;
  }
}

/* ============================================================================
   7. TABLE & BADGE RENDERING
   ============================================================================ */

/**
 * Re-renders the visible table rows up to displayedCount and updates total results count.
 */
function render() {
  const countDisplay = document.getElementById('results-count');
  countDisplay.textContent = `(Showing ${filteredHills.length.toLocaleString()} hills)`;

  const pageItems = filteredHills.slice(0, displayedCount);
  renderTable(pageItems, 0);
}

/**
 * Extracts and orders major classification configs for badge pills and map pins.
 * Also handles former/deleted classifications (e.g. 'xM' -> 'ex-Munro').
 * 
 * @param {Object} h - Normalized hill record.
 * @returns {Array<Object>} Matched category config objects with prefixes.
 */
function getOrderedMajorTokens(h) {
  if (!h.classTokens || h.classTokens.length === 0) return [];
  const baseMajorCodes = new Map(MAJOR_CATEGORIES_CONFIG.map(c => [c.code, c]));
  const matchedConfigs = [];

  h.classTokens.forEach(token => {
    let trimmed = token.trim();
    if (baseMajorCodes.has(trimmed)) {
      matchedConfigs.push({ cfg: baseMajorCodes.get(trimmed), prefix: '' });
    } else if (trimmed.startsWith('x') && trimmed.length > 1) {
      let baseCode = trimmed.slice(1);
      if (baseMajorCodes.has(baseCode)) {
        matchedConfigs.push({ cfg: baseMajorCodes.get(baseCode), prefix: 'ex-' });
      }
    }
  });

  return MAJOR_CATEGORIES_CONFIG.filter(cfg => matchedConfigs.some(m => m.cfg.code === cfg.code))
    .map(cfg => {
      let match = matchedConfigs.find(m => m.cfg.code === cfg.code);
      return { ...cfg, prefix: match ? match.prefix : '' };
    });
}

/**
 * Constructs HTML markup for row classification badge pills.
 * 
 * @param {Object} h - Normalized hill record.
 * @returns {string} HTML markup string.
 */
function buildRowBadgesHtml(h) {
  const matchedItems = getOrderedMajorTokens(h);
  if (matchedItems.length === 0) return '';

  return '<div class="row-badge-container">' + matchedItems.map(item => {
    const baseName = CLASSIFICATION_MAP[item.code] || item.name;
    const displayName = item.prefix === 'ex-' ? `ex-${baseName}` : baseName;
    const desc = getCodeDescription(item.code);
    const titleText = item.prefix === 'ex-' ? `Former ${desc}` : desc;
    return `<span class="row-badge" style="background-color: ${item.color}25; border-color: ${item.color}60; color: ${item.color};" title="${titleText}">${displayName}</span>`;
  }).join('') + '</div>';
}

/**
 * Constructs HTML markup for drawer (accordion) classification badges.
 * Wraps pills cleanly and includes major classifications plus any special list memberships.
 * 
 * @param {Object} h - Normalized hill record.
 * @returns {string} HTML markup string.
 */
function buildDrawerBadgesHtml(h) {
  const matchedItems = getOrderedMajorTokens(h);
  const badges = [];

  matchedItems.forEach(item => {
    const baseName = CLASSIFICATION_MAP[item.code] || item.name;
    const displayName = item.prefix === 'ex-' ? `ex-${baseName}` : baseName;
    const desc = getCodeDescription(item.code);
    const titleText = item.prefix === 'ex-' ? `Former ${desc}` : desc;
    badges.push(`<span class="row-badge" style="background-color: ${item.color}25; border-color: ${item.color}60; color: ${item.color};" title="${titleText}">${displayName}</span>`);
  });

  const nonMajor = getNonMajorMemberships(h);
  if (nonMajor.length > 0) {
    nonMajor.forEach(name => {
      badges.push(`<span class="row-badge" style="background-color: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;" title="${name}">${name}</span>`);
    });
  }

  if (badges.length === 0) return '';
  return `<div class="drawer-badge-container">${badges.join('')}</div>`;
}

/**
 * Returns the primary theme color for a hill (used for map pins).
 * 
 * @param {Object} h - Normalized hill record.
 * @returns {string} Hex color string.
 */
function getHillPrimaryColor(h) {
  const matchedItems = getOrderedMajorTokens(h);
  if (matchedItems.length > 0) {
    return matchedItems[0].color;
  }
  return '#64748b'; // Default slate gray
}

/**
 * Resolves the parent Marilyn/summit display string.
 * 
 * @param {Object} h - Normalized hill record.
 * @returns {string} Formatted parent name or ID string.
 */
function getParentDisplayString(h) {
  if (!h.marilynId || String(h.marilynId).trim() === '' || String(h.marilynId).trim() === String(h.number).trim()) {
    return 'None';
  }
  const parentHill = allHills.find(item => String(item.number).trim() === String(h.marilynId).trim());
  return parentHill ? `${parentHill.name} (#${parentHill.number})` : `#${h.marilynId}`;
}

/**
 * Dynamically generates external map and guidebook links:
 * - Google Maps terrain view
 * - PeakFinder 360 panorama
 * - Hill Bagging database page
 * - Regional service: MountainViews (Ireland), Geograph (Channel Islands), Streetmap (OS coordinates)
 * 
 * @param {Object} h - Normalized hill record.
 * @returns {string} Formatted HTML links string.
 */
function buildSimpleExternalLinksHtml(h) {
  let links = [];
  if (h.latitude && h.longitude) {
    const terrainUrl = `https://www.google.com/maps/@${h.latitude},${h.longitude},14z/data=!5m1!1e4`;
    const peakFinderUrl = `https://www.peakfinder.com/?lat=${h.latitude}&lng=-${Math.abs(h.longitude)},13z`;
    links.push(`<a href="${terrainUrl}" target="_blank">Google Maps</a>`);
    links.push(`<a href="${peakFinderUrl}" target="_blank">PeakFinder</a>`);
  }

  // Hill Bagging (dynamically generated from database number)
  if (h.number) {
    const hbUrl = `https://www.hill-bagging.co.uk/hill-view/?qu=S&rf=${encodeURIComponent(h.number)}`;
    links.push(`<a href="${hbUrl}" target="_blank">Hill Bagging</a>`);
  } else if (h.links?.hillBagging) {
    links.push(`<a href="${h.links.hillBagging}" target="_blank">Hill Bagging</a>`);
  }

  // Streetmap / MountainViews / Geograph (dynamically generated from coordinates and IDs)
  if (h.country === 'I' && h.mvNumber) {
    const mvUrl = `https://mountainviews.ie/summit/${encodeURIComponent(h.mvNumber)}/`;
    links.push(`<a href="${mvUrl}" target="_blank">MountainViews</a>`);
  } else if (h.country === 'C' && h.gridRefXY) {
    const ggUrl = `https://www.geograph.org.gg/gridref/${encodeURIComponent(h.gridRefXY)}`;
    links.push(`<a href="${ggUrl}" target="_blank">Geograph</a>`);
  } else if (h.xCoord && h.yCoord) {
    const smUrl = `https://www.streetmap.co.uk/map?X=${h.xCoord}&Y=${h.yCoord}&SV=${h.xCoord},${h.yCoord}&A=Y&Z=115`;
    links.push(`<a href="${smUrl}" target="_blank">Streetmap</a>`);
  } else if (h.links?.streetMap) {
    links.push(`<a href="${h.links.streetMap}" target="_blank">Streetmap</a>`);
  }

  return links.length > 0 ? links.join(' <span class="link-separator">|</span> ') : 'None';
}

/**
 * Returns non-major list memberships for inclusion in the drawer notes pane.
 * 
 * @param {Object} h - Normalized hill record.
 * @returns {Array<string>} Array of friendly list names.
 */
function getNonMajorMemberships(h) {
  const majorCodes = new Set(MAJOR_CATEGORIES_CONFIG.map(c => c.code));
  const nonMajorTokens = h.classTokens.filter(token => {
    let trimmed = token.trim();
    if (majorCodes.has(trimmed)) return false;
    if (trimmed.startsWith('x') && trimmed.length > 1 && majorCodes.has(trimmed.slice(1))) return false;
    return true;
  });
  if (nonMajorTokens.length === 0) return [];
  return nonMajorTokens.map(t => CLASSIFICATION_MAP[t] || t);
}

/**
 * Formats OS Landranger/Explorer map sheet numbers into clickable links to the OS Maps shop.
 * 
 * @param {string} sheetStr - Map sheet numbers string (e.g. "41 42").
 * @returns {string} Formatted HTML links string.
 */
function formatMapSheetLinks(sheetStr) {
  if (!sheetStr || String(sheetStr).trim() === '') return '-';
  const codes = String(sheetStr).split(/[\s,\/]+/).map(s => s.trim()).filter(Boolean);
  if (codes.length === 0) return '-';
  return codes.map(code => `<a href="https://shop.osmaps.com/search.php?search_query=${encodeURIComponent(code)}" target="_blank">${code}</a>`).join(' <span class="link-separator">|</span> ');
}

/**
 * Builds HTML for a single table row, including the inline drawer if this row is selected.
 * 
 * @param {Object} h - Normalized hill record.
 * @param {number} globalIdx - Global index in filteredHills.
 * @param {boolean} isSelected - Whether this row is currently selected/expanded.
 * @returns {string} HTML markup string.
 */
function buildRowHtml(h, globalIdx, isSelected) {
  const heightDisplay = h.metres !== null ? `${h.metres.toFixed(1)}m (${h.feet !== null ? h.feet : '-'}ft)` : '-';
  const classBadgesHtml = buildRowBadgesHtml(h);
  const drawerBadgesHtml = buildDrawerBadgesHtml(h);

  let rowHtml = `
    <tr class="${isSelected ? 'row-selected' : ''}" onclick="toggleSummit(${globalIdx})" id="row-${globalIdx}">
      <td class="col-name" style="font-weight: 600; color: #fff;" title="${h.name}">${h.name}</td>
      <td class="col-class" style="text-align: right;">${classBadgesHtml}</td>
      <td class="col-height" style="text-align: right;"><strong style="color: var(--accent);">${heightDisplay}</strong></td>
    </tr>
  `;

  if (isSelected) {
    const parentDisplay = getParentDisplayString(h);
    const simpleLinksHtml = buildSimpleExternalLinksHtml(h);
    const nonMajorList = getNonMajorMemberships(h);

    let notesItems = [];
    if (h.number !== null && h.number !== undefined && String(h.number).trim() !== '') {
      notesItems.push(`DoBIH#: ${h.number}`);
    }
    if (nonMajorList.length > 0) {
      nonMajorList.forEach(listName => notesItems.push(listName));
    }
    if (h.feature && h.feature.trim() !== '') {
      notesItems.push(h.feature);
    }
    if (h.observations && h.observations.trim() !== '') {
      notesItems.push(h.observations);
    }
    if (h.survey && h.survey.trim() !== '') {
      notesItems.push(h.survey);
    }

    let notesHtml = '';
    if (notesItems.length > 0) {
      notesHtml = `
        <div class="drawer-notes-pane">
          <span>Notes</span>
          <ul>
            ${notesItems.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    const map50kHtml = formatMapSheetLinks(h.map1_50k);
    const map25kHtml = formatMapSheetLinks(h.map1_25k);

    rowHtml += `
      <tr class="inline-drawer-row">
        <td colspan="3">
          <div class="inline-drawer-wrapper" id="inline-drawer-pane">
            <div class="drawer-body">
              <!-- LEFT SECTION (70%): Top row (Prev, Counter, Next, Pins, External Links) + Bottom Map / Photo -->
              <div class="drawer-left-col">
                <div class="drawer-top-row">
                  <div style="display: flex; align-items: center; gap: 4px; flex-wrap: nowrap;">
                    <button class="btn-icon-small" onclick="navigateCarousel(-1)">◀ Prev</button>
                    <span id="drawer-counter" style="font-size: 0.7rem; color: var(--text-secondary); white-space: nowrap; padding: 0 4px;">${globalIdx + 1} / ${filteredHills.length}</span>
                    <button class="btn-icon-small" onclick="navigateCarousel(1)">Next ▶</button>
                  </div>
                  <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="font-size: 0.6rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700;">Pins:</span>
                    <div class="mode-switch-wrap" style="gap: 1px; padding: 1px;">
                      <button class="pin-mode-btn mode-btn ${mapPinMode === 'none' ? 'active' : ''}" data-mode="none" type="button" onclick="setMapPinMode('none')" style="background-color: ${mapPinMode === 'none' ? 'var(--accent)' : 'transparent'}; color: ${mapPinMode === 'none' ? '#fff' : 'var(--text-secondary)'}; font-size: 0.55rem; padding: 2px 4px;">None</button>
                      <button class="pin-mode-btn mode-btn ${mapPinMode === 'filtered' ? 'active' : ''}" data-mode="filtered" type="button" onclick="setMapPinMode('filtered')" style="background-color: ${mapPinMode === 'filtered' ? 'var(--accent)' : 'transparent'}; color: ${mapPinMode === 'filtered' ? '#fff' : 'var(--text-secondary)'}; font-size: 0.55rem; padding: 2px 4px;">Filtered</button>
                      <button class="pin-mode-btn mode-btn ${mapPinMode === 'all' ? 'active' : ''}" data-mode="all" type="button" onclick="setMapPinMode('all')" style="background-color: ${mapPinMode === 'all' ? 'var(--accent)' : 'transparent'}; color: ${mapPinMode === 'all' ? '#fff' : 'var(--text-secondary)'}; font-size: 0.55rem; padding: 2px 4px;">All</button>
                    </div>
                  </div>
                  <div class="external-links-inline">${simpleLinksHtml}</div>
                </div>

                ${drawerBadgesHtml ? `
                <div class="drawer-mobile-badges-bar">
                  <span class="drawer-mobile-badges-label">Classification:</span>
                  ${drawerBadgesHtml}
                </div>
                ` : ''}

                <div id="terrain-map-container"></div>
                <div id="drawer-photo-container" style="display: none;">
                  <img id="drawer-hill-photo" src="" alt="Summit Photo" title="Click to open in full size" onclick="openCurrentPhotoFull()" />
                </div>
                <div id="drawer-view-tabs" class="drawer-view-tabs" style="display: none;">
                  <div class="drawer-tabs-left">
                    <button type="button" class="drawer-tab-btn active" id="tab-btn-map" onclick="switchDrawerTab('map')">Map</button>
                    <button type="button" class="drawer-tab-btn" id="tab-btn-photos-of" onclick="switchDrawerTab('photos-of')" style="display: none;">Photos of</button>
                    <button type="button" class="drawer-tab-btn" id="tab-btn-taken-from" onclick="switchDrawerTab('taken-from')" style="display: none;">Taken from</button>
                  </div>
                  <div class="drawer-tabs-center">
                    <span id="photo-title" style="display: none;" title="Click to open full size" onclick="openCurrentPhotoFull()"></span>
                  </div>
                  <div class="drawer-tabs-right">
                    <div id="photo-nav-controls" style="display: none; align-items: center; gap: 8px;">
                      <button class="btn-icon-small" type="button" onclick="navigatePhoto(-1)">◀ Prev</button>
                      <span id="photo-counter" style="font-size: 0.75rem; color: var(--text-secondary);"></span>
                      <button class="btn-icon-small" type="button" onclick="navigatePhoto(1)">Next ▶</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- RIGHT SECTION (30%): Details block + Notes bullet points -->
              <div class="drawer-right-col">
                <div class="unified-details-block">
                  <div class="detail-line drawer-classification-line">
                    <span>Classification</span>
                    ${drawerBadgesHtml || '<strong style="color: var(--text-muted); font-size: 0.8rem;">-</strong>'}
                  </div>
                  ${h.altName ? `<div class="detail-line"><span>Alternate Name</span><strong>${h.altName}</strong></div>` : ''}
                  <div class="detail-line"><span>Area</span><strong>${h.county || '-'}</strong></div>
                  <div class="detail-line"><span>Height</span><strong>${heightDisplay}</strong></div>
                  <div class="detail-line"><span>Drop</span><strong>${h.drop !== null ? h.drop + 'm' : '-'}</strong></div>
                  <div class="detail-line"><span>Parent</span><strong>${parentDisplay}</strong></div>
                  <div class="detail-line"><span>Grid Ref</span><strong>${h.gridRef || '-'}</strong></div>
                  <div class="detail-line"><span>Coordinates</span><strong>${h.latitude ? h.latitude.toFixed(5) + ', ' + h.longitude.toFixed(5) : '-'}</strong></div>
                  <div class="detail-line"><span>OS LANDRANGER (1:50k)</span><strong>${map50kHtml}</strong></div>
                  <div class="detail-line"><span>OS EXPLORER (1:25k)</span><strong>${map25kHtml}</strong></div>
                </div>
                ${notesHtml}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  return rowHtml;
}

/**
 * Renders an entire table batch, replacing existing tbody contents.
 * Automatically initializes the map and photo viewer if a summit is expanded.
 * 
 * @param {Array<Object>} pageItems - Items to render.
 * @param {number} startIdx - Starting index in filteredHills.
 */
function renderTable(pageItems, startIdx) {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 32px;">No matching hills found.</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map((h, idx) => buildRowHtml(h, startIdx + idx, (startIdx + idx) === currentSelectedIndex)).join('');

  if (currentSelectedIndex !== -1) {
    requestAnimationFrame(() => {
      const selHill = filteredHills[currentSelectedIndex];
      initMapForSelected(selHill);
      initPhotoForSelected(selHill);
    });
  }
}

/**
 * Appends additional rows onto the table without re-rendering existing rows.
 * Used by virtual infinite scrolling when scrolling down the page.
 * 
 * @param {Array<Object>} pageItems - Next slice of items.
 * @param {number} startIdx - Starting index of the appended slice.
 */
function appendTableRows(pageItems, startIdx) {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;

  const html = pageItems.map((h, idx) => buildRowHtml(h, startIdx + idx, false)).join('');
  tbody.insertAdjacentHTML('beforeend', html);
}

/* ============================================================================
   8. LEAFLET MAP ENGINE
   ============================================================================ */

/**
 * Draws background hill markers on the Leaflet map using a high-performance Canvas renderer.
 * Employs bounding-box spatial clipping (`getBounds().pad(0.3)`) so only hills in or
 * just outside the current viewport are drawn, guaranteeing 60 FPS performance.
 * 
 * @param {Object} selectedHill - Currently selected hill record (excluded from background pins).
 */
function updateBackgroundHillMarkers(selectedHill) {
  if (!leafletMap) return;

  if (!canvasLayerGroup) {
    canvasLayerGroup = L.layerGroup().addTo(leafletMap);
  }
  canvasLayerGroup.clearLayers();

  if (mapPinMode === 'none') return;

  const dataset = (mapPinMode === 'all') 
    ? allHills 
    : (filteredHills.length > 0 ? filteredHills : allHills);

  // Fast bounding-box check: only draw pins in current view (+30% padding for smooth panning)
  const bounds = leafletMap.getBounds().pad(0.3);

  const visibleHills = dataset.filter(h => {
    if (!h.latitude || !h.longitude) return false;
    if (selectedHill && String(h.number) === String(selectedHill.number)) return false;
    return bounds.contains([h.latitude, h.longitude]);
  });

  visibleHills.forEach((h) => {
    const pinColor = getHillPrimaryColor(h);

    const circle = L.circleMarker([h.latitude, h.longitude], {
      renderer: canvasRenderer,
      radius: 4,
      fillColor: pinColor,
      color: '#0f172a',
      weight: 1,
      opacity: 0.85,
      fillOpacity: 0.8
    });

    circle.bindTooltip(`<b>${h.name}</b><br>${h.metres ? h.metres + 'm' : ''} (${h.county})`, {
      direction: 'top',
      className: 'marker-tooltip'
    });

    circle.on('click', () => {
      const foundIdx = filteredHills.findIndex(item => String(item.number) === String(h.number));
      if (foundIdx !== -1) {
        selectSummit(foundIdx);
      }
    });

    canvasLayerGroup.addLayer(circle);
  });
}

/**
 * Initializes the Leaflet map inside `#terrain-map-container` for the selected hill:
 * - Adds OpenTopoMap, Esri Satellite, and standard OpenStreetMap base layers.
 * - Adds layer selection control.
 * - Adds custom toolbar control (Fullscreen toggle button and Recentre button).
 * - Creates a prominent summit marker with custom color and pulse shadow.
 * - Registers dynamic viewport moveend listeners to update background pins as the user pans.
 * 
 * @param {Object} hill - Selected hill record.
 */
function initMapForSelected(hill) {
  if (!hill.latitude || !hill.longitude) return;

  const isSameHill = (currentlyLoadedHillNumber !== null && String(currentlyLoadedHillNumber) === String(hill.number));
  let initialCenter = [hill.latitude, hill.longitude];
  let initialZoom = 13;

  if (leafletMap) {
    if (isSameHill) {
      try {
        initialCenter = leafletMap.getCenter();
        initialZoom = leafletMap.getZoom();
      } catch (e) {}
    }
    leafletMap.remove();
    leafletMap = null;
    activeMarker = null;
    canvasLayerGroup = null;
  }

  if (!canvasRenderer) canvasRenderer = L.canvas({ padding: 0.5 });

  leafletMap = L.map('terrain-map-container', {
    center: initialCenter,
    zoom: initialZoom,
    zoomControl: true,
    preferCanvas: true,
    zoomSnap: 0.25,
    wheelPxPerZoomLevel: 120
  });

  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: 'Map data: &copy; OpenStreetMap, SRTM | Map style: &copy; OpenTopoMap'
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri'
  });

  const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });

  topoLayer.addTo(leafletMap);

  const baseMaps = {
    "Topographic Relief": topoLayer,
    "Satellite Imagery": satelliteLayer,
    "Standard Map": osmLayer
  };
  L.control.layers(baseMaps).addTo(leafletMap);

  const MapToolsControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function(map) {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      
      // Fullscreen Button
      const fsBtn = L.DomUtil.create('a', '', container);
      fsBtn.innerHTML = '⛶';
      fsBtn.href = '#';
      fsBtn.title = 'Toggle Fullscreen';
      fsBtn.style.fontSize = '1.1rem';
      fsBtn.style.fontWeight = 'bold';
      fsBtn.style.lineHeight = '26px';
      fsBtn.style.textAlign = 'center';
      fsBtn.style.width = '26px';
      fsBtn.style.height = '26px';
      fsBtn.style.display = 'block';
      fsBtn.style.borderBottom = '1px solid #ccc';

      L.DomEvent.on(fsBtn, 'click', (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        const mapContainer = document.getElementById('terrain-map-container');
        mapContainer.classList.toggle('fullscreen-map');
        setTimeout(() => {
          leafletMap.invalidateSize();
        }, 100);
      });

      // Recentre Button
      const centerBtn = L.DomUtil.create('a', '', container);
      centerBtn.innerHTML = '🎯';
      centerBtn.href = '#';
      centerBtn.title = 'Recentre to Selected Hill';
      centerBtn.style.fontSize = '1rem';
      centerBtn.style.lineHeight = '26px';
      centerBtn.style.textAlign = 'center';
      centerBtn.style.width = '26px';
      centerBtn.style.height = '26px';
      centerBtn.style.display = 'block';

      L.DomEvent.on(centerBtn, 'click', (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        if (hill.latitude && hill.longitude) {
          leafletMap.setView([hill.latitude, hill.longitude], 13, { animate: false });
        }
      });

      return container;
    }
  });
  leafletMap.addControl(new MapToolsControl());

  const activePinColor = getHillPrimaryColor(hill);
  const customPinIcon = L.divIcon({
    className: 'custom-pin',
    html: `<div style="background-color:${activePinColor}; width:18px; height:18px; border:3px solid #ffffff; border-radius:50%; box-shadow:0 0 12px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  activeMarker = L.marker([hill.latitude, hill.longitude], { icon: customPinIcon, zIndexOffset: 1000 }).addTo(leafletMap);

  updateBackgroundHillMarkers(hill);

  // Dynamically update viewport background pins when panning/zooming without locking UI
  leafletMap.on('moveend', () => {
    const currentHill = filteredHills[currentSelectedIndex];
    updateBackgroundHillMarkers(currentHill);
  });

  setTimeout(() => {
    if (leafletMap) leafletMap.invalidateSize();
  }, 100);
}

/* ============================================================================
   9. PHOTO MANAGEMENT & BINARY EXIF METADATA PARSER
   ============================================================================ */

/** @type {string} Current tab in drawer: 'map', 'photos-of', or 'taken-from' */
let currentDrawerTab = 'map';

/** @type {Array<Object>} Photos featuring the currently expanded summit */
let currentPhotosOf = [];
/** @type {number} Current index in currentPhotosOf */
let currentPhotosOfIndex = 0;

/** @type {Array<Object>} Photos taken from the currently expanded summit */
let currentTakenFrom = [];
/** @type {number} Current index in currentTakenFrom */
let currentTakenFromIndex = 0;

/** @type {Object} Preloaded photos.json manifest mapping hill IDs to photos */
let photoManifest = {};

/** @type {Map<string, Array<Object>>} In-memory photo lookup cache */
const photoCache = new Map();

/**
 * Checks whether an image exists at the given URL via Image DOM element probing.
 * 
 * @param {string} url - Image path to probe.
 * @returns {Promise<string|null>} Resolves with URL if loaded successfully, null otherwise.
 */
function probeImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Binary parser reading JPEG segments directly from an ArrayBuffer.
 * Extracts comments and title strings without requiring large external libraries:
 * 1. Marker 0xFE: JPEG COM comment segment.
 * 2. Marker 0xE1: APP1 EXIF segment:
 *    - Tag 0x9C9C: Windows XPComment (UTF-16LE).
 *    - Tag 0x9C9B: Windows XPTitle (UTF-16LE).
 *    - Tag 0x010E: Standard EXIF ImageDescription (UTF-8).
 * 
 * @param {ArrayBuffer} buffer - Raw JPEG bytes.
 * @returns {string|null} Extracted comment or null if none found.
 */
function extractJpegComment(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;

    let offset = 2;
    const len = view.byteLength;

    while (offset < len) {
      if (view.getUint8(offset) !== 0xFF) break;
      const marker = view.getUint8(offset + 1);

      if (marker === 0xD9 || marker === 0xDA) break;
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
        offset += 2;
        continue;
      }

      if (offset + 4 > len) break;
      const segLen = view.getUint16(offset + 2);

      // Marker 0xFE = COM (JPEG Comment)
      if (marker === 0xFE && segLen > 2 && offset + 2 + segLen <= len) {
        const commentBytes = new Uint8Array(buffer, offset + 4, segLen - 2);
        const text = new TextDecoder().decode(commentBytes).trim();
        if (text) return text;
      }

      // Marker 0xE1 = APP1 (EXIF)
      if (marker === 0xE1 && segLen > 8 && offset + 2 + segLen <= len) {
        const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // 'Exif\0\0'
        let isExif = true;
        for (let i = 0; i < 6; i++) {
          if (view.getUint8(offset + 4 + i) !== exifHeader[i]) {
            isExif = false;
            break;
          }
        }

        if (isExif) {
          const tiffStart = offset + 10;
          if (tiffStart + 8 <= len) {
            const isLE = view.getUint16(tiffStart) === 0x4949; // 'II' = Little Endian
            const getU16 = (o) => view.getUint16(tiffStart + o, isLE);
            const getU32 = (o) => view.getUint32(tiffStart + o, isLE);

            if (getU16(2) === 0x002A) {
              const firstIfdOffset = getU32(4);
              const ifdStart = tiffStart + firstIfdOffset;
              if (ifdStart + 2 <= len) {
                const numEntries = view.getUint16(ifdStart, isLE);
                let xpComment = null;
                let xpTitle = null;
                let imgDesc = null;

                for (let i = 0; i < numEntries; i++) {
                  const entryOffset = ifdStart + 2 + i * 12;
                  if (entryOffset + 12 > len) break;
                  const tag = view.getUint16(entryOffset, isLE);
                  const count = view.getUint32(entryOffset + 4, isLE);
                  const valOffset = count <= 4 ? (entryOffset + 8) : (tiffStart + view.getUint32(entryOffset + 8, isLE));

                  if (valOffset + count <= len) {
                    if (tag === 0x9C9C) { // XPComment (UTF-16LE)
                      const bytes = new Uint8Array(buffer, valOffset, count);
                      xpComment = new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '').trim();
                    } else if (tag === 0x9C9B) { // XPTitle (UTF-16LE)
                      const bytes = new Uint8Array(buffer, valOffset, count);
                      xpTitle = new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '').trim();
                    } else if (tag === 0x010E) { // ImageDescription (UTF-8)
                      const bytes = new Uint8Array(buffer, valOffset, count);
                      imgDesc = new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
                    }
                  }
                }

                const found = xpComment || xpTitle || imgDesc;
                if (found) return found;
              }
            }
          }
        }
      }

      offset += 2 + segLen;
    }
  } catch (e) {
    console.warn('Error reading JPEG comment:', e);
  }

  return null;
}

let photoManifestPromise = null;

/**
 * Ensures that the photo manifest has been fetched and cached before probing.
 * 
 * @returns {Promise<Object>} Resolves with the photoManifest object.
 */
function ensurePhotosLoaded() {
  if (!photoManifestPromise) {
    photoManifestPromise = loadKnownPhotos();
  }
  return photoManifestPromise;
}

/**
 * Sorts photos for a specific hill according to user specification:
 * 1. Direct matches first (where the filename begins with this hill's number),
 *    ordered numerically by suffix (_001, _002, etc.).
 * 2. Tagged/background photos second (associated via EXIF keywords/tags).
 * 
 * @param {Array<Object>} photos - List of photo items.
 * @param {string|number} hillNum - Database number of the hill.
 * @returns {Array<Object>} Sorted photo list.
 */
function sortPhotosForHill(photos, hillNum) {
  const strNum = String(hillNum).trim();
  const legacyDirectRegex = new RegExp(`^${strNum}(?:_(\\d+)(?:_[a-fA-F0-9]+)?|[a-e])?\\.`, 'i');
  // Manifest-managed files (pure CRC32 or original trip files with timestamp prefix) are governed by role tags in photos.json
  const isManifestManagedFile = (f) => /^[a-fA-F0-9]{4,16}\.(?:jpg|jpeg|png|webp)$/i.test(f) || /^\d{8}_\d{6}_/i.test(f);

  const getRoleRank = (item) => {
    const role = (item.role || '').toLowerCase();
    if (role === 'primary') return 0;
    if (role === 'secondary') return 1;
    if (role === 'from') return 2;
    // Fallback for legacy direct filenames only (never treat CRC32 or timestamped trip filenames as direct hill numbers!)
    const file = (item.file || item.src || '').split('/').pop();
    if (!isManifestManagedFile(file) && legacyDirectRegex.test(file)) return 0;
    return 3;
  };

  return [...photos].sort((a, b) => {
    const rankA = getRoleRank(a);
    const rankB = getRoleRank(b);

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const fileA = (a.file || a.src || '').split('/').pop();
    const fileB = (b.file || b.src || '').split('/').pop();

    if (!isManifestManagedFile(fileA) && !isManifestManagedFile(fileB)) {
      const matchA = fileA.match(legacyDirectRegex);
      const matchB = fileB.match(legacyDirectRegex);

      if (matchA && matchB) {
        // Both match this hill directly: sort by numeric suffix (_001, _002...)
        const numA = matchA[1] !== undefined ? parseInt(matchA[1], 10) : 0;
        const numB = matchB[1] !== undefined ? parseInt(matchB[1], 10) : 0;
        if (numA !== numB) return numA - numB;
      }
    }

    return fileA.localeCompare(fileB, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Finds all photos associated with a hill.
 * Checks:
 * 1. Fast in-memory cache.
 * 2. Preloaded photos.json manifest.
 * 3. Probing fallback for sequential candidates (_001.._099, a..e, single).
 * 
 * @param {string|number} num - Hill number.
 * @returns {Promise<Array<Object>|null>} Array of photo items or null if none found.
 */
async function findPhotosForHill(num) {
  if (num === null || num === undefined || String(num).trim() === '') return null;
  const key = String(num).trim();
  if (photoCache.has(key)) return photoCache.get(key);

  await ensurePhotosLoaded();

  // 1. Fast path from preloaded photos.json manifest
  if (photoManifest && photoManifest[key] && Array.isArray(photoManifest[key])) {
    let list = photoManifest[key].map(item => {
      if (typeof item === 'string') {
        return { file: item, src: `image/hills/${item}`, title: '', role: 'primary' };
      }
      return {
        file: item.file || (item.src ? item.src.split('/').pop() : ''),
        src: item.src || `image/hills/${item.file}`,
        title: (item.title || '').trim(),
        role: (item.role || 'primary').toLowerCase()
      };
    });
    list = sortPhotosForHill(list, key);
    photoCache.set(key, list);
    if (list.length > 0) knownPhotos.add(key);
    return list;
  }

  // 2. Fallback candidate probing (supports _001, _002... and legacy a, b...)
  let photos = [];
  const probe001 = await probeImage(`image/hills/${key}_001.jpg`);
  if (probe001) {
    photos.push({ file: `${key}_001.jpg`, src: probe001, title: '' });
    for (let i = 2; i <= 99; i++) {
      const pad = String(i).padStart(3, '0');
      const filename = `${key}_${pad}.jpg`;
      const next = await probeImage(`image/hills/${filename}`);
      if (next) photos.push({ file: filename, src: next, title: '' });
      else break;
    }
  } else {
    const probeA = await probeImage(`image/hills/${key}a.jpg`);
    if (probeA) {
      photos.push({ file: `${key}a.jpg`, src: probeA, title: '' });
      for (const char of ['b', 'c', 'd', 'e']) {
        const filename = `${key}${char}.jpg`;
        const extra = await probeImage(`image/hills/${filename}`);
        if (extra) photos.push({ file: filename, src: extra, title: '' });
        else break;
      }
    } else {
      const single = await probeImage(`image/hills/${key}.jpg`);
      if (single) photos.push({ file: `${key}.jpg`, src: single, title: '' });
    }
  }

  const result = photos.length > 0 ? sortPhotosForHill(photos, key) : null;
  photoCache.set(key, result);
  if (result) knownPhotos.add(key);
  return result;
}

/**
 * Loads the photos.json manifest from image/hills/photos.json.
 * 
 * @returns {Promise<Object>} The parsed photos manifest.
 */
async function loadKnownPhotos() {
  // 1. Primary: Load photos.json manifest from the image/hills folder (authoritative)
  try {
    const res = await fetch('./image/hills/photos.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach(id => {
          const str = String(id).trim();
          if (/^[a-fA-F0-9]{4,16}\.(?:jpg|jpeg|png|webp)$/i.test(str)) return;
          const numMatch = str.match(/^(\d+)(?:_|[a-e]\.|\.|$)/i);
          if (numMatch) knownPhotos.add(numMatch[1]);
          else if (/^\d+$/.test(str)) knownPhotos.add(str);
        });
      } else if (data && typeof data === 'object') {
        photoManifest = data;
        Object.keys(data).forEach(id => {
          const str = String(id).trim();
          if (/^[a-fA-F0-9]{4,16}\.(?:jpg|jpeg|png|webp)$/i.test(str)) return;
          const numMatch = str.match(/^(\d+)/);
          if (numMatch) knownPhotos.add(numMatch[1]);
          else knownPhotos.add(str);
        });
      }
    }
  } catch (e) {
    // Graceful fallback
  }

  // 2. Supplemental: directory listing scan for legacy files (if available and not already in photos.json)
  try {
    const dirRes = await fetch('./image/hills/', { cache: 'no-store' });
    if (dirRes.ok) {
      const html = await dirRes.text();
      const fileMatches = [...html.matchAll(/href=["']?([^"'>]+\.(?:jpg|jpeg|png|webp))["'>]?/gi)];
      if (fileMatches.length > 0) {
        fileMatches.forEach(m => {
          const file = decodeURIComponent(m[1]).split('/').pop().split('\\').pop();
          // CRC32 files (e.g. 4cd9e263.jpg) and original trip photos (e.g. 20081206_135709_...) are registered strictly in photos.json, never parsed as hill numbers!
          if (/^[a-fA-F0-9]{4,16}\.(?:jpg|jpeg|png|webp)$/i.test(file) || /^\d{8}_\d{6}_/i.test(file)) {
            return;
          }
          // Legacy files: must be digits followed by '_' or '.' or single letter '[a-e].'
          const numMatch = file.match(/^(\d+)(?:_|[a-e]\.|\.)/i);
          if (numMatch) knownPhotos.add(numMatch[1]);
        });
      }
    }
  } catch (e) {
    // Directory listing not enabled or not supported
  }

  return photoManifest;
}

/**
 * Opens the currently displayed photo in full resolution in a new browser tab.
 */
function openCurrentPhotoFull() {
  const photoList = (currentDrawerTab === 'taken-from') ? currentTakenFrom : currentPhotosOf;
  const photoIndex = (currentDrawerTab === 'taken-from') ? currentTakenFromIndex : currentPhotosOfIndex;

  if (photoList.length > 0 && photoList[photoIndex]) {
    const item = photoList[photoIndex];
    const src = typeof item === 'string' ? item : item.src;
    if (src) window.open(src, '_blank');
  }
}

/**
 * Updates the photo image src, title caption, and Prev/Next navigation controls.
 * If the photo lacks a preloaded title, asynchronously extracts it from the JPEG bytes.
 */
async function updatePhotoDisplay() {
  const photoImg = document.getElementById('drawer-hill-photo');
  const navEl = document.getElementById('photo-nav-controls');
  const counterEl = document.getElementById('photo-counter');
  const titleEl = document.getElementById('photo-title');

  const photoList = (currentDrawerTab === 'taken-from') ? currentTakenFrom : currentPhotosOf;
  const photoIndex = (currentDrawerTab === 'taken-from') ? currentTakenFromIndex : currentPhotosOfIndex;

  if (!photoList || photoList.length === 0) return;
  const current = photoList[photoIndex];
  if (!current) return;
  const src = typeof current === 'string' ? current : current.src;

  if (photoImg && src) {
    photoImg.src = src;
  }

  const isPhotoTab = currentDrawerTab === 'photos-of' || currentDrawerTab === 'taken-from';

  if (isPhotoTab && photoList.length > 1) {
    if (navEl) navEl.style.display = 'flex';
    if (counterEl) counterEl.textContent = `${photoIndex + 1} / ${photoList.length}`;
  } else {
    if (navEl) navEl.style.display = 'none';
  }

  if (titleEl) {
    if (isPhotoTab) {
      let title = (typeof current === 'object' && current.title) ? current.title.trim() : '';

      // If title wasn't preloaded, attempt dynamic metadata extraction from JPEG
      if (!title && src && src.match(/\.jpe?g$/i)) {
        try {
          const res = await fetch(src);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const extracted = extractJpegComment(buf);
            if (extracted) {
              title = extracted;
              if (typeof current === 'object') current.title = extracted;
            }
          }
        } catch (e) {}
      }

      if (title) {
        titleEl.style.display = 'inline-block';
        titleEl.textContent = title;
        titleEl.title = `${title} (Click to open full size)`;
        if (photoImg) photoImg.title = `${title} - Click to open in full size`;
      } else {
        titleEl.style.display = 'none';
        titleEl.textContent = '';
        titleEl.title = '';
        if (photoImg) photoImg.title = 'Click to open in full size';
      }
    } else {
      titleEl.style.display = 'none';
    }
  }
}

/**
 * Switches the drawer view tab between 'map', 'photos-of', and 'taken-from'.
 * 
 * @param {string} tab - 'map', 'photos-of', or 'taken-from'.
 */
function switchDrawerTab(tab) {
  currentDrawerTab = tab;
  const mapContainer = document.getElementById('terrain-map-container');
  const photoContainer = document.getElementById('drawer-photo-container');
  const mapBtn = document.getElementById('tab-btn-map');
  const photosOfBtn = document.getElementById('tab-btn-photos-of');
  const takenFromBtn = document.getElementById('tab-btn-taken-from');
  const photoTitle = document.getElementById('photo-title');
  const photoNav = document.getElementById('photo-nav-controls');

  if (mapBtn) mapBtn.classList.toggle('active', tab === 'map');
  if (photosOfBtn) photosOfBtn.classList.toggle('active', tab === 'photos-of');
  if (takenFromBtn) takenFromBtn.classList.toggle('active', tab === 'taken-from');

  if (tab === 'photos-of' || tab === 'taken-from') {
    if (mapContainer) mapContainer.style.display = 'none';
    if (photoContainer) photoContainer.style.display = 'flex';
    updatePhotoDisplay();
  } else {
    // Map tab
    if (photoContainer) photoContainer.style.display = 'none';
    if (mapContainer) {
      mapContainer.style.display = 'block';
      if (leafletMap) leafletMap.invalidateSize();
    }
    if (photoTitle) photoTitle.style.display = 'none';
    if (photoNav) photoNav.style.display = 'none';
  }
}

/**
 * Advances or rewinds the photo carousel for the currently active photo tab.
 * 
 * @param {number} direction - 1 for Next, -1 for Prev.
 */
function navigatePhoto(direction) {
  if (currentDrawerTab === 'taken-from') {
    if (currentTakenFrom.length <= 1) return;
    currentTakenFromIndex = (currentTakenFromIndex + direction + currentTakenFrom.length) % currentTakenFrom.length;
  } else {
    if (currentPhotosOf.length <= 1) return;
    currentPhotosOfIndex = (currentPhotosOfIndex + direction + currentPhotosOf.length) % currentPhotosOf.length;
  }
  updatePhotoDisplay();
}

/**
 * Initializes photo viewer state when a summit is selected.
 * 
 * @param {Object} hill - Selected hill record.
 */
async function initPhotoForSelected(hill) {
  const isSameHill = (currentlyLoadedHillNumber !== null && String(currentlyLoadedHillNumber) === String(hill.number));
  const activeTabToRestore = isSameHill ? currentDrawerTab : 'map';

  if (!isSameHill) {
    currentPhotosOf = [];
    currentPhotosOfIndex = 0;
    currentTakenFrom = [];
    currentTakenFromIndex = 0;
    switchDrawerTab('map');
  }

  const tabsEl = document.getElementById('drawer-view-tabs');
  const photosOfBtn = document.getElementById('tab-btn-photos-of');
  const takenFromBtn = document.getElementById('tab-btn-taken-from');
  if (!tabsEl || !hill) return;

  tabsEl.style.display = 'none';
  if (photosOfBtn) photosOfBtn.style.display = 'none';
  if (takenFromBtn) takenFromBtn.style.display = 'none';

  const photos = await findPhotosForHill(hill.number);
  // Verify that the user hasn't switched to another summit while probing
  if (filteredHills[currentSelectedIndex]?.number !== hill.number) return;

  if (photos && photos.length > 0) {
    currentPhotosOf = photos.filter(p => (p.role || '').toLowerCase() !== 'from');
    currentTakenFrom = photos.filter(p => (p.role || '').toLowerCase() === 'from');

    const hasPhotosOf = currentPhotosOf.length > 0;
    const hasTakenFrom = currentTakenFrom.length > 0;

    if (photosOfBtn) {
      photosOfBtn.style.display = hasPhotosOf ? 'inline-flex' : 'none';
      if (hasPhotosOf) {
        photosOfBtn.title = `Photos of ${hill.name} (${currentPhotosOf.length})`;
      }
    }
    if (takenFromBtn) {
      takenFromBtn.style.display = hasTakenFrom ? 'inline-flex' : 'none';
      if (hasTakenFrom) {
        takenFromBtn.title = `Photos taken from ${hill.name} (${currentTakenFrom.length})`;
      }
    }

    if (hasPhotosOf || hasTakenFrom) {
      tabsEl.style.display = 'flex';
      switchDrawerTab(activeTabToRestore);
    } else {
      tabsEl.style.display = 'none';
      switchDrawerTab('map');
    }
  } else {
    tabsEl.style.display = 'none';
    switchDrawerTab('map');
  }

  currentlyLoadedHillNumber = hill.number;
}

/* ============================================================================
   10. SUMMIT SELECTION, DRAWER CONTROLS, & NAVIGATION
   ============================================================================ */

/**
 * Toggles summit drawer expansion. If the clicked summit is already open, closes it.
 * 
 * @param {number} index - Index in filteredHills.
 */
function toggleSummit(index) {
  if (currentSelectedIndex === index) {
    closeDrawer();
  } else {
    selectSummit(index);
  }
}

/**
 * Expands the drawer for the specified summit index.
 * Automatically scrolls to align the row beneath the sticky top bar.
 * 
 * @param {number} index - Index in filteredHills.
 */
function selectSummit(index) {
  if (index < 0 || index >= filteredHills.length) return;
  currentSelectedIndex = index;
  currentlyLoadedHillNumber = filteredHills[index]?.number;
  
  if (index >= displayedCount) {
    displayedCount = Math.ceil((index + 1) / batchSize) * batchSize;
  }

  render();

  scrollToSelectedRow(true);
}

/**
 * Navigates to previous or next summit in the filtered hills list.
 * 
 * @param {number} direction - 1 for Next, -1 for Prev.
 */
function navigateCarousel(direction) {
  if (filteredHills.length === 0) return;
  let nextIndex = currentSelectedIndex + direction;
  if (nextIndex < 0) nextIndex = filteredHills.length - 1;
  if (nextIndex >= filteredHills.length) nextIndex = 0;
  selectSummit(nextIndex);
}

/**
 * Closes the inline drawer and destroys the active Leaflet map instance.
 */
function closeDrawer() {
  currentSelectedIndex = -1;
  currentlyLoadedHillNumber = null;
  currentDrawerTab = 'map';
  currentPhotosOf = [];
  currentPhotosOfIndex = 0;
  currentTakenFrom = [];
  currentTakenFromIndex = 0;
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
  render();
}

/**
 * Resets all active filters, chips, dropdowns, and search inputs back to defaults.
 */
function clearAllChips() {
  activeLists.clear();
  activeCountries.clear();
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('filter-county').value = '';
  document.getElementById('filter-min-height').value = '';
  document.getElementById('filter-min-drop').value = '';
  updateCountyDropdown();
  applyFilters();
}

/* ============================================================================
   11. EVENT LISTENERS & BOOTSTRAPPER
   ============================================================================ */

// Debounced input listeners for instant typing responsiveness
const debouncedApplyFilters = debounce(applyFilters, 180);

['filter-search', 'filter-min-height', 'filter-min-drop'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', debouncedApplyFilters);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        applyFilters();
      }
    });
  }
});

const countyEl = document.getElementById('filter-county');
if (countyEl) {
  countyEl.addEventListener('change', applyFilters);
}

// Country Chips click listener
document.querySelectorAll('.chip-country').forEach(chip => {
  chip.addEventListener('click', () => {
    const code = chip.getAttribute('data-country');
    if (activeCountries.has(code)) {
      activeCountries.delete(code);
      chip.classList.remove('active');
    } else {
      activeCountries.add(code);
      chip.classList.add('active');
    }
    updateCountyDropdown();
    applyFilters();
  });
});

// Classification List Chips click listener
document.querySelectorAll('.filter-chip:not(.chip-country)').forEach(chip => {
  chip.addEventListener('click', () => {
    const listCode = chip.getAttribute('data-list');
    if (activeLists.has(listCode)) {
      activeLists.delete(listCode);
      chip.classList.remove('active');
    } else {
      activeLists.add(listCode);
      chip.classList.add('active');
    }
    applyFilters();
  });
});

const majorCodeColorMap = new Map(MAJOR_CATEGORIES_CONFIG.map(c => [c.code, c.color]));

// Set tooltips, colors, and calculate contrast for category filter chips
document.querySelectorAll('.filter-chip').forEach(chip => {
  const code = chip.getAttribute('data-list') || chip.getAttribute('data-country');
  if (code && CLASSIFICATION_DESCRIPTIONS[code]) {
    chip.setAttribute('title', CLASSIFICATION_DESCRIPTIONS[code]);
  }
  const listCode = chip.getAttribute('data-list');
  if (listCode && majorCodeColorMap.has(listCode)) {
    const color = majorCodeColorMap.get(listCode);
    chip.style.setProperty('--chip-color', color);

    // Calculate contrast luminance to ensure text is always clearly legible
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    chip.style.setProperty('--chip-text', lum > 0.55 ? '#0f172a' : '#ffffff');
  }
});

// Sort order dropdown change listener
document.getElementById('sort-order').addEventListener('change', () => {
  sortHills();
  render();
  scrollToSelectedRow(true);
});

// Back to Top button logic + Virtual Infinite Scroll (incremental append)
const backToTopBtn = document.getElementById('back-to-top');
window.addEventListener('scroll', () => {
  if (window.scrollY > 400) {
    backToTopBtn.style.display = 'flex';
  } else {
    backToTopBtn.style.display = 'none';
  }

  if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 400) {
    if (displayedCount < filteredHills.length) {
      const startIdx = displayedCount;
      const nextBatch = Math.min(batchSize, filteredHills.length - startIdx);
      displayedCount += nextBatch;
      const nextItems = filteredHills.slice(startIdx, displayedCount);
      appendTableRows(nextItems, startIdx);
    }
  }
});

/**
 * Smoothly scrolls viewport to the very top.
 */
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Global Keyboard Navigation
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const mapContainer = document.getElementById('terrain-map-container');
    if (mapContainer && mapContainer.classList.contains('fullscreen-map')) {
      mapContainer.classList.remove('fullscreen-map');
      if (leafletMap) leafletMap.invalidateSize();
      return;
    }
  }

  if (currentSelectedIndex !== -1) {
    if (e.key === 'ArrowLeft') navigateCarousel(-1);
    if (e.key === 'ArrowRight') navigateCarousel(1);
    if (e.key === 'Escape') closeDrawer();
  }
});

// Application entry point on DOMContentLoaded
window.addEventListener('DOMContentLoaded', async () => {
  // Auto-detect whether admin panel is available (localhost or accessible)
  const adminBtn = document.getElementById('admin-link-btn');
  if (adminBtn) {
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname) || location.protocol === 'file:';
    if (!isLocal) {
      // On remote static hosting where admin is excluded, probe if admin exists, otherwise hide
      fetch('admin/', { method: 'HEAD' })
        .then(res => { if (!res.ok) adminBtn.style.display = 'none'; })
        .catch(() => { adminBtn.style.display = 'none'; });
    }
  }

  await ensurePhotosLoaded();
  try {
    const res = await fetch('./dobih.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      loadDataset(json);
    }
  } catch (e) {
    console.error('Failed to load dobih.json:', e);
  }
});
