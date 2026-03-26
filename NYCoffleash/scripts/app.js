// NYC Open Data – 311 Service Requests (Socrata v2.1 JSON API)
// Filtered to: 'Dog Off Leash' (DPR) + 'Unleashed Dog in Public' (DOHMH)
const API_BASE = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json';

// NYC Parks Dog Runs & Off-Leash Areas
const DOG_RUNS_API = 'https://data.cityofnewyork.us/resource/hxx3-bwgv.geojson';

// NYC Parks Animal Condition Response (Urban Park Rangers)
const ANIMAL_API = 'https://data.cityofnewyork.us/resource/fuhs-xmg2.json';

// Cache TTLs
const CACHE_TTL_PARK_LIST = 24 * 60 * 60 * 1000;       // 24 hours
const CACHE_TTL_DOG_RUNS  = 7 * 24 * 60 * 60 * 1000;   // 7 days (static data)

// In-memory cache for individual park boundaries (cleared on page reload)
const parkBoundaryCache = new Map();

// Fix double-encoded UTF-8 from the source data (e.g. "Ã±" → "ñ")
function fixEncoding(str) {
  if (!str) return str;
  try { return decodeURIComponent(escape(str)); } catch { return str; }
}

// Escape HTML entities to prevent XSS when inserting API data into innerHTML
function escHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Convenience: fix encoding then escape HTML
function safeText(str) { return escHTML(fixEncoding(str)); }

let map;
let activePopup  = null;
let currentData  = [];
let currentMode  = 'dogruns'; // 'complaints' | 'dogruns' | 'animals'
let dogRunsData  = { type: 'FeatureCollection', features: [] };
let animalData   = [];
let allParksData = null;
let allParksCentroidMap = null;

