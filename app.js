/* ============================================
   AR NAVIGATE — App Logic
   Building management, floor plan editor,
   pathfinding, and AR navigation mode.
   ============================================ */

// ===== API =====
const API = 'port/8000'.startsWith('__') ? '' : 'port/8000';

const WP_TYPES = {
  room:      { label: 'Rum / Avdelning', color: '#3b82f6' },
  corridor:  { label: 'Korridor',        color: '#64748b' },
  stairs:    { label: 'Trappa / Hiss',   color: '#f59e0b' },
  entrance:  { label: 'Entré',           color: '#8b5cf6' },
  exit:      { label: 'Utgång',          color: '#ef4444' },
  wc:        { label: 'Toalett',         color: '#10b981' },
  elevator:  { label: 'Hiss',            color: '#ec4899' },
};

// ===== STATE =====
const state = {
  buildings: [],
  currentBuilding: null,
  currentFloorIdx: 0,
  mode: 'nav',          // 'nav' | 'editor'
  editorTool: 'add',
  editorWpType: 'room',
  selectedWp: null,     // for connect mode
  draggingWp: null,
  route: null,          // computed path
  routeFromId: null,
  routeToId: null,
  arState: null,        // AR animation state
};

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}

// ===== TOAST =====
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ===== API CALLS + LOCAL DEMO FALLBACK =====
const LOCAL_DB_KEY = 'ar-navigate-local-db-v3';
function localDbLoad(){ try { return JSON.parse(localStorage.getItem(LOCAL_DB_KEY)||'[]'); } catch { return []; } }
function localDbSave(data){ localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(data)); }
function localFloor(f){ return { id:f.id, name:f.name, level:f.level??0, canvas_w:f.canvas_w||800, canvas_h:f.canvas_h||500, background:f.background||null, waypoints:f.waypoints||[], edges:f.edges||[], scaleMetersPerUnit:f.scaleMetersPerUnit||null, scaleCalibration:f.scaleCalibration||null }; }
function localHandle(method,path,body){
  let db=localDbLoad(); const parts=path.split('/').filter(Boolean);
  if(parts[0]!=='api' || parts[1]!=='buildings') throw new Error('Unsupported local API');
  if(method==='GET' && parts.length===2) return db.map(b=>({...b,waypoint_count:(b.floors||[]).reduce((n,f)=>n+(f.waypoints||[]).length,0)}));
  if(method==='GET' && parts.length===3){ const b=db.find(x=>x.id===parts[2]); if(!b) throw new Error('Not found'); return b; }
  if(method==='POST' && parts.length===2){
    const id='local_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); const count=Math.max(1,Number(body.floor_count)||1); const names=body.floor_names||[];
    const b={id,name:body.name||'Ny byggnad',address:body.address||'',type:body.type||'Byggnad',floors:Array.from({length:count},(_,i)=>localFloor({id:id+'_f'+i,name:names[i]||`Våning ${i+1}`,level:i,canvas_w:800,canvas_h:500,waypoints:[],edges:[]}))}; db.push(b); localDbSave(db); return b;
  }
  if(method==='DELETE' && parts.length===3){ db=db.filter(x=>x.id!==parts[2]); localDbSave(db); return {ok:true}; }
  if(method==='PUT' && parts.length===5 && parts[3]==='floors'){ const b=db.find(x=>x.id===parts[2]); if(!b) throw new Error('Not found'); const f=b.floors.find(x=>x.id===parts[4]); if(!f) throw new Error('Floor not found'); Object.assign(f,body); localDbSave(db); return f; }
  throw new Error('Unsupported local API');
}
async function apiRequest(method,path,body){
  try { const r=await fetch(`${API}${path}`, body===undefined?{method}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(!r.ok) throw new Error(`API error: ${r.status}`); return r.json(); }
  catch(e){ return localHandle(method,path,body); }
}
async function apiGet(path){ return apiRequest('GET',path); }
async function apiPost(path,body){ return apiRequest('POST',path,body); }
async function apiPut(path,body){ return apiRequest('PUT',path,body); }
async function apiDelete(path){ return apiRequest('DELETE',path); }

// ===== THEME =====
(function () {
  const t = $('[data-theme-toggle]');
  const r = document.documentElement;
  let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', d);
  if (t) {
    t.addEventListener('click', () => {
      d = d === 'dark' ? 'light' : 'dark';
      r.setAttribute('data-theme', d);
    });
  }
})();

// ===== VIEW SWITCHING =====
function showView(name) {
  $('#viewBuildings').classList.add('hidden');
  $('#viewDetail').classList.add('hidden');
  if (name === 'buildings') $('#viewBuildings').classList.remove('hidden');
  if (name === 'detail') $('#viewDetail').classList.remove('hidden');
}

// ===== BUILDING LIST =====
async function loadBuildingList() {
  try {
    state.buildings = await apiGet('/api/buildings');
    renderBuildingList();
  } catch (e) {
    toast('Kunde inte hämta byggnader');
  }
}

function renderBuildingList() {
  const container = $('#buildingList');
  container.innerHTML = '';

  if (state.buildings.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/>
        </svg>
        <p class="empty-state-title">Inga byggnader än</p>
        <p class="empty-state-desc">Klicka på "Ny byggnad" för att lägga till en byggnad med planritning och navigeringspunkter.</p>
      </div>`;
    return;
  }

  for (const b of state.buildings) {
    const card = document.createElement('div');
    card.className = 'building-card';
    card.innerHTML = `
      <button class="building-card-delete" data-delete="${b.id}" aria-label="Ta bort">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
      <svg class="building-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/>
      </svg>
      <span class="building-card-type">${escapeHtml(b.type || 'Byggnad')}</span>
      <h3 class="building-card-name">${escapeHtml(b.name)}</h3>
      <p class="building-card-address">${escapeHtml(b.address || 'Ingen adress angiven')}</p>
      <div class="building-card-stats">
        <span class="building-card-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>
          ${b.floor_count} våning${b.floor_count !== 1 ? 'ar' : ''}
        </span>
        <span class="building-card-stat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
          ${b.waypoint_count} punkter
        </span>
      </div>`;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete]')) return;
      openBuilding(b.id);
    });
    container.appendChild(card);
  }

  // Delete buttons
  $$('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delete;
      const b = state.buildings.find(x => x.id === id);
      if (confirm(`Ta bort "${b.name}"? Detta går inte att ångra.`)) {
        await apiDelete(`/api/buildings/${id}`);
        toast('Byggnad borttagen');
        loadBuildingList();
      }
    });
  });
}

// ===== BUILDING DETAIL =====
async function openBuilding(id) {
  try {
    state.currentBuilding = await apiGet(`/api/buildings/${id}`);
    state.currentFloorIdx = 0;
    state.mode = 'nav';
    state.route = null;
    state.routeFromId = null;
    state.routeToId = null;
    state.selectedWp = null;
    $('#routeInfo').classList.add('hidden');
    showView('detail');
    renderDetail();
  } catch (e) {
    toast('Kunde inte öppna byggnad');
  }
}

function renderDetail() {
  const b = state.currentBuilding;
  if (!b) return;

  $('#detailName').textContent = b.name;
  $('#detailAddress').textContent = b.address || 'Ingen adress angiven';

  // Floor tabs
  const tabs = $('#detailFloorTabs');
  tabs.innerHTML = '';
  b.floors.forEach((f, i) => {
    const tab = document.createElement('button');
    tab.className = 'floor-tab' + (i === state.currentFloorIdx ? ' active' : '');
    tab.textContent = f.name;
    tab.addEventListener('click', () => {
      state.currentFloorIdx = i;
      renderDetail();
    });
    tabs.appendChild(tab);
  });

  // Mode panels
  const isEditor = state.mode === 'editor';
  $('#navPanel').classList.toggle('hidden', isEditor);
  $('#editorPanel').classList.toggle('hidden', !isEditor);
  $('#wpListPanel').classList.toggle('hidden', !isEditor);

  renderFloorPlan();

  if (isEditor) {
    ensureScaleUI();
    updateScaleUI();
    renderWpList();
  } else {
    populateNavSelects();
  }
}

// ===== FLOOR PLAN RENDERING =====
function currentFloor() {
  return state.currentBuilding?.floors[state.currentFloorIdx];
}

function renderFloorPlan() {
  const svg = $('#floorPlan');
  svg.innerHTML = '';
  const floor = currentFloor();
  if (!floor) return;

  svg.setAttribute('viewBox', `0 0 ${floor.canvas_w || 800} ${floor.canvas_h || 500}`);
  svg.className.baseVal = 'floor-plan-svg mode-' + (state.mode === 'editor' ? state.editorTool : 'nav');

  // Background image
  if (floor.background) {
    const img = el('image', {
      href: floor.background,
      x: 0, y: 0,
      width: floor.canvas_w || 800,
      height: floor.canvas_h || 500,
      preserveAspectRatio: 'xMidYMid meet',
      class: 'fp-bg-image',
    }, svg);
  }

  // Grid (subtle)
  const gridOpacity = floor.background ? '0.03' : '0.06';
  for (let x = 0; x <= (floor.canvas_w || 800); x += 40) {
    el('line', { x1: x, y1: 0, x2: x, y2: floor.canvas_h || 500, stroke: 'currentColor', 'stroke-width': 1, opacity: gridOpacity }, svg);
  }
  for (let y = 0; y <= (floor.canvas_h || 500); y += 40) {
    el('line', { x1: 0, y1: y, x2: floor.canvas_w || 800, y2: y, stroke: 'currentColor', 'stroke-width': 1, opacity: gridOpacity }, svg);
  }

  // Determine path waypoints on this floor
  const pathWpIds = new Set();
  const pathEdges = new Set();
  if (state.route) {
    for (const step of state.route) {
      if (step.floorIdx === state.currentFloorIdx) {
        pathWpIds.add(step.wpId);
        if (step.edge) pathEdges.add(step.edge);
      }
    }
  }

  // Edges
  for (const edge of floor.edges) {
    const wp1 = floor.waypoints.find(w => w.id === edge[0]);
    const wp2 = floor.waypoints.find(w => w.id === edge[1]);
    if (!wp1 || !wp2) continue;

    const isPath = pathEdges.has(`${edge[0]}|${edge[1]}`) || pathEdges.has(`${edge[1]}|${edge[0]}`);
    el('line', {
      x1: wp1.x, y1: wp1.y, x2: wp2.x, y2: wp2.y,
      class: isPath ? 'fp-edge-path' : 'fp-edge',
      'data-edge': `${edge[0]}|${edge[1]}`,
    }, svg);
  }

  // Waypoints
  for (const wp of floor.waypoints) {
    const type = WP_TYPES[wp.type] || WP_TYPES.room;
    let cls = 'fp-waypoint-circle';
    if (state.routeFromId === wp.id) cls += ' fp-waypoint-start';
    else if (state.routeToId === wp.id) cls += ' fp-waypoint-end';
    else if (pathWpIds.has(wp.id)) cls += ' fp-waypoint-path';
    else cls += ''; // type color via fill

    const color = state.routeFromId === wp.id ? '#22c55e'
      : state.routeToId === wp.id ? '#ef4444'
      : pathWpIds.has(wp.id) ? 'var(--color-primary)'
      : type.color;

    const g = el('g', { class: 'fp-waypoint', 'data-wp': wp.id }, svg);
    el('circle', {
      cx: wp.x, cy: wp.y, r: 10,
      fill: color,
      class: cls,
    }, g);
    // Stairs icon
    if (wp.type === 'stairs' || wp.type === 'elevator') {
      el('text', { x: wp.x, y: wp.y + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff', 'pointer-events': 'none' }, g).textContent = '⇅';
    }
    // Label
    if (wp.label) {
      el('text', {
        x: wp.x, y: wp.y - 16,
        class: 'fp-waypoint-label',
      }, g).textContent = wp.label;
    }
  }
}

// ===== NAVIGATION SELECTS =====
function populateNavSelects() {
  const floor = currentFloor();
  if (!floor) return;

  const allWps = [];
  for (const f of state.currentBuilding.floors) {
    for (const wp of f.waypoints) {
      allWps.push({ ...wp, floorName: f.name, floorIdx: f.level });
    }
  }

  const fromSel = $('#selectFrom');
  const toSel = $('#selectTo');
  fromSel.innerHTML = '';
  toSel.innerHTML = '';

  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '— Välj punkt —';
  fromSel.appendChild(emptyOpt.cloneNode(true));
  toSel.appendChild(emptyOpt.cloneNode(true));

  for (const wp of allWps) {
    const o1 = document.createElement('option');
    o1.value = wp.id;
    o1.textContent = `${wp.label || 'Namnlös'} (${wp.floorName})`;
    fromSel.appendChild(o1);

    const o2 = o1.cloneNode(true);
    toSel.appendChild(o2);
  }

  fromSel.value = state.routeFromId || '';
  toSel.value = state.routeToId || '';
}

// ===== PATHFINDING (BFS) =====
function findPath(fromId, toId) {
  const building = state.currentBuilding;
  if (!building) return null;

  // Build adjacency list across all floors
  const adj = {}; // wpId -> [{wpId, floorIdx}]

  for (const floor of building.floors) {
    for (const edge of floor.edges) {
      if (!adj[edge[0]]) adj[edge[0]] = [];
      if (!adj[edge[1]]) adj[edge[1]] = [];
      adj[edge[0]].push({ wpId: edge[1], floorIdx: floor.level });
      adj[edge[1]].push({ wpId: edge[0], floorIdx: floor.level });
    }
  }

  // Connect stairs across floors
  const stairsByFloor = {};
  for (let i = 0; i < building.floors.length; i++) {
    stairsByFloor[i] = building.floors[i].waypoints.filter(w => w.type === 'stairs' || w.type === 'elevator');
  }
  for (let i = 0; i < building.floors.length - 1; i++) {
    const lower = stairsByFloor[i];
    const upper = stairsByFloor[i + 1];
    for (const l of lower) {
      for (const u of upper) {
        if (!adj[l.id]) adj[l.id] = [];
        if (!adj[u.id]) adj[u.id] = [];
        adj[l.id].push({ wpId: u.id, floorIdx: i + 1, isStairs: true });
        adj[u.id].push({ wpId: l.id, floorIdx: i, isStairs: true });
      }
    }
  }

  // BFS
  const visited = new Set([fromId]);
  const queue = [{ wpId: fromId, floorIdx: findFloorIdx(fromId), path: [] }];

  while (queue.length > 0) {
    const { wpId, floorIdx, path } = queue.shift();
    if (wpId === toId) return path;

    const neighbors = adj[wpId] || [];
    for (const n of neighbors) {
      const key = n.wpId;
      if (visited.has(key)) continue;
      visited.add(key);
      const newStep = {
        wpId: n.wpId,
        floorIdx: n.floorIdx,
        fromWpId: wpId,
        edge: `${wpId}|${n.wpId}`,
        isStairs: n.isStairs || false,
      };
      queue.push({ wpId: n.wpId, floorIdx: n.floorIdx, path: [...path, newStep] });
    }
  }
  return null;
}

function findFloorIdx(wpId) {
  for (let i = 0; i < state.currentBuilding.floors.length; i++) {
    if (state.currentBuilding.floors[i].waypoints.some(w => w.id === wpId)) return i;
  }
  return 0;
}

function getWp(wpId) {
  for (const f of state.currentBuilding.floors) {
    const wp = f.waypoints.find(w => w.id === wpId);
    if (wp) return { ...wp, floorName: f.name, floorIdx: f.level };
  }
  return null;
}

// ===== CALCULATE ROUTE =====
async function calculateRoute() {
  const fromId = $('#selectFrom').value;
  const toId = $('#selectTo').value;

  if (!fromId || !toId) {
    toast('Välj både start- och slutpunkt');
    return;
  }
  if (fromId === toId) {
    toast('Start och mål är samma punkt');
    return;
  }

  state.routeFromId = fromId;
  state.routeToId = toId;

  const path = findPath(fromId, toId);
  if (!path) {
    toast('Ingen rutt hittades mellan dessa punkter');
    state.route = null;
    renderFloorPlan();
    return;
  }

  state.route = path;

  // Stats
  const floors = new Set(path.map(s => s.floorIdx));
  let totalDist = 0;
  for (const step of path) {
    const from = getWp(step.fromWpId);
    const to = getWp(step.wpId);
    if (from && to) {
      totalDist += Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
    }
  }

  $('#statPoints').textContent = path.length + 1;
  const scale = currentFloor()?.scaleMetersPerUnit || 1;
  const totalMeters = totalDist * scale;
  $('#statDistance').textContent = totalMeters >= 1 ? (Math.round(totalMeters*10)/10) + ' m' : Math.round(totalDist) + ' ritn.enheter';
  $('#statFloors').textContent = floors.size;

  // Steps
  const stepsEl = $('#routeSteps');
  stepsEl.innerHTML = '';
  path.forEach((step, i) => {
    const wp = getWp(step.wpId);
    const fromWp = getWp(step.fromWpId);
    const stepEl = document.createElement('div');
    stepEl.className = 'route-step';
    let text = '';
    if (step.isStairs) {
      text = `Ta trappa/hiss till ${wp?.floorName || 'nästa våning'}`;
    } else {
      text = `Gå till ${wp?.label || 'punkt'}`;
    }
    stepEl.innerHTML = `
      <span class="route-step-num">${i + 1}</span>
      <span class="route-step-text">${escapeHtml(text)}</span>
      <span class="route-step-floor">${wp?.floorName || ''}</span>`;
    stepsEl.appendChild(stepEl);
  });

  $('#routeInfo').classList.remove('hidden');
  renderFloorPlan();
}

// ===== EDITOR =====
function setEditorTool(tool) {
  state.editorTool = tool;
  state.selectedWp = null;
  $$('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));

  const hints = {
    add: 'Klicka på planritningen för att placera en ny punkt.',
    connect: 'Klicka på två punkter för att koppla dem med en linje.',
    move: 'Drag en punkt för att flytta den.',
    delete: 'Klicka på en punkt eller linje för att ta bort den.',
    calibrate: 'Klicka på två punkter i planritningen och ange verkligt avstånd i meter.',
  };
  $('#editorHint').textContent = hints[tool] || '';
  renderFloorPlan();
}

function svgCoords(clientX, clientY) {
  const svg = $('#floorPlan');
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  return pt.matrixTransform(ctm.inverse());
}

function handleSvgClick(e) {
  if (state.mode !== 'editor') return;
  const floor = currentFloor();
  if (!floor) return;

  const wpEl = e.target.closest('[data-wp]');
  const edgeEl = e.target.closest('[data-edge]');

  if (state.editorTool === 'calibrate') {
    const coords = wpEl ? (()=>{ const wp=floor.waypoints.find(w=>w.id===wpEl.dataset.wp); return wp ? {x:wp.x,y:wp.y} : null; })() : svgCoords(e.clientX,e.clientY);
    if (!coords) return;
    state.calibrationPoints = state.calibrationPoints || [];
    state.calibrationPoints.push(coords);
    if(state.calibrationPoints.length===1){ toast('Punkt A vald – välj punkt B'); renderFloorPlan(); return; }
    const [a,b]=state.calibrationPoints; const units=Math.hypot(b.x-a.x,b.y-a.y);
    const meters=Number(prompt('Hur många meter är det mellan punkt A och B?', '10'));
    if(!Number.isFinite(meters)||meters<=0||units<1){ state.calibrationPoints=[]; toast('Kalibreringen avbröts'); return; }
    floor.scaleMetersPerUnit=meters/units; floor.scaleCalibration={a,b,meters}; state.calibrationPoints=[];
    toast(`Skala sparad: ${meters.toFixed(2)} m`); renderDetail(); return;
  }

  if (state.editorTool === 'add') {
    if (wpEl) return; // Don't add on existing waypoint
    const coords = svgCoords(e.clientX, e.clientY);
    const newWp = {
      id: `wp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      x: Math.round(coords.x),
      y: Math.round(coords.y),
      label: '',
      type: state.editorWpType,
    };
    floor.waypoints.push(newWp);
    renderFloorPlan();
    renderWpList();
  } else if (state.editorTool === 'connect') {
    if (!wpEl) {
      state.selectedWp = null;
      renderFloorPlan();
      return;
    }
    const wpId = wpEl.dataset.wp;
    if (!state.selectedWp) {
      state.selectedWp = wpId;
      renderFloorPlan();
      // Highlight selected
      const g = $(`[data-wp="${wpId}"]`);
      if (g) g.querySelector('circle').classList.add('fp-waypoint-selected');
    } else {
      if (state.selectedWp === wpId) {
        state.selectedWp = null;
        renderFloorPlan();
        return;
      }
      // Create edge
      const edgeKey = [state.selectedWp, wpId].sort();
      const exists = floor.edges.some(e =>
        (e[0] === edgeKey[0] && e[1] === edgeKey[1]) ||
        (e[0] === edgeKey[1] && e[1] === edgeKey[0])
      );
      if (!exists) {
        floor.edges.push([state.selectedWp, wpId]);
        toast('Punkter kopplade');
      } else {
        toast('Punkterna är redan kopplade');
      }
      state.selectedWp = null;
      renderFloorPlan();
      renderWpList();
    }
  } else if (state.editorTool === 'delete') {
    if (wpEl) {
      const wpId = wpEl.dataset.wp;
      floor.waypoints = floor.waypoints.filter(w => w.id !== wpId);
      floor.edges = floor.edges.filter(e => e[0] !== wpId && e[1] !== wpId);
      toast('Punkt borttagen');
      renderFloorPlan();
      renderWpList();
    } else if (edgeEl) {
      const [a, b] = edgeEl.dataset.edge.split('|');
      floor.edges = floor.edges.filter(e =>
        !((e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))
      );
      toast('Linje borttagen');
      renderFloorPlan();
    }
  }
}

