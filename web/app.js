// Audaces Canvas - Application Engine

// 0. UNIVERSAL OVERLAY, MODAL & DRAWER STATE MACHINE
window.OverlayManager = {
  closeAll(except = null) {
    if (except !== 'cenarios') document.getElementById('cenarios-lista-overlay')?.remove();
    if (except !== 'oportunidades') document.getElementById('op-lista-overlay')?.remove();
    if (except !== 'comparador') document.getElementById('comparador-modal')?.remove();
    if (except !== 'notepad') document.getElementById('op-notepad-modal')?.remove();
    if (except !== 'cenario-criar') document.getElementById('op-cenario-overlay')?.remove();
    if (except !== 'audit') document.getElementById('audit-modal')?.classList.remove('open');
    if (except !== 'toolsMenu') {
      const menu = document.getElementById('header-tools-menu');
      if (menu) menu.style.display = 'none';
    }
    if (except !== 'chat') {
      const chatDrawer = document.getElementById('chat-drawer');
      if (chatDrawer) chatDrawer.classList.remove('open');
    }
  }
};

// 1. STATE INITIALIZATION
let nodes = [];
let connections = [];
let nextNodeId = 1;

// Multi-canvas home screen state
let currentView = 'home'; // 'home' | 'canvas'
let activeCanvasId = null;
let activeFolderFilter = null; // null = show all

// Sticky notes (quick annotations during meetings)
let notes = [];
// Camada de Medição. Fica ao lado de nodes/connections porque é estado do
// canvas, não do nó: um breakpoint pode medir uma ARESTA, e aresta não tem dono.
let breakpoints = [];
// Oportunidades de receita. Pendem de uma ARESTA — a receita que se perde mora
// na passagem de bastão, onde ninguém é dono do prejuízo.
let oportunidades = [];
let nextNoteId = 1;
let activeNoteId = null;
let activeNoteStartPos = { x: 0, y: 0 };
const NOTE_COLORS = {
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  emerald: 'var(--accent-emerald)',
  purple: 'var(--accent-purple)'
};

// Child canvas navigation context
let childContext = null; // { node, parentNodes, parentConnections, parentNextNodeId, parentPanOffset, parentZoom }

// Pan & Zoom State
let zoom = 1.0;
let panOffset = { x: 100, y: 100 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffsetStart = { x: 0, y: 0 };

// Interaction State
let activeNodeId = null;
let activeNodeStartPos = { x: 0, y: 0 };
let pointerStartMouse = { x: 0, y: 0 };
let selectedNodeId = null;
let selectedConnectionId = null;

// Multi-select / box-select state
let selectedNodeIds = [];
let isBoxSelecting = false;
let boxSelectStart = { x: 0, y: 0 }; // screen coords

// Connection Drag State
let draggingConnection = null; // { fromNodeId, startX, startY, tempLineEl }

// DOM Elements
const viewport = document.getElementById('canvas-viewport');
const container = document.getElementById('canvas-container');
const grid = document.getElementById('canvas-grid');
const nodesContainer = document.getElementById('nodes-container');
const svgLayer = document.getElementById('connections-svg');
const zoomLabel = document.getElementById('zoom-percentage');

// Properties Panel DOM
const propPanel = document.getElementById('properties-panel');
const propNodeBadge = document.getElementById('prop-node-badge');
const propNodeTitle = document.getElementById('prop-node-title');
const propNodeId = document.getElementById('prop-node-id');
const propDesc = document.getElementById('prop-desc');
const propOwner = document.getElementById('prop-owner');
const propDept = document.getElementById('prop-dept');
const propStatus = document.getElementById('prop-status');
const propDuration = document.getElementById('prop-duration');
const propFrequency = document.getElementById('prop-frequency');
const propTriggerCond = document.getElementById('prop-trigger-cond');
const propOutputCond = document.getElementById('prop-output-cond');
const propTools = document.getElementById('prop-tools');
const propToolsTagsPreview = document.getElementById('prop-tools-tags-preview');
const propBottleneck = document.getElementById('prop-bottleneck');
const btnDeleteNode = document.getElementById('btn-delete-node');
const closePropertiesBtn = document.getElementById('close-properties-btn');

// Top Filter DOM
const filterAreaSelect = document.getElementById('filter-dept');

// Subprocess DOM
const subprocessInput = document.getElementById('subprocess-input');
const btnAddSubprocess = document.getElementById('btn-add-subprocess');
const subprocessList = document.getElementById('subprocess-list');

// Modals / AI Audit DOM
const auditModal = document.getElementById('audit-modal');
const closeAuditBtn = document.getElementById('close-audit-btn');
const btnAudit = document.getElementById('btn-audit');
const btnReAudit = document.getElementById('btn-re-audit');
const auditCountNodes = document.getElementById('audit-count-nodes');
const auditCountBottlenecks = document.getElementById('audit-count-bottlenecks');
const auditCountIntegrations = document.getElementById('audit-count-integrations');
const aiReportAnalysis = document.getElementById('ai-report-analysis');
const aiReportSop = document.getElementById('ai-report-sop');
const aiReportAutomations = document.getElementById('ai-report-automations');
const dbPromptContent = document.getElementById('db-prompt-content');
const btnCopyPrompt = document.getElementById('btn-copy-prompt');

// 2. PAN & ZOOM MANAGEMENT
function updateViewport() {
  container.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`;
  
  // Dotted grid behaves as physical background matching pan/zoom
  grid.style.backgroundPosition = `${panOffset.x}px ${panOffset.y}px`;
  grid.style.backgroundSize = `${40 * zoom}px ${40 * zoom}px`;
  
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

// Mouse Pan & Box-Select Handlers
viewport.addEventListener('pointerdown', (e) => {
  const onEmptyCanvas = e.target === viewport || e.target === grid || e.target === svgLayer;
  if (!onEmptyCanvas) return;

  e.preventDefault();
  deselectAll();

  // Shift + left-click → box-select
  if (e.shiftKey && e.button === 0) {
    isBoxSelecting = true;
    boxSelectStart = { x: e.clientX, y: e.clientY };
    const selRect = document.getElementById('selection-rect');
    selRect.style.left = e.clientX + 'px';
    selRect.style.top = e.clientY + 'px';
    selRect.style.width = '0';
    selRect.style.height = '0';
    selRect.style.display = 'block';
    return;
  }

  // Default (left-click or middle-click) → pan
  isPanning = true;
  viewport.style.cursor = 'grabbing';
  panStart = { x: e.clientX, y: e.clientY };
  panOffsetStart = { ...panOffset };
});

window.addEventListener('pointermove', (e) => {
  if (isBoxSelecting) {
    const selRect = document.getElementById('selection-rect');
    const x = Math.min(e.clientX, boxSelectStart.x);
    const y = Math.min(e.clientY, boxSelectStart.y);
    const w = Math.abs(e.clientX - boxSelectStart.x);
    const h = Math.abs(e.clientY - boxSelectStart.y);
    selRect.style.left = x + 'px';
    selRect.style.top = y + 'px';
    selRect.style.width = w + 'px';
    selRect.style.height = h + 'px';
    return;
  }
  if (isPanning) {
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;
    panOffset.x = panOffsetStart.x + dx;
    panOffset.y = panOffsetStart.y + dy;
    updateViewport();
  } else if (activeNodeId) {
    // Draging a node card
    const node = nodes.find(n => n.id === activeNodeId);
    if (node) {
      const dx = (e.clientX - pointerStartMouse.x) / zoom;
      const dy = (e.clientY - pointerStartMouse.y) / zoom;
      node.x = activeNodeStartPos.x + dx;
      node.y = activeNodeStartPos.y + dy;
      
      const el = document.getElementById(node.id);
      if (el) {
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
      }
      updateConnections();
    }
  } else if (activeNoteId) {
    // Dragging a sticky note
    const note = notes.find(n => n.id === activeNoteId);
    if (note) {
      const dx = (e.clientX - pointerStartMouse.x) / zoom;
      const dy = (e.clientY - pointerStartMouse.y) / zoom;
      note.x = activeNoteStartPos.x + dx;
      note.y = activeNoteStartPos.y + dy;

      const el = document.getElementById(note.id);
      if (el) {
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
      }
    }
  } else if (draggingConnection) {
    // Dragging connection line
    const rect = container.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / zoom;
    const mouseY = (e.clientY - rect.top) / zoom;
    
    updateTempConnectionLine(draggingConnection.startX, draggingConnection.startY, mouseX, mouseY);
    highlightValidInputPorts(true);
  }
});

window.addEventListener('pointerup', (e) => {
  if (isBoxSelecting) {
    isBoxSelecting = false;
    const selRect = document.getElementById('selection-rect');
    selRect.style.display = 'none';

    // Compute selection box in canvas-space
    const vRect = viewport.getBoundingClientRect();
    const x1 = Math.min(e.clientX, boxSelectStart.x);
    const y1 = Math.min(e.clientY, boxSelectStart.y);
    const x2 = Math.max(e.clientX, boxSelectStart.x);
    const y2 = Math.max(e.clientY, boxSelectStart.y);

    // Only trigger selection if box is larger than a click (>5px)
    if (x2 - x1 > 5 || y2 - y1 > 5) {
      const selX1 = (x1 - vRect.left - panOffset.x) / zoom;
      const selY1 = (y1 - vRect.top - panOffset.y) / zoom;
      const selX2 = (x2 - vRect.left - panOffset.x) / zoom;
      const selY2 = (y2 - vRect.top - panOffset.y) / zoom;

      selectedNodeIds = [];
      nodes.forEach(node => {
        const el = document.getElementById(node.id);
        const nW = el ? el.offsetWidth : 220;
        const nH = el ? el.offsetHeight : 120;
        if (node.x + nW > selX1 && node.x < selX2 && node.y + nH > selY1 && node.y < selY2) {
          selectedNodeIds.push(node.id);
          if (el) el.classList.add('selected');
        }
      });
    }
    return;
  }

  if (isPanning) {
    isPanning = false;
    viewport.style.cursor = 'default';
  }

  if (activeNodeId) {
    // Arrastar trava x,y — é assim que o auto-layout (G6) sabe o que não mover.
    const dragged = nodes.find(n => n.id === activeNodeId);
    if (dragged) AudasysFieldMeta.touchFields(dragged, ['x', 'y']);
    activeNodeId = null;
    saveToLocalStorage();
  }

  if (activeNoteId) {
    activeNoteId = null;
    saveToLocalStorage();
  }

  if (draggingConnection) {
    // Find target input port
    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    const inputPort = elementUnderCursor ? elementUnderCursor.closest('.input-port') : null;
    
    if (inputPort) {
      const toNodeId = inputPort.dataset.nodeId;
      const fromNodeId = draggingConnection.fromNodeId;
      
      if (fromNodeId !== toNodeId) {
        const fromCaseId = draggingConnection.fromCaseId;
        // SEM rótulo automático. O texto do case já está escrito dentro do card
        // da decisão, e a aresta herda a COR daquele case — repetir "Sim" /
        // "Não, falta item" na linha só espalhava texto solto pelo canvas.
        // Rótulo continua disponível: é só clicar na aresta e escrever.
        createConnection(fromNodeId, toNodeId, { ruleId: fromCaseId || '', label: '' });
      }
    }
    
    // Clear temp line
    if (draggingConnection.tempLineEl) {
      draggingConnection.tempLineEl.remove();
    }
    draggingConnection = null;
    highlightValidInputPorts(false);
  }
});

// Mouse Wheel Zoom
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = viewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Local coordinate before zoom adjustment
  const beforeZoomX = (mouseX - panOffset.x) / zoom;
  const beforeZoomY = (mouseY - panOffset.y) / zoom;
  
  const zoomFactor = 0.08;
  if (e.deltaY < 0) {
    zoom = Math.min(3.0, zoom + zoomFactor);
  } else {
    zoom = Math.max(0.18, zoom - zoomFactor);
  }
  
  panOffset.x = mouseX - beforeZoomX * zoom;
  panOffset.y = mouseY - beforeZoomY * zoom;
  updateViewport();
}, { passive: false });

// 3. NODE CREATION & RENDERING
function createNode(type, x, y, customData = {}) {
  const defaultNames = {
    trigger: 'Novo Gatilho',
    action: 'Nova Ação',
    integration: 'Nova Integração',
    condition: 'Nova Decisão',
    output: 'Novo Resultado',
    wait: 'Nova Espera'
  };
  
  const id = `node_${Date.now()}_${nextNodeId++}`;
  const node = {
    id,
    type,
    x: Math.round(x),
    y: Math.round(y),
    name: customData.name || defaultNames[type],
    description: customData.description || '',
    owner: customData.owner || '',
    triggerCond: customData.triggerCond || '',
    outputCond: customData.outputCond || '',
    tools: customData.tools || '',
    bottleneck: customData.bottleneck || '',
    bottleneckCategory: customData.bottleneckCategory || '',
    subprocesses: customData.subprocesses || [],
    subprocessMode: customData.subprocessMode || 'checklist',
    childCanvas: customData.childCanvas || { nodes: [], connections: [], nextNodeId: 1 },
    rules: customData.rules || [],
    switchField: customData.switchField || '',
    switchCases: customData.switchCases || [],
    outcomeType: customData.outcomeType || 'success',
    waitType: customData.waitType || 'tempo_fixo',
    waitDuration: customData.waitDuration || '',
    waitTrigger: customData.waitTrigger || '',
    scriptConditions: customData.scriptConditions || [],
    duration: customData.duration || '',
    frequency: customData.frequency || 'diario',
    area: customData.area || 'geral',
    status: customData.status || 'pendente'
  };

  nodes.push(node);
  renderNodeDOM(node);
  saveToLocalStorage();

  // Quick mode: focus inline title instead of opening panel
  if (!customData.name) {
    const el = document.getElementById(id);
    if (el) {
      const titleEl = el.querySelector('.node-title');
      if (titleEl) {
        titleEl.textContent = '';
        setTimeout(() => titleEl.focus(), 30);
      }
    }
  }

  return node;
}

// 3b. STICKY NOTES — quick annotations during meetings
function createNote(x, y, customData = {}) {
  const id = `note_${Date.now()}_${nextNoteId++}`;
  const note = {
    id,
    x: Math.round(x),
    y: Math.round(y),
    text: customData.text || '',
    color: customData.color || 'amber'
  };

  notes.push(note);
  renderNoteDOM(note);
  saveToLocalStorage();

  // Focus the textarea right away so the user can type immediately
  if (!customData.text) {
    const el = document.getElementById(id);
    if (el) {
      const textEl = el.querySelector('.sticky-note-text');
      if (textEl) setTimeout(() => textEl.focus(), 30);
    }
  }

  return note;
}

function renderNoteDOM(note) {
  const el = document.createElement('div');
  el.className = 'sticky-note';
  el.id = note.id;
  el.style.left = `${note.x}px`;
  el.style.top = `${note.y}px`;
  el.style.setProperty('--note-color', NOTE_COLORS[note.color] || NOTE_COLORS.amber);

  el.innerHTML = `
    <div class="sticky-note-toolbar">
      <div class="sticky-note-colors">
        ${Object.keys(NOTE_COLORS).map(key => `<div class="sticky-note-color-dot${note.color === key ? ' active' : ''}" data-color="${key}" style="background: ${NOTE_COLORS[key]}" title="Cor"></div>`).join('')}
      </div>
      <button class="sticky-note-delete" title="Excluir anotação"><i class="fa-solid fa-trash-can"></i></button>
    </div>
    <textarea class="sticky-note-text" placeholder="Anotação rápida...">${note.text}</textarea>
  `;

  // Drag handle (anywhere on the card except text/colors/delete)
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sticky-note-text') || e.target.closest('.sticky-note-color-dot') || e.target.closest('.sticky-note-delete')) return;
    e.stopPropagation();
    deselectAll();
    activeNoteId = note.id;
    activeNoteStartPos = { x: note.x, y: note.y };
    pointerStartMouse = { x: e.clientX, y: e.clientY };
  });

  // Text editing
  const textEl = el.querySelector('.sticky-note-text');
  textEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  textEl.addEventListener('blur', () => {
    note.text = textEl.value;
    saveToLocalStorage();
  });

  // Color selection
  el.querySelectorAll('.sticky-note-color-dot').forEach(dot => {
    dot.addEventListener('pointerdown', (e) => e.stopPropagation());
    dot.addEventListener('click', () => {
      note.color = dot.dataset.color;
      el.style.setProperty('--note-color', NOTE_COLORS[note.color] || NOTE_COLORS.amber);
      el.querySelectorAll('.sticky-note-color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === note.color));
      saveToLocalStorage();
    });
  });

  // Delete
  el.querySelector('.sticky-note-delete').addEventListener('pointerdown', (e) => e.stopPropagation());
  el.querySelector('.sticky-note-delete').addEventListener('click', () => deleteNote(note.id));

  nodesContainer.appendChild(el);
}

function deleteNote(noteId) {
  notes = notes.filter(n => n.id !== noteId);
  const el = document.getElementById(noteId);
  if (el) el.remove();
  saveToLocalStorage();
}

function translateFrequency(freq) {
  const dict = {
    diario: 'Diário',
    semanal: 'Semanal',
    mensal: 'Mensal',
    demanda: 'Sob Demanda'
  };
  return dict[freq] || 'Diário';
}

function renderNodeDOM(node) {
  const el = document.createElement('div');
  el.className = 'canvas-node';
  el.id = node.id;
  el.dataset.type = node.type;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  
  if (node.status) {
    el.classList.add(`status-${node.status}`);
  }
  
  // Set outcome type on output nodes
  if (node.type === 'output') {
    el.dataset.outcome = node.outcomeType || 'success';
  }

  // Icon and badge matching type
  const icons = {
    trigger: 'fa-play',
    action: 'fa-gears',
    integration: 'fa-circle-nodes',
    condition: 'fa-code-branch',
    output: node.outcomeType === 'failure' ? 'fa-triangle-exclamation' : 'fa-flag-checkered',
    wait: 'fa-hourglass-half'
  };

  const badges = {
    trigger: 'Gatilho',
    action: 'Ação',
    integration: 'Integração',
    condition: 'Decisão',
    output: node.outcomeType === 'failure' ? 'Falha' : 'Resultado',
    wait: 'Espera'
  };
  
  const statusLabels = {
    pendente: 'Pendente',
    mapeamento: 'Mapeando',
    concluido: 'Concluído'
  };
  
  if (node.type === 'condition') {
    // ── SWITCH / DECISION NODE — special layout ──
    el.classList.add('condition-switch');
    el.innerHTML = `
      <div class="node-port input-port" data-node-id="${node.id}" title="Entrada"></div>
      <button class="node-duplicate-btn" title="Duplicar node"><i class="fa-solid fa-copy"></i></button>
      <div class="node-header">
        <div class="node-type-icon"><i class="fa-solid fa-code-branch"></i></div>
        <div class="node-type-badge">Decisão</div>
        ${node.status && node.status !== 'pendente' ? `<div class="node-status-badge status-${node.status}">${statusLabels[node.status]}</div>` : ''}
      </div>
      <div class="node-title" contenteditable="true" data-placeholder="Nome da decisão...">${escapeHtml(node.name)}</div>
      <div class="switch-field-display" id="sfd-${node.id}">${node.switchField ? `<i class="fa-solid fa-shuffle"></i> ${escapeHtml(node.switchField)}` : '<span class="sfd-placeholder">campo avaliado...</span>'}</div>
      <div class="switch-cases-container" id="scc-${node.id}"></div>
    `;
  } else {
    el.innerHTML = `
      <!-- Top Port (Input) if not trigger -->
      ${node.type !== 'trigger' ? `<div class="node-port input-port" data-node-id="${node.id}" title="Entrada"></div>` : ''}

      <button class="node-duplicate-btn" title="Duplicar node"><i class="fa-solid fa-copy"></i></button>

      <div class="node-header">
        <div class="node-type-icon"><i class="fa-solid ${icons[node.type] || 'fa-gears'}"></i></div>
        <div class="node-type-badge">${badges[node.type] || node.type}</div>
        ${node.status && node.status !== 'pendente' ? `<div class="node-status-badge status-${node.status}">${statusLabels[node.status]}</div>` : ''}
      </div>
      <div class="node-title" contenteditable="true" data-placeholder="Nome do processo...">${escapeHtml(node.name)}</div>
      <div class="node-desc">${node.description || 'Clique para detalhar...'}</div>

      <div class="node-owner-preview ${!node.owner ? 'unowned' : ''}">
        <i class="fa-solid fa-user"></i>
        <span class="owner-name">${node.owner ? node.owner : 'Sem responsável'}</span>
      </div>

      <div class="node-meta-preview">
        <span class="meta-duration"><i class="fa-regular fa-clock"></i> ${node.duration || '--'}</span>
        <span class="meta-frequency"><i class="fa-solid fa-rotate"></i> ${translateFrequency(node.frequency)}</span>
      </div>

      ${node.bottleneck ? `
        <div class="node-failure-preview">
          <i class="fa-solid fa-triangle-exclamation"></i> <strong>Falha:</strong> ${node.bottleneck}
        </div>
      ` : ''}

      <div class="node-tools-preview" id="preview-tags-${node.id}"></div>

      <div class="node-status-indicator" id="status-${node.id}" style="display: none;">
        <i class="fa-solid fa-list-check"></i> <span class="sub-count">0</span>
      </div>

      <!-- Right Port (Output) if not output -->
      ${node.type !== 'output' ? `<div class="node-port output-port" data-node-id="${node.id}" title="Conectar saída"></div>` : ''}
    `;
  }

  // Inline title editing
  const titleEl = el.querySelector('.node-title');
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    if (e.key === 'Escape') { titleEl.textContent = node.name; titleEl.blur(); }
  });
  titleEl.addEventListener('blur', () => {
    const newName = titleEl.textContent.trim() || 'Sem nome';
    node.name = newName;
    titleEl.textContent = newName;
    if (selectedNodeId === node.id) propNodeTitle.textContent = newName;
    updateConnections();
    saveToLocalStorage();
  });
  titleEl.addEventListener('pointerdown', (e) => e.stopPropagation());

  // Duplicate button
  el.querySelector('.node-duplicate-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    duplicateNode(node.id);
  });

  // Attach events
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('node-port')) return;
    if (e.target.closest('.case-output-port')) return;
    if (e.target.closest('.node-title') || e.target.closest('.node-duplicate-btn')) return;

    e.stopPropagation();
    selectNode(node.id);

    activeNodeId = node.id;
    activeNodeStartPos = { x: node.x, y: node.y };
    pointerStartMouse = { x: e.clientX, y: e.clientY };
  });

  // Standard output port drag
  const outPort = el.querySelector('.output-port');
  if (outPort) {
    outPort.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const rect = outPort.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const startX = (rect.left + rect.width / 2 - containerRect.left) / zoom;
      const startY = (rect.top + rect.height / 2 - containerRect.top) / zoom;
      const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.setAttribute('class', 'temp-connection-line');
      svgLayer.appendChild(tempLine);
      draggingConnection = { fromNodeId: node.id, fromCaseId: null, startX, startY, tempLineEl: tempLine };
    });
  }

  nodesContainer.appendChild(el);

  // For condition nodes: build switch case ports
  if (node.type === 'condition') {
    buildSwitchCasePorts(node, el);
  }

  updateNodePreviewDetails(node);
}

// Helper: creates/refreshes the switch case rows and their output ports
function buildSwitchCasePorts(node, el) {
  const container_ = el.querySelector(`#scc-${node.id}`);
  if (!container_) return;
  container_.innerHTML = '';

  const makeCasePort = (caseId, color, label, isDashed) => {
    const row = document.createElement('div');
    row.className = `switch-case-row${isDashed ? ' switch-else-row' : ''}`;

    const dot = document.createElement('span');
    dot.className = 'case-color-dot';
    dot.style.background = isDashed ? 'transparent' : color;
    dot.style.borderColor = isDashed ? 'rgba(148,163,184,0.5)' : color;
    dot.style.borderStyle = isDashed ? 'dashed' : 'solid';

    const lbl = document.createElement('span');
    lbl.className = 'case-label-text';
    lbl.textContent = label;

    const port = document.createElement('div');
    port.className = 'case-output-port';
    port.dataset.nodeId = node.id;
    port.dataset.caseId = caseId;
    port.style.borderColor = isDashed ? 'rgba(148,163,184,0.5)' : color;
    port.style.borderStyle = isDashed ? 'dashed' : 'solid';
    port.title = isDashed ? 'Senão (default)' : `Conectar: ${label}`;

    port.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const rect = port.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const startX = (rect.left + rect.width / 2 - cRect.left) / zoom;
      const startY = (rect.top + rect.height / 2 - cRect.top) / zoom;
      const tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tempLine.setAttribute('class', 'temp-connection-line');
      svgLayer.appendChild(tempLine);
      draggingConnection = { fromNodeId: node.id, fromCaseId: caseId, startX, startY, tempLineEl: tempLine };
    });

    row.appendChild(dot);
    row.appendChild(lbl);
    row.appendChild(port);
    return row;
  };

  const cases = node.switchCases || [];
  cases.forEach(sc => {
    container_.appendChild(makeCasePort(sc.id, sc.color, sc.value || '...', false));
  });
  // Always add ELSE row
  container_.appendChild(makeCasePort('else', 'rgba(148,163,184,0.4)', 'senão', true));
}