// ── Map init ─────────────────────────────────────────────────────
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-74.006, 40.7128],
    zoom: 10,
    maxBounds: [[-74.6, 40.4], [-73.3, 41.0]],
    minZoom: 8,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // Mark body so CSS can keep attribution collapsed until map loads
  document.body.classList.add('map-loading');

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

  // Handle map load errors — prompt user to reload
  map.on('error', (e) => {
    if (e.error && e.error.status === 0) {
      showLoadError();
    }
  });

  map.on('load', () => {
    // Close attribution and remove loading guard
    const attrEl = document.querySelector('.maplibregl-ctrl-attrib');
    if (attrEl) { attrEl.classList.remove('maplibregl-compact-show'); attrEl.removeAttribute('open'); }
    document.body.classList.remove('map-loading');

    // ── Borough boundaries ──────────────────────────────────────
    map.addSource('boroughs', {
      type: 'geojson',
      data: 'data/boroughs.geojson',
    });

    map.addLayer({
      id: 'borough-fill',
      type: 'fill',
      source: 'boroughs',
      paint: {
        'fill-color': '#e85d04',
        'fill-opacity': 0,
      },
    });

    map.addLayer({
      id: 'borough-outline',
      type: 'line',
      source: 'boroughs',
      paint: {
        'line-color': '#e85d04',
        'line-width': 1.5,
        'line-opacity': 0.35,
      },
    });

    // ── All parks (clickable background layer) ───────────────────
    map.addSource('all-parks', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      generateId: true,
    });

    map.addLayer({
      id: 'all-parks-fill',
      type: 'fill',
      source: 'all-parks',
      paint: {
        'fill-color': '#3a7d44',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.28, 0.14],
      },
    });

    map.addLayer({
      id: 'all-parks-outline',
      type: 'line',
      source: 'all-parks',
      paint: { 'line-color': '#1a3d22', 'line-width': 1, 'line-opacity': 0.5 },
    });

    let hoveredParkId = null;

    map.on('mousemove', 'all-parks-fill', (e) => {
      if (e.features.length > 0) {
        if (hoveredParkId !== null) {
          map.setFeatureState({ source: 'all-parks', id: hoveredParkId }, { hover: false });
        }
        hoveredParkId = e.features[0].id;
        map.setFeatureState({ source: 'all-parks', id: hoveredParkId }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';
      }
    });
    map.on('mouseleave', 'all-parks-fill', () => {
      if (hoveredParkId !== null) {
        map.setFeatureState({ source: 'all-parks', id: hoveredParkId }, { hover: false });
      }
      hoveredParkId = null;
      map.getCanvas().style.cursor = '';
    });
    map.on('click', 'all-parks-fill', (e) => {
      e.preventDefault();
      const feature = e.features[0];
      const rawName = feature.properties.name311;
      if (!rawName) return;
      // Toggle off if this park is already selected
      if (selectedParkName && fixEncoding(rawName) === selectedParkName) {
        const src = map.getSource('park-boundary');
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
        applyParkStyle(false);
        updateReportBtn(null);
        setParkLabel(null);
        const parkSel = document.getElementById('park-name-filter');
        parkSel.value = '';
        updateFilterDot();
        // Restore full data when deselecting
        if (currentMode === 'complaints') {
          document.getElementById('park-filter').value = '';
          loadComplaints();
        } else if (currentMode === 'animals') {
          renderAnimalList(animalData);
          updateAnimalStats(animalData);
        } else if (currentMode === 'dogruns') {
          renderDogRunList();
          updateDogRunMapSources(dogRunsData.features);
        }
        return;
      }
      // Show this park as the highlighted boundary
      const src = map.getSource('park-boundary');
      if (src) src.setData({ type: 'FeatureCollection', features: [feature] });
      applyParkStyle(true);
      if (map.getLayer('park-fill')) map.setPaintProperty('park-fill', 'fill-opacity', 0.45);
      updateReportBtn(rawName);
      // Zoom to park bounds
      const g = feature.geometry;
      const coords = g.type === 'MultiPolygon' ? g.coordinates.flat(2) : g.coordinates.flat(1);
      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
      const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      setParkLabel(fixEncoding(rawName), [centerLng, centerLat]);
      const pad = { top: 120, bottom: 120, left: 120, right: 120 };
      const camera = map.cameraForBounds(bounds, { padding: pad, maxZoom: 16 });
      if (camera) map.flyTo({ center: camera.center, zoom: camera.zoom, duration: 700 });
      else map.fitBounds(bounds, { padding: pad, maxZoom: 16, duration: 700 });
      // Sync dropdown if this park is in the current list
      const parkSel = document.getElementById('park-name-filter');
      const opt = [...parkSel.options].find(o => o.value === rawName);
      if (opt) { parkSel.value = rawName; updateFilterDot(); }

      // Filter data to this park in the current mode
      const parkNameClean = fixEncoding(rawName);
      if (currentMode === 'complaints') {
        // Set park filter and auto-load complaints for this park
        document.getElementById('park-filter').value = '__park__';
        if (opt) parkSel.value = rawName;
        loadComplaints();
      } else if (currentMode === 'animals') {
        // Filter animal incidents to this park
        const filtered = animalData.filter(inc =>
          (fixEncoding(inc.property) || '').toLowerCase() === parkNameClean.toLowerCase()
        );
        renderAnimalList(filtered);
        updateAnimalStats(filtered);
      } else if (currentMode === 'dogruns') {
        // Filter dog runs whose name contains this park name
        const parkLower = parkNameClean.toLowerCase();
        const filtered = dogRunsData.features.filter(f => {
          const name = fixEncoding(f.properties.name || '').toLowerCase();
          return name.includes(parkLower) || parkLower.includes(name.split(' dog')[0].trim());
        });
        renderDogRunList(filtered);
        // Keep all dots on the map — only filter the list
      }
    });

    // ── Park boundary (selected park highlight) ──────────────────
    map.addSource('park-boundary', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: 'park-fill',
      type: 'fill',
      source: 'park-boundary',
      paint: {
        'fill-color': '#3a7d44',
        'fill-color-transition': { duration: 150, delay: 0 },
        'fill-opacity': 0,
        'fill-opacity-transition': { duration: 400, delay: 0 },
      },
    });

    map.addLayer({
      id: 'park-outline',
      type: 'line',
      source: 'park-boundary',
      paint: {
        'line-color': '#1a3d22',
        'line-width': 2.5,
        'line-width-transition': { duration: 150, delay: 0 },
        'line-opacity': 0.9,
      },
    });


    map.on('mouseenter', 'park-fill', () => {
      map.getCanvas().style.cursor = 'pointer';
      if (!selectedParkName) applyParkStyle(true);
    });
    map.on('mouseleave', 'park-fill', () => {
      map.getCanvas().style.cursor = '';
      if (!selectedParkName) applyParkStyle(false);
    });

    // ── Dog Runs & Off-Leash Areas ────────────────────────────────
    map.addSource('dog-runs', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      generateId: true,
    });

    map.addLayer({
      id: 'dog-runs-fill',
      type: 'fill',
      source: 'dog-runs',
      paint: {
        'fill-color': '#0096a0',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.45, 0.2],
      },
    });

    map.addLayer({
      id: 'dog-runs-outline',
      type: 'line',
      source: 'dog-runs',
      paint: { 'line-color': '#005f69', 'line-width': 1.5, 'line-opacity': 0.75 },
    });

    let hoveredDogRunId = null;
    map.on('mousemove', 'dog-runs-fill', (e) => {
      if (e.features.length > 0) {
        if (hoveredDogRunId !== null) {
          map.setFeatureState({ source: 'dog-runs', id: hoveredDogRunId }, { hover: false });
        }
        hoveredDogRunId = e.features[0].id;
        map.setFeatureState({ source: 'dog-runs', id: hoveredDogRunId }, { hover: true });
        map.getCanvas().style.cursor = 'pointer';
      }
    });
    map.on('mouseleave', 'dog-runs-fill', () => {
      if (hoveredDogRunId !== null) {
        map.setFeatureState({ source: 'dog-runs', id: hoveredDogRunId }, { hover: false });
      }
      hoveredDogRunId = null;
      map.getCanvas().style.cursor = '';
    });
    map.on('click', 'dog-runs-fill', (e) => {
      e.preventDefault();
      const p = e.features[0].properties;
      const BORO = { B: 'Brooklyn', M: 'Manhattan', Q: 'Queens', X: 'Bronx', R: 'Staten Island' };
      const name    = safeText(p.name || 'Dog Run');
      const borough = escHTML(BORO[p.borough] || p.borough || '');
      const surface = p.surface ? `${escHTML(p.surface)} surface` : '';
      const seating = p.seating === 'Yes' ? 'Seating available' : '';
      const details = [surface, seating].filter(Boolean).join(' · ');
      if (activePopup) { activePopup.remove(); activePopup = null; }
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${e.lngLat.lat},${e.lngLat.lng}`;
      const parkUrl = p.gispropnum ? `https://www.nycgovparks.org/parks/${encodeURIComponent(p.gispropnum)}` : '';
      activePopup = new maplibregl.Popup({ closeButton: true, maxWidth: '240px', className: 'dog-run-popup-wrap' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="dog-run-popup">
            <div class="dog-run-popup-type">🐕 Dog Run</div>
            <div class="dog-run-popup-name">${name}</div>
            ${borough ? `<div class="dog-run-popup-meta">${borough}</div>` : ''}
            ${details  ? `<div class="dog-run-popup-meta">${details}</div>`  : ''}
            <div class="dog-run-popup-links">
              <a href="${mapsUrl}" target="_blank" rel="noopener" class="dog-run-directions-link">Get Directions ↗</a>
              ${parkUrl ? `<a href="${parkUrl}" target="_blank" rel="noopener" class="dog-run-directions-link">Park Info ↗</a>` : ''}
            </div>
          </div>`)
        .addTo(map);
    });

    // ── Dog Run centroid dots (shown in Dog Runs mode) ───────────
    map.addSource('dog-runs-points', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'dog-runs-dots',
      type: 'circle',
      source: 'dog-runs-points',
      layout: { visibility: 'visible' },
      paint: {
        'circle-radius': 7,
        'circle-color': '#0096a0',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    });
    map.on('click', 'dog-runs-dots', (e) => {
      e.preventDefault();
      selectDogRun(e.features[0].properties._idx);
    });
    map.on('mouseenter', 'dog-runs-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'dog-runs-dots', () => { map.getCanvas().style.cursor = ''; });

    // ── Animal Incidents (park-level dots, sized by count) ────────
    map.addSource('animal-incidents', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'animal-incidents-dots',
      type: 'circle',
      source: 'animal-incidents',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 7, 5, 11, 20, 16],
        'circle-color': '#d93025',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.85,
      },
    });
    map.on('click', 'animal-incidents-dots', (e) => {
      e.preventDefault();
      const p       = e.features[0].properties;
      const indices = JSON.parse(p.indices || '[]');
      const items   = indices.map(i => animalData[i]).filter(Boolean);
      if (activePopup) { activePopup.remove(); activePopup = null; }

      // Filter the list panel to show only this park's incidents
      renderAnimalList(items);
      updateAnimalStats(items);

      // Build popup with incident rows (cap at 6, show overflow count)
      const preview  = items.slice(0, 6);
      const overflow = items.length - preview.length;
      const rows = preview.map(inc => {
        const species   = escHTML(inc.species_description || 'Unknown');
        const cond      = escHTML(inc.animal_condition || 'N/A');
        const condClass = ANIMAL_COND_CLASS[inc.animal_condition] || 'cond-unknown';
        const date      = formatDate(inc.date_and_time_of_initial);
        return `<div class="animal-popup-row">
          <span class="animal-popup-species">${species}</span>
          <span class="animal-cond-badge ${condClass}">${cond}</span>
          <span class="animal-popup-date">${date}</span>
        </div>`;
      }).join('');

      activePopup = new maplibregl.Popup({ maxWidth: '300px', offset: 10 })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div class="popup-content">
            <strong>${escHTML(p.displayName || p.parkName)}</strong>
            <div class="popup-meta" style="margin-bottom:.4rem;">${items.length} incident${items.length !== 1 ? 's' : ''}</div>
            <div class="animal-popup-list">${rows}</div>
            ${overflow > 0 ? `<div class="animal-popup-overflow">+${overflow} more in list</div>` : ''}
          </div>`)
        .addTo(map);
    });
    map.on('mouseenter', 'animal-incidents-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'animal-incidents-dots', () => { map.getCanvas().style.cursor = ''; });

    map.addSource('complaints', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Closed complaints (green)
    map.addLayer({
      id: 'complaints-closed',
      type: 'circle',
      source: 'complaints',
      filter: ['!=', ['get', 'status'], 'Open'],
      paint: {
        'circle-radius': 7,
        'circle-color': '#e8a800',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    });

    // Open complaints (orange, on top)
    map.addLayer({
      id: 'complaints-open',
      type: 'circle',
      source: 'complaints',
      filter: ['==', ['get', 'status'], 'Open'],
      paint: {
        'circle-radius': 7,
        'circle-color': '#F4C430',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    });

    // Click handler for both layers
    ['complaints-closed', 'complaints-open'].forEach(layerId => {
      map.on('click', layerId, (e) => {
        e.preventDefault();
        const props = e.features[0].properties;
        highlightCard(props.idx);
        showPopup(props.idx, e.lngLat);
      });
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });

    // Load data once map is ready — Dog Runs is the default mode
    loadAllParks();
    loadDogRuns();
    // Set initial UI state to match default dogruns mode
    document.getElementById('controls').dataset.mode = 'dogruns';
    document.querySelector('.panel-title').textContent = 'Find a Dog Run';
    if (map.getLayer('complaints-open'))  map.setLayoutProperty('complaints-open',  'visibility', 'none');
    if (map.getLayer('complaints-closed')) map.setLayoutProperty('complaints-closed', 'visibility', 'none');
  });
}

// ── Fetch & render ───────────────────────────────────────────────
async function loadComplaints() {
  const borough  = document.getElementById('borough-filter').value;
  const limit    = document.getElementById('limit-select').value;
  const park     = document.getElementById('park-filter').value;
  const parkName = document.getElementById('park-name-filter').value;

  const btn = document.getElementById('load-btn');
  btn.textContent = 'Loading…';
  btn.disabled = true;

  // Close mobile filter panel when loading
  const panel = document.getElementById('filter-panel');
  const filterBtn = document.getElementById('filter-toggle-btn');
  if (panel) { panel.classList.remove('open'); filterBtn?.classList.remove('open'); }

  updateActiveFilterBar(borough, park, parkName, limit);
  showLoading();
  if (activePopup) { activePopup.remove(); activePopup = null; }

  let where = `(descriptor='Dog Off Leash' OR descriptor='Unleashed Dog in Public')`;
  if (borough) where += ` AND borough='${borough}'`;
  if (park === '__park__') {
    where += ` AND location_type='Park'`;
    if (parkName) where += ` AND park_facility_name='${parkName.replace(/'/g, "''")}'`;
  } else if (park === '__street__') {
    where += ` AND location_type='Street/Curbside'`;
  } else if (parkName) {
    where += ` AND park_facility_name='${parkName.replace(/'/g, "''")}'`;
  }

  const url = new URL(API_BASE);
  url.searchParams.set('$where', where);
  url.searchParams.set('$limit', limit);
  url.searchParams.set('$order', 'created_date DESC');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    currentData = data;
    renderList(data);
    renderMarkers(data);
    updateStats(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.textContent = 'Load Complaints';
    btn.disabled = false;
  }
}

// ── Render list ──────────────────────────────────────────────────
function renderList(data) {
  const list    = document.getElementById('complaint-list');
  const countEl = document.getElementById('list-count');
  countEl.textContent = data.length;
  const tabCount = document.getElementById('tab-list-count');
  if (tabCount) tabCount.textContent = data.length;

  if (!data.length) {
    list.innerHTML = `
      <div class="state-box">
        <div class="state-icon">🐕</div>
        <div class="state-title">No results</div>
        <div class="state-msg">Try adjusting your filters.</div>
      </div>`;
    return;
  }

  list.innerHTML = data.map((c, i) => {
    const date    = formatDate(c.created_date);
    const address = escHTML(c.incident_address
      ? `${titleCase(c.incident_address)}, ${titleCase(c.city || c.borough || '')}`
      : titleCase(c.borough || 'Location unknown'));
    const borough = escHTML(titleCase(c.borough || ''));
    const parkName = safeText(c.park_facility_name);
    const hasNamedPark = parkName && parkName !== 'Unspecified';
    const isInPark = c.location_type === 'Park';
    const park = hasNamedPark
      ? `<div class="card-park">${parkName}</div>`
      : isInPark ? `<div class="card-park card-park-unspecified">Park</div>` : '';

    return `
      <div class="complaint-card" data-idx="${i}" onclick="focusMarker(${i})">
        <div class="card-top">
          <span class="card-address">${address}</span>
          <span class="card-status ${c.status === 'Open' ? 'status-open' : 'status-closed'}">${escHTML(c.status)}</span>
        </div>
        <div class="card-meta">
          <span class="card-borough">${borough}</span>
          <span class="card-date">${date}</span>
        </div>
        ${park}
      </div>`;
  }).join('');
}

// ── Render map markers ───────────────────────────────────────────
function renderMarkers(data) {
  if (activePopup) { activePopup.remove(); activePopup = null; }

  const features = data
    .filter(c => c.latitude && c.longitude)
    .map((c, i) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [parseFloat(c.longitude), parseFloat(c.latitude)],
      },
      properties: {
        idx: i,
        status: c.status || '',
        address: c.incident_address || '',
        city: c.city || c.borough || '',
        borough: c.borough || '',
        created_date: c.created_date || '',
        park: c.park_facility_name || '',
        resolution: c.resolution_description || '',
      },
    }));

  const geojson = { type: 'FeatureCollection', features };

  if (map.getSource('complaints')) {
    map.getSource('complaints').setData(geojson);
  }

  if (features.length > 0) {
    const lngs = features.map(f => f.geometry.coordinates[0]);
    const lats = features.map(f => f.geometry.coordinates[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 48, maxZoom: 14 }
    );
  }
}