function handleSvgPointerDown(e) {
  if (state.mode !== 'editor' || state.editorTool !== 'move') return;
  const wpEl = e.target.closest('[data-wp]');
  if (!wpEl) return;
  state.draggingWp = wpEl.dataset.wp;
  e.preventDefault();
}

function handleSvgPointerMove(e) {
  if (!state.draggingWp) return;
  const floor = currentFloor();
  if (!floor) return;
  const wp = floor.waypoints.find(w => w.id === state.draggingWp);
  if (!wp) return;
  const coords = svgCoords(e.clientX, e.clientY);
  wp.x = Math.round(coords.x);
  wp.y = Math.round(coords.y);
  renderFloorPlan();
}

function handleSvgPointerUp() {
  if (state.draggingWp) {
    state.draggingWp = null;
    renderWpList();
  }
}

function renderWpList() {
  const floor = currentFloor();
  if (!floor) return;
  const list = $('#wpList');
  list.innerHTML = '';

  if (floor.waypoints.length === 0) {
    list.innerHTML = '<p style="color:var(--color-text-muted);font-size:var(--text-sm);padding:var(--space-2)">Inga punkter än. Klicka på planritningen för att lägga till.</p>';
    return;
  }

  for (const wp of floor.waypoints) {
    const type = WP_TYPES[wp.type] || WP_TYPES.room;
    const item = document.createElement('div');
    item.className = 'wp-list-item';
    item.innerHTML = `
      <span class="wp-list-color" style="background:${type.color}"></span>
      <input type="text" class="wp-list-name" value="${escapeHtml(wp.label || '')}" data-wp-name="${wp.id}" placeholder="Namnlös" style="background:transparent;border:none;color:var(--color-text);font-size:var(--text-sm);flex:1;min-width:0" />
      <select class="wp-list-type select-sm" data-wp-type="${wp.id}">
        ${Object.entries(WP_TYPES).map(([k, v]) => `<option value="${k}" ${wp.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select>
      <button class="icon-btn" data-wp-del="${wp.id}" style="width:28px;height:28px" aria-label="Ta bort">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>`;
    list.appendChild(item);
  }

  // Name inputs
  $$('[data-wp-name]').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const wp = floor.waypoints.find(w => w.id === e.target.dataset.wpName);
      if (wp) {
        wp.label = e.target.value;
        renderFloorPlan();
      }
    });
  });

  // Type selects
  $$('[data-wp-type]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const wp = floor.waypoints.find(w => w.id === e.target.dataset.wpType);
      if (wp) {
        wp.type = e.target.value;
        renderFloorPlan();
        renderWpList();
      }
    });
  });

  // Delete buttons
  $$('[data-wp-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.wpDel;
      floor.waypoints = floor.waypoints.filter(w => w.id !== id);
      floor.edges = floor.edges.filter(e => e[0] !== id && e[1] !== id);
      renderFloorPlan();
      renderWpList();
    });
  });
}

// ===== SAVE FLOOR =====
async function saveFloor() {
  const floor = currentFloor();
  const building = state.currentBuilding;
  if (!floor || !building) return;

  try {
    await apiPut(`/api/buildings/${building.id}/floors/${floor.id}`, {
      waypoints: floor.waypoints,
      edges: floor.edges,
      background: floor.background,
      name: floor.name,
      scaleMetersPerUnit: floor.scaleMetersPerUnit || null,
      scaleCalibration: floor.scaleCalibration || null,
    });
    toast('Planritning sparad');
  } catch (e) {
    toast('Kunde inte spara');
  }
}

// ===== BACKGROUND IMAGE UPLOAD =====
function handleBgUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3_000_000) {
    toast('Bilden är för stor (max 3 MB)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const floor = currentFloor();
    if (floor) {
      floor.background = reader.result;
      renderFloorPlan();
      toast('Planritning uppladdad — glöm inte att spara');
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function clearBg() {
  const floor = currentFloor();
  if (floor) {
    floor.background = null;
    renderFloorPlan();
    toast('Bild borttagen — glöm inte att spara');
  }
}

// ===== ADD BUILDING MODAL =====
function openAddModal() {
  $('#addModal').classList.remove('hidden');
  $('#formName').value = '';
  $('#formAddress').value = '';
  $('#formType').value = '';
  $('#formFloors').value = '2';
  $('#formFloorNames').value = '';
  setTimeout(() => $('#formName').focus(), 100);
}

function closeAddModal() {
  $('#addModal').classList.add('hidden');
}

async function confirmAddBuilding() {
  const name = $('#formName').value.trim();
  if (!name) {
    toast('Ange ett byggnadsnamn');
    return;
  }

  const floorCount = parseInt($('#formFloors').value) || 1;
  const floorNamesText = $('#formFloorNames').value.trim();
  let floorNames = [];
  if (floorNamesText) {
    floorNames = floorNamesText.split('\n').map(s => s.trim()).filter(Boolean);
  }

  try {
    const building = await apiPost('/api/buildings', {
      name,
      address: $('#formAddress').value.trim(),
      type: $('#formType').value.trim() || 'Byggnad',
      floor_count: floorCount,
      floor_names: floorNames,
    });
    toast('Byggnad skapad');
    closeAddModal();
    await loadBuildingList();
    await openBuilding(building.id);
    // Auto-enter editor mode for new building
    state.mode = 'editor';
    renderDetail();
  } catch (e) {
    toast('Kunde inte skapa byggnad');
  }
}

// ===== ENHANCED NAVIGATION + AR MODE =====
const AR_OLIVE = '#6f7f3f';
const AR_OLIVE_DARK = '#4f5e2a';
const AR_WHITE = 'rgba(255,255,255,.94)';

function ensureScaleUI(){
  const panel=$('#editorPanel'); if(!panel || $('#scaleTools')) return;
  const box=document.createElement('div'); box.id='scaleTools'; box.style.cssText='margin:12px 0;padding:12px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface-2,#f8f8f5)';
  box.innerHTML='<div style="font-weight:700;margin-bottom:6px">Planritningens skala</div><div id="scaleStatus" style="font-size:13px;margin-bottom:8px"></div><button class="btn btn-outline" id="btnCalibrateScale">Kalibrera skala</button>';
  panel.prepend(box); $('#btnCalibrateScale').onclick=()=>{ state.editorTool='calibrate'; state.calibrationPoints=[]; $$('.tool-btn').forEach(b=>b.classList.remove('active')); $('#editorHint').textContent='Klicka på två punkter och ange avståndet i meter.'; toast('Välj punkt A och sedan punkt B'); };
  updateScaleUI();
}
function updateScaleUI(){ const floor=currentFloor(), elx=$('#scaleStatus'); if(!elx||!floor)return; elx.textContent=floor.scaleMetersPerUnit?`Kalibrerad: ${floor.scaleMetersPerUnit.toFixed(4)} m per ritningsenhet`:'Inte kalibrerad ännu – du kan ändå redigera planen.'; }

function ensureEnhancedNavUI() {
  const navPanel = $('#navPanel');
  if (!navPanel || $('#advancedNavControls')) return;
  const box = document.createElement('div');
  box.id='advancedNavControls'; box.className='nav-controls-row'; box.style.marginTop='12px';
  box.innerHTML=`<div class="control-group"><label class="control-label">Ruttalternativ</label><select id="routePreference" class="select"><option value="fast">Snabbaste väg</option><option value="accessible">Tillgänglig väg – undvik trappor</option><option value="stairs">Prioritera trappor</option><option value="elevator">Prioritera hiss</option></select></div><div class="control-group" style="flex:1"><label class="control-label">Sök destination</label><input id="routeSearch" class="input" type="search" placeholder="Rum, entré, WC…" autocomplete="off"></div>`;
  navPanel.querySelector('.nav-controls-row')?.after(box);
  $('#routeSearch').addEventListener('input',()=>{const q=$('#routeSearch').value.trim().toLowerCase();if(!q)return;const m=[];for(const f of state.currentBuilding?.floors||[])for(const w of f.waypoints||[])if((w.label||'').toLowerCase().includes(q))m.push(w);if(m.length===1){$('#selectTo').value=m[0].id;state.routeToId=m[0].id;}});
}
function routeWeight(step){const pref=$('#routePreference')?.value||'fast';if(!step.isStairs)return 1;const wp=getWp(step.wpId);if(pref==='accessible')return wp?.type==='elevator'?1.2:1000;if(pref==='elevator')return wp?.type==='elevator'?0.7:3;if(pref==='stairs')return wp?.type==='stairs'?.7:1.5;return 1.8;}

// Weighted shortest-path search. Existing floor links and stair/elevator links are preserved.
function findPath(fromId,toId){
  const building=state.currentBuilding;if(!building)return null;const adj={};
  const add=(a,b,f,isStairs=false)=>{(adj[a]??=[]).push({wpId:b,floorIdx:f,isStairs});};
  for(const floor of building.floors)for(const edge of floor.edges||[]){add(edge[0],edge[1],floor.level);add(edge[1],edge[0],floor.level);}
  const links=building.floors.map(f=>(f.waypoints||[]).filter(w=>w.type==='stairs'||w.type==='elevator'));
  for(let i=0;i<links.length-1;i++)for(const a of links[i])for(const b of links[i+1]){add(a.id,b.id,i+1,true);add(b.id,a.id,i,true);}
  const dist=new Map([[fromId,0]]),prev=new Map(),open=[{id:fromId,cost:0}];
  while(open.length){open.sort((a,b)=>a.cost-b.cost);const cur=open.shift();if(cur.id===toId)break;for(const n of adj[cur.id]||[]){const a=getWp(cur.id),b=getWp(n.wpId);const d=a&&b?Math.hypot(b.x-a.x,b.y-a.y):1;const nd=(dist.get(cur.id)??Infinity)+d*routeWeight(n);if(nd<(dist.get(n.wpId)??Infinity)){dist.set(n.wpId,nd);prev.set(n.wpId,{from:cur.id,n});open.push({id:n.wpId,cost:nd});}}}
  if(!prev.has(toId))return null;const path=[];let cur=toId;while(cur!==fromId){const p=prev.get(cur);path.push({wpId:cur,floorIdx:p.n.floorIdx,fromWpId:p.from,edge:`${p.from}|${cur}`,isStairs:!!p.n.isStairs});cur=p.from;}return path.reverse();
}

function installARStyle(){if($('#arEnhancedStyle'))return;const s=document.createElement('style');s.id='arEnhancedStyle';s.textContent=`#arCanvas{position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none}#arVideo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}#arFallback{z-index:0}.ar-direction-card{backdrop-filter:blur(8px)}#arArrowWrap{display:none!important}#arExtraControls button{min-width:44px}`;document.head.appendChild(s);}

async function loadThreeXR(){
  if(window.THREE) return window.THREE;
  if(!window.__arThreePromise){
    window.__arThreePromise=import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js').then(m=>{window.THREE=m;return m;});
  }
  return window.__arThreePromise;
}

function xrYawFromQuaternion(q){
  const siny=2*(q.w*q.y+q.x*q.z), cosy=1-2*(q.y*q.y+q.z*q.z);
  return Math.atan2(siny,cosy);
}

function makeARArrow(THREE, scale=1){
  const shape=new THREE.Shape();
  shape.moveTo(0,0.34); shape.lineTo(0.22,0.02); shape.lineTo(0.09,0.02);
  shape.lineTo(0.09,-0.34); shape.lineTo(-0.09,-0.34); shape.lineTo(-0.09,0.02);
  shape.lineTo(-0.22,0.02); shape.closePath();
  const white=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,transparent:true,opacity:.96});
  const olive=new THREE.MeshStandardMaterial({color:AR_OLIVE,roughness:.8,metalness:.05,side:THREE.DoubleSide});
  const outline=new THREE.Mesh(new THREE.ShapeGeometry(shape),white);
  const innerShape=new THREE.Shape();
  innerShape.moveTo(0,0.31); innerShape.lineTo(0.19,0.02); innerShape.lineTo(0.07,0.02);
  innerShape.lineTo(0.07,-0.31); innerShape.lineTo(-0.07,-0.31); innerShape.lineTo(-0.07,0.02);
  innerShape.lineTo(-0.19,0.02); innerShape.closePath();
  const inner=new THREE.Mesh(new THREE.ShapeGeometry(innerShape),olive);
  const g=new THREE.Group(); g.add(outline,inner); g.scale.setScalar(scale);
  // ShapeGeometry lies in XY; rotate onto the detected horizontal floor (XZ).
  g.rotation.x=-Math.PI/2;
  return g;
}

function routeWorldPoints(ar,THREE){
  const pts=[];
  const route=[getWp(state.routeFromId),...(ar.steps||[]).map(s=>s.wp)].filter(Boolean);
  if(!route.length)return pts;
  const base=route[0];
  const cos=Math.cos(ar.routeYaw||0), sin=Math.sin(ar.routeYaw||0);
  const scale=ar.metersPerUnit || currentFloor()?.scaleMetersPerUnit || 0.04;
  for(const wp of route){
    const px=(wp.x-base.x)*scale, pz=(wp.y-base.y)*scale;
    pts.push(new THREE.Vector3(px*cos-pz*sin,0.015,px*sin+pz*cos));
  }
  return pts;
}

function buildXRRoute(ar,THREE){
  ar.routeGroup?.clear();
  const pts=routeWorldPoints(ar,THREE); if(pts.length<2)return;
  ar.worldPoints=pts;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1],v=new THREE.Vector3().subVectors(b,a),len=v.length();
    const count=Math.max(1,Math.floor(len/0.65));
    for(let j=0;j<count;j++){
      const t=(j+.5)/count, pos=a.clone().lerp(b,t);
      const arrow=makeARArrow(THREE,Math.max(.55,Math.min(1.0,len/.9)));
      arrow.position.copy(pos);
      arrow.rotation.y=Math.atan2(v.x,v.z);
      ar.routeGroup.add(arrow);
    }
  }
}

