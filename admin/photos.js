/**
 * ============================================================================
 * DoBIH Photos - Frontend Controller
 * ============================================================================
 * Supports 3 Main Areas:
 * 1. Staging: Uncurated queue; crop/resample to 1600x900 or simply archive.
 * 2. Live: Photos currently on the website (<crc32>.jpg) linked via CRC32.
 * 3. Archived: Photos that have been processed or deemed not needed.
 * ============================================================================
 */

// Application State
let allHills = [];
let hillsById = new Map();

// Area Navigation State
let currentArea = 'staging'; // 'staging' | 'live' | 'archive'

// Staging State
let photoQueue = [];
let currentIndex = -1;
let currentPhoto = null;
let cropper = null;

// Categorized Hills State for Staging (hillNumber -> hill object)
let primaryHills = new Map();
let secondaryHills = new Map();
let fromHills = new Map();

let baseOrientation = 0;
let straightenAngle = 0.0;
let adjustments = {
  rotate: 0.0,
  contrast: 100,
  saturation: 100,
  brightness: 100,
  hue: 0
};
let showHorizonGrid = false;

// Live Photos State
let livePhotos = [];
let liveSearchQuery = '';
let editingLivePhoto = null;
let modalPrimaryHills = new Map();
let modalSecondaryHills = new Map();
let modalFromHills = new Map();

// Archived Photos State
let archivePhotos = [];
let archiveSearchQuery = '';
let archiveFilter = 'all'; // 'all' | 'live' | 'unprocessed'

// DOM Elements
const elements = {
  queueCount: document.getElementById('queue-count'),
  btnRefresh: document.getElementById('btn-refresh'),

  // Area Navigation
  tabAreaStaging: document.getElementById('tab-area-staging'),
  tabAreaLive: document.getElementById('tab-area-live'),
  tabAreaArchive: document.getElementById('tab-area-archive'),
  badgeCountStaging: document.getElementById('badge-count-staging'),
  badgeCountLive: document.getElementById('badge-count-live'),
  badgeCountArchive: document.getElementById('badge-count-archive'),
  areaStaging: document.getElementById('area-staging'),
  areaLive: document.getElementById('area-live'),
  areaArchive: document.getElementById('area-archive'),

  // Staging Workbench
  viewportCard: document.getElementById('viewport-card'),
  editorPanel: document.getElementById('editor-panel'),
  emptyState: document.getElementById('empty-state'),
  currentFilename: document.getElementById('current-filename'),
  fileMetaPill: document.getElementById('file-meta-pill'),
  cropperImage: document.getElementById('cropper-image'),
  cropResolutionBadge: document.getElementById('crop-resolution-badge'),
  filmstripStrip: document.getElementById('filmstrip-strip'),

  btnPrevPhoto: document.getElementById('btn-prev-photo'),
  btnNextPhoto: document.getElementById('btn-next-photo'),
  btnChevronPrev: document.getElementById('btn-chevron-prev'),
  btnChevronNext: document.getElementById('btn-chevron-next'),
  btnStripPrev: document.getElementById('btn-strip-prev'),
  btnStripNext: document.getElementById('btn-strip-next'),
  queuePosIndicator: document.getElementById('queue-position-indicator'),
  statusAlertBanner: document.getElementById('status-alert-banner'),
  statusBannerIcon: document.getElementById('status-banner-icon'),
  statusBannerTitle: document.getElementById('status-banner-title'),
  statusBannerDetail: document.getElementById('status-banner-detail'),

  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnRotateCCW: document.getElementById('btn-rotate-ccw'),
  btnRotate: document.getElementById('btn-rotate'),
  btnResetCrop: document.getElementById('btn-reset-crop'),
  btnToggleTweak: document.getElementById('btn-toggle-tweak'),
  adjustmentsPanel: document.getElementById('adjustments-panel'),
  btnFitFull: document.getElementById('btn-fit-full'),

  tabStraighten: document.getElementById('tab-straighten'),
  tabColor: document.getElementById('tab-color'),
  contentStraighten: document.getElementById('content-straighten'),
  contentColor: document.getElementById('content-color'),
  btnCompare: document.getElementById('btn-compare'),
  btnResetAdjustments: document.getElementById('btn-reset-adjustments'),
  horizonGridOverlay: document.getElementById('horizon-grid-overlay'),
  btnToggleGrid: document.getElementById('btn-toggle-grid'),

  sliderRotate: document.getElementById('slider-rotate'),
  valRotate: document.getElementById('val-rotate'),
  btnRotMinus1: document.getElementById('btn-rot-minus-1'),
  btnRotMinus01: document.getElementById('btn-rot-minus-01'),
  btnRotZero: document.getElementById('btn-rot-zero'),
  btnRotPlus01: document.getElementById('btn-rot-plus-01'),
  btnRotPlus1: document.getElementById('btn-rot-plus-1'),
  btnResetRotate: document.getElementById('btn-reset-rotate'),

  sliderContrast: document.getElementById('slider-contrast'),
  valContrast: document.getElementById('val-contrast'),
  btnContrastMinus: document.getElementById('btn-contrast-minus'),
  btnContrastPlus: document.getElementById('btn-contrast-plus'),
  btnResetContrast: document.getElementById('btn-reset-contrast'),

  sliderSaturation: document.getElementById('slider-saturation'),
  valSaturation: document.getElementById('val-saturation'),
  btnSatMinus: document.getElementById('btn-sat-minus'),
  btnSatPlus: document.getElementById('btn-sat-plus'),
  btnResetSat: document.getElementById('btn-reset-sat'),

  sliderBrightness: document.getElementById('slider-brightness'),
  valBrightness: document.getElementById('val-brightness'),
  btnBrightMinus: document.getElementById('btn-bright-minus'),
  btnBrightPlus: document.getElementById('btn-bright-plus'),
  btnResetBright: document.getElementById('btn-reset-bright'),

  sliderHue: document.getElementById('slider-hue'),
  valHue: document.getElementById('val-hue'),
  btnHueMinus: document.getElementById('btn-hue-minus'),
  btnHuePlus: document.getElementById('btn-hue-plus'),
  btnResetHue: document.getElementById('btn-reset-hue'),

  infoDate: document.getElementById('info-date'),
  infoTime: document.getElementById('info-time'),
  infoCrc: document.getElementById('info-crc'),
  infoArea: document.getElementById('info-area'),
  infoSiteStatus: document.getElementById('info-site-status'),
  infoArchiveStatus: document.getElementById('info-archive-status'),

  targetFileBanner: document.getElementById('target-file-banner'),
  targetFileName: document.getElementById('target-file-name'),
  targetFileMeta: document.getElementById('target-file-meta'),

  primarySearch: document.getElementById('primary-search'),
  primarySuggestions: document.getElementById('primary-suggestions'),
  primaryChipsContainer: document.getElementById('primary-chips-container'),
  primaryCountBadge: document.getElementById('primary-count-badge'),

  secondarySearch: document.getElementById('secondary-search'),
  secondarySuggestions: document.getElementById('secondary-suggestions'),
  secondaryChipsContainer: document.getElementById('secondary-chips-container'),
  secondaryCountBadge: document.getElementById('secondary-count-badge'),

  fromSearch: document.getElementById('from-search'),
  fromSuggestions: document.getElementById('from-suggestions'),
  fromChipsContainer: document.getElementById('from-chips-container'),
  fromCountBadge: document.getElementById('from-count-badge'),

  photoComment: document.getElementById('photo-comment'),
  btnQuickPrimary: document.getElementById('btn-quick-primary'),
  btnQuickFrom: document.getElementById('btn-quick-from'),
  btnQuickArea: document.getElementById('btn-quick-area'),
  btnClearComment: document.getElementById('btn-clear-comment'),

  btnProcess: document.getElementById('btn-process'),
  btnArchiveSingle: document.getElementById('btn-archive-single'),
  btnDelete: document.getElementById('btn-delete'),

  // Live Area
  liveSearch: document.getElementById('live-search'),
  livePhotoGrid: document.getElementById('live-photo-grid'),
  liveEmptyState: document.getElementById('live-empty-state'),
  liveStatTotal: document.getElementById('live-stat-total'),
  liveStatHills: document.getElementById('live-stat-hills'),
  liveStatArchived: document.getElementById('live-stat-archived'),
  btnRefreshLive: document.getElementById('btn-refresh-live'),

  // Archive Area
  archiveSearch: document.getElementById('archive-search'),
  archivePhotoGrid: document.getElementById('archive-photo-grid'),
  archiveEmptyState: document.getElementById('archive-empty-state'),
  subtabCountAll: document.getElementById('subtab-count-all'),
  subtabCountLive: document.getElementById('subtab-count-live'),
  subtabCountUnprocessed: document.getElementById('subtab-count-unprocessed'),
  btnRefreshArchive: document.getElementById('btn-refresh-archive'),

  // Modal: Edit Live Metadata
  modalEditLive: document.getElementById('modal-edit-live'),
  modalPreviewImg: document.getElementById('modal-preview-img'),
  modalFileName: document.getElementById('modal-file-name'),
  modalFileCrc: document.getElementById('modal-file-crc'),
  modalFileArchive: document.getElementById('modal-file-archive'),
  modalPrimarySearch: document.getElementById('modal-primary-search'),
  modalPrimarySuggestions: document.getElementById('modal-primary-suggestions'),
  modalPrimaryChips: document.getElementById('modal-primary-chips'),
  modalPrimaryCount: document.getElementById('modal-primary-count'),
  modalSecondarySearch: document.getElementById('modal-secondary-search'),
  modalSecondarySuggestions: document.getElementById('modal-secondary-suggestions'),
  modalSecondaryChips: document.getElementById('modal-secondary-chips'),
  modalSecondaryCount: document.getElementById('modal-secondary-count'),
  modalFromSearch: document.getElementById('modal-from-search'),
  modalFromSuggestions: document.getElementById('modal-from-suggestions'),
  modalFromChips: document.getElementById('modal-from-chips'),
  modalFromCount: document.getElementById('modal-from-count'),
  modalComment: document.getElementById('modal-comment'),
  btnSaveLiveMeta: document.getElementById('btn-save-live-meta'),

  // Toast
  toast: document.getElementById('toast'),
  toastMsg: document.getElementById('toast-msg'),
  toastClose: document.getElementById('toast-close')
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadHillsDatabase();
  await loadStagingQueue();
});