// ── Popup ────────────────────────────────────────────────────────
function showPopup(idx, lngLat) {
  if (activePopup) { activePopup.remove(); activePopup = null; }
  const c = currentData[idx];
  if (!c) return;

  activePopup = new maplibregl.Popup({ maxWidth: '280px', offset: 10 })
    .setLngLat(lngLat || [parseFloat(c.longitude), parseFloat(c.latitude)])
    .setHTML(buildPopup(c))
    .addTo(map);
}

function buildPopup(c) {
  const date    = formatDate(c.created_date);
  const address = escHTML(c.incident_address
    ? `${titleCase(c.incident_address)}, ${titleCase(c.city || c.borough || '')}`
    : titleCase(c.borough || 'Unknown location'));
  const status  = c.status === 'Open' ? 'status-open' : 'status-closed';
  const park    = c.park_facility_name && c.park_facility_name !== 'Unspecified'
    ? `<div>${safeText(c.park_facility_name)}</div>` : '';
  const resText = c.resolution_description ? fixEncoding(c.resolution_description) : '';
  const res     = resText
    ? `<div class="popup-resolution">${escHTML(resText.substring(0, 140))}${resText.length > 140 ? '…' : ''}</div>`
    : '';

  return `
    <div class="popup-content">
      <strong>${address}</strong>
      <div class="popup-meta">
        <span class="${status}">${escHTML(c.status)}</span> · ${date}
      </div>
      ${park}
      ${res}
    </div>`;
}