function updateNodePreviewDetails(node) {
  const el = document.getElementById(node.id);
  if (!el) return;

  // For condition/switch nodes: refresh case ports and field display
  if (node.type === 'condition') {
    const titleEl = el.querySelector('.node-title');
    if (titleEl && document.activeElement !== titleEl) titleEl.textContent = node.name;
    const sfd = el.querySelector(`#sfd-${node.id}`);
    if (sfd) sfd.innerHTML = node.switchField
      ? `<i class="fa-solid fa-shuffle"></i> ${escapeHtml(node.switchField)}`
      : '<span class="sfd-placeholder">campo avaliado...</span>';
    buildSwitchCasePorts(node, el);
    return;
  }

  // Title: only update if not currently being edited inline
  const titleEl = el.querySelector('.node-title');
  if (titleEl && document.activeElement !== titleEl) {
    titleEl.textContent = node.name;
  }
  el.querySelector('.node-desc').textContent = node.description || 'Clique para detalhar...';

  // Status styling on card root
  el.classList.remove('status-pendente', 'status-mapeamento', 'status-concluido');
  el.classList.add(`status-${node.status || 'pendente'}`);

  const statusLabels = {
    pendente: 'Pendente',
    mapeamento: 'Mapeando',
    concluido: 'Concluído'
  };

  // Status badge: only render when not pending
  let statusBadge = el.querySelector('.node-status-badge');
  if (node.status && node.status !== 'pendente') {
    if (!statusBadge) {
      statusBadge = document.createElement('div');
      el.querySelector('.node-header').appendChild(statusBadge);
    }
    statusBadge.className = `node-status-badge status-${node.status}`;
    statusBadge.textContent = statusLabels[node.status];
  } else if (statusBadge) {
    statusBadge.remove();
  }

  // Owner preview update
  const ownerPreview = el.querySelector('.node-owner-preview');
  if (ownerPreview) {
    if (node.owner) {
      ownerPreview.classList.remove('unowned');
      ownerPreview.querySelector('.owner-name').textContent = node.owner;
    } else {
      ownerPreview.classList.add('unowned');
      ownerPreview.querySelector('.owner-name').textContent = 'Sem responsável';
    }
  }

  // Meta Preview update
  const durationSpan = el.querySelector('.meta-duration');
  if (durationSpan) {
    durationSpan.innerHTML = `<i class="fa-regular fa-clock"></i> ${node.duration || '--'}`;
  }
  const freqSpan = el.querySelector('.meta-frequency');
  if (freqSpan) {
    freqSpan.innerHTML = `<i class="fa-solid fa-rotate"></i> ${translateFrequency(node.frequency)}`;
  }

  // Tags Preview
  const tagsContainer = el.querySelector('.node-tools-preview');
  tagsContainer.innerHTML = '';
  if (node.tools) {
    node.tools.split(',').forEach(tool => {
      const cleanTool = tool.trim();
      if (cleanTool) {
        const tag = document.createElement('span');
        tag.className = 'node-tool-tag';
        tag.textContent = cleanTool;
        tagsContainer.appendChild(tag);
      }
    });
  }

  // Failure Block Preview (with Lean category tag)
  let failurePreview = el.querySelector('.node-failure-preview');
  const hasFailure = node.bottleneck || node.bottleneckCategory;
  if (hasFailure) {
    if (!failurePreview) {
      failurePreview = document.createElement('div');
      failurePreview.className = 'node-failure-preview';
      el.insertBefore(failurePreview, tagsContainer);
    }
    const catColor = LEAN_CATEGORY_COLORS[node.bottleneckCategory] || '';
    const catLabel = LEAN_CATEGORY_LABELS[node.bottleneckCategory] || '';
    const catTag = catLabel ? `<span class="lean-cat-tag" style="background:${catColor}22;color:${catColor};border-color:${catColor}44">${catLabel}</span>` : '';
    const bodyText = node.bottleneck || '';
    failurePreview.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>${catTag}${bodyText ? ` <span class="failure-text">${bodyText}</span>` : ''}`;
  } else if (failurePreview) {
    failurePreview.remove();
  }

  // Subprocess Indicator
  const statusIndicator = el.querySelector('.node-status-indicator');
  const subs = normalizeSubprocesses(node.subprocesses);
  const hasScript = node.scriptConditions && node.scriptConditions.length > 0;
  if (node.subprocessMode === 'canvas' && node.childCanvas && node.childCanvas.nodes.length > 0) {
    statusIndicator.style.display = 'flex';
    statusIndicator.innerHTML = `<i class="fa-solid fa-diagram-project"></i> <span class="sub-count">${node.childCanvas.nodes.length} nodes</span>`;
  } else if (node.subprocessMode !== 'canvas' && subs.length > 0) {
    const done = subs.filter(s => s.done).length;
    statusIndicator.style.display = 'flex';
    statusIndicator.innerHTML = `<i class="fa-solid fa-list-check"></i> <span class="sub-count">${done}/${subs.length}</span>${hasScript ? ' <i class="fa-solid fa-code" title="Script condicional"></i>' : ''}`;
  } else if (hasScript) {
    statusIndicator.style.display = 'flex';
    statusIndicator.innerHTML = `<i class="fa-solid fa-code"></i> <span class="sub-count">${node.scriptConditions.length} SE</span>`;
  } else {
    statusIndicator.style.display = 'none';
  }

  // Outcome type on output nodes
  if (node.type === 'output') {
    el.dataset.outcome = node.outcomeType || 'success';
    // Update icon and badge
    const icon = el.querySelector('.node-type-icon i');
    const badge = el.querySelector('.node-type-badge');
    if (icon) icon.className = `fa-solid ${node.outcomeType === 'failure' ? 'fa-triangle-exclamation' : 'fa-flag-checkered'}`;
    if (badge) badge.textContent = node.outcomeType === 'failure' ? 'Falha' : 'Resultado';
  }

}

// 4. CONNECTIONS MANAGEMENT
function createConnection(fromId, toId, customData = {}) {
  // Prevent exact duplicates (same source + same target + same ruleId)
  // Allows N:1 (multiple cases → same target) and 1:N (same case → multiple targets)
  const exists = connections.some(c =>
    c.from === fromId &&
    c.to === toId &&
    (c.ruleId || '') === (customData.ruleId || '')
  );
  if (exists) return;

  const conn = {
    id: Audasys.genId('conn'),
    from: fromId,
    to: toId,
    label: customData.label || '',
    ruleId: customData.ruleId || '',
    midX: 0,
    midY: 0
  };

  connections.push(conn);
  renderConnectionDOM(conn);
  // Re-apply style after render so color lookup finds the node
  setTimeout(() => updateConnectionStyle(conn), 0);
  saveToLocalStorage();
}

function renderConnectionDOM(conn) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('id', conn.id);
  path.setAttribute('class', 'connection-line');
  path.setAttribute('marker-end', 'url(#arrow-cc)');

  path.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    selectConnection(conn.id);
  });

  // Rótulo = <g> com <rect> de fundo + <text>. Antes era um <text> solto com um
  // halo de 5px na cor `--bg-secondary`, variável que não existe no projeto: o
  // fallback não batia com o fundo do canvas e o texto ficava ilegível sobre a
  // grade e sobre outras arestas.
  const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  labelGroup.setAttribute('id', conn.id + '-label');
  labelGroup.setAttribute('class', 'connection-label');

  const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  labelBg.setAttribute('class', 'connection-label-bg');
  labelBg.setAttribute('rx', '4');

  const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  labelText.setAttribute('class', 'connection-label-text');
  labelText.setAttribute('text-anchor', 'middle');
  labelText.setAttribute('dominant-baseline', 'middle');
  labelText.textContent = conn.label || '';

  labelGroup.appendChild(labelBg);
  labelGroup.appendChild(labelText);
  labelGroup.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    selectConnection(conn.id);
  });

  /**
   * Marca de gargalo da passagem: uma barra vermelha inclinada cruzando a linha.
   *
   * Lê como se INTERROMPESSE o fluxo — mas não interrompe nada. É sinalizador:
   * a aresta continua ligando os dois nós, o traçado segue igual, e nenhuma
   * lógica muda. A leitura de "aqui trava" é justamente o que se quer numa
   * reunião, sem precisar de legenda.
   */
  const marcaGargalo = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  marcaGargalo.setAttribute('id', conn.id + '-gargalo');
  marcaGargalo.setAttribute('class', 'edge-gargalo');
  marcaGargalo.style.display = 'none';
  marcaGargalo.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    selectConnection(conn.id);
  });

  svgLayer.appendChild(path);
  svgLayer.appendChild(marcaGargalo);
  svgLayer.appendChild(labelGroup);
  updateConnectionLine(conn);
  updateConnectionStyle(conn);
}

/**
 * Faixas na aresta.
 *
 * QUATRO coisas querem o ponto médio: o rótulo, a barra de gargalo, a bolinha de
 * medição e o asterisco de receita. Empilhadas no mesmo pixel, nenhuma se lê —
 * e três das cinco medições reais deste projeto estão em arestas, então não é
 * caso hipotético.
 *
 * Um único lugar decide o deslocamento de cada uma. Três arquivos decidindo
 * separadamente foi exatamente como elas acabaram todas no meio.
 */
const FAIXA_NA_ARESTA = { gargalo: -42, rotulo: 0, medicao: 42, oportunidade: 82 };

function pontoNaAresta(conn, faixa) {
  if (!conn || conn.midX == null) return null;
  return { x: conn.midX + (FAIXA_NA_ARESTA[faixa] ?? 0), y: conn.midY };
}
window.pontoNaAresta = pontoNaAresta;

/** Posiciona a barra de gargalo na faixa dela, inclinada sobre a linha. */
function posicionarGargalo(conn) {
  const marca = document.getElementById(conn.id + '-gargalo');
  if (!marca) return;
  if (!conn.gargalo?.texto) { marca.style.display = 'none'; return; }

  const R = 11;   // metade do comprimento da barra
  const p = pontoNaAresta(conn, 'gargalo');
  marca.style.display = '';
  marca.setAttribute('x1', p.x - R * 0.5);
  marca.setAttribute('y1', p.y + R);
  marca.setAttribute('x2', p.x + R * 0.5);
  marca.setAttribute('y2', p.y - R);
  const cats = conn.gargalo.categorias?.join(', ') || 'sem categoria';
  marca.setAttribute('title', `${conn.gargalo.texto} (${cats})`);
}

function updateConnectionLine(conn) {
  const path = document.getElementById(conn.id);
  if (!path) return;

  const fromEl = document.getElementById(conn.from);
  const toEl = document.getElementById(conn.to);
  const fromNode = nodes.find(n => n.id === conn.from);
  const toNode = nodes.find(n => n.id === conn.to);

  if (fromEl && toEl && fromNode && toNode) {
    let sX = fromNode.x + fromEl.offsetWidth;
    let sY = fromNode.y + fromEl.offsetHeight / 2;

    // For condition/switch nodes: use the actual rendered position of the case port
    if (fromNode.type === 'condition' && conn.ruleId) {
      const casePort = fromEl.querySelector(`.case-output-port[data-case-id="${conn.ruleId}"]`);
      if (casePort) {
        const portRect = casePort.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        sX = (portRect.left + portRect.width / 2 - cRect.left) / zoom;
        sY = (portRect.top + portRect.height / 2 - cRect.top) / zoom;
      }
    }

    const tX = toNode.x;
    const tY = toNode.y + toEl.offsetHeight / 2;

    // ── Traçado ───────────────────────────────────────────────────────────
    // O destino pode estar ATRÁS da origem (aresta de retorno: "Avisar cliente"
    // volta para "Conferir e preparar"). A fórmula antiga usava
    // dx = |tX - sX| * 0.5 SEMPRE POSITIVO, então os pontos de controle
    // empurravam a curva para fora nos dois sentidos e produziam um "S" que
    // atravessava o mapa inteiro. Aqui o retorno ganha rota própria: sai pela
    // direita, contorna por cima ou por baixo, e entra pela esquerda.
    const RECUO = 40;          // quanto a linha avança antes de virar
    const FOLGA = 34;          // distância do corredor de retorno até o card
    const ehRetorno = tX < sX + RECUO;
    let d;

    if (!ehRetorno) {
      // Caminho normal, da esquerda para a direita: bezier suave, com o braço
      // limitado para não estufar quando os nós estão muito distantes.
      const dx = Math.min(Math.abs(tX - sX) * 0.5, 160);
      const cp1X = sX + dx, cp2X = tX - dx;
      d = `M ${sX} ${sY} C ${cp1X} ${sY}, ${cp2X} ${tY}, ${tX} ${tY}`;
      conn.midX = 0.125 * sX + 0.375 * cp1X + 0.375 * cp2X + 0.125 * tX;
      conn.midY = 0.125 * sY + 0.375 * sY + 0.375 * tY + 0.125 * tY;
    } else {
      // Retorno: corredor horizontal acima (ou abaixo) dos dois cards, com
      // cantos arredondados. Percorre por fora em vez de cortar por dentro.
      const topoOrigem = fromNode.y;
      const topoDestino = toNode.y;
      const baseOrigem = fromNode.y + fromEl.offsetHeight;
      const baseDestino = toNode.y + toEl.offsetHeight;
      // Contorna pelo lado mais curto.
      const porCima = Math.min(topoOrigem, topoDestino) - FOLGA;
      const porBaixo = Math.max(baseOrigem, baseDestino) + FOLGA;
      const corredorY = (sY - porCima) <= (porBaixo - sY) ? porCima : porBaixo;

      const saiX = sX + RECUO;
      const entraX = tX - RECUO;
      const r = 12;
      const sinal = corredorY < sY ? -1 : 1;

      d = [
        `M ${sX} ${sY}`,
        `L ${saiX - r} ${sY}`,
        `Q ${saiX} ${sY} ${saiX} ${sY + sinal * r}`,
        `L ${saiX} ${corredorY - sinal * r}`,
        `Q ${saiX} ${corredorY} ${saiX - r} ${corredorY}`,
        `L ${entraX + r} ${corredorY}`,
        `Q ${entraX} ${corredorY} ${entraX} ${corredorY + (tY > corredorY ? r : -r)}`,
        `L ${entraX} ${tY - (tY > corredorY ? r : -r)}`,
        `Q ${entraX} ${tY} ${entraX + r} ${tY}`,
        `L ${tX} ${tY}`,
      ].join(' ');

      // O rótulo vai no corredor, onde a linha é reta e visível — não no ponto
      // médio geométrico, que numa rota em degraus cai num canto qualquer.
      conn.midX = (saiX + entraX) / 2;
      conn.midY = corredorY;
    }

    path.setAttribute('d', d);
    posicionarRotulo(conn);
    posicionarGargalo(conn);
  }
}

/** Rótulo centrado no ponto calculado, com o fundo dimensionado pelo texto. */
function posicionarRotulo(conn) {
  const grupo = document.getElementById(conn.id + '-label');
  if (!grupo) return;
  const texto = grupo.querySelector('.connection-label-text');
  const fundo = grupo.querySelector('.connection-label-bg');
  if (!texto || !fundo) return;

  texto.textContent = conn.label || '';
  if (!conn.label) { grupo.style.display = 'none'; return; }
  grupo.style.display = '';

  const x = conn.midX;
  const y = conn.midY - 10;
  texto.setAttribute('x', x);
  texto.setAttribute('y', y);

  // getBBox só responde com o elemento no layout; sem isso o fundo fica 0x0.
  const cx = texto.getBBox();
  const padX = 6, padY = 3;
  fundo.setAttribute('x', cx.x - padX);
  fundo.setAttribute('y', cx.y - padY);
  fundo.setAttribute('width', cx.width + padX * 2);
  fundo.setAttribute('height', cx.height + padY * 2);
}

function updateConnections() {
  connections.forEach(conn => {
    updateConnectionLine(conn);
    updateConnectionStyle(conn);
  });
  // O breakpoint de aresta mora no ponto médio da curva, que só existe depois
  // do traçado — por isso reposiciona aqui, e não no arrasto do nó.
  window.AudasysBreakpoints?.reposicionar?.();
  window.AudasysOportunidades?.renderTodos?.();
}

function updateTempConnectionLine(x1, y1, x2, y2) {
  if (draggingConnection && draggingConnection.tempLineEl) {
    const dx = Math.abs(x2 - x1) * 0.5;
    draggingConnection.tempLineEl.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
  }
}

function highlightValidInputPorts(active) {
  const ports = document.querySelectorAll('.input-port');
  ports.forEach(port => {
    if (active) {
      const portNodeId = port.dataset.nodeId;
      if (portNodeId !== draggingConnection.fromNodeId) {
        port.classList.add('valid-target');
      }
    } else {
      port.classList.remove('valid-target');
    }
  });
}

// 5. SELECTION & PROPERTIES PANEL BINDING
function selectNode(nodeId) {
  deselectAll();
  selectedNodeId = nodeId;
  
  const el = document.getElementById(nodeId);
  if (el) el.classList.add('selected');
  
  // Fill Sidebar Panel
  const node = nodes.find(n => n.id === nodeId);
  if (node) {
    const badgeColors = {
      trigger: 'rgba(16, 185, 129, 0.15)',
      action: 'rgba(59, 130, 246, 0.15)',
      wait: 'rgba(148, 163, 184, 0.15)',
      condition: 'rgba(245, 158, 11, 0.15)',
      output: 'rgba(244, 63, 94, 0.15)'
    };

    const textColors = {
      trigger: 'var(--accent-emerald)',
      action: 'var(--accent-glow)',
      wait: '#94a3b8',
      condition: 'var(--accent-amber)',
      output: 'var(--accent-rose)'
    };
    
    const labels = {
      trigger: 'Gatilho',
      action: 'Ação',
      integration: 'Integração',
      condition: 'Decisão',
      output: node.outcomeType === 'failure' ? 'Falha' : 'Resultado',
      wait: 'Espera'
    };

    propNodeBadge.textContent = labels[node.type] || node.type;
    propNodeBadge.style.background = badgeColors[node.type];
    propNodeBadge.style.color = textColors[node.type];
    propNodeBadge.style.borderColor = textColors[node.type];
    
    propNodeTitle.textContent = node.name;
    propNodeId.textContent = `ID: ${node.id}`;
    propDesc.value = node.description || '';
    propOwner.value = node.owner || '';
    propDept.value = node.area || 'geral';
    propStatus.value = node.status || 'pendente';
    propDuration.value = node.duration || '';
    propFrequency.value = node.frequency || 'diario';
    propTriggerCond.value = node.triggerCond || '';
    propOutputCond.value = node.outputCond || '';
    propTools.value = node.tools || '';
    propBottleneck.value = node.bottleneck || '';
    // Preenchimento = evidência: pinta os campos e oferece o gesto de conferir.
    window.AudasysEvidencia?.marcarPainel?.(node);
    window.AudasysBreakpoints?.marcarPainel?.(node);
    const propBotCat = document.getElementById('prop-bottleneck-category');
    if (propBotCat) propBotCat.value = node.bottleneckCategory || '';

    // Condition node: show rules section, hide generic fields
    const isCondition = node.type === 'condition';
    const isWait = node.type === 'wait';
    const isOutput = node.type === 'output';
    const condRulesSection = document.getElementById('condition-rules-section');
    const triggerSection = document.getElementById('panel-trigger-output-section');
    const waitSection = document.getElementById('wait-section');
    const outcomeSection = document.getElementById('outcome-section');
    const scriptSection = document.getElementById('action-script-section');

    if (condRulesSection) condRulesSection.style.display = isCondition ? '' : 'none';
    if (triggerSection) triggerSection.style.display = isCondition ? 'none' : '';
    if (waitSection) waitSection.style.display = isWait ? '' : 'none';
    if (outcomeSection) outcomeSection.style.display = isOutput ? '' : 'none';
    if (scriptSection) scriptSection.style.display = (node.type === 'action' || isWait) ? '' : 'none';

    if (isCondition) {
      const sfInput = document.getElementById('prop-switch-field');
      if (sfInput) sfInput.value = node.switchField || '';
      renderSwitchCases(node);
    }
    if (isOutput) {
      const btn = document.getElementById(`outcome-btn-${node.outcomeType || 'success'}`);
      if (btn) { document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    }
    if (isWait) {
      const wtSel = document.getElementById('prop-wait-type');
      const wdIn = document.getElementById('prop-wait-duration');
      const wtrig = document.getElementById('prop-wait-trigger');
      if (wtSel) wtSel.value = node.waitType || 'tempo_fixo';
      if (wdIn) wdIn.value = node.waitDuration || '';
      if (wtrig) wtrig.value = node.waitTrigger || '';
    }
    if (scriptSection) renderScriptConditions(node);

    renderTagsPreview(node.tools);
    renderSubprocessList(node);

    // Subprocess mode UI
    const isCanvas = node.subprocessMode === 'canvas';
    document.getElementById('subprocess-checklist-section').style.display = isCanvas ? 'none' : '';
    document.getElementById('subprocess-canvas-section').style.display = isCanvas ? '' : 'none';
    document.getElementById('btn-mode-checklist').classList.toggle('active', !isCanvas);
    document.getElementById('btn-mode-canvas').classList.toggle('active', isCanvas);
    const count = node.childCanvas?.nodes?.length || 0;
    const countEl = document.getElementById('child-canvas-count');
    if (isCanvas && count > 0) {
      countEl.style.display = '';
      countEl.textContent = `${count} nó${count !== 1 ? 's' : ''} no canvas filho`;
    } else {
      countEl.style.display = 'none';
    }

    propPanel.classList.add('open');
  }
}

function selectConnection(connId) {
  deselectAll();
  selectedConnectionId = connId;
  const path = document.getElementById(connId);
  if (path) {
    path.classList.add('selected');
    // Keep custom color for selected state, just intensify it
    path.style.opacity = '1';
    path.style.filter = 'brightness(1.3)';
  }
  const conn = connections.find(c => c.id === connId);
  if (!conn) return;

  const fromNode = nodes.find(n => n.id === conn.from);
  // `rules` é formato pré-switch e o servidor o APAGA na hidratação (schema.js).
  // Sem o encadeamento opcional, clicar numa aresta que sai de uma decisão
  // carregada do disco lançava TypeError e a seleção morria no meio — só não
  // aparecia em nó criado na sessão, que nasce com `rules: []`.
  if (fromNode && fromNode.type === 'condition' && fromNode.rules?.length > 0) {
    showEdgeRuleSelect(conn, fromNode);
    return;
  }
  // Antes, clicar na aresta abria o campo de rótulo direto. Agora abre um menu:
  // a aresta passou a comportar três ações (medir, marcar gargalo, rotular) e
  // nenhuma delas pode monopolizar o clique. Custa um clique a mais no rótulo —
  // é o preço de o elemento ter deixado de fazer uma coisa só.
  abrirMenuDaAresta(conn);
}

/** Mesma taxonomia Lean do nó — dois vocabulários paralelos confundiriam. */
const LEAN_CATS = [
  { id: 'handoff', label: 'Handoff' }, { id: 'espera', label: 'Espera' },
  { id: 'retrabalho', label: 'Retrabalho' }, { id: 'defeito', label: 'Defeito' },
  { id: 'politica', label: 'Política' }, { id: 'estoque', label: 'Acúmulo/Fila' },
  { id: 'superprocessamento', label: 'Superprocessamento' }, { id: 'movimento', label: 'Movimento' },
  { id: 'superprod', label: 'Superprodução' }, { id: 'talento', label: 'Talento' },
  { id: 'outro', label: 'Outro' },
];

/** Menu de contexto da aresta. Reusa os estilos de `.card-context-menu`. */
function abrirMenuDaAresta(conn) {
  fecharMenuDaAresta();

  const jaTemBp = breakpoints.some(b => b.alvo.tipo === 'edge' && b.alvo.id === conn.id);
  const temGargalo = !!conn.gargalo?.texto;

  const rect = viewport.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'edge-context-menu';
  menu.className = 'card-context-menu edge-context-menu';
  menu.style.left = `${rect.left + conn.midX * zoom + panOffset.x}px`;
  menu.style.top = `${rect.top + conn.midY * zoom + panOffset.y + 10}px`;
  menu.innerHTML = `
    <button data-acao="breakpoint"><i class="fa-solid fa-circle-dot"></i> ${
      jaTemBp ? 'Abrir medição' : 'Medir esta passagem'}</button>
    <button data-acao="gargalo"><i class="fa-solid fa-slash"></i> ${
      temGargalo ? 'Editar gargalo' : 'Mapear gargalo'}</button>
    ${temGargalo ? '<button data-acao="tirar-gargalo" class="danger"><i class="fa-solid fa-eraser"></i> Tirar o gargalo</button>' : ''}
    <button data-acao="oportunidade"><i class="fa-solid fa-asterisk"></i> Mapear oportunidade de receita</button>
    <div class="menu-divider"></div>
    <button data-acao="rotulo"><i class="fa-solid fa-pen"></i> Editar rótulo</button>`;

  menu.addEventListener('pointerdown', e => e.stopPropagation());
  menu.addEventListener('click', (e) => {
    const acao = e.target.closest('[data-acao]')?.dataset.acao;
    if (!acao) return;
    fecharMenuDaAresta();

    if (acao === 'rotulo') return showEdgeLabelInput(conn);
    if (acao === 'breakpoint') return window.AudasysBreakpoints?.naAresta?.(conn);
    if (acao === 'gargalo') return editarGargaloDaAresta(conn);
    if (acao === 'oportunidade') return window.AudasysOportunidades?.novaNaAresta?.(conn);
    if (acao === 'tirar-gargalo') {
      conn.gargalo = { texto: '', categorias: [] };
      posicionarGargalo(conn);
      saveToLocalStorage();
    }
  });

  document.body.appendChild(menu);
}

function fecharMenuDaAresta() {
  document.getElementById('edge-context-menu')?.remove();
  document.getElementById('edge-gargalo-form')?.remove();
}

/** Formulário curto do gargalo: o texto e as categorias Lean. */
function editarGargaloDaAresta(conn) {
  const de = nodes.find(n => n.id === conn.from)?.name ?? '';
  const para = nodes.find(n => n.id === conn.to)?.name ?? '';
  const atuais = new Set(conn.gargalo?.categorias || []);

  const rect = viewport.getBoundingClientRect();
  const box = document.createElement('div');
  box.id = 'edge-gargalo-form';
  box.className = 'bp-popover';
  box.style.left = `${rect.left + conn.midX * zoom + panOffset.x}px`;
  box.style.top = `${rect.top + conn.midY * zoom + panOffset.y + 10}px`;
  box.innerHTML = `
    <div class="bp-pop-head"><b>Gargalo na passagem</b>
      <button class="bp-pop-fechar" data-fechar-garg>✕</button></div>
    <div class="agd-sub" style="margin:-6px 0 10px">${escapeHtml(de)} → ${escapeHtml(para)}</div>
    <textarea id="garg-texto" rows="2" placeholder="O que trava nesta passagem?">${escapeHtml(conn.gargalo?.texto || '')}</textarea>
    <div class="garg-cats">${LEAN_CATS.map(c => `
      <label class="garg-cat"><input type="checkbox" value="${c.id}" ${atuais.has(c.id) ? 'checked' : ''}> ${c.label}</label>`).join('')}</div>
    <div class="garg-foot">
      <button class="arb-btn primary" data-salvar-garg>Salvar</button>
    </div>`;
  document.body.appendChild(box);
  box.addEventListener('pointerdown', e => e.stopPropagation());
  box.querySelector('#garg-texto').focus();

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar-garg]')) return box.remove();
    if (!e.target.closest('[data-salvar-garg]')) return;
    conn.gargalo = {
      texto: box.querySelector('#garg-texto').value.trim(),
      categorias: [...box.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value),
    };
    posicionarGargalo(conn);
    saveToLocalStorage();
    box.remove();
  });
}

/**
 * Troca o texto do rótulo de uma aresta.
 *
 * O rótulo virou `<g><rect/><text/></g>` quando ganhou fundo sólido. Escrever
 * `textContent` no `<g>` SUBSTITUI todos os filhos por um nó de texto puro —
 * apaga o retângulo e o `<text>` de uma vez, e o rótulo só volta ao normal no
 * próximo render completo. Havia quatro lugares fazendo isso.
 */
function setEdgeLabelText(conn, texto) {
  const grupo = document.getElementById(conn.id + '-label');
  const alvo = grupo?.querySelector('.connection-label-text');
  if (alvo) alvo.textContent = texto;
  conn.label = texto;
  posicionarRotulo(conn);
}

function deselectAll() {
  if (selectedNodeId) {
    const el = document.getElementById(selectedNodeId);
    if (el) el.classList.remove('selected');
    selectedNodeId = null;
  }
  // Clear multi-select
  selectedNodeIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('selected');
  });
  selectedNodeIds = [];

  if (selectedConnectionId) {
    const path = document.getElementById(selectedConnectionId);
    if (path) {
      path.classList.remove('selected');
      const conn = connections.find(c => c.id === selectedConnectionId);
      if (conn) updateConnectionStyle(conn);
    }
    selectedConnectionId = null;
    hideEdgeRuleSelect();
  }
  // `deselectAll` limpava só o seletor de regra. O campo de rótulo dependia de
  // um listener separado no viewport, e o botão flutuante do breakpoint não era
  // limpo por ninguém — ficava órfão na tela até o próximo render. Como este é
  // o ponto por onde passam os 11 caminhos de deseleção, limpar aqui cobre
  // todos de uma vez.
  hideEdgeLabelInput();
  fecharMenuDaAresta();
  window.AudasysBreakpoints?.esconderOfertaDaAresta?.();
  propPanel.classList.remove('open');
}

// Inputs Bindings to Live State
propNodeTitle.addEventListener('blur', () => {
  if (selectedNodeId) {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (node) {
      node.name = propNodeTitle.textContent.trim() || node.name;
      touchField(node, 'name');
      updateNodeDOMTitle(node.id, node.name);
      saveToLocalStorage();
    }
  }
});

propNodeTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    propNodeTitle.blur();
  }
});

function updateNodeDOMTitle(nodeId, newTitle) {
  const el = document.getElementById(nodeId);
  if (el) {
    el.querySelector('.node-title').textContent = newTitle;
    updateConnections(); // Recalculate in case offsetHeight shifts slightly
  }
}

// Bind other fields
[propDesc, propOwner, propTriggerCond, propOutputCond, propBottleneck, propDuration].forEach(field => {
  field.addEventListener('input', () => {
    if (selectedNodeId) {
      const node = nodes.find(n => n.id === selectedNodeId);
      if (node) {
        const propName = {
          'prop-desc': 'description',
          'prop-owner': 'owner',
          'prop-trigger-cond': 'triggerCond',
          'prop-output-cond': 'outputCond',
          'prop-bottleneck': 'bottleneck',
          'prop-duration': 'duration'
        }[field.id];
        
        node[propName] = field.value;
        touchField(node, propName);
        updateNodePreviewDetails(node);
        saveToLocalStorage();
      }
    }
  });
});

[propDept, propStatus, propFrequency].forEach(field => {
  field.addEventListener('change', () => {
    if (selectedNodeId) {
      const node = nodes.find(n => n.id === selectedNodeId);
      if (node) {
        const propName = {
          'prop-dept': 'area',
          'prop-status': 'status',
          'prop-frequency': 'frequency'
        }[field.id];
        
        node[propName] = field.value;
        touchField(node, propName);
        updateNodePreviewDetails(node);
        
        // Update department filtering
        applyAreaFilter();
        
        saveToLocalStorage();
      }
    }
  });
});

// Area / Department filtering logic
function applyAreaFilter() {
  const selectedArea = filterAreaSelect.value;
  
  if (selectedArea === 'all') {
    nodes.forEach(n => {
      const el = document.getElementById(n.id);
      if (el) el.classList.remove('dimmed');
    });
    connections.forEach(c => {
      const el = document.getElementById(c.id);
      if (el) el.classList.remove('dimmed');
    });
  } else {
    nodes.forEach(n => {
      const el = document.getElementById(n.id);
      if (el) {
        if (n.area === selectedArea) {
          el.classList.remove('dimmed');
        } else {
          el.classList.add('dimmed');
        }
      }
    });
    
    connections.forEach(c => {
      const el = document.getElementById(c.id);
      if (el) {
        const fromNode = nodes.find(n => n.id === c.from);
        const toNode = nodes.find(n => n.id === c.to);
        
        const isFromMatch = fromNode && fromNode.area === selectedArea;
        const isToMatch = toNode && toNode.area === selectedArea;
        
        if (isFromMatch && isToMatch) {
          el.classList.remove('dimmed');
        } else {
          el.classList.add('dimmed');
        }
      }
    });
  }
}

filterAreaSelect.addEventListener('change', applyAreaFilter);

// Tools tag management
propTools.addEventListener('input', () => {
  if (selectedNodeId) {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (node) {
      node.tools = propTools.value;
      touchField(node, 'tools');
      renderTagsPreview(node.tools);
      updateNodePreviewDetails(node);
      saveToLocalStorage();
    }
  }
});

function renderTagsPreview(toolsString) {
  propToolsTagsPreview.innerHTML = '';
  if (!toolsString) return;
  
  toolsString.split(',').forEach(tool => {
    const cleanTool = tool.trim();
    if (cleanTool) {
      const tag = document.createElement('span');
      tag.className = 'tag-item';
      tag.innerHTML = `<i class="fa-solid fa-tag"></i> ${escapeHtml(cleanTool)}`;
      propToolsTagsPreview.appendChild(tag);
    }
  });
}

// Subprocesses Operations
function normalizeSubprocesses(subs) {
  return (subs || []).map(s => typeof s === 'string' ? { text: s, done: false } : s);
}

document.getElementById('btn-add-subprocess').addEventListener('click', () => {
  const text = document.getElementById('subprocess-input').value.trim();
  if (text && selectedNodeId) {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (node) {
      node.subprocesses = normalizeSubprocesses(node.subprocesses);
      node.subprocesses.push({ text, done: false });
      document.getElementById('subprocess-input').value = '';
      renderSubprocessList(node);
      updateNodePreviewDetails(node);
      saveToLocalStorage();
    }
  }
});

document.getElementById('subprocess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-subprocess').click();
});

function renderSubprocessList(node) {
  const list = document.getElementById('subprocess-list');
  if (!list) return;
  list.innerHTML = '';
  const subs = normalizeSubprocesses(node.subprocesses);
  node.subprocesses = subs; // normalize in place

  subs.forEach((sub, idx) => {
    const li = document.createElement('li');
    li.className = `subprocess-item${sub.done ? ' done' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = sub.done;
    checkbox.addEventListener('change', () => {
      sub.done = checkbox.checked;
      li.classList.toggle('done', sub.done);
      updateNodePreviewDetails(node);
      saveToLocalStorage();
    });

    const span = document.createElement('span');
    span.contentEditable = 'true';
    span.textContent = sub.text;
    span.addEventListener('blur', () => {
      sub.text = span.textContent.trim() || sub.text;
      saveToLocalStorage();
    });
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'subprocess-delete';
    delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.addEventListener('click', () => {
      node.subprocesses.splice(idx, 1);
      renderSubprocessList(node);
      updateNodePreviewDetails(node);
      saveToLocalStorage();
    });

    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

// Subprocess mode toggle
document.getElementById('btn-mode-checklist').addEventListener('click', () => {
  if (!selectedNodeId) return;
  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  node.subprocessMode = 'checklist';
  document.getElementById('subprocess-checklist-section').style.display = '';
  document.getElementById('subprocess-canvas-section').style.display = 'none';
  document.getElementById('btn-mode-checklist').classList.add('active');
  document.getElementById('btn-mode-canvas').classList.remove('active');
  updateNodePreviewDetails(node);
  saveToLocalStorage();
});

document.getElementById('btn-mode-canvas').addEventListener('click', () => {
  if (!selectedNodeId) return;
  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  node.subprocessMode = 'canvas';
  document.getElementById('subprocess-checklist-section').style.display = 'none';
  document.getElementById('subprocess-canvas-section').style.display = '';
  document.getElementById('btn-mode-checklist').classList.remove('active');
  document.getElementById('btn-mode-canvas').classList.add('active');
  // Update child canvas count label
  const count = node.childCanvas?.nodes?.length || 0;
  const countEl = document.getElementById('child-canvas-count');
  if (count > 0) {
    countEl.style.display = '';
    countEl.textContent = `${count} nó${count !== 1 ? 's' : ''} no canvas filho`;
  } else {
    countEl.style.display = 'none';
  }
  updateNodePreviewDetails(node);
  saveToLocalStorage();
});

document.getElementById('btn-enter-child-canvas').addEventListener('click', () => {
  if (!selectedNodeId) return;
  const node = nodes.find(n => n.id === selectedNodeId);
  if (node) navigateToChildCanvas(node);
});

// Delete Node
btnDeleteNode.addEventListener('click', () => {
  if (selectedNodeId) {
    deleteNode(selectedNodeId);
  }
});

function deleteNode(nodeId) {
  // Remove associated connections and their labels from DOM & state
  const connsToRemove = connections.filter(c => c.from === nodeId || c.to === nodeId);
  connsToRemove.forEach(c => {
    const el = document.getElementById(c.id);
    if (el) el.remove();
    const labelEl = document.getElementById(c.id + '-label');
    if (labelEl) labelEl.remove();
  });
  connections = connections.filter(c => c.from !== nodeId && c.to !== nodeId);

  // Remove node card
  const nodeEl = document.getElementById(nodeId);
  if (nodeEl) nodeEl.remove();
  nodes = nodes.filter(n => n.id !== nodeId);

  deselectAll();
  saveToLocalStorage();
}

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  const editing = isEditingForm();

  // Delete / Backspace: remove selected node(s) or connection
  if ((e.key === 'Delete' || e.key === 'Backspace') && !editing) {
    if (selectedNodeIds.length > 0) {
      // Multi-select delete — copy array before iterating since deleteNode mutates it
      [...selectedNodeIds].forEach(id => deleteNode(id));
    } else if (selectedNodeId) {
      deleteNode(selectedNodeId);
    } else if (selectedConnectionId) {
      const path = document.getElementById(selectedConnectionId);
      if (path) path.remove();
      const labelEl = document.getElementById(selectedConnectionId + '-label');
      if (labelEl) labelEl.remove();
      document.getElementById(selectedConnectionId + '-gargalo')?.remove();
      connections = connections.filter(c => c.id !== selectedConnectionId);
      selectedConnectionId = null;
      saveToLocalStorage();
    }
  }

  // Tab: create connected action node to the right
  if (e.key === 'Tab' && selectedNodeId && !editing) {
    e.preventDefault();
    const parentNode = nodes.find(n => n.id === selectedNodeId);
    if (parentNode) {
      const newNode = createNode('action', parentNode.x + 340, parentNode.y, {});
      createConnection(parentNode.id, newNode.id);
    }
  }

  // Ctrl+D: duplicate selected node
  if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && selectedNodeId && !editing) {
    e.preventDefault();
    duplicateNode(selectedNodeId);
  }
});