/**
 * Loads and normalizes dobih.json dataset for fast summit searching.
 */
async function loadHillsDatabase() {
  try {
    const res = await fetch('../dobih.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rawHills = await res.json();

    allHills = rawHills.map(item => {
      const num = String(item.number ?? item.Number ?? '').trim();
      const name = String(item.name ?? item.Name ?? '').trim();
      const admin = item.administrative || item.Admin || {};
      const county = String(admin.county ?? item.County ?? '').trim();
      const area = String(admin.area ?? item.Area ?? '').trim();
      const section = String(admin.section ?? item.Section ?? '').trim();
      const elev = item.elevation || item.Elevation || {};
      const metres = elev.metres ?? item.Metres ?? null;
      const feet = elev.feet ?? (metres ? Math.round(metres * 3.28084) : null);
      const feature = String(item.feature ?? item.Feature ?? '').trim();

      const searchIndex = `${name} ${num} ${county} ${area} ${section} ${feature}`.toLowerCase();

      const hill = {
        number: num,
        name: name,
        county: county,
        area: area,
        section: section,
        metres: metres,
        feet: feet,
        feature: feature,
        searchIndex: searchIndex
      };

      hillsById.set(num, hill);
      return hill;
    });

    console.log(`Loaded ${allHills.length} hills from dobih.json`);
  } catch (err) {
    console.error('Failed to load dobih.json:', err);
    showToast('Could not load dobih.json database.', true);
  }
}

/**
 * Updates area tab counter badges and header status.
 */
function updateGlobalCounts(stats) {
  if (!stats) return;
  if (elements.badgeCountStaging) elements.badgeCountStaging.textContent = stats.staging ?? 0;
  if (elements.badgeCountLive) elements.badgeCountLive.textContent = stats.live ?? 0;
  if (elements.badgeCountArchive) elements.badgeCountArchive.textContent = stats.archived ?? 0;

  if (elements.queueCount) {
    elements.queueCount.textContent = `Staging: ${stats.staging ?? 0} • Live: ${stats.live ?? 0} • Archived: ${stats.archived ?? 0}`;
  }
}

// ============================================================================
// AREA NAVIGATION (Staging / Live / Archived)
// ============================================================================

/**
 * Switches the active application area.
 * 
 * @param {string} area - 'staging' | 'live' | 'archive'
 */
function switchArea(area) {
  currentArea = area;

  // Update tab buttons
  elements.tabAreaStaging.classList.toggle('active', area === 'staging');
  elements.tabAreaLive.classList.toggle('active', area === 'live');
  elements.tabAreaArchive.classList.toggle('active', area === 'archive');

  // Toggle containers
  elements.areaStaging.style.display = (area === 'staging') ? 'block' : 'none';
  elements.areaLive.style.display = (area === 'live') ? 'block' : 'none';
  elements.areaArchive.style.display = (area === 'archive') ? 'block' : 'none';

  if (area === 'staging') {
    if (photoQueue.length === 0) loadStagingQueue();
  } else if (area === 'live') {
    loadLivePhotos();
  } else if (area === 'archive') {
    loadArchiveList();
  }
}

// ============================================================================
// AREA 1: STAGING CONTROLLER
// ============================================================================

/**
 * Loads pending staging photos from api/photos.php.
 * 
 * @param {string|number|null} preferredTarget - Optional filename (string) or index (number)
 *                                               to select after loading. When a photo is processed,
 *                                               archived, or deleted at index `i`, passing `i`
 *                                               causes the workbench to automatically advance to the
 *                                               next photo in sequence.
 */
async function loadStagingQueue(preferredTarget = null) {
  try {
    elements.btnRefresh.classList.add('loading');
    const res = await fetch('api/photos.php?action=queue');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to list staging queue');
    }

    photoQueue = data.queue || [];
    updateGlobalCounts(data.stats || null);
    renderQueueState(data.stats || null);

    if (photoQueue.length > 0) {
      let targetIdx = 0;
      if (typeof preferredTarget === 'string') {
        // Find by specific filename if requested (e.g. when opening from archive recrop)
        const found = photoQueue.findIndex(p => p.filename === preferredTarget);
        if (found !== -1) targetIdx = found;
      } else if (typeof preferredTarget === 'number') {
        // Keep the same index slot so the workbench advances to the next photo
        targetIdx = Math.max(0, Math.min(preferredTarget, photoQueue.length - 1));
      }
      selectPhoto(targetIdx);
    } else {
      clearSelection();
    }
  } catch (err) {
    console.error('Queue load error:', err);
    showToast(`Error loading staging queue: ${err.message}`, true);
  } finally {
    elements.btnRefresh.classList.remove('loading');
  }
}

/**
 * Updates UI based on queue length (displays empty state if 0).
 */
function renderQueueState(stats = null) {
  const count = photoQueue.length;
  if (count === 0) {
    elements.viewportCard.style.display = 'none';
    elements.editorPanel.style.display = 'none';
    elements.emptyState.style.display = 'flex';
  } else {
    elements.viewportCard.style.display = 'flex';
    elements.editorPanel.style.display = 'flex';
    elements.emptyState.style.display = 'none';
    renderFilmstrip();
  }
}

/**
 * Renders thumbnail strip at the bottom of the viewport.
 */