async function startRealWebXR(){
  if(!state.route?.length){toast('Beräkna en rutt först');return;}
  if(!navigator.xr){toast('Den här telefonen/webbläsaren stöder inte WebXR AR');startARFallback();return;}
  installARStyle();
  const THREE=await loadThreeXR();
  if(!await navigator.xr.isSessionSupported?.('immersive-ar')){toast('WebXR AR stöds inte på den här enheten');startARFallback();return;}
  const overlay=$('#arOverlay'); overlay.classList.remove('hidden'); $('#arArrowWrap').style.display='none';
  const status=document.createElement('div'); status.id='xrStatus'; status.style.cssText='position:absolute;left:50%;top:18%;transform:translateX(-50%);z-index:50;background:rgba(0,0,0,.72);color:#fff;padding:12px 16px;border-radius:14px;text-align:center;font:600 15px system-ui;max-width:86%'; status.textContent='Rikta mobilen längs den första delen av rutten och tryck på skärmen.'; overlay.appendChild(status);
  const canvas=document.createElement('canvas'); canvas.id='xrCanvas'; canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:auto'; overlay.appendChild(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true}); renderer.xr.enabled=true; renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x666666,1.5));
  const group=new THREE.Group(); scene.add(group);
  const camera=new THREE.PerspectiveCamera();
  const ar={three:THREE,renderer,scene,camera,routeGroup:group,session:null,referenceSpace:null,hitTestSource:null,placed:false,routeYaw:0,metersPerUnit:0.04,worldPoints:[],steps:state.route.map(s=>({...s,wp:getWp(s.wpId),fromWp:getWp(s.fromWpId)}))};
  state.arState=ar;
  $('#arExtraControls')?.remove();
  try{
    const session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test','local'],optionalFeatures:['dom-overlay'],domOverlay:{root:overlay}});
    ar.session=session; renderer.xr.setSession(session);
    ar.referenceSpace=await session.requestReferenceSpace('local');
    const viewerSpace=await session.requestReferenceSpace('viewer');
    ar.hitTestSource=await session.requestHitTestSource({space:viewerSpace});
    session.addEventListener('select',()=>{
      if(ar.placed)return;
      const frame=ar.lastFrame,pose=frame?.getViewerPose(ar.referenceSpace); if(!pose)return;
      const hits=frame.getHitTestResults(ar.hitTestSource); if(!hits.length){status.textContent='Hittar inget golv ännu. Flytta mobilen långsamt över golvet.';return;}
      const hitPose=hits[0].getPose(ar.referenceSpace); if(!hitPose)return;
      ar.origin=new THREE.Vector3(hitPose.transform.position.x,hitPose.transform.position.y,hitPose.transform.position.z);
      ar.routeYaw=xrYawFromQuaternion(pose.transform.orientation);
      ar.placed=true;
      buildXRRoute(ar,THREE);
      status.textContent='Rutten är placerad. Följ de olivgröna pilarna.';
      setTimeout(()=>status.remove(),2200);
      // Move the whole route to the chosen floor point.
      group.position.copy(ar.origin);
    });
    session.addEventListener('end',()=>{cleanupRealXR();});
    renderer.setAnimationLoop((time,frame)=>{
      ar.lastFrame=frame;
      if(frame && ar.hitTestSource && !ar.placed){
        const hits=frame.getHitTestResults(ar.hitTestSource);
        if(hits.length)status.textContent='Golv hittat – håll mobilen längs rutten och tryck på skärmen.';
        else status.textContent='Söker efter golv… flytta mobilen långsamt.';
      }
      if(ar.placed) updateXRProgress(ar);
      renderer.render(scene,camera);
    });
    $('#arRouteBadge').textContent=`${getWp(state.routeFromId)?.label||'Start'} → ${getWp(state.routeToId)?.label||'Mål'}`;
  }catch(e){console.error(e);cleanupRealXR();toast('Kunde inte starta riktig AR – använder reservläge');startARFallback();}
}