function isEditingForm() {
  const activeEl = document.activeElement;
  return activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.hasAttribute('contenteditable'));
}

closePropertiesBtn.addEventListener('click', deselectAll);

// 6. DRAG AND DROP PALETTE
const paletteItems = document.querySelectorAll('.palette-item');
paletteItems.forEach(item => {
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('nodeType', item.dataset.nodeType);
  });
  
  // For mobile or quick click
  item.addEventListener('click', () => {
    // Spawn card in center of current screen
    const rect = viewport.getBoundingClientRect();
    const x = (rect.width / 2 - panOffset.x) / zoom - 110;
    const y = (rect.height / 2 - panOffset.y) / zoom - 50;
    createNode(item.dataset.nodeType, x, y);
  });
});

viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
});

viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('nodeType');
  if (type) {
    const rect = viewport.getBoundingClientRect();
    const x = (e.clientX - rect.left - panOffset.x) / zoom - 110;
    const y = (e.clientY - rect.top - panOffset.y) / zoom - 50;
    createNode(type, x, y);
  }
});

// 7. AI AUDITOR ENGINE (CALCULATED ANALYZER)
btnAudit.addEventListener('click', () => {
  if (auditModal.classList.contains('open')) {
    auditModal.classList.remove('open');
  } else {
    runAiAudit();
  }
});
btnReAudit.addEventListener('click', runAiAudit);
closeAuditBtn.addEventListener('click', () => auditModal.classList.remove('open'));