// ── Card / marker interaction ─────────────────────────────────────
function focusMarker(idx) {
  const c   = currentData[idx];
  const lat = parseFloat(c?.latitude);
  const lng = parseFloat(c?.longitude);
  if (!isNaN(lat) && !isNaN(lng)) {
    // On mobile, switch to map view first
    if (window.innerWidth <= 700) switchView('map');
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15) });
    showPopup(idx);
  }
  highlightCard(idx);
}

function highlightCard(idx) {
  document.querySelectorAll('.complaint-card').forEach(el => el.classList.remove('active'));
  const card = document.querySelector(`.complaint-card[data-idx="${idx}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── Stats bar ────────────────────────────────────────────────────
function updateStats(data) {
  const open     = data.filter(c => c.status === 'Open').length;
  const closed   = data.filter(c => c.status === 'Closed').length;
  const boroughs = [...new Set(data.map(c => c.borough).filter(Boolean))].length;

  document.getElementById('stats').innerHTML = `
    <span class="stat"><strong>${data.length}</strong> complaints</span>
    <span class="stat stat-open"><strong>${open}</strong> open</span>
    <span class="stat stat-closed"><strong>${closed}</strong> closed</span>
    <span class="stat"><strong>${boroughs}</strong> borough${boroughs !== 1 ? 's' : ''}</span>`;
}

// ── State helpers ────────────────────────────────────────────────
function showLoading() {
  document.getElementById('complaint-list').innerHTML = `
    <div class="state-box">
      <div class="spinner"></div>
      <div class="state-title">Fetching data…</div>
    </div>`;
  document.getElementById('list-count').textContent = '—';
  document.getElementById('stats').innerHTML = '';
}

function showError(msg) {
  const label = currentMode === 'animals' ? 'animal incidents' : 'complaints';
  document.getElementById('complaint-list').innerHTML = `
    <div class="state-box">
      <div class="state-icon">⚠️</div>
      <div class="state-title">Could not load ${label}</div>
      <div class="state-msg">${msg}</div>
    </div>`;
}

// ── Utilities ────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// ── Mobile filter panel ───────────────────────────────────────────
function toggleFilters() {
  const panelId = currentMode === 'dogruns'  ? 'dogrun-filter-panel'
                : currentMode === 'animals'  ? 'animal-filter-panel'
                : 'filter-panel';
  const panel = document.getElementById(panelId);
  const btn   = document.getElementById('filter-toggle-btn');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
}

function updateActiveFilterBar(borough, park, parkName, limit) {
  const bar = document.getElementById('active-filters');
  const chips = [];
  if (borough) chips.push(borough.charAt(0) + borough.slice(1).toLowerCase());
  if (park === '__park__') chips.push('Parks');
  else if (park === '__street__') chips.push('Street / Sidewalk');
  if (parkName) chips.push(parkName);
  if (limit !== '100') chips.push(limit + ' results');

  if (chips.length) {
    bar.style.display = 'flex';
    bar.innerHTML = `<span class="active-filters-label">Filtered by:</span>` +
      chips.map(c => `<span class="filter-chip">${escHTML(c)}</span>`).join('');
  } else {
    bar.style.display = 'none';
  }
}

function updateFilterDot() {
  const dot      = document.getElementById('filter-active-dot');
  const borough  = document.getElementById('borough-filter').value;
  const limit    = document.getElementById('limit-select').value;
  const park     = document.getElementById('park-filter').value;
  const parkName = document.getElementById('park-name-filter').value;
  const active   = borough !== '' || limit !== '100' || park !== '' || parkName !== '';
  dot.classList.toggle('visible', active);
}

function onParkFilterChange() {
  const park        = document.getElementById('park-filter').value;
  const parkNameSel = document.getElementById('park-name-filter');
  const isStreet    = park === '__street__';

  parkNameSel.disabled = isStreet;

  const parkLayers = ['all-parks-fill', 'all-parks-outline', 'park-fill', 'park-outline'];
  if (isStreet) {
    setParkLabel(null);
    parkNameSel.value = '';
    fetchParkBoundary('');
    updateReportBtn(null);
    parkLayers.forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    });
    toggleDogRunLayer(false);
  } else {
    parkLayers.forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
    });
    toggleDogRunLayer(true);
  }

  updateFilterDot();
}

// ── Fetch park list ───────────────────────────────────────────────
async function loadAllParks() {
  const CACHE_KEY = 'nycoffleash_all_parks';
  try {
    // Try sessionStorage first (persists for this browser session only)
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      allParksData = data; allParksCentroidMap = null;
      if (map.getSource('all-parks')) map.getSource('all-parks').setData(data);
      return;
    }
    const url = new URL('https://data.cityofnewyork.us/resource/enfh-gkve.geojson');
    url.searchParams.set('$limit', '5000');
    const res = await fetch(url.toString());
    const data = await res.json();
    allParksData = data; allParksCentroidMap = null;
    if (currentMode === 'animals' && animalData.length) renderAnimalMarkers(animalData);
    if (map.getSource('all-parks')) map.getSource('all-parks').setData(data);
    // Cache for this session (try/catch in case storage quota is exceeded)
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {}
  } catch (e) {
    // silently fail
  }
}

async function loadDogRuns() {
  const CACHE_KEY = 'nycoffleash_dog_runs_v2'; // v2 = includes inactive
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_DOG_RUNS) {
        applyDogRunsData(data);
        return;
      }
    }
    const res  = await fetch(`${DOG_RUNS_API}?$limit=200`);
    const data = await res.json();
    applyDogRunsData(data);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch (_) {}
  } catch (e) {
    showLoadError();
  }
}

function computeCentroid(geometry) {
  const coords = geometry.type === 'MultiPolygon'
    ? geometry.coordinates.flat(2)
    : geometry.coordinates.flat(1);
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

function applyDogRunsData(data) {
  dogRunsData = data;
  if (map.getSource('dog-runs')) map.getSource('dog-runs').setData(data);

  // Build centroid point features for the dot layer
  const pointFeatures = data.features.map((f, i) => {
    try {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: computeCentroid(f.geometry) },
        properties: { ...f.properties, _idx: i },
      };
    } catch (_) { return null; }
  }).filter(Boolean);

  if (map.getSource('dog-runs-points')) {
    map.getSource('dog-runs-points').setData({ type: 'FeatureCollection', features: pointFeatures });
  }
  populateDogRunFilters();
  if (currentMode === 'dogruns') renderDogRunList();
}

function toggleDogRunLayer(visible) {
  const vis = visible ? 'visible' : 'none';
  ['dog-runs-fill', 'dog-runs-outline'].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  });
}

async function loadParkList(borough) {
  const cacheKey = `nycoffleash_parks_v2_${borough || 'all'}`;

  // Check localStorage cache (24h TTL)
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const { parks, ts } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_PARK_LIST) {
        populateParkDropdown(parks);
        return;
      }
    }
  } catch (_) {}

  const url = new URL(API_BASE);
  url.searchParams.set('$select', 'park_facility_name');
  let where = `(descriptor='Dog Off Leash' OR descriptor='Unleashed Dog in Public') AND park_facility_name != 'Unspecified'`;
  if (borough) where += ` AND borough='${borough}'`;
  url.searchParams.set('$where', where);
  url.searchParams.set('$group', 'park_facility_name');
  url.searchParams.set('$order', 'park_facility_name ASC');
  url.searchParams.set('$limit', '1000');

  try {
    const res  = await fetch(url.toString());
    const data = await res.json();
    let parks = data.map(d => d.park_facility_name);

    // If a borough is selected, filter out parks that don't physically
    // exist in that borough according to the Parks Properties dataset.
    // Check localStorage for the valid-names list first.
    if (borough && BOROUGH_PARK_CODES[borough]) {
      const code = BOROUGH_PARK_CODES[borough];
      const validNamesCacheKey = `nycoffleash_validparks_${code}`;
      let validNames;
      try {
        const vRaw = localStorage.getItem(validNamesCacheKey);
        if (vRaw) {
          const { names, ts } = JSON.parse(vRaw);
          if (Date.now() - ts < CACHE_TTL_PARK_LIST) {
            validNames = new Set(names);
          }
        }
      } catch (_) {}

      if (!validNames) {
        const propUrl = new URL('https://data.cityofnewyork.us/resource/enfh-gkve.json');
        propUrl.searchParams.set('$select', 'name311');
        propUrl.searchParams.set('$where', `borough='${code}'`);
        propUrl.searchParams.set('$limit', '2000');
        const propRes  = await fetch(propUrl.toString());
        const propData = await propRes.json();
        const names = propData.map(p => p.name311);
        validNames = new Set(names);
        try { localStorage.setItem(validNamesCacheKey, JSON.stringify({ names, ts: Date.now() })); } catch (_) {}
      }

      parks = parks.filter(name => validNames.has(name));
    }

    // Cache the final park list
    try { localStorage.setItem(cacheKey, JSON.stringify({ parks, ts: Date.now() })); } catch (_) {}
    populateParkDropdown(parks);
  } catch (e) {
    // silently fail — park filter just won't be populated
  }
}

function populateParkDropdown(parks) {
  const sel = document.getElementById('park-name-filter');
  sel.innerHTML = '<option value="">All named parks</option>';
  parks.forEach(park_facility_name => {
    const opt = document.createElement('option');
    opt.value = park_facility_name;
    opt.textContent = fixEncoding(park_facility_name);
    sel.appendChild(opt);
  });
}

// Maps our uppercase API borough values to the GeoJSON boro_name field
const BOROUGH_GEO_NAMES = {
  'MANHATTAN':    'Manhattan',
  'BROOKLYN':     'Brooklyn',
  'QUEENS':       'Queens',
  'BRONX':        'Bronx',
  'STATEN ISLAND':'Staten Island',
};

const BOROUGH_CENTERS = {
  'MANHATTAN':    { center: [-73.971, 40.776], zoom: 12   },
  'BROOKLYN':     { center: [-73.949, 40.650], zoom: 11.5 },
  'QUEENS':       { center: [-73.820, 40.728], zoom: 11   },
  'BRONX':        { center: [-73.865, 40.845], zoom: 11.5 },
  'STATEN ISLAND':{ center: [-74.151, 40.580], zoom: 11   },
};

function updateBoroughHighlight(borough) {
  if (!map.getLayer('borough-fill')) return;
  if (borough && BOROUGH_GEO_NAMES[borough]) {
    const geoName = BOROUGH_GEO_NAMES[borough];
    map.setFilter('borough-fill', ['==', ['get', 'name'], geoName]);
    map.setPaintProperty('borough-fill', 'fill-opacity', 0.18);
    const cam = BOROUGH_CENTERS[borough];
    if (cam) map.easeTo({ center: cam.center, zoom: cam.zoom, duration: 600 });
  } else {
    map.setFilter('borough-fill', null);
    map.setPaintProperty('borough-fill', 'fill-opacity', 0);
    map.easeTo({ center: [-74.006, 40.7128], zoom: 10, duration: 600 });
  }
}

function onBoroughFilterChange() {
  const borough = document.getElementById('borough-filter').value;
  loadParkList(borough);
  updateBoroughHighlight(borough);
  updateFilterDot();
}

const BOROUGH_PARK_CODES = {
  'MANHATTAN': 'M', 'BROOKLYN': 'B', 'QUEENS': 'Q',
  'BRONX': 'X', 'STATEN ISLAND': 'R',
};

async function fetchParkBoundary(rawParkName) {
  const src = map.getSource('park-boundary');
  if (!src) return;
  if (!rawParkName) {
    src.setData({ type: 'FeatureCollection', features: [] });
    updateReportBtn(null);
    applyParkStyle(false);
    if (map.getLayer('park-fill')) map.setPaintProperty('park-fill', 'fill-opacity', 0);
    setParkLabel(null);
    return;
  }
  const name = fixEncoding(rawParkName);
  const boroughCode = BOROUGH_PARK_CODES[document.getElementById('borough-filter').value];
  const safeName = name.replace(/'/g, "''");
  const cacheKey = `${safeName}__${boroughCode || 'any'}`;

  try {
    // Check in-memory session cache first
    if (parkBoundaryCache.has(cacheKey)) {
      const data = parkBoundaryCache.get(cacheKey);
      applyParkBoundaryData(data, rawParkName);
      return;
    }

    const fetchGeo = async (where) => {
      const url = new URL('https://data.cityofnewyork.us/resource/enfh-gkve.geojson');
      url.searchParams.set('$where', where);
      const res = await fetch(url.toString());
      return res.json();
    };

    let data = await fetchGeo(
      boroughCode
        ? `name311='${safeName}' AND borough='${boroughCode}'`
        : `name311='${safeName}'`
    );

    // Fallback: if borough filter returned nothing, retry without borough
    if (boroughCode && (!data.features || !data.features.length)) {
      data = await fetchGeo(`name311='${safeName}'`);
    }

    // Store in session cache
    parkBoundaryCache.set(cacheKey, data);
    applyParkBoundaryData(data, rawParkName);
  } catch (e) {
    // silently fail
  }
}

function applyParkBoundaryData(data, rawParkName) {
  const src = map.getSource('park-boundary');
  if (!src) return;
  src.setData(data);
  // Reset to default style on new load; button stays gray until user clicks park on map
  applyParkStyle(false);
  if (map.getLayer('park-fill')) {
    map.setPaintProperty('park-fill', 'fill-opacity', data.features && data.features.length ? 0.3 : 0);
  }
  if (data.features && data.features.length) {
    const coords = data.features.flatMap(f => {
      const g = f.geometry;
      return g.type === 'MultiPolygon'
        ? g.coordinates.flat(2)
        : g.coordinates.flat(1);
    });
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const bounds = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    setParkLabel(fixEncoding(rawParkName), [centerLng, centerLat]);
    const pad = { top: 120, bottom: 120, left: 120, right: 120 };
    const camera = map.cameraForBounds(bounds, { padding: pad, maxZoom: 16 });
    if (camera) {
      map.flyTo({ center: camera.center, zoom: camera.zoom, duration: 700 });
    } else {
      map.fitBounds(bounds, { padding: pad, maxZoom: 16, duration: 700 });
    }
  }
}

// ── Data mode (Complaints / Dog Runs / Animals) ──────────────────
function onDataModeChange(mode) {
  currentMode = mode;
  const isComplaints = mode === 'complaints';
  const isDogRuns    = mode === 'dogruns';
  const isAnimals    = mode === 'animals';

  // Toggle map layers per mode
  ['complaints-open', 'complaints-closed'].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', isComplaints ? 'visible' : 'none');
  });
  if (map.getLayer('dog-runs-dots')) {
    map.setLayoutProperty('dog-runs-dots', 'visibility', isDogRuns ? 'visible' : 'none');
  }
  if (map.getLayer('animal-incidents-dots')) {
    map.setLayoutProperty('animal-incidents-dots', 'visibility', isAnimals ? 'visible' : 'none');
  }

  // Update report button per mode — always visible
  const reportBtn = document.getElementById('report-mode-btn');
  reportBtn.style.display = '';
  if (isAnimals) {
    reportBtn.textContent = 'Report an Animal';
    reportBtn.onclick = openAnimalReportModal;
    reportBtn.classList.add('animal-mode');
  } else {
    reportBtn.textContent = 'Report a Dog';
    reportBtn.onclick = clickReportHere;
    reportBtn.classList.remove('animal-mode');
  }

  // Switch active filter panel via data-mode attribute (CSS handles show/hide)
  document.getElementById('controls').dataset.mode = mode;

  // Close any open panel and reset toggle button
  ['filter-panel', 'dogrun-filter-panel', 'animal-filter-panel'].forEach(id => {
    document.getElementById(id).classList.remove('open');
  });
  document.getElementById('filter-toggle-btn').classList.remove('open');

  // Restore full dog run data to map when not in dogruns mode
  if (!isDogRuns) updateDogRunMapSources(dogRunsData.features);

  // Update list panel title + content
  document.querySelector('.panel-title').textContent =
    isComplaints ? 'Offleashed Dog Reports' : isDogRuns ? 'Find a Dog Run' : 'Sick/Injured Animal Reports';

  if (isComplaints) {
    loadComplaints();
  } else if (isDogRuns) {
    renderDogRunList();
  } else if (isAnimals) {
    if (!animalData.length) loadAnimalIncidents();
    else { renderAnimalList(animalData); updateAnimalStats(animalData); }
  }

  if (activePopup) { activePopup.remove(); activePopup = null; }
}

const DOG_RUN_BORO = { B: 'Brooklyn', M: 'Manhattan', Q: 'Queens', X: 'Bronx', R: 'Staten Island' };

function populateDogRunFilters() {
  // Zip list is driven live by the autocomplete — no pre-population needed

  // Surface types → populate select (small fixed set)
  const surfaces = [...new Set(dogRunsData.features.map(f => f.properties.surface).filter(Boolean))].sort();
  const surfSel = document.getElementById('dogrun-surface-filter');
  surfSel.innerHTML = '<option value="">All surfaces</option>';
  surfaces.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; surfSel.appendChild(o); });
}

function filterDogRuns() {
  const borough      = document.getElementById('dogrun-borough-filter').value;
  const zipInput     = document.getElementById('dogrun-zip-filter').value.trim();
  const surface      = document.getElementById('dogrun-surface-filter').value;
  const seating      = document.getElementById('dogrun-seating-filter').value;
  const filtered = dogRunsData.features.filter(f => {
    const p = f.properties;
    if (borough && p.borough !== borough)                        return false;
    if (zipInput && !(p.zipcode || '').startsWith(zipInput))     return false;
    if (surface && (p.surface || '') !== surface)                return false;
    if (seating && p.seating !== seating)                        return false;
    return true;
  });

  renderDogRunList(filtered);
  updateDogRunMapSources(filtered);
}

function updateDogRunMapSources(features) {
  if (map.getSource('dog-runs')) {
    map.getSource('dog-runs').setData({ type: 'FeatureCollection', features });
  }
  const pointFeatures = features.map(f => {
    const i = dogRunsData.features.indexOf(f);
    try {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: computeCentroid(f.geometry) }, properties: { ...f.properties, _idx: i } };
    } catch (_) { return null; }
  }).filter(Boolean);
  if (map.getSource('dog-runs-points')) {
    map.getSource('dog-runs-points').setData({ type: 'FeatureCollection', features: pointFeatures });
  }
}

function renderDogRunList(features) {
  features = features !== undefined ? features : dogRunsData.features;
  const list     = document.getElementById('complaint-list');
  const countEl  = document.getElementById('list-count');
  const tabCount = document.getElementById('tab-list-count');

  countEl.textContent = features.length || '—';
  if (tabCount) tabCount.textContent = features.length || '';

  if (!dogRunsData.features.length) {
    list.innerHTML = `
      <div class="state-box">
        <div class="state-icon">🐕</div>
        <div class="state-title">Loading dog runs…</div>
        <div class="state-msg">Fetching NYC dog run locations.</div>
      </div>`;
    return;
  }

  if (!features.length) {
    list.innerHTML = `
      <div class="state-box">
        <div class="state-icon">🔍</div>
        <div class="state-title">No results</div>
        <div class="state-msg">Try adjusting the filters above.</div>
      </div>`;
    return;
  }

  list.innerHTML = features.map(f => {
    const i       = dogRunsData.features.indexOf(f);
    const p       = f.properties;
    const name     = safeText(p.name || 'Dog Run');
    const borough  = escHTML(DOG_RUN_BORO[p.borough] || '');
    const surface  = escHTML(p.surface || '');
    const seating  = p.seating === 'Yes' ? 'Seating ✓' : '';
    const zip      = p.zipcode ? `ZIP ${escHTML(p.zipcode)}` : '';
    const meta     = [borough, zip, surface, seating].filter(Boolean).join(' · ');
    return `
      <div class="complaint-card dog-run-card" data-idx="${i}" onclick="selectDogRun(${i})">
        <div class="card-top">
          <span class="card-address">${name}</span>
          <span class="card-status dog-run-badge">Dog Run</span>
        </div>
        ${meta ? `<div class="card-meta">${meta}</div>` : ''}
      </div>`;
  }).join('');
}

function selectDogRun(idx) {
  const feature = dogRunsData.features[idx];
  if (!feature) return;

  // Highlight card
  document.querySelectorAll('.dog-run-card').forEach(el => el.classList.remove('active'));
  const card = document.querySelector(`.dog-run-card[data-idx="${idx}"]`);
  if (card) { card.classList.add('active'); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

  // Fly to centroid
  const centroid = computeCentroid(feature.geometry);
  map.flyTo({ center: centroid, zoom: 16, duration: 600 });

  // Show popup
  const p       = feature.properties;
  const name    = fixEncoding(p.name || 'Dog Run');
  const borough = DOG_RUN_BORO[p.borough] || '';
  const surface = p.surface ? `${p.surface} surface` : '';
  const seating = p.seating === 'Yes' ? 'Seating available' : '';
  const details = [surface, seating].filter(Boolean).join(' · ');

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${centroid[1]},${centroid[0]}`;
  const parkUrl = p.gispropnum ? `https://www.nycgovparks.org/parks/${p.gispropnum}` : '';
  if (activePopup) { activePopup.remove(); activePopup = null; }
  activePopup = new maplibregl.Popup({ closeButton: true, maxWidth: '240px', className: 'dog-run-popup-wrap' })
    .setLngLat(centroid)
    .setHTML(`
      <div class="dog-run-popup">
        <div class="dog-run-popup-type">🐕 Dog Run</div>
        <div class="dog-run-popup-name">${name}</div>
        ${borough ? `<div class="dog-run-popup-meta">${borough}</div>` : ''}
        ${details  ? `<div class="dog-run-popup-meta">${details}</div>` : ''}
        <div class="dog-run-popup-links">
          <a href="${mapsUrl}" target="_blank" rel="noopener" class="dog-run-directions-link">Get Directions ↗</a>
          ${parkUrl ? `<a href="${parkUrl}" target="_blank" rel="noopener" class="dog-run-directions-link">Park Info ↗</a>` : ''}
        </div>
      </div>`)
    .addTo(map);
}

// ── Mobile view switching ─────────────────────────────────────────
function switchView(view) {
  const mapContainer = document.getElementById('map-container');
  const listPanel    = document.getElementById('list-panel');
  const tabMap       = document.getElementById('tab-map');
  const tabList      = document.getElementById('tab-list');

  if (view === 'map') {
    mapContainer.classList.remove('mobile-hidden');
    listPanel.classList.remove('mobile-active');
    tabMap.classList.add('active');
    tabList.classList.remove('active');
    if (map) map.resize();
  } else {
    mapContainer.classList.add('mobile-hidden');
    listPanel.classList.add('mobile-active');
    tabList.classList.add('active');
    tabMap.classList.remove('active');
  }
}

// ── Report modal ─────────────────────────────────────────────────
function openReportModal() {
  document.getElementById('report-modal').classList.add('open');
}

function closeReportModal() {
  document.getElementById('report-modal').classList.remove('open');
}

function handleModalOverlayClick(e) {
  if (e.target === document.getElementById('report-modal')) closeReportModal();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeReportModal(); closeParkReportModal(); closeAnimalReportModal(); }
});