function updateXRProgress(ar){
  if(!ar.worldPoints?.length)return;
  const viewer=ar.lastFrame?.getViewerPose(ar.referenceSpace); if(!viewer)return;
  const p=viewer.transform.position;
  let best=Infinity,bestIndex=0;
  ar.worldPoints.forEach((v,i)=>{const d=Math.hypot(v.x-(p.x-ar.origin.x),v.z-(p.z-ar.origin.z));if(d<best){best=d;bestIndex=i;}});
  $('#arDistance').textContent=best<1?'Nästa punkt nära':`${Math.round(best*10)/10} m`;
  const target=ar.steps[Math.min(bestIndex,ar.steps.length-1)]?.wp;
  $('#arTarget').textContent=target?.label||'Följ pilarna';
  $('#arProgressBar').style.width=`${Math.min(100,bestIndex/Math.max(1,ar.worldPoints.length-1)*100)}%`;
  $('#arProgressText').textContent=best<0.55?'Fortsätt framåt':'Följ de gröna pilarna';
}

function cleanupRealXR(){
  const ar=state.arState;
  if(!ar)return;
  try{ar.hitTestSource?.cancel();}catch(e){}
  try{ar.renderer?.setAnimationLoop(null);}catch(e){}
  try{ar.session?.end();}catch(e){}
  ar.renderer?.dispose?.();
  $('#xrCanvas')?.remove(); $('#xrStatus')?.remove();
  state.arState=null;
}