// Tab Selector logic inside Audit panel
const tabBtns = document.querySelectorAll('.audit-tab-btn');
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const tabId = btn.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
  });
});

function calculateHealthScore() {
  if (nodes.length === 0) return null;

  // Factor 1: Owner coverage (30 pts) — how many steps have a responsible person
  const ownedNodes = nodes.filter(n => n.owner && n.owner.trim() !== '').length;
  const ownerScore = Math.round((ownedNodes / nodes.length) * 30);

  // Factor 2: Bottleneck-free ratio (25 pts) — fewer bottlenecks = healthier
  const bottleneckedNodes = nodes.filter(n => n.bottleneck && n.bottleneck.trim() !== '').length;
  const bottleneckScore = Math.round(((nodes.length - bottleneckedNodes) / nodes.length) * 25);

  // Factor 3: Flow connectivity (25 pts) — connections per node (target: >=1 conn/node)
  const connRatio = Math.min(connections.length / nodes.length, 1);
  const connectivityScore = Math.round(connRatio * 25);

  // Factor 4: Flow balance (20 pts) — process has at least 1 trigger and 1 output
  const hasTrigger = nodes.some(n => n.type === 'trigger');
  const hasOutput = nodes.some(n => n.type === 'output');
  const balanceScore = (hasTrigger ? 10 : 0) + (hasOutput ? 10 : 0);

  const total = ownerScore + bottleneckScore + connectivityScore + balanceScore;

  let tier, color;
  if (total >= 71) { tier = 'Saudável'; color = 'var(--accent-emerald)'; }
  else if (total >= 41) { tier = 'Atenção'; color = 'var(--accent-amber)'; }
  else { tier = 'Crítico'; color = 'var(--accent-rose)'; }

  return {
    total,
    tier,
    color,
    factors: [
      { label: 'Cobertura de Responsáveis', score: ownerScore, max: 30 },
      { label: 'Fluxo sem Gargalos', score: bottleneckScore, max: 25 },
      { label: 'Conectividade do Fluxo', score: connectivityScore, max: 25 },
      { label: 'Equilíbrio Gatilho/Resultado', score: balanceScore, max: 20 }
    ]
  };
}

function renderHealthScore(hs) {
  const block = document.getElementById('health-score-block');
  if (!hs) { block.style.display = 'none'; return; }

  block.style.display = 'flex';
  block.style.setProperty('--hs-color', hs.color);

  document.getElementById('hs-score-num').textContent = hs.total;
  document.getElementById('hs-score-num').style.color = hs.color;
  const badge = document.getElementById('hs-badge');
  badge.textContent = hs.tier;
  badge.style.color = hs.color;

  // Animate ring: circumference = 2π×50 ≈ 314
  const offset = 314 - (314 * hs.total / 100);
  const ring = document.getElementById('hs-ring-fill');
  ring.style.stroke = hs.color;
  // Trigger CSS transition by setting after a tick
  requestAnimationFrame(() => { ring.style.strokeDashoffset = offset; });

  // Factor bars
  const factorsEl = document.getElementById('hs-factors');
  factorsEl.innerHTML = hs.factors.map(f => {
    const pct = Math.round((f.score / f.max) * 100);
    let barColor = 'var(--accent-emerald)';
    if (pct < 70) barColor = 'var(--accent-amber)';
    if (pct < 40) barColor = 'var(--accent-rose)';
    return `
      <div class="hs-factor">
        <div class="hs-factor-header">
          <span>${f.label}</span>
          <span class="hs-factor-pct">${f.score}/${f.max}</span>
        </div>
        <div class="hs-bar-track">
          <div class="hs-bar-fill" style="width:${pct}%; background:${barColor};"></div>
        </div>
      </div>`;
  }).join('');
}