function renderFilmstrip() {
  elements.filmstripStrip.innerHTML = '';
  photoQueue.forEach((photo, idx) => {
    const card = document.createElement('div');
    card.className = `thumb-card ${idx === currentIndex ? 'active' : ''}`;
    card.onclick = () => selectPhoto(idx);

    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.src = photo.url;
    img.alt = photo.filename;
    img.loading = 'lazy';

    const caption = document.createElement('div');
    caption.className = 'thumb-caption';
    const displayTitle = (photo.parsed && photo.parsed.areaHint) ? photo.parsed.areaHint : photo.filename;
    caption.textContent = displayTitle;
    caption.title = photo.filename;

    card.appendChild(img);
    card.appendChild(caption);

    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'thumb-badge-container';

    if (photo.alreadyProcessed) {
      const addedBadge = document.createElement('span');
      addedBadge.className = 'thumb-badge badge-added';
      addedBadge.textContent = '✓ Added';
      badgeContainer.appendChild(addedBadge);
    }
    if (photo.isArchived) {
      const archBadge = document.createElement('span');
      archBadge.className = 'thumb-badge badge-archived';
      archBadge.textContent = '📦 Archived';
      badgeContainer.appendChild(archBadge);
    }

    if (badgeContainer.children.length > 0) {
      card.appendChild(badgeContainer);
    }

    elements.filmstripStrip.appendChild(card);
  });

  const activeThumb = elements.filmstripStrip.children[currentIndex];
  if (activeThumb) {
    activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

/**
 * Selects a photo from the queue by index.
 */
function selectPhoto(index) {
  if (index < 0 || index >= photoQueue.length) return;
  currentIndex = index;
  currentPhoto = photoQueue[index];

  if (elements.queuePosIndicator) {
    elements.queuePosIndicator.textContent = `${currentIndex + 1} / ${photoQueue.length}`;
  }

  // Update filename and meta pill
  elements.currentFilename.textContent = currentPhoto.filename;
  elements.currentFilename.title = currentPhoto.filename;
  elements.fileMetaPill.textContent = currentPhoto.sizeFormatted;

  // Reset transforms and adjustments
  baseOrientation = 0;
  straightenAngle = 0.0;
  adjustments = { rotate: 0.0, contrast: 100, saturation: 100, brightness: 100, hue: 0 };
  syncAdjustmentSliders();

  // Initialize Cropper.js on active image
  initCropper(currentPhoto.url);

  // Clear categories
  primaryHills.clear();
  secondaryHills.clear();
  fromHills.clear();
  elements.photoComment.value = '';

  // Populate parsed info
  const parsed = currentPhoto.parsed || {};
  elements.infoDate.textContent = parsed.dateFormatted || '—';
  elements.infoTime.textContent = parsed.timeFormatted || '—';
  elements.infoCrc.textContent = parsed.crc ? `#${parsed.crc}` : '—';
  elements.infoArea.textContent = parsed.areaHint || '—';

  // Status banners
  if (currentPhoto.alreadyProcessed) {
    elements.infoSiteStatus.innerHTML = '<span style="color: #34d399; font-weight: 700;">✓ Live</span>';
    elements.statusAlertBanner.style.display = 'flex';
    elements.statusAlertBanner.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    elements.statusBannerTitle.textContent = 'Already Live';
    const proc = currentPhoto.processedInfo;
    const summitsDesc = proc && proc.allHills && proc.allHills.length > 0 ? `Tagged to hill(s) #${proc.allHills.join(', #')}` : '';
    elements.statusBannerDetail.textContent = `Filename: ${proc ? proc.file : 'photo.jpg'} • ${summitsDesc}`;
  } else {
    elements.infoSiteStatus.textContent = 'Not on site';
    elements.statusAlertBanner.style.display = 'none';
  }

  if (currentPhoto.isArchived) {
    elements.infoArchiveStatus.innerHTML = '<span style="color: #818cf8; font-weight: 700;">✓ In Archive</span>';
  } else {
    elements.infoArchiveStatus.textContent = 'Unarchived';
  }

  // Pre-load hills if already processed on site
  if (currentPhoto.alreadyProcessed && currentPhoto.processedInfo) {
    const info = currentPhoto.processedInfo;
    if (info.primary && Array.isArray(info.primary)) {
      info.primary.forEach(hid => {
        const h = hillsById.get(String(hid));
        if (h) primaryHills.set(String(hid), h);
      });
    }
    if (info.secondary && Array.isArray(info.secondary)) {
      info.secondary.forEach(hid => {
        const h = hillsById.get(String(hid));
        if (h) secondaryHills.set(String(hid), h);
      });
    }
    if (info.from && Array.isArray(info.from)) {
      info.from.forEach(hid => {
        const h = hillsById.get(String(hid));
        if (h) fromHills.set(String(hid), h);
      });
    }
    if (info.comment) {
      elements.photoComment.value = info.comment;
    }
  }

  renderChips('primary');
  renderChips('secondary');
  renderChips('from');
  updateTargetAndValidation();
  renderFilmstrip();
}

function selectPrevPhoto() {
  if (photoQueue.length === 0) return;
  const nextIdx = (currentIndex - 1 + photoQueue.length) % photoQueue.length;
  selectPhoto(nextIdx);
}

function selectNextPhoto() {
  if (photoQueue.length === 0) return;
  const nextIdx = (currentIndex + 1) % photoQueue.length;
  selectPhoto(nextIdx);
}

function clearSelection() {
  currentIndex = -1;
  currentPhoto = null;
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
}

/**
 * Initializes Cropper.js instance with strict 16:9 ratio and min 1600x900 resolution.
 */
function initCropper(imageSrc) {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }

  elements.cropperImage.src = imageSrc;

  elements.cropperImage.onload = () => {
    if (elements.fileMetaPill && currentPhoto && elements.cropperImage.naturalWidth) {
      elements.fileMetaPill.textContent = `${currentPhoto.sizeFormatted} • ${elements.cropperImage.naturalWidth}×${elements.cropperImage.naturalHeight}`;
    }

    cropper = new Cropper(elements.cropperImage, {
      aspectRatio: 16 / 9,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.95,
      responsive: true,
      restore: false,
      guides: true,
      center: true,
      highlight: true,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      ready() {
        updateMinCropBoxConstraints();
        applyCropperTransforms();
        updateCropResolutionDisplay();
      },
      zoom() {
        updateMinCropBoxConstraints();
      },
      crop(e) {
        // Enforce that crop box in real image pixels can never be smaller than 1600x900
        if (cropper && (e.detail.width < 1599.5 || e.detail.height < 899.5)) {
          const imgData = cropper.getImageData();
          if (imgData && imgData.naturalWidth >= 1600 && imgData.naturalHeight >= 900) {
            const curData = cropper.getData();
            const clampedW = Math.max(1600, curData.width);
            const clampedH = Math.round(clampedW * (9 / 16));
            const maxX = Math.max(0, imgData.naturalWidth - clampedW);
            const maxY = Math.max(0, imgData.naturalHeight - clampedH);
            cropper.setData({
              x: Math.max(0, Math.min(curData.x, maxX)),
              y: Math.max(0, Math.min(curData.y, maxY)),
              width: clampedW,
              height: clampedH
            });
          }
        }
        updateCropResolutionDisplay();
      }
    });
  };
}

/**
 * Calculates and enforces minCropBoxWidth & minCropBoxHeight on the Cropper instance
 * corresponding to 1600x900 natural image pixels.
 */
function updateMinCropBoxConstraints() {
  if (!cropper) return;
  const imgData = cropper.getImageData();
  if (imgData && imgData.naturalWidth && imgData.width) {
    const scale = imgData.width / imgData.naturalWidth;
    const minW = Math.min(imgData.width, Math.max(10, 1600 * scale));
    const minH = Math.min(imgData.height, Math.max(10, 900 * scale));
    cropper.options.minCropBoxWidth = minW;
    cropper.options.minCropBoxHeight = minH;
  }
}

/**
 * Updates the crop resolution indicator.
 */
function updateCropResolutionDisplay() {
  if (!cropper) return;
  const data = cropper.getData(true);
  const w = Math.max(1600, Math.round(data.width));
  const h = Math.max(900, Math.round(data.height));
  if (elements.cropResolutionBadge) {
    elements.cropResolutionBadge.textContent = `Crop: ${w} × ${h} ➔ 1600×900`;
    elements.cropResolutionBadge.style.color = 'var(--accent)';
  }
}

/**
 * Updates the Cropper rotation based on baseOrientation (90 deg steps) + straightenAngle.
 */
function updateCropperRotation() {
  if (!cropper) return;
  const totalAngle = (baseOrientation + straightenAngle) % 360;
  cropper.rotateTo(totalAngle);
}

function applyCropperTransforms() {
  updateCropperRotation();
  applyColorFilters();
}

function applyColorFilters() {
  const filterStr = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturation}%) hue-rotate(${adjustments.hue}deg)`;
  const imgs = elements.viewportCard.querySelectorAll('.cropper-container img, #cropper-image');
  imgs.forEach(img => {
    img.style.filter = filterStr;
  });
  const wrapBox = elements.viewportCard.querySelector('.cropper-wrap-box');
  if (wrapBox && wrapBox.style.filter) wrapBox.style.filter = 'none';
}

function syncAdjustmentSliders() {
  if (elements.sliderRotate) elements.sliderRotate.value = adjustments.rotate;
  if (elements.valRotate) elements.valRotate.textContent = `${adjustments.rotate >= 0 ? '+' : ''}${parseFloat(adjustments.rotate).toFixed(1)}°`;
  if (elements.sliderContrast) elements.sliderContrast.value = adjustments.contrast;
  if (elements.valContrast) elements.valContrast.textContent = `${adjustments.contrast}%`;
  if (elements.sliderSaturation) elements.sliderSaturation.value = adjustments.saturation;
  if (elements.valSaturation) elements.valSaturation.textContent = `${adjustments.saturation}%`;
  if (elements.sliderBrightness) elements.sliderBrightness.value = adjustments.brightness;
  if (elements.valBrightness) elements.valBrightness.textContent = `${adjustments.brightness}%`;
  if (elements.sliderHue) elements.sliderHue.value = adjustments.hue;
  if (elements.valHue) elements.valHue.textContent = `${adjustments.hue}°`;
}

// ============================================================================
// STAGING SUMMITS TAGGING & CHIPS
// ============================================================================

function addHillToCategory(category, hill) {
  const id = String(hill.number);
  if (category === 'primary') {
    primaryHills.set(id, hill);
    secondaryHills.delete(id);
  } else if (category === 'secondary') {
    if (!primaryHills.has(id)) {
      secondaryHills.set(id, hill);
    }
  } else if (category === 'from') {
    fromHills.set(id, hill);
  }

  renderChips(category);
  updateTargetAndValidation();
  updateCaptionHelpers();
}

function removeHillFromCategory(category, id) {
  if (category === 'primary') primaryHills.delete(id);
  else if (category === 'secondary') secondaryHills.delete(id);
  else if (category === 'from') fromHills.delete(id);

  renderChips(category);
  updateTargetAndValidation();
  updateCaptionHelpers();
}

function renderChips(category) {
  let map, container, countBadge;
  if (category === 'primary') {
    map = primaryHills;
    container = elements.primaryChipsContainer;
    countBadge = elements.primaryCountBadge;
  } else if (category === 'secondary') {
    map = secondaryHills;
    container = elements.secondaryChipsContainer;
    countBadge = elements.secondaryCountBadge;
  } else {
    map = fromHills;
    container = elements.fromChipsContainer;
    countBadge = elements.fromCountBadge;
  }

  container.innerHTML = '';
  countBadge.textContent = `${map.size} selected`;
  if (map.size > 0) {
    countBadge.style.color = category === 'primary' ? 'var(--accent)' : (category === 'secondary' ? '#38bdf8' : '#a78bfa');
    countBadge.style.fontWeight = '700';
  } else {
    countBadge.style.color = 'var(--text-muted)';
    countBadge.style.fontWeight = 'normal';
  }

  if (map.size === 0) {
    const hint = document.createElement('span');
    hint.className = 'chips-empty-hint';
    hint.textContent = category === 'primary' ? 'No primary hills added' : (category === 'secondary' ? 'No secondary hills added' : "No 'Taken From' hill specified");
    container.appendChild(hint);
    return;
  }

  map.forEach((hill, id) => {
    const chip = document.createElement('span');
    chip.className = `tag-chip chip-${category}`;
    chip.innerHTML = `
      <span>#${escapeHtml(hill.number)} ${escapeHtml(hill.name)}${hill.metres ? ` (${Math.round(hill.metres)}m)` : ''}</span>
      <span class="remove-tag-btn" title="Remove summit">&times;</span>
    `;
    chip.querySelector('.remove-tag-btn').onclick = () => removeHillFromCategory(category, id);
    container.appendChild(chip);
  });
}

function updateTargetAndValidation() {
  const targetName = currentPhoto ? `${currentPhoto.filename.replace(/\.[^.]+$/, '')}.jpg` : 'photo.jpg';
  elements.targetFileName.textContent = targetName;

  const hasPrimary = primaryHills.size > 0;
  const hasFrom = fromHills.size > 0;
  const isValid = hasPrimary || hasFrom;

  if (isValid) {
    elements.btnProcess.disabled = false;
    elements.btnProcess.textContent = '🚀 Save & Go Live';
    elements.targetFileMeta.textContent = `Valid: ${primaryHills.size} Primary • ${secondaryHills.size} Secondary • ${fromHills.size} From`;
    elements.targetFileMeta.style.color = '#34d399';
    if (elements.targetFileBanner) {
      elements.targetFileBanner.style.borderColor = 'rgba(16, 185, 129, 0.5)';
      elements.targetFileBanner.style.background = 'rgba(16, 185, 129, 0.12)';
    }
  } else {
    elements.btnProcess.disabled = true;
    elements.btnProcess.textContent = 'Select Primary or Taken From to Process';
    elements.targetFileMeta.textContent = 'At least 1 hill required in Primary or Taken From';
    elements.targetFileMeta.style.color = 'var(--text-muted)';
    if (elements.targetFileBanner) {
      elements.targetFileBanner.style.borderColor = 'var(--border-color)';
      elements.targetFileBanner.style.background = 'var(--bg-base)';
    }
  }
}

function updateCaptionHelpers() {
  if (elements.btnQuickPrimary) {
    if (primaryHills.size > 0) {
      const names = Array.from(primaryHills.values()).map(h => h.name).join(' & ');
      elements.btnQuickPrimary.textContent = names;
      elements.btnQuickPrimary.style.display = 'inline-block';
      elements.btnQuickPrimary.onclick = () => {
        elements.photoComment.value = names;
      };
    } else {
      elements.btnQuickPrimary.style.display = 'none';
    }
  }

  if (elements.btnQuickFrom) {
    if (fromHills.size > 0) {
      const names = Array.from(fromHills.values()).map(h => h.name).join(' / ');
      const text = `View from ${names}`;
      elements.btnQuickFrom.textContent = text;
      elements.btnQuickFrom.style.display = 'inline-block';
      elements.btnQuickFrom.onclick = () => {
        elements.photoComment.value = text;
      };
    } else {
      elements.btnQuickFrom.style.display = 'none';
    }
  }

  if (elements.btnQuickArea) {
    if (currentPhoto && currentPhoto.parsed && currentPhoto.parsed.areaHint) {
      elements.btnQuickArea.textContent = currentPhoto.parsed.areaHint;
      elements.btnQuickArea.style.display = 'inline-block';
      elements.btnQuickArea.onclick = () => {
        elements.photoComment.value = currentPhoto.parsed.areaHint;
      };
    } else {
      elements.btnQuickArea.style.display = 'none';
    }
  }
}

/**
 * Searches hills database for autocomplete dropdown.
 */
function searchHills(query, dropdownEl, onSelect) {
  const trimmed = query.trim().toLowerCase();
  dropdownEl.innerHTML = '';

  if (trimmed.length < 1) {
    dropdownEl.classList.remove('open');
    return;
  }

  const matches = allHills.filter(h => h.searchIndex.includes(trimmed)).slice(0, 8);

  if (matches.length === 0) {
    dropdownEl.innerHTML = '<div class="suggestion-item" style="color: var(--text-muted); cursor: default;">No matching summits found</div>';
    dropdownEl.classList.add('open');
    return;
  }

  matches.forEach(h => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';

    const metaParts = [];
    if (h.metres) metaParts.push(`${Math.round(h.metres)}m`);
    const loc = h.county || h.area || '';
    if (loc) metaParts.push(loc);

    item.innerHTML = `
      <div class="suggestion-name">${escapeHtml(h.name)} <span style="font-size: 0.8em; color: var(--text-muted); font-weight: normal;">#${escapeHtml(h.number)}</span></div>
      <div class="suggestion-meta">${escapeHtml(metaParts.join(' • '))}</div>
    `;
    item.onclick = () => {
      onSelect(h);
      dropdownEl.classList.remove('open');
    };
    dropdownEl.appendChild(item);
  });

  dropdownEl.classList.add('open');
}

// ============================================================================
// STAGING ACTIONS: Process & Go Live | Simply Archive | Skip | Delete
// ============================================================================

/**
 * Saves and processes the current staging photo to go Live on the website.
 */
async function processCurrentPhoto() {
  if (!currentPhoto) return;

  if (primaryHills.size === 0 && fromHills.size === 0) {
    showToast('Please select at least one hill in Primary or Taken From.', true);
    elements.primarySearch.focus();
    return;
  }

  const cropData = cropper ? cropper.getData(true) : { x: 0, y: 0, width: 1600, height: 900 };
  const crc = currentPhoto && currentPhoto.parsed && currentPhoto.parsed.crc ? currentPhoto.parsed.crc : '';

  // Render 1600x900 canvas with full rotation and color adjustments applied
  let imageBase64 = null;
  if (cropper) {
    try {
      const croppedCanvas = cropper.getCroppedCanvas({
        width: 1600,
        height: 900,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      });

      if (croppedCanvas) {
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = 1600;
        finalCanvas.height = 900;
        const ctx = finalCanvas.getContext('2d');

        const filterStr = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturation}%) hue-rotate(${adjustments.hue}deg)`;
        ctx.filter = filterStr;
        ctx.drawImage(croppedCanvas, 0, 0, 1600, 900);

        imageBase64 = finalCanvas.toDataURL('image/jpeg', 0.88);
      }
    } catch (e) {
      console.warn('Canvas export failed, falling back to server-side GDI crop:', e);
    }
  }

  const payload = {
    filename: currentPhoto.filename,
    primaryHills: Array.from(primaryHills.keys()).map(k => parseInt(k, 10)),
    secondaryHills: Array.from(secondaryHills.keys()).map(k => parseInt(k, 10)),
    fromHills: Array.from(fromHills.keys()).map(k => parseInt(k, 10)),
    comment: elements.photoComment.value.trim(),
    crc: crc,
    crop: {
      x: cropData.x,
      y: cropData.y,
      width: Math.max(1600, cropData.width),
      height: Math.max(900, cropData.height)
    },
    imageBase64: imageBase64
  };

  // Capture current index before asynchronous processing so we can advance to the next photo
  const targetIndex = currentIndex;

  try {
    elements.btnProcess.disabled = true;
    elements.btnProcess.textContent = 'Processing & Archiving...';

    const res = await fetch('api/photos.php?action=process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to process photo');
    }

    showToast(`✓ Published as ${result.savedFile} and archived original!`);
    // Reload staging queue and automatically select the next photo in sequence
    await loadStagingQueue(targetIndex);
  } catch (err) {
    console.error('Process error:', err);
    showToast(`Error processing photo: ${err.message}`, true);
  } finally {
    elements.btnProcess.disabled = false;
    updateTargetAndValidation();
  }
}