async function startAR(){
  // Prefer true WebXR/ARCore. The old camera-overlay mode remains as a fallback.
  return startRealWebXR();
}

function startARFallback(){
  // Non-WebXR fallback: retain the existing sensor/camera experience.
  if(!state.route?.length){toast('Beräkna en rutt först');return;}installARStyle();$('#arOverlay').classList.remove('hidden');
  const video=$('#arVideo'),fallback=$('#arFallback');let stream=null,cameraOk=false;
  navigator.mediaDevices?.getUserMedia?.({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false}).then(s=>{stream=s;video.srcObject=s;video.style.display='block';fallback.classList.add('hidden');}).catch(()=>{video.style.display='none';fallback.classList.remove('hidden');});
  const steps=state.route.map(s=>({...s,wp:getWp(s.wpId),fromWp:getWp(s.fromWpId)}));
  state.arState={steps,currentStep:0,progress:0,cameraOk,stream,rafId:null,heading:0,motion:false,paused:false};
  const from=getWp(state.routeFromId),to=getWp(state.routeToId);$('#arRouteBadge').textContent=`${from?.label||'Start'} → ${to?.label||'Mål'}`;addARControls();
  window.addEventListener('deviceorientation',handleAROrientation,true);window.addEventListener('devicemotion',handleARMotion,true);arAnimate();
}