function runAiAudit() {
  auditModal.classList.add('open');

  // Health Score
  const hs = calculateHealthScore();
  renderHealthScore(hs);

  // Calculate Stats
  auditCountNodes.textContent = nodes.length;
  
  const bottlenecksCount = nodes.filter(n => n.bottleneck.trim() !== '').length;
  auditCountBottlenecks.textContent = bottlenecksCount;
  
  // Get unique integrations mapping tools
  const toolList = [];
  nodes.forEach(n => {
    if (n.tools) {
      n.tools.split(',').forEach(t => {
        const clean = t.trim().toLowerCase();
        if (clean && !toolList.includes(clean)) toolList.push(clean);
      });
    }
  });
  auditCountIntegrations.textContent = toolList.length;
  
  // Generate reports
  if (nodes.length === 0) {
    const emptyMsg = `
      <div class="audit-alert info">
        <i class="fa-solid fa-circle-info"></i> <strong>Quadro Vazio!</strong> Adicione gatilhos e passos de ação para rodar a análise.
      </div>
    `;
    aiReportAnalysis.innerHTML = emptyMsg;
    aiReportSop.innerHTML = emptyMsg;
    aiReportAutomations.innerHTML = emptyMsg;
    dbPromptContent.textContent = "Nenhum dado mapeado ainda.";
    return;
  }
  
  // Generate analysis
  aiReportAnalysis.innerHTML = generateAnalysisReport(toolList, bottlenecksCount);
  aiReportSop.innerHTML = generateSopReport();
  aiReportAutomations.innerHTML = generateAutomationsReport(toolList);
  
  // Build Prompt Export Box
  const promptData = {
    title: "Audaces Canvas Process Dump",
    timestamp: new Date().toISOString(),
    health_score: hs ? { total: hs.total, classificacao: hs.tier, fatores: hs.factors.map(f => ({ fator: f.label, pontos: `${f.score}/${f.max}` })) } : null,
    nodes: nodes.map(n => ({
      id: n.id,
      tipo: n.type,
      nome: n.name,
      descricao: n.description,
      responsavel: n.owner,
      entrada: n.triggerCond,
      saida: n.outputCond,
      ferramentas: n.tools ? n.tools.split(',').map(t => t.trim()) : [],
      gargalos: n.bottleneck,
      subprocessos: n.subprocesses
    })),
    conexoes: connections.map(c => ({
      de: c.from,
      para: c.to
    }))
  };
  
  const formattedPrompt = `Haja como um consultor de operações de alta performance e especialista em arquitetura de processos de negócios (BPM). Abaixo, forneço a base de dados do nosso mapeamento de processos feito no Audaces Canvas em formato JSON.

Analise nossa topologia de fluxo e fichas de etapas e nos dê:
1. Um diagnóstico de problemas estruturais (ex: gargalos acumulados, falta de donos em etapas críticas, ou redundâncias).
2. Oportunidades de automação usando Make/n8n para as tarefas manuais mais lentas.
3. Ideias de onde implantar Inteligência Artificial (agentes e prompts de qualificação ou automação de escrita/análise).

DADOS DO PROCESSO:
${JSON.stringify(promptData, null, 2)}`;
  
  dbPromptContent.textContent = formattedPrompt;
}

btnCopyPrompt.addEventListener('click', () => {
  navigator.clipboard.writeText(dbPromptContent.textContent)
    .then(() => {
      const originalText = btnCopyPrompt.innerHTML;
      btnCopyPrompt.innerHTML = `<i class="fa-solid fa-check"></i> Copiado!`;
      btnCopyPrompt.style.background = 'rgba(16, 185, 129, 0.2)';
      btnCopyPrompt.style.color = '#34d399';
      
      setTimeout(() => {
        btnCopyPrompt.innerHTML = originalText;
        btnCopyPrompt.style.background = '';
        btnCopyPrompt.style.color = '';
      }, 2000);
    });
});

// Algoritmos de Relatórios
function generateAnalysisReport(toolList, bottlenecksCount) {
  let html = `<h3>Análise Topológica da Operação</h3>`;
  
  // Diagnóstico estrutural básico
  const triggers = nodes.filter(n => n.type === 'trigger');
  const outputs = nodes.filter(n => n.type === 'output');
  
  if (triggers.length === 0) {
    html += `
      <div class="audit-alert warning">
        <i class="fa-solid fa-triangle-exclamation"></i> <strong>Aviso de Entrada:</strong> Não foi detectado nenhum <strong>Gatilho</strong>. Todo fluxo precisa de um evento inicial claro (ex: Lead responde formulário, Compra efetuada) para determinar onde o processo começa.
      </div>
    `;
  }
  
  if (outputs.length === 0) {
    html += `
      <div class="audit-alert warning">
        <i class="fa-solid fa-triangle-exclamation"></i> <strong>Aviso de Saída:</strong> Não há nós de <strong>Saída/Fim</strong>. Sem determinar um objetivo final concreto, o processo pode ficar incompleto ou sem métrica de sucesso.
      </div>
    `;
  }
  
  // Owner check
  const unownedNodes = nodes.filter(n => !n.owner);
  if (unownedNodes.length > 0) {
    html += `
      <div class="audit-alert warning">
        <i class="fa-solid fa-user-xmark"></i> <strong>Falta de Responsabilização:</strong> Encontramos <strong>${unownedNodes.length}</strong> etapas sem responsável definido (ex: <em>${unownedNodes.slice(0, 3).map(n => n.name).join(', ')}</em>). Processos sem dono geram gargalos de execução silenciosos.
      </div>
    `;
  }
  
  // Verificação de conexões soltas
  const connectedNodeIds = new Set();
  connections.forEach(c => {
    connectedNodeIds.add(c.from);
    connectedNodeIds.add(c.to);
  });
  
  const isolatedNodes = nodes.filter(n => !connectedNodeIds.has(n.id));
  if (isolatedNodes.length > 0) {
    html += `
      <div class="audit-alert warning">
        <i class="fa-solid fa-triangle-exclamation"></i> <strong>Blocos Isolados:</strong> Encontramos ${isolatedNodes.length} bloco(s) sem conexões: <strong>${isolatedNodes.map(n => n.name).join(', ')}</strong>. Conecte-os ao fluxo principal para mapear a dependência real.
      </div>
    `;
  }
  
  // Gargalos list
  html += `<h3>Pontos Críticos e Gargalos Atuais</h3>`;
  const bottlenecks = nodes.filter(n => n.bottleneck.trim() !== '');
  if (bottlenecks.length > 0) {
    html += `<ul>`;
    bottlenecks.forEach(node => {
      html += `<li><strong>${node.name}</strong> (Responsável: <em>${node.owner || 'Não definido'}</em>):<br>
               <span style="color: #fbd38d;">&nbsp;&nbsp;↳ Gargalo:</span> ${node.bottleneck}</li>`;
    });
    html += `</ul>`;
  } else {
    html += `<p>Nenhum gargalo específico foi listado nos formulários dos blocos ainda. Preencha o campo "Onde isso costuma falhar? (Ponto de Quebra)" na barra lateral para gerar o diagnóstico.</p>`;
  }
  
  // Recomendações
  html += `<h3>Diagnóstico Executivo</h3>`;
  html += `<p>Com base em <strong>${nodes.length}</strong> etapas estruturadas e <strong>${toolList.length}</strong> ferramentas utilizadas, recomenda-se:</p>`;
  html += `<ol>`;
  if (toolList.length > 0) {
    html += `<li><strong>Padronização de Ecossistema:</strong> As ferramentas detectadas (<code>${toolList.join(', ')}</code>) devem ser unificadas. Garanta que dados de clientes não sejam reinseridos manualmente de um sistema para o outro.</li>`;
  }
  if (bottlenecksCount > 0) {
    html += `<li><strong>Otimização de Gargalos:</strong> Foque os esforços de automação e treinamento nas etapas de <em>${bottlenecks.map(n => n.name).join(', ')}</em>, pois são os principais pontos de fricção operacional declarados.</li>`;
  }
  if (unownedNodes.length > 0) {
    html += `<li><strong>Cultura de Dono:</strong> Há etapas importantes sem um Responsável claro. Defina cargos específicos para cada bloco para evitar falhas de comunicação e gargalos silenciosos.</li>`;
  }
  html += `</ol>`;
  
  return html;
}

function generateSopReport() {
  let html = `<h3>Procedimentos Operacionais Padrão (SOP / POP) Gerados</h3>`;
  html += `<p>Estrutura guia para treinamento da sua equipe interna baseada nos blocos de Ação e Gatilhos:</p>`;
  
  const sops = nodes.filter(n => n.type === 'action' || n.type === 'trigger');
  
  if (sops.length === 0) {
    html += `<p>Nenhum passo de Ação ou Gatilho disponível para modelar POPs.</p>`;
    return html;
  }
  
  sops.forEach(node => {
    html += `
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); padding: 16px; border-radius: 10px; margin-bottom: 16px;">
        <h4 style="color: var(--text-primary); border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; margin-bottom: 10px;">POP: ${node.name}</h4>
        <p><strong>Descrição:</strong> ${node.description || 'Não especificada.'}</p>
        <p><strong>Quem Executa:</strong> <code>${node.owner || 'Responsável Operacional'}</code></p>
        <p><strong>Gatilho de Entrada (Quando iniciar):</strong> ${node.triggerCond || 'A etapa anterior ser concluída.'}</p>
        <p><strong>Entregável (Como terminar):</strong> ${node.outputCond || 'Executar a tarefa descrita.'}</p>
    `;
    
    if (node.subprocesses && node.subprocesses.length > 0) {
      html += `<p><strong>Passo a Passo de Execução:</strong></p><ol>`;
      node.subprocesses.forEach(sub => {
        html += `<li>${sub}</li>`;
      });
      html += `</ol>`;
    }
    
    html += `</div>`;
  });
  
  return html;
}

function generateAutomationsReport(toolList) {
  let html = `<h3>Oportunidades de Automação & IA (Make/n8n)</h3>`;
  
  if (toolList.length === 0) {
    html += `<p>Nenhuma ferramenta integrada foi mapeada. Adicione tags de ferramentas (ex: "Kommo", "WhatsApp", "ActiveCampaign") nos blocos para vermos os caminhos de integração.</p>`;
    return html;
  }
  
  html += `<div class="audit-alert info"><i class="fa-solid fa-bolt"></i> <strong>Integração Sugerida:</strong> Abaixo estão as pontes lógicas recomendadas para conectar seu stack de ferramentas de forma autônoma.</div>`;
  
  // Analisa as tags de ferramentas
  const hasCRM = toolList.some(t => t.includes('crm') || t.includes('kommo') || t.includes('pipedrive'));
  const hasWA = toolList.some(t => t.includes('whatsapp') || t.includes('wa') || t.includes('evolution'));
  const _hasMake = toolList.some(t => t.includes('make') || t.includes('n8n') || t.includes('zapier'));
  const hasSheets = toolList.some(t => t.includes('sheets') || t.includes('excel') || t.includes('tabela'));
  
  if (hasCRM && hasWA) {
    html += `
      <div style="margin-bottom: 20px;">
        <h4 style="color: var(--accent-glow);">1. Notificações e Follow-ups de Leads no WhatsApp</h4>
        <p><strong>Gatilho:</strong> Alteração de status no CRM (ex: Lead avança para etapa X).</p>
        <p><strong>Ação:</strong> Enviar template/mensagem personalizada via WhatsApp Cloud API ou Evolution API.</p>
        <p><strong>Blueprint lógico:</strong><br>
        <code>CRM Webhook ➔ Make/n8n Router ➔ Validação de Dados ➔ Evolution API Send</code></p>
      </div>
    `;
  }
  
  if (hasSheets && hasCRM) {
    html += `
      <div style="margin-bottom: 20px;">
        <h4 style="color: var(--accent-glow);">2. Sincronização e Dashboard de Performance</h4>
        <p><strong>Gatilho:</strong> Venda fechada ou lead qualificado.</p>
        <p><strong>Ação:</strong> Registrar linha em planilha para controle de KPIs e faturamento.</p>
        <p><strong>Blueprint lógico:</strong><br>
        <code>CRM Event ➔ Make/n8n ➔ Google Sheets Add Row ➔ Notificação Slack/Teams</code></p>
      </div>
    `;
  }
  
  // Recomendações genéricas inteligentes
  html += `<h4 style="color: var(--text-primary); margin-top: 20px;">Onde implantar Agentes de IA neste fluxo?</h4>`;
  html += `<ul>`;
  
  const hasForm = nodes.some(n => n.name.toLowerCase().includes('formulário') || n.description.toLowerCase().includes('formulário'));
  if (hasForm) {
    html += `<li><strong>Qualificação com IA (Triagem):</strong> Crie um agente que pegue as respostas do seu formulário e faça uma qualificação/análise de Maturidade automática (como na Calculadora de IA).</li>`;
  }
  
  const hasEmail = nodes.some(n => n.name.toLowerCase().includes('email') || n.tools.toLowerCase().includes('email'));
  if (hasEmail) {
    html += `<li><strong>Rascunho de E-mails com IA:</strong> Um agente conectado ao Make monitorando novos e-mails recebidos, fazendo o rascunho da resposta ideal e salvando como rascunho no Gmail para você apenas revisar e enviar.</li>`;
  }
  
  html += `<li><strong>Auditor de Notas de Reunião:</strong> Se o processo envolve reuniões com clientes, conecte um gravador e rode transcrição automática pela IA para alimentar o CRM com as principais dores do cliente de forma estruturada.</li>`;
  html += `</ul>`;
  
  return html;
}

// 8. DATA SAVE, LOAD & ACTIONS

/**
 * Monta o estado serializável do canvas. Único ponto de serialização — é o que
 * torna seguro, mais adiante, ter nós propostos pelo agente vivendo no array
 * `nodes` com marcadores `_pending`: eles são filtrados aqui e nunca vazam
 * para o disco.
 */
function serializeCanvas() {
  const base = childContext
    ? {
        // Dentro de um canvas filho, `nodes`/`connections` são do FILHO; o pai
        // está guardado em childContext. Reempacotar é obrigatório, senão o
        // filho sobrescreve o pai.
        nodes: childContext.parentNodes,
        connections: childContext.parentConnections,
        notes,
        breakpoints,
        oportunidades,
        zoom: childContext.parentZoom,
        panOffset: childContext.parentPanOffset,
        nextNodeId: childContext.parentNextNodeId,
        nextNoteId
      }
    : { nodes, connections, notes, breakpoints, oportunidades, zoom, panOffset, nextNodeId, nextNoteId };

  if (childContext) childContext.node.childCanvas = { nodes, connections, nextNodeId };

  // Nós e arestas propostos pelo agente vivem no array (é o que faz o fantasma
  // reusar drag, seleção e painel), mas não podem chegar ao disco: só existem
  // depois do aceite, quando o servidor os grava com id definitivo.
  const clean = (list) => list
    .filter(item => item._pending !== 'add')
    .map(item => {
      const copy = { ...item };
      for (const key of Object.keys(copy)) if (key.startsWith('_')) delete copy[key];
      return copy;
    });

  return { ...base, nodes: clean(base.nodes), connections: clean(base.connections), notes: clean(base.notes) };
}

/**
 * Os 46 call-sites do app continuam chamando esta função. O nome ficou por
 * compatibilidade; o destino agora é o daemon, com debounce.
 */
function saveToLocalStorage() {
  if (!activeCanvasId) return;
  Audasys.persistence.save(serializeCanvas());
}

/**
 * Garante que todo campo exista com o default certo.
 *
 * A auditoria fazia `n.bottleneck.trim()`, `n.description.toLowerCase()` e
 * `n.tools.toLowerCase()` sobre objetos que podiam não ter esses campos —
 * um JSON importado à mão derrubava o relatório inteiro com TypeError.
 * Hidratar na única porta de entrada mata a classe do bug.
 */
function hydrateNodeDefaults(node) {
  const strings = ['name', 'description', 'owner', 'triggerCond', 'outputCond', 'tools',
                   'bottleneck', 'bottleneckCategory', 'duration', 'waitDuration', 'waitTrigger', 'switchField'];
  for (const key of strings) if (typeof node[key] !== 'string') node[key] = '';

  for (const key of ['switchCases', 'scriptConditions']) if (!Array.isArray(node[key])) node[key] = [];
  node.subprocesses = normalizeSubprocesses(node.subprocesses);

  if (!node.childCanvas || typeof node.childCanvas !== 'object') {
    node.childCanvas = { nodes: [], connections: [], nextNodeId: 1 };
  }
  node.subprocessMode = node.subprocessMode || 'checklist';
  node.outcomeType = node.outcomeType || 'success';
  node.waitType = node.waitType || 'tempo_fixo';
  node.frequency = node.frequency || 'diario';
  node.area = node.area || 'geral';
  node.status = node.status || 'pendente';
  node.x = Math.round(Number(node.x) || 0);
  node.y = Math.round(Number(node.y) || 0);
  return node;
}

/**
 * Substitui integralmente o estado do canvas e re-renderiza.
 *
 * O trio "limpa e redesenha" estava duplicado em três lugares (carga, import
 * e abertura de canvas), cada cópia esquecendo um passo diferente. Esta é a
 * única porta de entrada — e o gancho que o agente vai usar na F3.
 *
 * @param {object} data
 * @param {{source?: 'open'|'import'|'undo'|'remote'|'reject', preserveViewport?: boolean,
 *          reselect?: string|null, persist?: boolean}} [opts]
 * @returns {{applied: boolean, reason?: string}}
 */