/**
 * Simply archives the current staging photo without publishing to the website.
 * (For photos deemed not needed on the website).
 */
async function archiveCurrentPhoto() {
  if (!currentPhoto) return;
  // Capture current index so we advance to the next photo in queue
  const targetIndex = currentIndex;

  try {
    elements.btnArchiveSingle.disabled = true;
    elements.btnArchiveSingle.textContent = 'Archiving...';

    const res = await fetch('api/photos.php?action=archive_single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: currentPhoto.filename })
    });

    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to archive photo');
    }

    showToast(`🗄️ Photo moved to archive without publishing.`);
    // Reload staging queue and automatically select the next photo in sequence
    await loadStagingQueue(targetIndex);
  } catch (err) {
    console.error('Archive error:', err);
    showToast(`Error archiving photo: ${err.message}`, true);
  } finally {
    elements.btnArchiveSingle.disabled = false;
    elements.btnArchiveSingle.textContent = '🗄️ Archive';
  }
}

/**
 * Permanently deletes the current active photo from the staging folder.
 */
async function deleteCurrentPhoto() {
  if (!currentPhoto) return;
  if (!confirm(`Are you sure you want to permanently delete "${currentPhoto.filename}" from the staging folder?`)) {
    return;
  }
  // Capture current index so we advance to the next photo in queue
  const targetIndex = currentIndex;

  try {
    const res = await fetch('api/photos.php?action=delete_staging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: currentPhoto.filename })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Photo removed from staging.');
      // Reload staging queue and automatically select the next photo in sequence
      await loadStagingQueue(targetIndex);
    } else {
      throw new Error(result.error || 'Could not delete file');
    }
  } catch (err) {
    showToast(`Delete error: ${err.message}`, true);
  }
}