// ── Park report button ────────────────────────────────────────────
let selectedParkName = null;

let parkLabelMarker = null;

function setParkLabel(name, lngLat) {
  if (parkLabelMarker) { parkLabelMarker.remove(); parkLabelMarker = null; }
  if (!name || !lngLat) return;
  const el = document.createElement('div');
  el.className = 'park-map-label';
  el.textContent = name;
  parkLabelMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat(lngLat)
    .addTo(map);
}

function applyParkStyle(active) {
  if (!map.getLayer('park-fill')) return;
  map.setPaintProperty('park-fill', 'fill-color', active ? '#1a3d22' : '#3a7d44');
  map.setPaintProperty('park-fill', 'fill-opacity', active ? 0.5 : 0.35);
  map.setPaintProperty('park-outline', 'line-width', active ? 3.5 : 2.5);
}

function updateReportBtn(rawName) {
  selectedParkName = rawName ? fixEncoding(rawName) : null;
}

function clickReportHere() {
  if (selectedParkName) {
    openParkReportModal(selectedParkName);
  } else {
    openReportModal();
  }
}

function openParkReportModal(parkName) {
  document.getElementById('park-report-name').textContent = parkName;
  document.getElementById('park-report-modal').classList.add('open');
}

function closeParkReportModal() {
  document.getElementById('park-report-modal').classList.remove('open');
}