function handleAROrientation(e){if(!state.arState)return;state.arState.heading=typeof e.webkitCompassHeading==='number'?e.webkitCompassHeading:(e.alpha||0);}
function handleARMotion(e){if(!state.arState)return;const a=e.accelerationIncludingGravity;if(!a)return;const mag=Math.hypot(a.x||0,a.y||0,a.z||0);state.arState.motion=Math.abs(mag-9.81)>1.4;}
function addARControls(){if($('#arExtraControls'))return;const hud=$('.ar-hud');if(!hud)return;const b=document.createElement('div');b.id='arExtraControls';b.style.cssText='position:absolute;left:50%;bottom:78px;transform:translateX(-50%);display:flex;gap:8px;z-index:20';b.innerHTML='<button class="btn btn-ghost" id="arPrevStep">‹</button><button class="btn btn-primary" id="arHere">Jag är här</button><button class="btn btn-ghost" id="arNextStep">›</button>';hud.appendChild(b);$('#arPrevStep').onclick=()=>{state.arState.currentStep=Math.max(0,state.arState.currentStep-1);state.arState.progress=0;};$('#arNextStep').onclick=()=>{state.arState.currentStep++;state.arState.progress=0;};$('#arHere').onclick=()=>{state.arState.progress=Math.min(.99,state.arState.progress+.25);};}
function drawFloorArrow(ctx,x,y,size,angle,alpha=1){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalAlpha=alpha;ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=7;ctx.shadowOffsetY=4;ctx.fillStyle=AR_OLIVE;ctx.strokeStyle=AR_WHITE;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(size*.72,-size*.15);ctx.lineTo(size*.3,-size*.15);ctx.lineTo(size*.3,size);ctx.lineTo(-size*.3,size);ctx.lineTo(-size*.3,-size*.15);ctx.lineTo(-size*.72,-size*.15);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
function drawFloorPath(ctx,ar,w,h){const step=ar.steps[ar.currentStep];if(!step)return;const cur=step.fromWp?{x:step.fromWp.x+(step.wp.x-step.fromWp.x)*ar.progress,y:step.fromWp.y+(step.wp.y-step.fromWp.y)*ar.progress}:step.wp;const pts=[cur];for(let i=ar.currentStep;i<Math.min(ar.steps.length,ar.currentStep+8);i++)if(ar.steps[i].wp)pts.push(ar.steps[i].wp);for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,n=Math.max(2,Math.floor(len/42));for(let j=1;j<=n;j++){const t=j/n,px=a.x+dx*t,depth=(i-1)*n+j,sy=h*.79-depth*34;if(sy<h*.16)continue;const perspective=Math.min(2,1+depth*.055),sx=w/2+(px-cur.x)*2.1*perspective;drawFloorArrow(ctx,sx,sy,Math.max(8,12*perspective),Math.atan2(-dy,dx)-Math.PI/2,Math.max(.32,1-depth*.045));}}}
function arAnimate(){const ar=state.arState;if(!ar||ar.three)return;const c=$('#arCanvas'),ctx=c.getContext('2d'),r=c.parentElement.getBoundingClientRect(),d=devicePixelRatio||1;c.width=Math.max(1,r.width*d);c.height=Math.max(1,r.height*d);c.style.width=r.width+'px';c.style.height=r.height+'px';ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);if(ar.currentStep>=ar.steps.length){ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,r.width,r.height);ctx.fillStyle=AR_WHITE;ctx.textAlign='center';ctx.font=`700 ${Math.min(34,r.width*.075)}px sans-serif`;ctx.fillText('✓ Framme!',r.width/2,r.height/2);return;}drawFloorPath(ctx,ar,r.width,r.height);const step=ar.steps[ar.currentStep],from=step.fromWp,wp=step.wp,dst=from&&wp?Math.hypot(wp.x-from.x,wp.y-from.y):0;if(ar.motion&&!ar.paused&&dst>0)ar.progress=Math.min(.99,ar.progress+.006);$('#arDistance').textContent=dst?`${Math.max(1,Math.round(dst*(1-ar.progress)))} u`:'—';$('#arTarget').textContent=wp?.label||'Nästa punkt';$('#arProgressBar').style.width=`${((ar.currentStep+ar.progress)/ar.steps.length)*100}%`;$('#arProgressText').textContent=`Punkt ${ar.currentStep+1} av ${ar.steps.length}`;ar.rafId=requestAnimationFrame(arAnimate);}