// ============================================================================
// AREA 2: LIVE PHOTOS CONTROLLER
// ============================================================================

/**
 * Loads all live photos from api/photos.php.
 */
async function loadLivePhotos() {
  try {
    elements.btnRefreshLive.classList.add('loading');
    const res = await fetch('api/photos.php?action=live_list');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to load live photos');
    }

    livePhotos = data.live || [];
    updateGlobalCounts(data.stats || null);
    renderLivePhotos();
  } catch (err) {
    console.error('Live load error:', err);
    showToast(`Error loading live photos: ${err.message}`, true);
  } finally {
    elements.btnRefreshLive.classList.remove('loading');
  }
}

/**
 * Renders live photo cards grid.
 */
function renderLivePhotos() {
  const query = (elements.liveSearch ? elements.liveSearch.value : liveSearchQuery).trim().toLowerCase();
  
  let filtered = livePhotos;
  if (query) {
    filtered = livePhotos.filter(item => {
      if (item.file && item.file.toLowerCase().includes(query)) return true;
      if (item.crc && item.crc.toLowerCase().includes(query)) return true;
      if (item.comment && item.comment.toLowerCase().includes(query)) return true;
      if (item.allHills && item.allHills.some(hid => {
        const hill = hillsById.get(String(hid));
        return String(hid).includes(query) || (hill && hill.searchIndex.includes(query));
      })) return true;
      return false;
    });
  }

  // Update stats
  const distinctHills = new Set();
  let archivedCount = 0;
  livePhotos.forEach(p => {
    (p.allHills || []).forEach(hid => distinctHills.add(hid));
    if (p.hasArchive) archivedCount++;
  });

  if (elements.liveStatTotal) elements.liveStatTotal.textContent = `${filtered.length} of ${livePhotos.length} Live Photo${livePhotos.length === 1 ? '' : 's'}`;
  if (elements.liveStatHills) elements.liveStatHills.textContent = `${distinctHills.size} Summits Covered`;
  if (elements.liveStatArchived) elements.liveStatArchived.textContent = `${archivedCount} Linked to Archive`;

  if (filtered.length === 0) {
    elements.livePhotoGrid.style.display = 'none';
    elements.liveEmptyState.style.display = 'flex';
    return;
  }

  elements.livePhotoGrid.style.display = 'grid';
  elements.liveEmptyState.style.display = 'none';
  elements.livePhotoGrid.innerHTML = '';

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'gallery-card live-card';

    // Format primary chips
    const primaryHtml = (item.primary || []).map(hid => {
      const h = hillsById.get(String(hid));
      return `<span class="chip-mini primary">#${hid} ${h ? h.name : ''}</span>`;
    }).join('');

    // Format secondary chips
    const secondaryHtml = (item.secondary || []).map(hid => {
      const h = hillsById.get(String(hid));
      return `<span class="chip-mini secondary">#${hid} ${h ? h.name : ''}</span>`;
    }).join('');

    // Format from chips
    const fromHtml = (item.from || []).map(hid => {
      const h = hillsById.get(String(hid));
      return `<span class="chip-mini from">#${hid} ${h ? h.name : ''}</span>`;
    }).join('');

    const archiveLinkHtml = item.hasArchive && item.archiveInfo
      ? `<div class="card-archive-link" title="Original photo stored in archive">
           <span>✓ Original: <b>${escapeHtml(item.archiveInfo.filename)}</b></span>
         </div>`
      : `<div class="card-archive-missing">⚠️ No original file found in archive</div>`;

    card.innerHTML = `
      <div class="card-img-wrap" onclick="window.open('${item.url}', '_blank')">
        <img src="${item.url}" alt="${item.file}" loading="lazy">
      </div>
      <div class="card-body">
        <div class="card-filename-row">
          <span class="card-filename" title="${item.file}">${item.file}</span>
          <span class="card-filesize">${item.sizeFormatted}</span>
        </div>

        ${item.comment ? `<div class="card-caption">"${escapeHtml(item.comment)}"</div>` : ''}

        <div class="card-chips-group">
          ${primaryHtml ? `<div class="card-chip-row"><span class="card-chip-label">Primary:</span>${primaryHtml}</div>` : ''}
          ${secondaryHtml ? `<div class="card-chip-row"><span class="card-chip-label">Secondary:</span>${secondaryHtml}</div>` : ''}
          ${fromHtml ? `<div class="card-chip-row"><span class="card-chip-label">From:</span>${fromHtml}</div>` : ''}
        </div>

        ${archiveLinkHtml}
      </div>

      <div class="card-actions">
        <button type="button" class="btn btn-sm" onclick="window.open('${item.url}', '_blank')">🔍 Full Size</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="openEditLiveModal('${escapeJs(item.file)}')">📝 Metadata</button>
        ${item.hasArchive && item.archiveInfo ? `<button type="button" class="btn btn-sm" onclick="recropFromArchive('${escapeJs(item.archiveInfo.filename)}')" title="Load into Staging workbench to crop and edit">✏️ Edit</button>` : ''}
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteLivePhoto('${escapeJs(item.file)}')">🗑️ Remove</button>
      </div>
    `;

    elements.livePhotoGrid.appendChild(card);
  });
}

/**
 * Removes a live photo from image/hills and photos.json (leaving archive copy safe).
 */
async function deleteLivePhoto(filename) {
  if (!confirm(`Are you sure you want to remove "${filename}" from the website?\n\nThe original file in the archive will be preserved.`)) {
    return;
  }

  try {
    const res = await fetch('api/photos.php?action=delete_live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to remove photo');

    showToast('Photo removed from website. Original preserved in archive.');
    await loadLivePhotos();
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

// ============================================================================
// AREA 3: ARCHIVE CONTROLLER
// ============================================================================

/**
 * Loads all archived photos from api/photos.php.
 */
async function loadArchiveList() {
  try {
    elements.btnRefreshArchive.classList.add('loading');
    const res = await fetch('api/photos.php?action=archive_list');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to load archive list');
    }

    archivePhotos = data.archive || [];
    updateGlobalCounts(data.stats || null);

    if (elements.subtabCountAll) elements.subtabCountAll.textContent = archivePhotos.length;
    if (elements.subtabCountLive) elements.subtabCountLive.textContent = data.liveCount ?? 0;
    if (elements.subtabCountUnprocessed) elements.subtabCountUnprocessed.textContent = data.archivedOnlyCount ?? 0;

    renderArchivePhotos();
  } catch (err) {
    console.error('Archive load error:', err);
    showToast(`Error loading archive list: ${err.message}`, true);
  } finally {
    elements.btnRefreshArchive.classList.remove('loading');
  }
}

function setArchiveFilter(filter) {
  archiveFilter = filter;
  const subtabs = document.querySelectorAll('.toolbar-filter-tabs .subtab-btn');
  subtabs.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
  });
  renderArchivePhotos();
}

/**
 * Renders archived photos grid.
 */