function handleParkModalOverlayClick(e) {
  if (e.target === document.getElementById('park-report-modal')) closeParkReportModal();
}

// ── Dog Run zip autocomplete ──────────────────────────────────────
function initDogRunZipAutocomplete() {
  const input = document.getElementById('dogrun-zip-filter');
  const list  = document.getElementById('dogrun-zip-list');

  function getZips() {
    return [...new Set(dogRunsData.features.map(f => f.properties.zipcode).filter(Boolean))].sort();
  }

  function showSuggestions(q) {
    const matches = q ? getZips().filter(z => z.startsWith(q)) : [];
    if (!matches.length) { list.classList.remove('open'); return; }
    list.innerHTML = matches
      .map(z => `<li class="ac-item" data-zip="${z}">${z}</li>`)
      .join('');
    list.classList.add('open');
    list.querySelectorAll('.ac-item').forEach(li => {
      li.addEventListener('click', () => {
        input.value = li.dataset.zip;
        list.classList.remove('open');
        filterDogRuns();
      });
    });
  }

  input.addEventListener('input', () => {
    showSuggestions(input.value.trim());
    filterDogRuns();
  });

  input.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.ac-item')];
    const activeIdx = items.findIndex(el => el.classList.contains('active'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[activeIdx]?.classList.remove('active');
      items[(activeIdx + 1) % items.length]?.classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[activeIdx]?.classList.remove('active');
      items[(activeIdx - 1 + items.length) % items.length]?.classList.add('active');
    } else if (e.key === 'Enter') {
      const active = list.querySelector('.ac-item.active');
      if (active) { e.preventDefault(); input.value = active.dataset.zip; list.classList.remove('open'); filterDogRuns(); }
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ac-wrap')) list.classList.remove('open');
  });
}