function applyCanvasState(data, opts = {}) {
  const source = opts.source || 'open';

  // Dentro de um canvas filho, `nodes` global é do FILHO. Aplicar um estado
  // externo aqui escreveria o filho por cima do pai.
  if (childContext) {
    if (source === 'remote') return { applied: false, reason: 'in_child_context' };
    if (source === 'import' && !confirm('Você está dentro de um subprocesso. Sair para importar?')) {
      return { applied: false, reason: 'user_declined' };
    }
    if (source !== 'undo') navigateToParentCanvas();
  }

  // Re-render total destrói foco, caret e arrasto em andamento.
  if (source === 'remote' && (activeNodeId !== null || draggingConnection !== null || isEditingForm())) {
    return { applied: false, reason: 'busy' };
  }

  const keepZoom = opts.preserveViewport ? zoom : null;
  const keepPan = opts.preserveViewport ? { ...panOffset } : null;

  deselectAll();
  clearAllBoard(); // limpa o DOM E zera os arrays — por isso as atribuições vêm depois

  nodes = data.nodes || [];
  connections = data.connections || [];
  notes = data.notes || [];
  breakpoints = data.breakpoints || [];
  oportunidades = data.oportunidades || [];
  nextNodeId = data.nextNodeId || 1;
  nextNoteId = data.nextNoteId || 1;
  zoom = keepZoom ?? (data.zoom || 1.0);
  panOffset = keepPan ?? (data.panOffset || { x: 100, y: 100 });

  nodes.forEach(node => { migrateRulesToSwitch(node); hydrateNodeDefaults(node); });

  // Aresta apontando para nó inexistente vira linha invisível e lixo silencioso.
  const known = new Set(nodes.map(n => n.id));
  const orphans = connections.filter(c => !known.has(c.from) || !known.has(c.to));
  if (orphans.length) {
    console.warn(`[canvas] ${orphans.length} aresta(s) órfã(s) descartada(s)`, orphans.map(c => c.id));
    connections = connections.filter(c => known.has(c.from) && known.has(c.to));
  }

  nodes.forEach(node => renderNodeDOM(node));
  window.AudasysExpand?.marcarExpansiveis?.();  // badge do filho vira botão de expandir
  window.AudasysEvidencia?.marcarTodosOsCards?.();  // densidade = evidência
  connections.forEach(conn => renderConnectionDOM(conn));
  notes.forEach(note => renderNoteDOM(note));
  window.AudasysBreakpoints?.renderTodos?.();
  window.AudasysOportunidades?.renderTodos?.();

  window.currentCanvasDerivadoDe = data.derivadoDe || null;
  updateCenarioHeaderUI(data);

  updateViewport();
  updateConnections();
  applyAreaFilter();

  if (opts.reselect && nodes.some(n => n.id === opts.reselect)) selectNode(opts.reselect);
  if (opts.persist) saveToLocalStorage();

  return { applied: true };
}

function updateCenarioHeaderUI(data) {
  const widget = document.getElementById('header-cenario-widget');
  const btnListar = document.getElementById('btn-listar-cenarios-topo');
  const badgeCount = document.getElementById('cenarios-count-badge');
  if (!widget) return;

  if (data?.derivadoDe) {
    widget.style.display = 'flex';
    if (btnListar) btnListar.style.display = 'none';

    const posturaEl = document.getElementById('header-cenario-postura');
    const premissaEl = document.getElementById('header-cenario-premissa');
    if (posturaEl) posturaEl.textContent = (data.derivadoDe.postura || 'Realista').toUpperCase();
    if (premissaEl) premissaEl.textContent = data.derivadoDe.premissa || 'Cenário Simulado';
  } else {
    widget.style.display = 'none';
    if (btnListar) {
      btnListar.style.display = '';
      if (activeClientId && activeCanvasId) {
        Audasys.api.listarCenarios(activeClientId, activeCanvasId).then(({ cenarios }) => {
          if (badgeCount) {
            badgeCount.textContent = cenarios.length;
            badgeCount.style.display = cenarios.length > 0 ? 'inline-block' : 'none';
          }
        }).catch(() => {});
      }
    }
  }
}

document.getElementById('btn-add-note').addEventListener('click', () => {
  const rect = viewport.getBoundingClientRect();
  const x = (rect.width / 2 - panOffset.x) / zoom - 100;
  const y = (rect.height / 2 - panOffset.y) / zoom - 60;
  createNote(x, y);
});

// Cenários no Topo
document.getElementById('btn-comparar-cenario-topo')?.addEventListener('click', () => {
  if (activeClientId && activeCanvasId && window.AudasysComparador) {
    window.AudasysComparador.toggleModalComparador(activeClientId, activeCanvasId);
  }
});

document.getElementById('btn-voltar-processo-base')?.addEventListener('click', () => {
  if (window.currentCanvasDerivadoDe?.canvasId) {
    openCanvas(window.currentCanvasDerivadoDe.canvasId);
  }
});

document.getElementById('btn-listar-cenarios-topo')?.addEventListener('click', () => {
  if (activeClientId && activeCanvasId && window.AudasysComparador) {
    window.AudasysComparador.toggleListaCenarios(activeClientId, activeCanvasId);
  }
});

window.openCanvas = openCanvas;

// Global actions binding
// O salvamento é automático; o botão força a descarga imediata da fila.
document.getElementById('btn-save').addEventListener('click', async () => {
  saveToLocalStorage();
  await Audasys.persistence.flush();
});

document.getElementById('btn-export').addEventListener('click', () => {
  const data = {
    nodes,
    connections,
    notes,
    zoom,
    panOffset,
    nextNodeId,
    nextNoteId
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audaces-canvas-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm("Tem certeza que deseja apagar todo o quadro? Esta ação não pode ser desfeita.")) {
    clearAllBoard();
    saveToLocalStorage();
  }
});

function clearAllBoard() {
  nodesContainer.innerHTML = '';
  // Keep defs in SVG
  const defs = svgLayer.querySelector('defs');
  svgLayer.innerHTML = '';
  if (defs) svgLayer.appendChild(defs);
  
  nodes = [];
  connections = [];
  notes = [];
  nextNodeId = 1;
  nextNoteId = 1;
  deselectAll();
}

// 9. WINDOW RESIZE HANDLER
window.addEventListener('resize', updateConnections);

// 10. NEW UTILITY FUNCTIONS

// Duplicate a node (Ctrl+D or hover button)
function duplicateNode(nodeId) {
  const source = nodes.find(n => n.id === nodeId);
  if (!source) return;
  const copy = JSON.parse(JSON.stringify(source)); // deep clone
  copy.x = source.x + 30;
  copy.y = source.y + 30;
  createNode(source.type, copy.x, copy.y, { ...copy });
}

// Edge label floating input
const edgeLabelInput = document.getElementById('edge-label-input');
let _activeLabelConn = null;

function showEdgeLabelInput(conn) {
  _activeLabelConn = conn;
  const rect = viewport.getBoundingClientRect();
  const screenX = rect.left + conn.midX * zoom + panOffset.x;
  const screenY = rect.top + conn.midY * zoom + panOffset.y;

  edgeLabelInput.value = conn.label || '';
  edgeLabelInput.style.display = 'block';
  edgeLabelInput.style.left = `${screenX - 60}px`;
  edgeLabelInput.style.top = `${screenY - 14}px`;
  setTimeout(() => edgeLabelInput.focus(), 20);
}

function hideEdgeLabelInput() {
  edgeLabelInput.style.display = 'none';
  _activeLabelConn = null;
}

edgeLabelInput.addEventListener('blur', () => {
  if (_activeLabelConn) {
    setEdgeLabelText(_activeLabelConn, edgeLabelInput.value.trim());
    saveToLocalStorage();
  }
  hideEdgeLabelInput();
});

edgeLabelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') edgeLabelInput.blur();
  e.stopPropagation();
});

// Hide edge label input when clicking elsewhere
viewport.addEventListener('pointerdown', () => {
  if (_activeLabelConn) edgeLabelInput.blur();
});

// Child canvas navigation
function navigateToChildCanvas(node) {
  if (!node.childCanvas) node.childCanvas = { nodes: [], connections: [], nextNodeId: 1 };

  childContext = {
    node,
    parentNodes: nodes,
    parentConnections: connections,
    parentNextNodeId: nextNodeId,
    parentPanOffset: { ...panOffset },
    parentZoom: zoom
  };

  // Clear DOM
  nodesContainer.innerHTML = '';
  const defs = svgLayer.querySelector('defs');
  svgLayer.innerHTML = '';
  if (defs) svgLayer.appendChild(defs);

  // Load child state into globals
  nodes = node.childCanvas.nodes;
  connections = node.childCanvas.connections;
  nextNodeId = node.childCanvas.nextNodeId || 1;
  panOffset = { x: 100, y: 100 };
  zoom = 1.0;

  nodes.forEach(n => renderNodeDOM(n));
  window.AudasysExpand?.marcarExpansiveis?.();  // badge do filho vira botão de expandir
  window.AudasysEvidencia?.marcarTodosOsCards?.();  // densidade = evidência
  connections.forEach(c => renderConnectionDOM(c));
  updateViewport();
  updateConnections();
  deselectAll();

  // Show breadcrumb, hide filter
  document.getElementById('header-breadcrumb').style.display = 'flex';
  document.getElementById('breadcrumb-node-name').textContent = node.name;
  document.getElementById('header-filter').style.display = 'none';
}

document.getElementById('btn-back-to-parent').addEventListener('click', navigateToParentCanvas);

function navigateToParentCanvas() {
  if (!childContext) return;

  childContext.node.childCanvas = { nodes, connections, nextNodeId };

  // Clear DOM
  nodesContainer.innerHTML = '';
  const defs = svgLayer.querySelector('defs');
  svgLayer.innerHTML = '';
  if (defs) svgLayer.appendChild(defs);

  // Restore parent state
  nodes = childContext.parentNodes;
  connections = childContext.parentConnections;
  nextNodeId = childContext.parentNextNodeId;
  panOffset = childContext.parentPanOffset;
  zoom = childContext.parentZoom;

  nodes.forEach(n => renderNodeDOM(n));
  window.AudasysExpand?.marcarExpansiveis?.();  // badge do filho vira botão de expandir
  window.AudasysEvidencia?.marcarTodosOsCards?.();  // densidade = evidência
  connections.forEach(c => renderConnectionDOM(c));
  notes.forEach(n => renderNoteDOM(n)); // notes belong to the root canvas only
  updateViewport();
  updateConnections();
  deselectAll();

  childContext = null;

  document.getElementById('header-breadcrumb').style.display = 'none';
  document.getElementById('header-filter').style.display = 'flex';
  saveToLocalStorage();
}

// 11. CONNECTION COLOR SYSTEM

const RULE_COLOR_PALETTE = ['#3b82f6','#f59e0b','#ef4444','#10b981','#c084fc','#06b6d4','#f97316','#84cc16'];
const LEAN_CATEGORY_COLORS = {
  espera: '#f59e0b', retrabalho: '#ef4444', handoff: '#f97316',
  superprocessamento: '#8b5cf6', estoque: '#06b6d4', movimento: '#3b82f6',
  superprod: '#ec4899', talento: '#10b981', outro: '#94a3b8'
};
const LEAN_CATEGORY_LABELS = {
  espera: 'Espera', retrabalho: 'Retrabalho', handoff: 'Handoff',
  superprocessamento: 'Superprocessamento', estoque: 'Acúmulo/Fila',
  movimento: 'Movimento', superprod: 'Superprodução', talento: 'Talento', outro: 'Outro'
};

function updateConnectionStyle(conn) {
  const path = document.getElementById(conn.id);
  if (!path) return;

  if (conn.ruleId === 'else') {
    path.style.color = 'rgba(148,163,184,0.5)';
    path.style.strokeDasharray = '6 3';
    path.style.opacity = '0.7';
  } else if (conn.ruleId) {
    const fromNode = nodes.find(n => n.id === conn.from);
    // Look in switchCases first, then legacy rules
    const sc = fromNode?.switchCases?.find(c => c.id === conn.ruleId);
    const rule = sc || fromNode?.rules?.find(r => r.id === conn.ruleId);
    if (rule) {
      path.style.color = rule.color;
      path.style.strokeDasharray = '';
      path.style.opacity = '1';
    }
  } else {
    path.style.color = '';
    path.style.strokeDasharray = '';
    path.style.opacity = '1';
  }
}

// Edge rule selector (for condition node connections)
const edgeRuleSelect = document.getElementById('edge-rule-select');
let _activeRuleConn = null;

function showEdgeRuleSelect(conn, fromNode) {
  _activeRuleConn = conn;
  const rect = viewport.getBoundingClientRect();
  const screenX = rect.left + conn.midX * zoom + panOffset.x;
  const screenY = rect.top + conn.midY * zoom + panOffset.y;

  edgeRuleSelect.innerHTML = '<option value="">— Atribuir regra —</option>';
  const buildOptions = (rules, parentId = null, prefix = '') => {
    const children = rules.filter(r => r.parentId === parentId);
    children.forEach((rule, i) => {
      const num = prefix ? `${prefix}.${i+1}` : `${i+1}`;
      const opt = document.createElement('option');
      opt.value = rule.id;
      opt.textContent = `${num}. ${getRuleDisplay(rule)}`;
      opt.style.color = rule.color;
      if (conn.ruleId === rule.id) opt.selected = true;
      edgeRuleSelect.appendChild(opt);
      buildOptions(rules, rule.id, num);
    });
  };
  buildOptions(fromNode.rules);
  const elseOpt = document.createElement('option');
  elseOpt.value = 'else';
  elseOpt.textContent = '↳ Senão (padrão)';
  if (conn.ruleId === 'else') elseOpt.selected = true;
  edgeRuleSelect.appendChild(elseOpt);

  edgeRuleSelect.style.display = 'block';
  edgeRuleSelect.style.left = `${screenX - 80}px`;
  edgeRuleSelect.style.top = `${screenY - 14}px`;
  setTimeout(() => edgeRuleSelect.focus(), 20);
}

function hideEdgeRuleSelect() {
  edgeRuleSelect.style.display = 'none';
  _activeRuleConn = null;
}

edgeRuleSelect.addEventListener('change', () => {
  if (_activeRuleConn) {
    _activeRuleConn.ruleId = edgeRuleSelect.value;
    updateConnectionStyle(_activeRuleConn);
    // Set label from rule name if not already set
    if (_activeRuleConn.ruleId && _activeRuleConn.ruleId !== 'else') {
      const fromNode = nodes.find(n => n.id === _activeRuleConn.from);
      const rule = fromNode?.rules?.find(r => r.id === _activeRuleConn.ruleId);
      if (rule) {
        const display = getRuleDisplay(rule);
        setEdgeLabelText(_activeRuleConn, display);
      }
    }
    saveToLocalStorage();
  }
  hideEdgeRuleSelect();
});

edgeRuleSelect.addEventListener('blur', hideEdgeRuleSelect);
edgeRuleSelect.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideEdgeRuleSelect(); e.stopPropagation(); }
});

// 12. DECISION NODE RULES PANEL

const RULE_OPERATORS = ['é', 'não é', 'contém', 'não contém', 'está preenchido', 'não está preenchido', 'maior que'];

function renderRulesList(node) {
  const list = document.getElementById('rules-list');
  if (!list) return;
  list.innerHTML = '';

  const syncConnLabel = (rule) => {
    const display = getRuleDisplay(rule);
    connections.filter(c => c.ruleId === rule.id).forEach(c => {
      if (!c._labelOverride) setEdgeLabelText(c, display);
    });
  };

  const buildItems = (rules, parentId = null, prefix = '') => {
    const children = rules.filter(r => r.parentId === parentId);
    children.forEach((rule, i) => {
      const num = prefix ? `${prefix}.${i+1}` : `${i+1}`;
      const li = document.createElement('li');
      li.className = 'rule-item';
      li.dataset.ruleId = rule.id;
      li.style.paddingLeft = prefix ? `${prefix.split('.').length * 14 + 4}px` : '4px';

      const numBadge = document.createElement('span');
      numBadge.className = 'rule-num-badge';
      numBadge.textContent = num;

      const colorDot = document.createElement('span');
      colorDot.className = 'rule-color-dot';
      colorDot.style.background = rule.color;

      // --- 3-field row: campo | operador | valor ---
      const fields = document.createElement('div');
      fields.className = 'rule-fields';

      // Legacy mode: rule has label but no field
      if (rule.label !== undefined && rule.field === undefined) {
        const legacyInput = document.createElement('input');
        legacyInput.type = 'text';
        legacyInput.className = 'rule-label-input';
        legacyInput.value = rule.label || '';
        legacyInput.placeholder = 'Condição';
        legacyInput.addEventListener('blur', () => { rule.label = legacyInput.value.trim(); syncConnLabel(rule); saveToLocalStorage(); });
        legacyInput.addEventListener('keydown', e => { if (e.key === 'Enter') legacyInput.blur(); });
        fields.appendChild(legacyInput);
      } else {
        const fieldInput = document.createElement('input');
        fieldInput.type = 'text';
        fieldInput.className = 'rule-field-input';
        fieldInput.value = rule.field || '';
        fieldInput.placeholder = 'variável';
        fieldInput.addEventListener('blur', () => { rule.field = fieldInput.value.trim(); syncConnLabel(rule); saveToLocalStorage(); });
        fieldInput.addEventListener('keydown', e => { if (e.key === 'Enter') fieldInput.blur(); });

        const opSelect = document.createElement('select');
        opSelect.className = 'rule-op-select';
        RULE_OPERATORS.forEach(op => {
          const o = document.createElement('option');
          o.value = op; o.textContent = op;
          if (op === (rule.operator || 'é')) o.selected = true;
          opSelect.appendChild(o);
        });
        opSelect.addEventListener('change', () => {
          rule.operator = opSelect.value;
          const noValue = rule.operator === 'está preenchido' || rule.operator === 'não está preenchido';
          valueInput.style.display = noValue ? 'none' : '';
          syncConnLabel(rule); saveToLocalStorage();
        });

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'rule-value-input';
        valueInput.value = rule.value || '';
        valueInput.placeholder = 'valor';
        const noValueOp = rule.operator === 'está preenchido' || rule.operator === 'não está preenchido';
        if (noValueOp) valueInput.style.display = 'none';
        valueInput.addEventListener('blur', () => { rule.value = valueInput.value.trim(); syncConnLabel(rule); saveToLocalStorage(); });
        valueInput.addEventListener('keydown', e => { if (e.key === 'Enter') valueInput.blur(); });

        fields.appendChild(fieldInput);
        fields.appendChild(opSelect);
        fields.appendChild(valueInput);
      }

      const subBtn = document.createElement('button');
      subBtn.className = 'rule-sub-btn';
      subBtn.title = 'Sub-condição';
      subBtn.innerHTML = '<i class="fa-solid fa-code-branch"></i>';
      subBtn.addEventListener('click', () => addRule(node, rule.id));

      const delBtn = document.createElement('button');
      delBtn.className = 'rule-del-btn';
      delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      delBtn.addEventListener('click', () => {
        node.rules = node.rules.filter(r => r.id !== rule.id && r.parentId !== rule.id);
        connections.filter(c => c.ruleId === rule.id).forEach(c => { c.ruleId = ''; updateConnectionStyle(c); });
        renderRulesList(node);
        updateNodePreviewDetails(node);
        saveToLocalStorage();
      });

      li.appendChild(numBadge);
      li.appendChild(colorDot);
      li.appendChild(fields);
      li.appendChild(subBtn);
      li.appendChild(delBtn);
      list.appendChild(li);

      buildItems(rules, rule.id, num);
    });
  };
  buildItems(node.rules);
}