function renderArchivePhotos() {
  const query = (elements.archiveSearch ? elements.archiveSearch.value : archiveSearchQuery).trim().toLowerCase();

  let filtered = archivePhotos;

  // Filter by subtab status
  if (archiveFilter === 'live') {
    filtered = filtered.filter(p => p.isLive);
  } else if (archiveFilter === 'unprocessed') {
    filtered = filtered.filter(p => !p.isLive);
  }

  // Filter by query
  if (query) {
    filtered = filtered.filter(p => {
      if (p.filename && p.filename.toLowerCase().includes(query)) return true;
      if (p.crc && p.crc.toLowerCase().includes(query)) return true;
      if (p.parsed && p.parsed.areaHint && p.parsed.areaHint.toLowerCase().includes(query)) return true;
      if (p.parsed && p.parsed.dateFormatted && p.parsed.dateFormatted.includes(query)) return true;
      return false;
    });
  }

  if (filtered.length === 0) {
    elements.archivePhotoGrid.style.display = 'none';
    elements.archiveEmptyState.style.display = 'flex';
    return;
  }

  elements.archivePhotoGrid.style.display = 'grid';
  elements.archiveEmptyState.style.display = 'none';
  elements.archivePhotoGrid.innerHTML = '';

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'gallery-card archive-card';

    const parsed = item.parsed || {};
    const dateStr = parsed.dateFormatted ? `${parsed.dateFormatted} ${parsed.timeFormatted || ''}` : 'Date unknown';
    const areaStr = parsed.areaHint || 'Area unassigned';

    let liveStatusHtml = '';
    if (item.isLive && item.liveInfo) {
      liveStatusHtml = `
        <div class="card-archive-link" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4);">
          <span>🟢 Live: <b>${escapeHtml(item.liveInfo.file)}</b></span>
          <button type="button" class="btn btn-sm" onclick="window.open('../image/hills/${item.liveInfo.file}', '_blank')" title="View Live cropped 16:9 photo">View</button>
        </div>
      `;
    } else {
      liveStatusHtml = `
        <div class="card-archive-missing">⚪ Archived Only (Not on website)</div>
      `;
    }

    card.innerHTML = `
      <div class="card-img-wrap" onclick="window.open('${item.url}', '_blank')">
        <img src="${item.url}" alt="${item.filename}" loading="lazy">
        <span class="card-status-badge ${item.isLive ? 'live' : 'unprocessed'}">
          ${item.isLive ? 'Live' : 'Archived Only'}
        </span>
      </div>

      <div class="card-body">
        <div class="card-filename-row">
          <span class="card-filename" title="${item.filename}">${item.filename}</span>
          <span class="card-filesize">${item.sizeFormatted}</span>
        </div>

        <div class="card-meta-line">
          <span>📅 ${escapeHtml(dateStr)}</span>
          <span>📍 ${escapeHtml(areaStr)}</span>
        </div>

        ${liveStatusHtml}
      </div>

      <div class="card-actions">
        <button type="button" class="btn btn-sm" onclick="window.open('${item.url}', '_blank')">🔍 Full Size</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="recropFromArchive('${escapeJs(item.filename)}')" title="Load into Staging workbench to crop and edit">✏️ Edit</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteArchivePhoto('${escapeJs(item.filename)}')">🗑️ Delete</button>
      </div>
    `;

    elements.archivePhotoGrid.appendChild(card);
  });
}

/**
 * Loads an archived photo directly into Staging cropper so user can crop and publish it to Live.
 */
async function recropFromArchive(filename) {
  try {
    const res = await fetch('api/photos.php?action=send_to_staging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename, copy: true })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to prepare photo for staging');

    showToast('Loaded photo into Staging workbench.');
    switchArea('staging');
    await loadStagingQueue(filename);
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

/**
 * Copies an archived photo to staging queue.
 */
async function sendToStaging(filename) {
  try {
    const res = await fetch('api/photos.php?action=send_to_staging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename, copy: true })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to send to staging');

    showToast(`✓ "${filename}" copied to Staging queue.`);
    const statsRes = await fetch('api/photos.php?action=queue');
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      updateGlobalCounts(statsData.stats);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

/**
 * Deletes an archived photo.
 */
async function deleteArchivePhoto(filename) {
  if (!confirm(`Are you sure you want to permanently delete "${filename}" from the archive?`)) {
    return;
  }

  try {
    const res = await fetch('api/photos.php?action=delete_archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to delete photo');

    showToast('Archived photo deleted.');
    await loadArchiveList();
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}

// ============================================================================
// MODAL: EDIT LIVE PHOTO METADATA
// ============================================================================

function openEditLiveModal(filename) {
  const photo = livePhotos.find(p => p.file === filename);
  if (!photo) return;

  editingLivePhoto = photo;
  modalPrimaryHills.clear();
  modalSecondaryHills.clear();
  modalFromHills.clear();

  elements.modalPreviewImg.src = photo.url;
  elements.modalFileName.textContent = photo.file;
  elements.modalFileCrc.textContent = `CRC32: #${photo.crc || '—'}`;
  elements.modalFileArchive.textContent = photo.hasArchive && photo.archiveInfo 
    ? `Linked original: ${photo.archiveInfo.filename}`
    : 'No linked original in archive';

  (photo.primary || []).forEach(hid => {
    const h = hillsById.get(String(hid));
    if (h) modalPrimaryHills.set(String(hid), h);
  });
  (photo.secondary || []).forEach(hid => {
    const h = hillsById.get(String(hid));
    if (h) modalSecondaryHills.set(String(hid), h);
  });
  (photo.from || []).forEach(hid => {
    const h = hillsById.get(String(hid));
    if (h) modalFromHills.set(String(hid), h);
  });

  elements.modalComment.value = photo.comment || '';

  renderModalChips('primary');
  renderModalChips('secondary');
  renderModalChips('from');

  elements.modalEditLive.style.display = 'flex';
}

function closeEditLiveModal() {
  elements.modalEditLive.style.display = 'none';
  editingLivePhoto = null;
}

function renderModalChips(category) {
  let map, container, badge;
  if (category === 'primary') {
    map = modalPrimaryHills;
    container = elements.modalPrimaryChips;
    badge = elements.modalPrimaryCount;
  } else if (category === 'secondary') {
    map = modalSecondaryHills;
    container = elements.modalSecondaryChips;
    badge = elements.modalSecondaryCount;
  } else {
    map = modalFromHills;
    container = elements.modalFromChips;
    badge = elements.modalFromCount;
  }

  container.innerHTML = '';
  badge.textContent = `${map.size} selected`;

  if (map.size === 0) {
    container.innerHTML = '<span class="chips-empty-hint">None selected</span>';
    return;
  }

  map.forEach((hill, id) => {
    const chip = document.createElement('span');
    chip.className = `tag-chip chip-${category}`;
    chip.innerHTML = `
      <span>#${escapeHtml(hill.number)} ${escapeHtml(hill.name)}</span>
      <span class="remove-tag-btn" title="Remove summit">&times;</span>
    `;
    chip.querySelector('.remove-tag-btn').onclick = () => {
      map.delete(id);
      renderModalChips(category);
    };
    container.appendChild(chip);
  });
}

async function saveLiveMeta() {
  if (!editingLivePhoto) return;

  const primaryIds = Array.from(modalPrimaryHills.keys()).map(k => parseInt(k, 10));
  const secondaryIds = Array.from(modalSecondaryHills.keys()).map(k => parseInt(k, 10));
  const fromIds = Array.from(modalFromHills.keys()).map(k => parseInt(k, 10));
  const comment = elements.modalComment.value.trim();

  if (primaryIds.length === 0 && fromIds.length === 0) {
    showToast('At least one hill must be in Primary or Taken From.', true);
    return;
  }

  try {
    elements.btnSaveLiveMeta.disabled = true;
    elements.btnSaveLiveMeta.textContent = 'Saving...';

    const res = await fetch('api/photos.php?action=update_live_meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: editingLivePhoto.file,
        primaryHills: primaryIds,
        secondaryHills: secondaryIds,
        fromHills: fromIds,
        comment: comment
      })
    });

    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to update metadata');

    showToast('Live details updated successfully.');
    closeEditLiveModal();
    await loadLivePhotos();
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  } finally {
    elements.btnSaveLiveMeta.disabled = false;
    elements.btnSaveLiveMeta.textContent = 'Save Changes';
  }
}

// ============================================================================
// UTILITIES & EVENT LISTENERS
// ============================================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

let toastTimer = null;
function showToast(message, isError = false) {
  if (toastTimer) clearTimeout(toastTimer);
  elements.toastMsg.textContent = message;
  elements.toast.classList.toggle('toast-error', isError);
  elements.toast.classList.add('show');
  const duration = isError ? 12000 : 4000;
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove('show');
  }, duration);
}