// ── Animal report modal ───────────────────────────────────────────
function openAnimalReportModal() {
  document.getElementById('animal-report-modal').classList.add('open');
}
function closeAnimalReportModal() {
  document.getElementById('animal-report-modal').classList.remove('open');
}
function handleAnimalModalOverlayClick(e) {
  if (e.target === document.getElementById('animal-report-modal')) closeAnimalReportModal();
}

// ── Animal Incidents ──────────────────────────────────────────────
const ANIMAL_COND_CLASS = {
  'Injured':   'cond-injured',
  'Unhealthy': 'cond-unhealthy',
  'DOA':       'cond-doa',
  'Healthy':   'cond-healthy',
  'N/A':       'cond-na',
};

function getOrBuildParkCentroidMap() {
  if (allParksCentroidMap) return allParksCentroidMap;
  allParksCentroidMap = new Map();
  if (!allParksData) return allParksCentroidMap;
  for (const f of allParksData.features) {
    const name = (f.properties.name311 || '').toLowerCase().trim();
    if (name) {
      try { allParksCentroidMap.set(name, computeCentroid(f.geometry)); } catch (_) {}
    }
  }
  return allParksCentroidMap;
}

async function loadAnimalIncidents() {
  const borough   = document.getElementById('animal-borough-filter').value;
  const condition = document.getElementById('animal-condition-filter').value;
  const cls       = document.getElementById('animal-class-filter').value;
  const limit     = document.getElementById('animal-limit-select').value;

  const btn = document.getElementById('animal-load-btn');
  btn.textContent = 'Loading…';
  btn.disabled = true;

  const panel = document.getElementById('animal-filter-panel');
  if (panel) { panel.classList.remove('open'); document.getElementById('filter-toggle-btn')?.classList.remove('open'); }

  showLoading();
  if (activePopup) { activePopup.remove(); activePopup = null; }

  const conditions = [];
  if (condition === 'sick') {
    conditions.push(`(animal_condition='Injured' OR animal_condition='Unhealthy' OR animal_condition='DOA')`);
  } else if (condition) {
    conditions.push(`animal_condition='${condition}'`);
  }
  if (borough) conditions.push(`borough='${borough}'`);
  if (cls)     conditions.push(`animal_class='${cls.replace(/'/g, "''")}'`);

  const url = new URL(ANIMAL_API);
  if (conditions.length) url.searchParams.set('$where', conditions.join(' AND '));
  url.searchParams.set('$limit', limit);
  url.searchParams.set('$order', 'date_and_time_of_initial DESC');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    animalData = data;
    renderAnimalList(data);
    renderAnimalMarkers(data);
    updateAnimalStats(data);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.textContent = 'Load Incidents';
    btn.disabled = false;
  }
}