function getRuleDisplay(rule) {
  if (rule.field) {
    if (rule.operator === 'está preenchido' || rule.operator === 'não está preenchido') {
      return `${rule.field} ${rule.operator}`;
    }
    if (rule.value) return `${rule.field} ${rule.operator} ${rule.value}`;
    return `${rule.field} ${rule.operator} …`;
  }
  return rule.label || 'Condição sem nome';
}

function addRule(node, parentId = null) {
  const colorIdx = node.rules.length % RULE_COLOR_PALETTE.length;
  node.rules.push({
    id: `rule_${Date.now()}`,
    field: '',
    operator: 'é',
    value: '',
    color: RULE_COLOR_PALETTE[colorIdx],
    parentId
  });
  renderRulesList(node);
  updateNodePreviewDetails(node);
  saveToLocalStorage();
}

// btn-add-rule removed (replaced by btn-add-switch-case)

// 13. WAIT NODE BINDINGS
['prop-wait-type', 'prop-wait-duration', 'prop-wait-trigger'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(eventType, () => {
    if (!selectedNodeId) return;
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    if (id === 'prop-wait-type') node.waitType = el.value;
    if (id === 'prop-wait-duration') node.waitDuration = el.value;
    if (id === 'prop-wait-trigger') node.waitTrigger = el.value;
    saveToLocalStorage();
  });
});

// 13b. OUTCOME TYPE BINDINGS
document.querySelectorAll('.outcome-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!selectedNodeId) return;
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    node.outcomeType = btn.dataset.outcome;
    document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateNodePreviewDetails(node);
    saveToLocalStorage();
  });
});

// 13c. SCRIPT CONDITIONS
function renderScriptConditions(node) {
  const list = document.getElementById('script-conditions-list');
  if (!list) return;
  list.innerHTML = '';
  (node.scriptConditions || []).forEach((sc, idx) => {
    const li = document.createElement('li');
    li.className = 'script-condition-row';

    const seLabel = document.createElement('span');
    seLabel.className = 'sc-label';
    seLabel.textContent = 'SE';

    const condIn = document.createElement('input');
    condIn.type = 'text';
    condIn.className = 'sc-input';
    condIn.value = sc.condition || '';
    condIn.placeholder = 'condição';
    condIn.addEventListener('blur', () => { sc.condition = condIn.value.trim(); saveToLocalStorage(); });
    condIn.addEventListener('keydown', e => { if (e.key === 'Enter') condIn.blur(); });

    const arrow = document.createElement('span');
    arrow.className = 'sc-arrow';
    arrow.textContent = '→';

    const actIn = document.createElement('input');
    actIn.type = 'text';
    actIn.className = 'sc-input';
    actIn.value = sc.behavior || '';
    actIn.placeholder = 'comportamento';
    actIn.addEventListener('blur', () => { sc.behavior = actIn.value.trim(); updateNodePreviewDetails(node); saveToLocalStorage(); });
    actIn.addEventListener('keydown', e => { if (e.key === 'Enter') actIn.blur(); });

    const del = document.createElement('button');
    del.className = 'rule-del-btn';
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.addEventListener('click', () => {
      node.scriptConditions.splice(idx, 1);
      renderScriptConditions(node);
      updateNodePreviewDetails(node);
      saveToLocalStorage();
    });

    li.appendChild(seLabel);
    li.appendChild(condIn);
    li.appendChild(arrow);
    li.appendChild(actIn);
    li.appendChild(del);
    list.appendChild(li);
  });
}

document.getElementById('btn-add-script')?.addEventListener('click', () => {
  if (!selectedNodeId) return;
  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  if (!node.scriptConditions) node.scriptConditions = [];
  node.scriptConditions.push({ condition: '', behavior: '' });
  renderScriptConditions(node);
  saveToLocalStorage();
});

// 13. BOTTLENECK CATEGORY BINDING

const propBotCat = document.getElementById('prop-bottleneck-category');
propBotCat.addEventListener('change', () => {
  if (!selectedNodeId) return;
  const node = nodes.find(n => n.id === selectedNodeId);
  if (node) {
    node.bottleneckCategory = propBotCat.value;
    touchField(node, 'bottleneckCategory');
    updateNodePreviewDetails(node);
    saveToLocalStorage();
  }
});

// 14. SWITCH NODE FUNCTIONS

function migrateRulesToSwitch(node) {
  if (node.type !== 'condition') return;
  if (node.switchCases && node.switchCases.length > 0) return; // already migrated
  if (!node.rules || node.rules.length === 0) return;
  // Migrate: each rule with field+value becomes a case
  node.switchField = node.rules[0]?.field || '';
  node.switchCases = node.rules
    .filter(r => r.field || r.label)
    .map(r => ({ id: r.id, value: r.value || r.label || '', color: r.color }));
}

function renderSwitchCases(node) {
  const list = document.getElementById('switch-cases-list');
  if (!list) return;
  list.innerHTML = '';
  (node.switchCases || []).forEach((sc, idx) => {
    const li = document.createElement('li');
    li.className = 'switch-case-item';

    const dot = document.createElement('span');
    dot.className = 'case-color-dot';
    dot.style.background = sc.color;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'rule-label-input';
    inp.value = sc.value || '';
    inp.placeholder = `Caso ${idx + 1}`;
    inp.addEventListener('blur', () => {
      sc.value = inp.value.trim();
      updateNodePreviewDetails(node);
      // update any connections with this ruleId
      connections.filter(c => c.ruleId === sc.id).forEach(c => {
        setEdgeLabelText(c, sc.value);
      });
      saveToLocalStorage();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });

    const del = document.createElement('button');
    del.className = 'rule-del-btn';
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.addEventListener('click', () => {
      node.switchCases.splice(idx, 1);
      connections.filter(c => c.ruleId === sc.id).forEach(c => { c.ruleId = ''; updateConnectionStyle(c); });
      renderSwitchCases(node);
      updateNodePreviewDetails(node);
      saveToLocalStorage();
    });

    li.appendChild(dot);
    li.appendChild(inp);
    li.appendChild(del);
    list.appendChild(li);
  });
}

document.getElementById('btn-add-switch-case')?.addEventListener('click', () => {
  if (!selectedNodeId) return;
  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node || node.type !== 'condition') return;
  const colorIdx = (node.switchCases || []).length % RULE_COLOR_PALETTE.length;
  if (!node.switchCases) node.switchCases = [];
  node.switchCases.push({ id: `sc_${Date.now()}`, value: '', color: RULE_COLOR_PALETTE[colorIdx] });
  renderSwitchCases(node);
  updateNodePreviewDetails(node);
  saveToLocalStorage();
});

document.getElementById('prop-switch-field')?.addEventListener('input', () => {
  if (!selectedNodeId) return;
  const node = nodes.find(n => n.id === selectedNodeId);
  if (!node) return;
  node.switchField = document.getElementById('prop-switch-field').value.trim();
  updateNodePreviewDetails(node);
  saveToLocalStorage();
});

// 15. HOME SCREEN — Multi-canvas management

// ── Data helpers ──────────────────────────────────────────────────────────────

/**
 * Espelho em memória da home vinda do daemon.
 *
 * A "Empresa" da interface é o cliente do backend — um diretório em disco.
 * Manter os dois conceitos separados criaria uma hierarquia paralela para
 * migrar depois, sem ganho nenhum.
 *
 * O cache existe porque `loadHome()` e `renderFolderDOM()` são síncronos e
 * chamados de dezenas de handlers; deixá-los assim evita espalhar `await`
 * pela árvore de renderização inteira. Quem muda dados chama `refreshHome()`.
 */
let homeCache = { folders: [] };
let activeClientId = null;

function loadHomeData() {
  return homeCache;
}

/** Busca a home no daemon e reconstrói o cache no formato que a UI espera. */
async function refreshHome() {
  const { clients } = await Audasys.api.fullHome();
  homeCache = {
    folders: clients.map(c => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      canvases: c.canvases.map(cv => ({
        id: cv.id, name: cv.name, folderId: c.id,
        createdAt: cv.createdAt, lastModified: cv.lastModified,
        nodeCount: cv.nodeCount, edgeCount: cv.edgeCount, pendingChangesets: cv.pendingChangesets
      }))
    }))
  };
  return homeCache;
}

/** Em qual empresa vive um canvas. */
function clientOfCanvas(canvasId) {
  for (const folder of homeCache?.folders || []) {
    if ((folder.canvases || []).some(c => c.id === canvasId)) return folder.id;
  }
  return activeClientId || window.activeClientId || null;
}

window.clientOfCanvas = clientOfCanvas;

const genId = (prefix) => Audasys.genId(prefix);

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Vocabulário da empresa aberta.
 *
 * As áreas e as categorias de gargalo estavam escritas à mão em quatro lugares
 * (dois selects no HTML, o schema e o MCP), e não tinham `suporte` nem
 * `atendimento` — no primeiro mapa real, os nós da atendente foram todos para
 * `operacoes` e a fronteira de handoff sumiu. Agora vêm do servidor.
 */
let vocabulary = { areas: [], wasteCategories: [] };

async function loadVocabulary(clientId) {
  vocabulary = await Audasys.api.vocabulary(clientId);

  const fill = (select, list, { allOption = null } = {}) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = (allOption ? `<option value="${allOption.value}">${allOption.label}</option>` : '')
      + list.map(item =>
          `<option value="${escapeHtml(item.id)}" title="${escapeHtml(item.hint || '')}">${escapeHtml(item.label || item.id)}</option>`
        ).join('');
    if ([...select.options].some(o => o.value === current)) select.value = current;
  };

  fill(document.getElementById('filter-dept'), vocabulary.areas, { allOption: { value: 'all', label: 'Todas as Áreas' } });
  fill(document.getElementById('prop-dept'), vocabulary.areas);
  fill(document.getElementById('prop-bottleneck-category'), vocabulary.wasteCategories,
       { allOption: { value: '', label: 'Sem categoria' } });
}

/** Erro de rede vira aviso visível: falha silenciosa em ferramenta de reunião é pior. */
function reportError(action, err) {
  console.error(`[${action}]`, err);
  alert(`Não consegui ${action}.\n\n${err.message}\n\nO daemon está rodando? (npm start)`);
}

// ── View switching ────────────────────────────────────────────────────────────
function showHomeView() {
  currentView = 'home';
  activeCanvasId = null;

  window.OverlayManager?.closeAll();
  const homeScreen = document.getElementById('home-screen');
  if (homeScreen) homeScreen.style.display = 'flex';
  
  const canvasViewport = document.getElementById('canvas-viewport');
  if (canvasViewport) canvasViewport.style.display = 'none';

  const nodePalette = document.querySelector('.node-palette');
  if (nodePalette) nodePalette.style.display = 'none';

  const propPanel = document.getElementById('properties-panel');
  if (propPanel) propPanel.style.display = 'none';

  const titleWrapper = document.getElementById('header-canvas-title-wrapper');
  if (titleWrapper) titleWrapper.style.display = 'none';

  const breadcrumb = document.getElementById('header-breadcrumb');
  if (breadcrumb) breadcrumb.style.display = 'none';

  const headerActions = document.getElementById('header-actions');
  if (headerActions) headerActions.style.display = 'none';

  const cenarioWidget = document.getElementById('header-cenario-widget');
  if (cenarioWidget) cenarioWidget.style.display = 'none';

  loadHome();
}

function showCanvasView(canvasId, canvasName) {
  currentView = 'canvas';

  window.OverlayManager?.closeAll();
  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('canvas-viewport').style.display = '';
  document.querySelector('.node-palette').style.display = '';
  document.getElementById('properties-panel').style.display = '';
  
  const titleWrapper = document.getElementById('header-canvas-title-wrapper');
  if (titleWrapper) {
    titleWrapper.style.display = 'flex';
    const titleInput = document.getElementById('header-canvas-title-input');
    if (titleInput) titleInput.value = canvasName || 'Canvas sem título';
  }

  document.getElementById('header-actions').style.display = 'flex';

  // Show canvas name in breadcrumb area if available
  const breadcrumb = document.getElementById('header-breadcrumb');
  if (breadcrumb) breadcrumb.style.display = 'none'; // child canvas breadcrumb stays hidden initially
}

// ── Home rendering ────────────────────────────────────────────────────────────
function loadHome() {
  const home = loadHomeData();
  if (!home) return;

  // Sidebar folder nav
  const folderNav = document.getElementById('home-folder-nav');
  folderNav.innerHTML = '';

  const allItem = document.createElement('div');
  allItem.className = 'home-nav-folder' + (activeFolderFilter === null ? ' active' : '');
  allItem.innerHTML = `<i class="fa-solid fa-house"></i> Todos os Canvases`;
  allItem.addEventListener('click', () => { activeFolderFilter = null; loadHome(); });
  folderNav.appendChild(allItem);

  home.folders.forEach(f => {
    const item = document.createElement('div');
    item.className = 'home-nav-folder' + (activeFolderFilter === f.id ? ' active' : '');
    item.innerHTML = `<i class="fa-solid fa-folder"></i> ${f.name}`;
    item.addEventListener('click', () => { activeFolderFilter = f.id; loadHome(); });
    folderNav.appendChild(item);
  });

  // Main folder list
  const folderList = document.getElementById('home-folder-list');
  folderList.innerHTML = '';

  const foldersToShow = activeFolderFilter
    ? home.folders.filter(f => f.id === activeFolderFilter)
    : home.folders;

  let totalCanvases = 0;
  foldersToShow.forEach(f => {
    const canvases = f.canvases || [];
    totalCanvases += canvases.length;
    folderList.appendChild(renderFolderDOM(f, canvases, home));
  });

  const titleEl = document.getElementById('home-title');
  titleEl.textContent = activeFolderFilter
    ? (home.folders.find(f => f.id === activeFolderFilter)?.name || 'Canvases')
    : 'Canvases';

  const countEl = document.getElementById('home-canvas-count');
  countEl.textContent = `${totalCanvases} canvas${totalCanvases !== 1 ? 'es' : ''}`;
}

function renderFolderDOM(folder, canvases, home) {
  const section = document.createElement('div');
  section.className = 'home-folder-section';
  section.id = `folder-section-${folder.id}`;

  const header = document.createElement('div');
  header.className = 'home-folder-header';
  header.innerHTML = `
    <i class="fa-solid fa-chevron-down home-folder-chevron"></i>
    <span class="home-folder-name" data-folder-id="${folder.id}">${folder.name}</span>
    <div class="home-folder-actions">
      <button class="home-folder-action-btn rename-folder-btn" data-folder-id="${folder.id}" title="Renomear empresa"><i class="fa-solid fa-pen"></i></button>
      <button class="home-folder-action-btn danger delete-folder-btn" data-folder-id="${folder.id}" title="Excluir empresa"><i class="fa-solid fa-trash-can"></i></button>
    </div>
  `;

  // Collapse toggle
  header.addEventListener('click', (e) => {
    if (e.target.closest('.home-folder-action-btn') || e.target.closest('.home-folder-name[contenteditable="true"]')) return;
    header.classList.toggle('collapsed');
    body.classList.toggle('collapsed');
  });

  // Rename folder
  header.querySelector('.rename-folder-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const nameEl = header.querySelector('.home-folder-name');
    nameEl.contentEditable = 'true';
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    nameEl.addEventListener('blur', () => {
      nameEl.contentEditable = 'false';
      renameFolder(folder.id, nameEl.textContent.trim() || folder.name);
    }, { once: true });
    nameEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); } });
  });

  // Delete folder
  header.querySelector('.delete-folder-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteFolder(folder.id);
  });

  const body = document.createElement('div');
  body.className = 'home-folder-body';

  // Canvas cards
  canvases.forEach(cv => body.appendChild(renderCanvasCard(cv, folder, home)));

  // "+" add canvas card
  const addCard = document.createElement('div');
  addCard.className = 'canvas-home-card add-card';
  addCard.innerHTML = `<i class="fa-solid fa-plus"></i> Novo Canvas`;
  addCard.addEventListener('click', () => createCanvas(folder.id));
  body.appendChild(addCard);

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function renderCanvasCard(cv, folder, home) {
  const card = document.createElement('div');
  card.className = 'canvas-home-card';
  card.id = `canvas-card-${cv.id}`;

  card.innerHTML = `
    <div class="canvas-card-menu">
      <button class="canvas-card-menu-btn" title="Ações"><i class="fa-solid fa-ellipsis"></i></button>
    </div>
    <div class="canvas-card-name">${escapeHtml(cv.name)}</div>
    <div class="canvas-card-meta"><i class="fa-regular fa-clock"></i> ${formatDate(cv.lastModified)}${
      cv.pendingChangesets
        ? `<span class="canvas-card-pending" title="O agente propôs alterações que ainda não foram revisadas"><i class="fa-solid fa-wand-magic-sparkles"></i> ${cv.pendingChangesets}</span>`
        : ''
    }</div>
  `;

  // Open canvas on card click (not on menu)
  card.addEventListener('click', (e) => {
    if (e.target.closest('.canvas-card-menu') || e.target.closest('.card-context-menu')) return;
    openCanvas(cv.id);
  });

  // Context menu
  const menuBtn = card.querySelector('.canvas-card-menu-btn');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any open menus first
    document.querySelectorAll('.card-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'card-context-menu';

    const otherFolders = home.folders.filter(f => f.id !== folder.id);
    const moveOptions = otherFolders.map(f =>
      `<button class="move-canvas-btn" data-folder-id="${f.id}"><i class="fa-solid fa-folder-arrow-down"></i> Mover para: ${f.name}</button>`
    ).join('');

    menu.innerHTML = `
      <button class="rename-canvas-btn"><i class="fa-solid fa-pen"></i> Renomear</button>
      <button class="duplicate-canvas-btn"><i class="fa-solid fa-copy"></i> Duplicar</button>
      ${moveOptions ? `<div class="menu-divider"></div>${moveOptions}` : ''}
      <div class="menu-divider"></div>
      <button class="delete-canvas-btn danger"><i class="fa-solid fa-trash-can"></i> Excluir</button>
    `;

    menu.querySelector('.rename-canvas-btn').addEventListener('click', (ev) => {
      ev.stopPropagation(); menu.remove();
      renameCanvas(cv.id);
    });
    menu.querySelector('.duplicate-canvas-btn').addEventListener('click', (ev) => {
      ev.stopPropagation(); menu.remove();
      duplicateCanvas(cv.id);
    });
    menu.querySelector('.delete-canvas-btn').addEventListener('click', (ev) => {
      ev.stopPropagation(); menu.remove();
      deleteCanvas(cv.id, folder.id);
    });
    menu.querySelectorAll('.move-canvas-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation(); menu.remove();
        moveCanvas(cv.id, folder.id, btn.dataset.folderId);
      });
    });

    card.appendChild(menu);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
  });

  return card;
}