function setupEventListeners() {
  // Global Refresh (preserves current active photo position in staging)
  elements.btnRefresh.onclick = () => {
    if (currentArea === 'staging') loadStagingQueue(currentIndex);
    else if (currentArea === 'live') loadLivePhotos();
    else if (currentArea === 'archive') loadArchiveList();
  };

  // Toast Close
  if (elements.toastClose) {
    elements.toastClose.onclick = () => {
      if (toastTimer) clearTimeout(toastTimer);
      elements.toast.classList.remove('show');
    };
  }

  // Cropper Controls
  elements.btnZoomIn.onclick = () => cropper && cropper.zoom(0.1);
  elements.btnZoomOut.onclick = () => cropper && cropper.zoom(-0.1);
  if (elements.btnRotateCCW) {
    elements.btnRotateCCW.onclick = () => {
      baseOrientation = (baseOrientation - 90 + 360) % 360;
      updateCropperRotation();
    };
  }
  if (elements.btnRotate) {
    elements.btnRotate.onclick = () => {
      baseOrientation = (baseOrientation + 90) % 360;
      updateCropperRotation();
    };
  }
  elements.btnResetCrop.onclick = () => cropper && cropper.reset();
  elements.btnFitFull.onclick = () => {
    if (!cropper) return;
    const imgData = cropper.getImageData();
    const targetAspect = 16 / 9;
    let newWidth, newHeight;
    if (imgData.aspectRatio >= targetAspect) {
      newHeight = imgData.naturalHeight;
      newWidth = newHeight * targetAspect;
    } else {
      newWidth = imgData.naturalWidth;
      newHeight = newWidth / targetAspect;
    }
    cropper.setData({
      x: (imgData.naturalWidth - newWidth) / 2,
      y: (imgData.naturalHeight - newHeight) / 2,
      width: newWidth,
      height: newHeight
    });
  };

  // Tweak Button (toggles straighten and color adjustments panel)
  if (elements.btnToggleTweak && elements.adjustmentsPanel) {
    elements.btnToggleTweak.onclick = () => {
      const isHidden = elements.adjustmentsPanel.style.display === 'none' || !elements.adjustmentsPanel.style.display;
      if (isHidden) {
        elements.adjustmentsPanel.style.display = 'flex';
        elements.btnToggleTweak.classList.add('active');
        if (elements.tabColor) elements.tabColor.click();
      } else {
        elements.adjustmentsPanel.style.display = 'none';
        elements.btnToggleTweak.classList.remove('active');
      }
    };
  }

  // Adjustments Tabs
  elements.tabStraighten.onclick = () => {
    elements.tabStraighten.classList.add('active');
    elements.tabColor.classList.remove('active');
    elements.contentStraighten.style.display = 'flex';
    elements.contentColor.style.display = 'none';
  };
  elements.tabColor.onclick = () => {
    elements.tabColor.classList.add('active');
    elements.tabStraighten.classList.remove('active');
    elements.contentColor.style.display = 'flex';
    elements.contentStraighten.style.display = 'none';
  };

  // Straighten Slider
  elements.sliderRotate.oninput = (e) => {
    straightenAngle = parseFloat(e.target.value);
    adjustments.rotate = straightenAngle;
    elements.valRotate.textContent = `${straightenAngle >= 0 ? '+' : ''}${straightenAngle.toFixed(1)}°`;
    updateCropperRotation();
  };

  const applyNudge = (delta) => {
    straightenAngle = Math.min(45, Math.max(-45, parseFloat((straightenAngle + delta).toFixed(1))));
    elements.sliderRotate.value = straightenAngle;
    adjustments.rotate = straightenAngle;
    elements.valRotate.textContent = `${straightenAngle >= 0 ? '+' : ''}${straightenAngle.toFixed(1)}°`;
    updateCropperRotation();
  };

  elements.btnRotMinus1.onclick = () => applyNudge(-1.0);
  elements.btnRotMinus01.onclick = () => applyNudge(-0.1);
  elements.btnRotZero.onclick = () => {
    straightenAngle = 0.0;
    elements.sliderRotate.value = 0;
    adjustments.rotate = 0;
    elements.valRotate.textContent = '0.0°';
    updateCropperRotation();
  };
  elements.btnRotPlus01.onclick = () => applyNudge(0.1);
  elements.btnRotPlus1.onclick = () => applyNudge(1.0);

  // Toggle Grid Lines Overlay
  elements.btnToggleGrid.onclick = () => {
    showHorizonGrid = !showHorizonGrid;
    elements.horizonGridOverlay.style.display = showHorizonGrid ? 'block' : 'none';
    elements.btnToggleGrid.classList.toggle('active', showHorizonGrid);
  };

  // Color & Contrast Controls with Fine-Tuning
  const updateContrast = (val) => {
    adjustments.contrast = Math.min(160, Math.max(50, val));
    if (elements.sliderContrast) elements.sliderContrast.value = adjustments.contrast;
    if (elements.valContrast) elements.valContrast.textContent = `${adjustments.contrast}%`;
    applyColorFilters();
  };
  const updateSat = (val) => {
    adjustments.saturation = Math.min(200, Math.max(0, val));
    if (elements.sliderSaturation) elements.sliderSaturation.value = adjustments.saturation;
    if (elements.valSaturation) elements.valSaturation.textContent = `${adjustments.saturation}%`;
    applyColorFilters();
  };
  const updateBright = (val) => {
    adjustments.brightness = Math.min(140, Math.max(60, val));
    if (elements.sliderBrightness) elements.sliderBrightness.value = adjustments.brightness;
    if (elements.valBrightness) elements.valBrightness.textContent = `${adjustments.brightness}%`;
    applyColorFilters();
  };
  const updateHue = (val) => {
    adjustments.hue = Math.min(180, Math.max(-180, val));
    if (elements.sliderHue) elements.sliderHue.value = adjustments.hue;
    if (elements.valHue) elements.valHue.textContent = `${adjustments.hue}°`;
    applyColorFilters();
  };

  // Slider input listeners
  if (elements.sliderContrast) elements.sliderContrast.oninput = (e) => updateContrast(parseInt(e.target.value, 10));
  if (elements.sliderSaturation) elements.sliderSaturation.oninput = (e) => updateSat(parseInt(e.target.value, 10));
  if (elements.sliderBrightness) elements.sliderBrightness.oninput = (e) => updateBright(parseInt(e.target.value, 10));
  if (elements.sliderHue) elements.sliderHue.oninput = (e) => updateHue(parseInt(e.target.value, 10));

  // Nudge +/- button listeners
  if (elements.btnContrastMinus) elements.btnContrastMinus.onclick = () => updateContrast(adjustments.contrast - 1);
  if (elements.btnContrastPlus) elements.btnContrastPlus.onclick = () => updateContrast(adjustments.contrast + 1);
  if (elements.btnSatMinus) elements.btnSatMinus.onclick = () => updateSat(adjustments.saturation - 1);
  if (elements.btnSatPlus) elements.btnSatPlus.onclick = () => updateSat(adjustments.saturation + 1);
  if (elements.btnBrightMinus) elements.btnBrightMinus.onclick = () => updateBright(adjustments.brightness - 1);
  if (elements.btnBrightPlus) elements.btnBrightPlus.onclick = () => updateBright(adjustments.brightness + 1);
  if (elements.btnHueMinus) elements.btnHueMinus.onclick = () => updateHue(adjustments.hue - 1);
  if (elements.btnHuePlus) elements.btnHuePlus.onclick = () => updateHue(adjustments.hue + 1);

  // Individual Reset icons beside titles
  if (elements.btnResetRotate) {
    elements.btnResetRotate.onclick = () => {
      straightenAngle = 0.0;
      elements.sliderRotate.value = 0;
      adjustments.rotate = 0;
      elements.valRotate.textContent = '0.0°';
      updateCropperRotation();
    };
  }
  if (elements.btnResetContrast) elements.btnResetContrast.onclick = () => updateContrast(100);
  if (elements.btnResetSat) elements.btnResetSat.onclick = () => updateSat(100);
  if (elements.btnResetBright) elements.btnResetBright.onclick = () => updateBright(100);
  if (elements.btnResetHue) elements.btnResetHue.onclick = () => updateHue(0);

  // Reset Adjustments (all)
  elements.btnResetAdjustments.onclick = () => {
    straightenAngle = 0.0;
    adjustments = { rotate: 0.0, contrast: 100, saturation: 100, brightness: 100, hue: 0 };
    syncAdjustmentSliders();
    updateCropperRotation();
    applyColorFilters();
  };

  // Hold to Compare
  const startCompare = () => {
    const imgs = elements.viewportCard.querySelectorAll('.cropper-container img, #cropper-image');
    imgs.forEach(img => { img.style.filter = 'none'; });
    if (cropper) cropper.rotateTo(baseOrientation);
  };
  const endCompare = () => {
    applyCropperTransforms();
  };
  elements.btnCompare.addEventListener('mousedown', startCompare);
  elements.btnCompare.addEventListener('mouseup', endCompare);
  elements.btnCompare.addEventListener('mouseleave', endCompare);
  elements.btnCompare.addEventListener('touchstart', (e) => { e.preventDefault(); startCompare(); });
  elements.btnCompare.addEventListener('touchend', endCompare);

  // Staging Summits Search Listeners
  let primarySearchTimer;
  elements.primarySearch.addEventListener('input', (e) => {
    clearTimeout(primarySearchTimer);
    primarySearchTimer = setTimeout(() => {
      searchHills(e.target.value, elements.primarySuggestions, (h) => addHillToCategory('primary', h));
    }, 180);
  });
  elements.primarySearch.addEventListener('focus', (e) => {
    if (e.target.value.trim()) {
      searchHills(e.target.value, elements.primarySuggestions, (h) => addHillToCategory('primary', h));
    }
  });

  let secondarySearchTimer;
  elements.secondarySearch.addEventListener('input', (e) => {
    clearTimeout(secondarySearchTimer);
    secondarySearchTimer = setTimeout(() => {
      searchHills(e.target.value, elements.secondarySuggestions, (h) => addHillToCategory('secondary', h));
    }, 180);
  });
  elements.secondarySearch.addEventListener('focus', (e) => {
    if (e.target.value.trim()) {
      searchHills(e.target.value, elements.secondarySuggestions, (h) => addHillToCategory('secondary', h));
    }
  });

  let fromSearchTimer;
  elements.fromSearch.addEventListener('input', (e) => {
    clearTimeout(fromSearchTimer);
    fromSearchTimer = setTimeout(() => {
      searchHills(e.target.value, elements.fromSuggestions, (h) => addHillToCategory('from', h));
    }, 180);
  });
  elements.fromSearch.addEventListener('focus', (e) => {
    if (e.target.value.trim()) {
      searchHills(e.target.value, elements.fromSuggestions, (h) => addHillToCategory('from', h));
    }
  });

  // Modal Autocomplete Search Listeners
  let modalPrimaryTimer;
  elements.modalPrimarySearch.addEventListener('input', (e) => {
    clearTimeout(modalPrimaryTimer);
    modalPrimaryTimer = setTimeout(() => {
      searchHills(e.target.value, elements.modalPrimarySuggestions, (h) => {
        modalPrimaryHills.set(String(h.number), h);
        modalSecondaryHills.delete(String(h.number));
        renderModalChips('primary');
      });
    }, 180);
  });

  let modalSecondaryTimer;
  elements.modalSecondarySearch.addEventListener('input', (e) => {
    clearTimeout(modalSecondaryTimer);
    modalSecondaryTimer = setTimeout(() => {
      searchHills(e.target.value, elements.modalSecondarySuggestions, (h) => {
        if (!modalPrimaryHills.has(String(h.number))) {
          modalSecondaryHills.set(String(h.number), h);
          renderModalChips('secondary');
        }
      });
    }, 180);
  });

  let modalFromTimer;
  elements.modalFromSearch.addEventListener('input', (e) => {
    clearTimeout(modalFromTimer);
    modalFromTimer = setTimeout(() => {
      searchHills(e.target.value, elements.modalFromSuggestions, (h) => {
        modalFromHills.set(String(h.number), h);
        renderModalChips('from');
      });
    }, 180);
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (elements.primarySuggestions && !e.target.closest('#primary-search') && !e.target.closest('#primary-suggestions')) {
      elements.primarySuggestions.classList.remove('open');
    }
    if (elements.secondarySuggestions && !e.target.closest('#secondary-search') && !e.target.closest('#secondary-suggestions')) {
      elements.secondarySuggestions.classList.remove('open');
    }
    if (elements.fromSuggestions && !e.target.closest('#from-search') && !e.target.closest('#from-suggestions')) {
      elements.fromSuggestions.classList.remove('open');
    }
    if (elements.modalPrimarySuggestions && !e.target.closest('#modal-primary-search') && !e.target.closest('#modal-primary-suggestions')) {
      elements.modalPrimarySuggestions.classList.remove('open');
    }
    if (elements.modalSecondarySuggestions && !e.target.closest('#modal-secondary-search') && !e.target.closest('#modal-secondary-suggestions')) {
      elements.modalSecondarySuggestions.classList.remove('open');
    }
    if (elements.modalFromSuggestions && !e.target.closest('#modal-from-search') && !e.target.closest('#modal-from-suggestions')) {
      elements.modalFromSuggestions.classList.remove('open');
    }
  });

  // Caption Helpers
  if (elements.btnClearComment) {
    elements.btnClearComment.onclick = () => {
      elements.photoComment.value = '';
    };
  }

  // Staging Action Buttons
  elements.btnProcess.onclick = processCurrentPhoto;
  elements.btnArchiveSingle.onclick = archiveCurrentPhoto;
  elements.btnDelete.onclick = deleteCurrentPhoto;

  // Viewport & Filmstrip Navigation Buttons
  if (elements.btnPrevPhoto) elements.btnPrevPhoto.onclick = selectPrevPhoto;
  if (elements.btnNextPhoto) elements.btnNextPhoto.onclick = selectNextPhoto;
  if (elements.btnChevronPrev) elements.btnChevronPrev.onclick = selectPrevPhoto;
  if (elements.btnChevronNext) elements.btnChevronNext.onclick = selectNextPhoto;
  if (elements.btnStripPrev) elements.btnStripPrev.onclick = selectPrevPhoto;
  if (elements.btnStripNext) elements.btnStripNext.onclick = selectNextPhoto;

  // Live Area Search
  if (elements.liveSearch) {
    elements.liveSearch.addEventListener('input', (e) => {
      liveSearchQuery = e.target.value;
      renderLivePhotos();
    });
  }

  // Archive Area Search
  if (elements.archiveSearch) {
    elements.archiveSearch.addEventListener('input', (e) => {
      archiveSearchQuery = e.target.value;
      renderArchivePhotos();
    });
  }

  // Keyboard Arrow Navigation
  window.addEventListener('keydown', (e) => {
    if (currentArea !== 'staging') return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      selectPrevPhoto();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      selectNextPhoto();
    }
  });
}