function renderAnimalList(data) {
  const list     = document.getElementById('complaint-list');
  const countEl  = document.getElementById('list-count');
  const tabCount = document.getElementById('tab-list-count');
  countEl.textContent = data.length;
  if (tabCount) tabCount.textContent = data.length;

  if (!data.length) {
    list.innerHTML = `
      <div class="state-box">
        <div class="state-icon">🐾</div>
        <div class="state-title">No results</div>
        <div class="state-msg">Try adjusting your filters.</div>
      </div>`;
    return;
  }

  list.innerHTML = data.map((inc) => {
    const idx     = animalData.indexOf(inc);
    const date    = formatDate(inc.date_and_time_of_initial);
    const species = escHTML(inc.species_description || 'Unknown animal');
    const cond    = escHTML(inc.animal_condition || '');
    const action  = safeText(inc.final_ranger_action || '');
    const park    = safeText(inc.property || '');
    const borough = escHTML(inc.borough || '');
    const condClass = ANIMAL_COND_CLASS[inc.animal_condition] || 'cond-unknown';

    return `
      <div class="complaint-card animal-card" data-idx="${idx}" onclick="focusAnimalCard(${idx})">
        <div class="card-top">
          <span class="card-address">${species}</span>
          ${cond ? `<span class="card-status animal-cond-badge ${condClass}">${cond}</span>` : ''}
        </div>
        <div class="card-meta">
          <span class="card-borough">${borough}</span>
          <span class="card-date">${date}</span>
        </div>
        ${park   ? `<div class="card-park">${park}</div>` : ''}
        ${action ? `<div class="card-action">${action}</div>` : ''}
      </div>`;
  }).join('');
}

function focusAnimalCard(idx) {
  document.querySelectorAll('.animal-card').forEach(el => el.classList.remove('active'));
  const card = document.querySelector(`.animal-card[data-idx="${idx}"]`);
  if (card) { card.classList.add('active'); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

  const inc = animalData[idx];
  if (!inc) return;
  const centroidMap = getOrBuildParkCentroidMap();
  const key = (inc.property || '').toLowerCase().trim();
  const centroid = centroidMap.get(key);
  if (centroid) {
    if (window.innerWidth <= 700) switchView('map');
    map.flyTo({ center: centroid, zoom: 14, duration: 600 });
    if (activePopup) { activePopup.remove(); activePopup = null; }
    activePopup = new maplibregl.Popup({ maxWidth: '260px', offset: 10 })
      .setLngLat(centroid)
      .setHTML(buildAnimalPopup(inc))
      .addTo(map);
  }
}

function buildAnimalPopup(inc) {
  const species   = inc.species_description || 'Unknown animal';
  const cond      = inc.animal_condition || 'N/A';
  const action    = inc.final_ranger_action || '';
  const park      = fixEncoding(inc.property || '');
  const date      = formatDate(inc.date_and_time_of_initial);
  const condClass = ANIMAL_COND_CLASS[cond] || 'cond-unknown';
  return `
    <div class="popup-content">
      <strong>${species}</strong>
      <div class="popup-meta">
        <span class="animal-cond-badge ${condClass}" style="font-size:.7rem;padding:.1rem .35rem;">${cond}</span> · ${date}
      </div>
      ${park   ? `<div>${park}</div>` : ''}
      ${action ? `<div class="popup-resolution">${action}</div>` : ''}
    </div>`;
}

function renderAnimalMarkers(data) {
  if (!map.getSource('animal-incidents')) return;
  const centroidMap = getOrBuildParkCentroidMap();

  const grouped = new Map();
  data.forEach((inc, i) => {
    const key = (inc.property || '').toLowerCase().trim();
    if (!grouped.has(key)) grouped.set(key, { indices: [], displayName: inc.property || '' });
    grouped.get(key).indices.push(i);
  });

  const features = [];
  grouped.forEach(({ indices, displayName }, key) => {
    const centroid = centroidMap.get(key);
    if (!centroid) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: centroid },
      properties: { count: indices.length, parkName: key, displayName, indices: JSON.stringify(indices) },
    });
  });

  map.getSource('animal-incidents').setData({ type: 'FeatureCollection', features });

  if (features.length > 0) {
    const lngs = features.map(f => f.geometry.coordinates[0]);
    const lats = features.map(f => f.geometry.coordinates[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 48, maxZoom: 13 }
    );
  }
}

function updateAnimalStats(data) {
  const injured   = data.filter(d => d.animal_condition === 'Injured').length;
  const unhealthy = data.filter(d => d.animal_condition === 'Unhealthy').length;
  const doa       = data.filter(d => d.animal_condition === 'DOA').length;
  const species   = new Set(data.map(d => d.species_description).filter(Boolean)).size;

  document.getElementById('stats').innerHTML = `
    <span class="stat"><strong>${data.length}</strong> incidents</span>
    <span class="stat stat-open"><strong>${injured}</strong> injured</span>
    <span class="stat stat-closed"><strong>${unhealthy}</strong> unhealthy</span>
    <span class="stat"><strong>${doa}</strong> DOA</span>
    <span class="stat"><strong>${species}</strong> species</span>`;
}

// ── Load error banner ─────────────────────────────────────────────
let loadErrorShown = false;
function showLoadError() {
  if (loadErrorShown) return;
  loadErrorShown = true;
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fef2f2;color:#991b1b;padding:.75rem 1rem;text-align:center;font-size:.85rem;font-family:inherit;border-bottom:2px solid #fca5a5;display:flex;align-items:center;justify-content:center;gap:.5rem;flex-wrap:wrap;';
  banner.innerHTML = '<span>The page didn\u2019t load properly.</span><button onclick="location.reload()" style="background:#991b1b;color:#fff;border:none;border-radius:6px;padding:.35rem .9rem;font-size:.82rem;font-weight:600;cursor:pointer;">Reload Page</button>';
  document.body.prepend(banner);
}

// ── Boot ─────────────────────────────────────────────────────────
initMap();
loadParkList();
initDogRunZipAutocomplete();