function stopAR(){
  if(state.arState?.three){try{state.arState.session?.end();}catch(e){}cleanupRealXR();}
  else {if(state.arState?.rafId)cancelAnimationFrame(state.arState.rafId);if(state.arState?.stream)state.arState.stream.getTracks().forEach(t=>t.stop());}
  window.removeEventListener('deviceorientation',handleAROrientation,true);window.removeEventListener('devicemotion',handleARMotion,true);
  state.arState=null;$('#arOverlay').classList.add('hidden');$('#arArrowWrap').style.display='none';$('#arExtraControls')?.remove();$('#xrCanvas')?.remove();$('#xrStatus')?.remove();
}


function exportProject(){const data=JSON.stringify(state.buildings,null,2);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download='ar-navigate-projekt.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function addProjectTools(){if($('#projectTools'))return;const header=$('#viewBuildings .section-header');if(!header)return;const wrap=document.createElement('div');wrap.id='projectTools';wrap.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap';wrap.innerHTML='<button class="btn btn-outline" id="btnExportProject">Exportera projekt</button><label class="btn btn-outline" for="projectImport">Importera projekt</label><input id="projectImport" type="file" accept="application/json" class="hidden-input">';header.appendChild(wrap);$('#btnExportProject').onclick=exportProject;$('#projectImport').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());for(const b of data){await apiPost('/api/buildings',b);}toast('Projekt importerat');loadBuildingList();}catch(err){toast('Kunde inte importera projekt');}e.target.value='';};}

// ===== UTILS =====
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
  ensureEnhancedNavUI();
  addProjectTools();
  ensureScaleUI();
  // Building list
  $('#btnAddBuilding').addEventListener('click', openAddModal);

  // Modal
  $('#btnCloseModal').addEventListener('click', closeAddModal);
  $('#btnCancelAdd').addEventListener('click', closeAddModal);
  $('#btnConfirmAdd').addEventListener('click', confirmAddBuilding);
  $('#addModal .modal-backdrop').addEventListener('click', closeAddModal);

  // Detail
  $('#btnBackToList').addEventListener('click', () => {
    showView('buildings');
    loadBuildingList();
  });
  $('#btnEditMode').addEventListener('click', () => {
    state.mode = 'editor';
    renderDetail();
  });
  $('#btnNavMode').addEventListener('click', () => {
    state.mode = 'nav';
    state.route = null;
    $('#routeInfo').classList.add('hidden');
    renderDetail();
  });

  // Navigation
  $('#btnCalculateRoute').addEventListener('click', calculateRoute);
  $('#selectFrom').addEventListener('change', (e) => { state.routeFromId = e.target.value; });
  $('#selectTo').addEventListener('change', (e) => { state.routeToId = e.target.value; });

  // AR
  $('#btnStartAR').addEventListener('click', startAR);
  $('#btnExitAR').addEventListener('click', stopAR);

  // Editor tools
  $$('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setEditorTool(btn.dataset.tool));
  });
  $('#wpTypeSelect').addEventListener('change', (e) => {
    state.editorWpType = e.target.value;
  });

  // Floor plan SVG events
  const svg = $('#floorPlan');
  svg.addEventListener('click', handleSvgClick);
  svg.addEventListener('pointerdown', handleSvgPointerDown);
  svg.addEventListener('pointermove', handleSvgPointerMove);
  svg.addEventListener('pointerup', handleSvgPointerUp);
  svg.addEventListener('pointercancel', handleSvgPointerUp);

  // Background upload
  $('#bgUpload').addEventListener('change', handleBgUpload);
  $('#btnClearBg').addEventListener('click', clearBg);

  // Save floor
  $('#btnSaveFloor').addEventListener('click', saveFloor);

  // Keyboard shortcuts for editor
  document.addEventListener('keydown', (e) => {
    if (state.mode !== 'editor') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const map = { '1': 'add', '2': 'connect', '3': 'move', '4': 'delete' };
    if (map[e.key]) setEditorTool(map[e.key]);
    if (e.key === 'Escape') {
      state.selectedWp = null;
      renderFloorPlan();
    }
  });

  // Init
  loadBuildingList();
});