// ── CRUD actions ──────────────────────────────────────────────────────────────
async function createFolder(name) {
  try {
    await Audasys.api.createClient(name || 'Nova Empresa');
    await refreshHome();
    loadHome();
  } catch (err) { reportError('criar a empresa', err); }
}

async function createCanvas(folderId, name) {
  try {
    const { canvas } = await Audasys.api.createCanvas(folderId, name || 'Novo Canvas');
    await refreshHome();
    openCanvas(canvas.id);
  } catch (err) { reportError('criar o canvas', err); }
}

async function openCanvas(canvasId) {
  let clientId = clientOfCanvas(canvasId) || activeClientId || window.activeClientId;
  if (!clientId) {
    try {
      await refreshHome();
      clientId = clientOfCanvas(canvasId) || activeClientId || window.activeClientId;
    } catch (e) {}
  }
  if (!clientId) { reportError('abrir o canvas', new Error('Empresa do canvas não encontrada')); return; }

  try {
    await loadVocabulary(clientId);
    const { canvas } = await Audasys.api.getCanvas(clientId, canvasId);

    activeCanvasId = canvasId;
    activeClientId = clientId;
    window.activeCanvasId = canvasId;
    window.activeClientId = clientId;
    childContext = null;
    // A sessão de escrita precisa existir antes de qualquer render: o app
    // dispara saveToLocalStorage() em vários pontos da própria montagem.
    Audasys.persistence.attach(clientId, canvasId, canvas.rev);

    applyCanvasState(canvas, { source: 'open' });
    showCanvasView(canvasId, canvas.name || 'Canvas');
    AudasysAgent.attach(clientId, canvasId);
  } catch (err) {
    reportError('abrir o canvas', err);
  }
}

async function closeCanvas() {
  try {
    AudasysAgent.detach();
  } catch (e) {}

  if (activeCanvasId) {
    try {
      saveToLocalStorage();
      await Audasys.persistence.flush();
    } catch (e) {
      console.warn('Erro ao salvar no closeCanvas:', e);
    }
  }

  try {
    Audasys.persistence.detach();
  } catch (e) {}

  clearAllBoard();
  nodes = []; connections = []; notes = [];
  nextNodeId = 1; nextNoteId = 1;
  activeCanvasId = null;
  activeClientId = null;
  window.activeCanvasId = null;
  window.activeClientId = null;
  childContext = null;
  window.currentCanvasDerivadoDe = null;

  try {
    if (window.AudasysOportunidades?.limpar) {
      window.AudasysOportunidades.limpar();
    }
  } catch (e) {}

  try {
    await refreshHome();
  } catch (err) {
    console.warn('home desatualizada', err);
  }
  showHomeView();
}

async function renameFolder(folderId, newName) {
  try {
    await Audasys.api.renameClient(folderId, newName);
    await refreshHome();
    loadHome();
  } catch (err) { reportError('renomear a empresa', err); }
}

function renameCanvas(canvasId) {
  const folderId = clientOfCanvas(canvasId);
  const targetCanvas = (homeCache.folders.find(f => f.id === folderId)?.canvases || [])
    .find(c => c.id === canvasId);
  if (!targetCanvas) return;

  const card = document.getElementById(`canvas-card-${canvasId}`);
  if (!card) return;
  const nameEl = card.querySelector('.canvas-card-name');
  nameEl.contentEditable = 'true';
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  nameEl.addEventListener('blur', async () => {
    nameEl.contentEditable = 'false';
    const newName = nameEl.textContent.trim() || targetCanvas.name;
    if (newName === targetCanvas.name) return;
    try {
      await Audasys.api.patchCanvas(folderId, canvasId, { name: newName });
      await refreshHome();
      loadHome();
    } catch (err) {
      nameEl.textContent = targetCanvas.name;
      reportError('renomear o canvas', err);
    }
  }, { once: true });
  nameEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); } });
}

async function deleteFolder(folderId) {
  const folder = homeCache.folders.find(f => f.id === folderId);
  const count = (folder?.canvases || []).length;
  if (!confirm(`Excluir a empresa "${folder?.name ?? folderId}"${count ? ` e seus ${count} canvas(es)` : ''}?\n\nVai para a lixeira em data/.trash/.`)) return;
  try {
    await Audasys.api.deleteClient(folderId);
    if (activeFolderFilter === folderId) activeFolderFilter = null;
    await refreshHome();
    loadHome();
  } catch (err) { reportError('excluir a empresa', err); }
}

async function deleteCanvas(canvasId, folderId) {
  if (!confirm('Excluir este canvas?\n\nVai para a lixeira em data/.trash/.')) return;
  try {
    await Audasys.api.deleteCanvas(folderId || clientOfCanvas(canvasId), canvasId);
    await refreshHome();
    loadHome();
  } catch (err) { reportError('excluir o canvas', err); }
}

async function duplicateCanvas(canvasId) {
  const folderId = clientOfCanvas(canvasId);
  if (!folderId) return;
  try {
    await Audasys.api.duplicateCanvas(folderId, canvasId);
    await refreshHome();
    loadHome();
  } catch (err) { reportError('duplicar o canvas', err); }
}

async function moveCanvas(canvasId, fromFolderId, toFolderId) {
  if (fromFolderId === toFolderId) return;
  try {
    // Empresas são diretórios distintos: mover é copiar-e-apagar no servidor.
    await Audasys.api.moveCanvas(fromFolderId, canvasId, toFolderId);
    await refreshHome();
    loadHome();
  } catch (err) { reportError('mover o canvas', err); }
}

// ── Toolbar button wiring ─────────────────────────────────────────────────────
document.getElementById('btn-back-home').addEventListener('click', closeCanvas);

document.getElementById('home-btn-new-folder').addEventListener('click', () => {
  const name = prompt('Nome da empresa:');
  if (name && name.trim()) createFolder(name.trim());
});

document.getElementById('home-btn-new-canvas').addEventListener('click', () => {
  const home = loadHomeData();
  if (!home || home.folders.length === 0) {
    alert('Crie uma empresa primeiro.');
    return;
  }
  if (home.folders.length === 1) {
    createCanvas(home.folders[0].id);
    return;
  }
  // Multiple folders: let user pick
  const folderNames = home.folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
  const choice = prompt(`Em qual empresa criar o canvas?\n\n${folderNames}\n\nDigite o número:`);
  const idx = parseInt(choice) - 1;
  if (!isNaN(idx) && home.folders[idx]) createCanvas(home.folders[idx].id);
});

// ── App initialization ────────────────────────────────────────────────────────
async function initApp() {
  updateViewport();

  try {
    await Audasys.api.health();
  } catch {
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
                   background:#0f1115;color:#e7e9ee;font:15px/1.6 system-ui;text-align:center;padding:40px">
         <div><h2 style="margin:0 0 10px">O daemon não está rodando</h2>
         <p style="color:#9aa3b2;margin:0">No terminal, dentro de <code>~/dev/audasys-canvas</code>:</p>
         <pre style="background:#1b2029;padding:12px 18px;border-radius:8px;display:inline-block;margin-top:12px">npm start</pre>
         </div></div>`);
    return;
  }

  try {
    await refreshHome();
  } catch (err) {
    reportError('carregar a lista de canvases', err);
    return;
  }

  showHomeView();
}

// Indicador de gravação no header: sem ele não há como saber se o que você
// acabou de digitar chegou ao disco.
Audasys.persistence.onState((state) => {
  const el = document.getElementById('btn-save');
  if (!el) return;
  const label = {
    dirty: '<i class="fa-regular fa-clock"></i> Salvando…',
    saving: '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Salvando',
    saved: '<i class="fa-solid fa-check"></i> Salvo',
    conflict: '<i class="fa-solid fa-triangle-exclamation"></i> Conflito',
    error: '<i class="fa-solid fa-triangle-exclamation"></i> Erro ao salvar'
  }[state];
  if (label) el.innerHTML = label;
  el.dataset.saveState = state;

  if (state === 'conflict') {
    // Outra aba ou o agente escreveu primeiro. Recarregar é mais honesto do
    // que sobrescrever silenciosamente o trabalho do outro lado.
    if (confirm('Este canvas foi alterado em outro lugar.\n\nRecarregar a versão do servidor? Suas alterações não salvas serão perdidas.')) {
      openCanvas(activeCanvasId);
    }
  }
});

// Direct Canvas Flow Name Editing
const headerTitleInput = document.getElementById('header-canvas-title-input');
if (headerTitleInput) {
  headerTitleInput.addEventListener('blur', async () => {
    const newName = headerTitleInput.value.trim() || 'Novo Canvas';
    if (activeClientId && activeCanvasId) {
      try {
        await Audasys.api.renameCanvas(activeClientId, activeCanvasId, newName);
        await refreshHome();
      } catch (e) {
        console.warn('Falha ao renomear canvas:', e);
      }
    }
  });
  headerTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      headerTitleInput.blur();
    }
  });
}

// Dropdown de Ferramentas / Ações
document.getElementById('btn-tools-dropdown')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('header-tools-menu');
  if (!menu) return;
  const isVisible = menu.style.display === 'flex';
  window.OverlayManager.closeAll('toolsMenu');
  menu.style.display = isVisible ? 'none' : 'flex';
});

// Fechar dropdown ao clicar em qualquer item
document.getElementById('header-tools-menu')?.addEventListener('click', () => {
  const menu = document.getElementById('header-tools-menu');
  if (menu) menu.style.display = 'none';
});

// Logo e Botão de Voltar para o Início
document.getElementById('header-logo-home')?.addEventListener('click', () => {
  closeCanvas();
});

document.getElementById('btn-back-home')?.addEventListener('click', () => {
  closeCanvas();
});

// Salvar e Versionar como Mapa de Processos (.md)
document.getElementById('btn-salvar-mapa')?.addEventListener('click', async () => {
  if (!activeClientId || !activeCanvasId) return;
  try {
    saveToLocalStorage();
    await Audasys.persistence.flush();

    const res = await Audasys.api.salvarMapaProcesso(activeClientId, activeCanvasId, {
      autor: 'Consultor',
      nota: `Mapa gerado a partir do Canvas com ${nodes.length} passos`,
    });

    const v = res.versao;
    abrirModalMapaProcesso(v, `Mapa de Processos salvo com sucesso como Versão ${v.versao}!`);
  } catch (err) {
    reportError('salvar o mapa de processos', err);
  }
});

// Histórico de Versões do Mapa de Processos (.md)
document.getElementById('btn-historico-mapas')?.addEventListener('click', async () => {
  if (!activeClientId || !activeCanvasId) return;
  try {
    const { versoes } = await Audasys.api.listarVersoesMapa(activeClientId, activeCanvasId);
    abrirModalHistoricoMapas(versoes);
  } catch (err) {
    reportError('listar histórico de mapas', err);
  }
});

function abrirModalMapaProcesso(versao, msgSucesso = '') {
  document.getElementById('mapa-processo-modal')?.remove();
  window.OverlayManager?.closeAll('mapa-processo');

  const ov = document.createElement('div');
  ov.id = 'mapa-processo-modal';
  ov.className = 'esc-overlay';
  ov.innerHTML = `
    <div class="qd-box" style="max-width: 760px; max-height: 88vh; display:flex; flex-direction:column;">
      <div class="esc-head">
        <div>
          <b><i class="fa-solid fa-file-signature"></i> Mapa de Processos (Versão ${versao.versao})</b>
          <div class="agd-sub">${new Date(versao.criadoEm).toLocaleString('pt-BR')} · ${versao.nodeCount} passos · rev.${versao.rev}</div>
        </div>
        <button class="agd-close" data-fechar-mapa>✕</button>
      </div>
      ${msgSucesso ? `<div style="background:rgba(16,185,129,0.12); color:#34d399; font-size:12px; font-weight:600; padding:10px 18px; border-bottom:1px solid rgba(16,185,129,0.2);"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(msgSucesso)}</div>` : ''}
      <div style="flex:1; overflow-y:auto; padding:16px;">
        <pre style="background:#090d16; border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:14px; font-size:12px; color:#cbd5e1; white-space:pre-wrap; max-height:55vh; overflow-y:auto;">${escapeHtml(versao.markdown)}</pre>
      </div>
      <div class="esc-foot" style="padding:12px 18px; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <button class="header-btn" data-fechar-mapa>Fechar</button>
        <button class="header-btn highlight-btn" id="btn-copiar-md-modal"><i class="fa-solid fa-copy"></i> Copiar Markdown (.md)</button>
      </div>
    </div>`;

  document.body.appendChild(ov);

  ov.addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar-mapa]') || e.target === ov) ov.remove();
  });

  ov.querySelector('#btn-copiar-md-modal')?.addEventListener('click', () => {
    navigator.clipboard.writeText(versao.markdown);
    alert('Markdown da Versão copiado para a área de transferência!');
  });
}

function abrirModalHistoricoMapas(versoes) {
  document.getElementById('historico-mapas-modal')?.remove();
  window.OverlayManager?.closeAll('historico-mapas');

  const ov = document.createElement('div');
  ov.id = 'historico-mapas-modal';
  ov.className = 'esc-overlay';
  ov.innerHTML = `
    <div class="qd-box" style="max-width: 680px; max-height: 85vh; display:flex; flex-direction:column;">
      <div class="esc-head">
        <div>
          <b><i class="fa-solid fa-clock-rotate-left"></i> Histórico de Mapas de Processos (.md)</b>
          <div class="agd-sub">Versões oficiais salvas para este processo</div>
        </div>
        <button class="agd-close" data-fechar-hist>✕</button>
      </div>
      <div style="flex:1; overflow-y:auto; padding:16px;">
        ${!versoes || versoes.length === 0 ? '<div class="qd-vazia">Nenhum Mapa de Processos foi salvo ainda. Use "Salvar como Mapa de Processos" para criar a primeira versão versionada.</div>' : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${[...versoes].reverse().map(v => `
              <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:700; color:#f8fafc; font-size:13.5px;"><i class="fa-solid fa-file-lines" style="color:#60a5fa; margin-right:6px;"></i> Versão ${v.versao} ${v.versao === versoes.length ? '<span style="font-size:10px; color:#10b981; background:rgba(16,185,129,0.15); padding:2px 6px; border-radius:4px; margin-left:4px;">ATUAL</span>' : ''}</div>
                  <div style="font-size:11.5px; color:#94a3b8; margin-top:2px;">${new Date(v.criadoEm).toLocaleString('pt-BR')} · ${v.nodeCount} passos · ${v.edgeCount} arestas</div>
                </div>
                <button class="arb-btn" data-ver-versao="${v.versao}"><i class="fa-solid fa-eye"></i> Visualizar</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
      <div class="esc-foot" style="padding:12px 18px; border-top:1px solid rgba(255,255,255,0.08); display:flex; justify-content:flex-end;">
        <button class="header-btn" data-fechar-hist>Fechar</button>
      </div>
    </div>`;

  document.body.appendChild(ov);

  ov.addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar-hist]') || e.target === ov) return ov.remove();
    const btn = e.target.closest('[data-ver-versao]');
    if (btn) {
      const vNum = parseInt(btn.dataset.verVersao);
      const v = versoes.find(x => x.versao === vNum);
      if (v) {
        ov.remove();
        abrirModalMapaProcesso(v);
      }
    }
  });
}

// Global Escape Key & Click Outside para fechar overlays
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.OverlayManager.closeAll();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#header-tools-dropdown-wrapper')) {
    const menu = document.getElementById('header-tools-menu');
    if (menu && menu.style.display === 'flex') {
      menu.style.display = 'none';
    }
  }
});

// 16. INITIALIZATION RUN
updateViewport();
initApp();