// =====================================================================
// DATA PREPARATION MODAL (CSV to dobih.json)
// =====================================================================

async function openDataPrepModal() {
  const modal = document.getElementById('modal-data-prep');
  if (!modal) return;
  modal.style.display = 'flex';
  const consoleBox = document.getElementById('data-prep-console');
  if (consoleBox) consoleBox.style.display = 'none';

  await refreshDataPrepStatus();
}

function closeDataPrepModal() {
  const modal = document.getElementById('modal-data-prep');
  if (modal) modal.style.display = 'none';
}

async function refreshDataPrepStatus() {
  const csvMeta = document.getElementById('data-csv-meta');
  const jsonMeta = document.getElementById('data-json-meta');
  if (csvMeta) csvMeta.textContent = 'Checking...';
  if (jsonMeta) jsonMeta.textContent = 'Checking...';

  try {
    const res = await fetch('api/photos.php?action=data_status');
    const data = await res.json();
    if (data.success) {
      if (csvMeta) {
        csvMeta.textContent = data.csv.exists
          ? `${data.csv.sizeFormatted} • Modified: ${data.csv.mtimeFormatted}`
          : '⚠️ Not found';
      }
      if (jsonMeta) {
        jsonMeta.textContent = data.json.exists
          ? `${data.json.sizeFormatted} • Modified: ${data.json.mtimeFormatted}`
          : '⚠️ Not compiled yet';
      }
    }
  } catch (err) {
    if (csvMeta) csvMeta.textContent = 'Error checking';
    if (jsonMeta) jsonMeta.textContent = 'Error checking';
  }
}

async function rebuildDoBIHData() {
  const btn = document.getElementById('btn-rebuild-data');
  const consoleBox = document.getElementById('data-prep-console');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Compiling...';
  }
  if (consoleBox) {
    consoleBox.style.display = 'block';
    consoleBox.textContent = 'Starting PowerShell CSV to JSON conversion...\nPlease wait, processing ~20,000 summits...';
  }

  try {
    const res = await fetch('api/photos.php?action=rebuild_data');
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'dobih.json successfully rebuilt!');
      if (consoleBox) {
        consoleBox.textContent = `SUCCESS: ${data.message}\nOutput Size: ${data.outputSizeFormatted}\n\n${data.stdout || ''}`;
      }
      await refreshDataPrepStatus();
      // Reload hill search database in Photos studio
      await loadDobihDatabase();
    } else {
      showToast(data.error || 'Failed to rebuild database', true);
      if (consoleBox) {
        consoleBox.textContent = `ERROR:\n${data.error || 'Unknown error'}`;
      }
    }
  } catch (err) {
    showToast('Network error during build', true);
    if (consoleBox) {
      consoleBox.textContent = `Network Error: ${err.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
        Rebuild dobih.json
      `;
    }
  }
}

// Expose modal handlers to window for inline onclick attributes
window.openDataPrepModal = openDataPrepModal;
window.closeDataPrepModal = closeDataPrepModal;
window.rebuildDoBIHData = rebuildDoBIHData;
