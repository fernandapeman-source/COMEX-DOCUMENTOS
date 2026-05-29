'use strict';
/* ════════════════════════════════════════════════════════════════════════
   PEMAN Comex — Browser-only app
   Calls Anthropic API directly, fills xlsx templates via JSZip.
   No Node.js / no server required.
   ════════════════════════════════════════════════════════════════════════ */

/* ── DOM refs ─────────────────────────────────────────────────────────── */
const apiKeyInput     = document.getElementById('apiKey');
const btnSaveKey      = document.getElementById('btnSaveKey');
const dropzone        = document.getElementById('dropzone');
const fileInput       = document.getElementById('fileInput');
const fileList        = document.getElementById('fileList');
const stageSelect     = document.getElementById('stageSelect');
const noteInput       = document.getElementById('noteInput');
const btnGenerate     = document.getElementById('btnGenerate');
const progressArea    = document.getElementById('progressArea');
const progressBar     = document.getElementById('progressBar');
const progressMsg     = document.getElementById('progressMsg');
const summaryCard     = document.getElementById('summaryCard');
const summaryContent  = document.getElementById('summaryContent');
const comercialCard   = document.getElementById('comercialCard');
const downloadButtons = document.getElementById('downloadButtons');
const certsCard       = document.getElementById('certsCard');
const errorBox        = document.getElementById('errorBox');

/* ── State ────────────────────────────────────────────────────────────── */
let selectedFiles = [];
// Kept after generation so "Regenerar" can re-fill templates with edits
let currentMap = null, currentCantOrig = null, currentStage = null;

const STORED_OP = 'peman_op_map';

function saveOperation(map, cantOrig, stage) {
  try {
    localStorage.setItem(STORED_OP, JSON.stringify({ map, cantOrig, stage }));
  } catch(e) { /* storage full — ignore */ }
}

function clearSavedOperation() {
  localStorage.removeItem(STORED_OP);
}

function restoreOperation() {
  try {
    const raw = localStorage.getItem(STORED_OP);
    if (!raw) return;
    const { map, cantOrig, stage } = JSON.parse(raw);
    if (!map) return;
    currentMap      = map;
    currentCantOrig = cantOrig;
    currentStage    = stage;
    // Show certs module with banner
    const ope  = map.REF_OPE || 'Operación sin número';
    const nCont = [1,2,3,4,5,6,7,8,9,10].filter(i => map[`CONTAINER_${i}`]).length;
    const label = document.getElementById('savedOpLabel');
    const banner = document.getElementById('savedOpBanner');
    if (label)  label.textContent = `📂 Operación guardada: ${ope} — ${nCont} contenedor${nCont !== 1 ? 'es' : ''}`;
    if (banner) banner.classList.remove('hidden');
    certsCard.classList.remove('hidden');
  } catch(e) { /* corrupt data — ignore */ }
}

/* ════════════════════════════════════════════════════════════════════════
   API KEY
   ════════════════════════════════════════════════════════════════════════ */
const STORED_KEY = 'peman_api_key';
const savedKey = localStorage.getItem(STORED_KEY);
if (savedKey) apiKeyInput.value = savedKey;

btnSaveKey.addEventListener('click', () => {
  const k = apiKeyInput.value.trim();
  if (k) { localStorage.setItem(STORED_KEY, k); flash(btnSaveKey, '✓ Guardado'); }
});

const btnTestKey = document.getElementById('btnTestKey');
const apikeyHint = document.getElementById('apikeyHint');

btnTestKey.addEventListener('click', async () => {
  const k = apiKeyInput.value.trim() || localStorage.getItem(STORED_KEY) || '';
  if (!k) { apikeyHint.textContent = '⚠ Ingresá una API Key primero'; apikeyHint.style.color = '#c0392b'; return; }
  btnTestKey.disabled = true;
  btnTestKey.textContent = '⏳';
  apikeyHint.textContent = 'Verificando...';
  apikeyHint.style.color = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': k,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.ok) {
      apikeyHint.textContent = '✓ Key válida';
      apikeyHint.style.color = '#2e7d52';
      localStorage.setItem(STORED_KEY, k);
    } else {
      const err = await res.json().catch(() => ({}));
      apikeyHint.textContent = `✗ Error ${res.status}: ${err.error?.message || res.statusText}`;
      apikeyHint.style.color = '#c0392b';
    }
  } catch(e) {
    apikeyHint.textContent = '✗ ' + e.message;
    apikeyHint.style.color = '#c0392b';
  }
  btnTestKey.disabled = false;
  btnTestKey.textContent = 'Verificar';
});

function flash(btn, msg) {
  const orig = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

/* ════════════════════════════════════════════════════════════════════════
   GOOGLE SHEETS — config panel
   ════════════════════════════════════════════════════════════════════════ */
(function initGoogleSheets() {
  const clientIdInput = document.getElementById('gsClientId');
  const sheetIdInput  = document.getElementById('gsSheetId');
  const btnSave       = document.getElementById('btnGsSave');
  const btnConnect    = document.getElementById('btnGsConnect');
  const statusDot     = document.getElementById('gsStatusDot');
  const hint          = document.getElementById('gsHint');

  if (!clientIdInput) return;   // panel not present

  // Restore saved values
  clientIdInput.value = gsGetClientId();
  sheetIdInput.value  = gsGetSheetId();
  updateGsDot();

  function updateGsDot() {
    const connected = gsIsConnected();
    statusDot.className = `gs-dot gs-dot--${connected ? 'on' : 'off'}`;
    statusDot.title     = connected ? 'Conectado a Google' : 'No conectado';
    btnConnect.textContent = connected ? 'Reconectar' : 'Conectar';
    if (connected) {
      hint.textContent  = '✓ Conectado — las operaciones se registrarán automáticamente';
      hint.style.color  = '#1a6b3c';
    } else {
      hint.textContent  = 'Configurá para registrar operaciones automáticamente';
      hint.style.color  = '';
    }
  }

  btnSave.addEventListener('click', () => {
    gsSetClientId(clientIdInput.value);
    gsSetSheetId(sheetIdInput.value);
    flash(btnSave, '✓ Guardado');
  });

  btnConnect.addEventListener('click', async () => {
    gsSetClientId(clientIdInput.value);
    gsSetSheetId(sheetIdInput.value);
    const cid = gsGetClientId();
    if (!cid) { hint.textContent = '⚠ Ingresá el Client ID primero'; hint.style.color = '#c0392b'; return; }
    btnConnect.disabled = true;
    hint.textContent = '⏳ Abriendo Google...';
    hint.style.color = '';
    try {
      await gsConnect();
      updateGsDot();
    } catch (e) {
      hint.textContent = '✗ ' + e.message;
      hint.style.color = '#c0392b';
    }
    btnConnect.disabled = false;
  });
})();

/* ── Sync operation to Google Sheets (called after each generation) ──────── */
async function syncOperationToSheets(map, stage) {
  if (!gsIsConnected() || !gsGetSheetId()) return;  // silently skip if not configured
  try {
    const result = await gsSyncOperation(map, stage);
    showGsToast(result.action === 'created'
      ? `✅ Operación ${map.REF_OPE} registrada en Google Sheets`
      : `🔄 Operación ${map.REF_OPE} actualizada en Google Sheets`
    );
  } catch (e) {
    showGsToast(`⚠ Sheets: ${e.message}`, true);
    console.warn('Google Sheets sync error:', e);
  }
}

function showGsToast(msg, isError = false) {
  let toast = document.getElementById('gsToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'gsToast';
    document.body.appendChild(toast);
  }
  toast.textContent  = msg;
  toast.className    = `gs-toast ${isError ? 'gs-toast--error' : ''}`;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

// ── Borrar operación guardada ──────────────────────────────────────────────
document.getElementById('btnClearOp')?.addEventListener('click', () => {
  clearSavedOperation();
  currentMap = currentCantOrig = currentStage = null;
  document.getElementById('savedOpBanner').classList.add('hidden');
  certsCard.classList.add('hidden');
});

// ── Restaurar operación guardada al cargar la página ──────────────────────
restoreOperation();

/* ════════════════════════════════════════════════════════════════════════
   FILE UPLOAD & DRAG-DROP
   ════════════════════════════════════════════════════════════════════════ */
dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop',      e  => { e.preventDefault(); dropzone.classList.remove('drag-over'); addFiles([...e.dataTransfer.files]); });
fileInput.addEventListener('change',   ()  => { addFiles([...fileInput.files]); fileInput.value = ''; });

function addFiles(files) {
  for (const f of files) {
    if (!selectedFiles.some(x => x.name === f.name && x.size === f.size)) selectedFiles.push(f);
  }
  renderFileList();
}

function removeFile(i) { selectedFiles.splice(i, 1); renderFileList(); }

function renderFileList() {
  fileList.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-badge ${badgeCls(ext)}">${ext}</span>
      <span class="file-size">${fmtSize(f.size)}</span>
      <button class="btn-remove" data-i="${i}">✕</button>`;
    li.querySelector('.btn-remove').addEventListener('click', () => removeFile(i));
    fileList.appendChild(li);
  });
}

function badgeCls(ext) {
  if (ext === 'pdf') return 'badge-pdf';
  if (['xlsx','xls'].includes(ext)) return 'badge-xlsx';
  if (['docx','doc'].includes(ext)) return 'badge-docx';
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return 'badge-img';
  return 'badge-other';
}
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ════════════════════════════════════════════════════════════════════════
   FILE PARSING  (browser side)
   ════════════════════════════════════════════════════════════════════════ */

/** Read file as ArrayBuffer */
function readArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

/** Read file as base64 (for PDFs sent to Claude) */
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result.split(',')[1]); // strip data:...;base64,
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Parse XLSX → CSV text using SheetJS */
async function parseXlsx(file) {
  const ab = await readArrayBuffer(file);
  const wb = XLSX.read(ab, { type: 'array' });
  const lines = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { defval: '' });
    if (csv.trim()) { lines.push(`=== Hoja: ${name} ===`); lines.push(csv); }
  }
  return lines.join('\n');
}

/** Parse DOCX → plain text using JSZip (extract word/document.xml) */
async function parseDocx(file) {
  const ab = await readArrayBuffer(file);
  const zip = await JSZip.loadAsync(ab);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) return '';
  const xml = await xmlFile.async('text');
  return xml
    .replace(/<w:p[ >]/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

const IMAGE_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

/**
 * Build Claude message content blocks from the selected files.
 * PDFs    → document block (base64, Claude reads natively, including scanned PDFs).
 * Images  → image block  (base64, Claude sees the image directly).
 * XLSX    → text block   (CSV via SheetJS).
 * DOCX    → text block   (XML extraction).
 */
async function buildContentBlocks(note) {
  const blocks = [];
  for (const file of selectedFiles) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
      const b64 = await readBase64(file);
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: b64 },
        title: file.name,
      });

    } else if (IMAGE_MIME[ext]) {
      // Image files (jpg, png, etc.) — sent as vision blocks so Claude can read them
      const b64 = await readBase64(file);
      blocks.push({
        type: 'text',
        text: `=== IMAGEN: ${file.name} (nómina / documento escaneado) ===`,
      });
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: IMAGE_MIME[ext], data: b64 },
      });

    } else if (['xlsx','xls'].includes(ext)) {
      const text = await parseXlsx(file);
      blocks.push({ type: 'text', text: `=== DOCUMENTO: ${file.name} ===\n${text}` });

    } else if (['docx','doc'].includes(ext)) {
      const text = await parseDocx(file);
      blocks.push({ type: 'text', text: `=== DOCUMENTO: ${file.name} ===\n${text}` });

    } else {
      const text = await file.text();
      blocks.push({ type: 'text', text: `=== DOCUMENTO: ${file.name} ===\n${text}` });
    }
  }
  const suffix = note ? `\nNota del usuario: ${note}` : '';
  blocks.push({ type: 'text', text: `Extrae todos los datos y devuelve SOLO el JSON solicitado.${suffix}` });
  return blocks;
}

/* ════════════════════════════════════════════════════════════════════════
   CLAUDE API CALL
   ════════════════════════════════════════════════════════════════════════ */

const SYSTEM_PROMPT = `Eres un especialista en comercio exterior argentino.
Recibirás documentos de una operación de exportación (PE, Booking, Contrato, Cierre, Nómina, etc.).
Extrae TODOS los datos relevantes y devuelve EXCLUSIVAMENTE un JSON válido con esta estructura (sin markdown, sin explicaciones):

REGLAS DE PRIORIDAD:
- PE manda sobre todo para: pesos, bultos, bolsas, FOB, Incoterm, Aduana, Posición arancelaria, ATA, Despachante.
- Booking: Vessel, Voyage, POL, POD, Terminal, días libres, cantidad contenedores.
- Contrato/Cierre: Consignee, Notify, dirección completa, Payment term, BL TELEX.
- Nómina (xlsx): contenedor, chofer, DNI, tractor, semi, precinto. El precinto de la nómina es SIEMPRE precinto_linea; el campo precinto_aduana siempre queda "" (se completa manualmente).
REGLAS FIJAS:
- notify_name y notify_address = consignee_name y consignee_address siempre.
- metros_cubicos: SIEMPRE 32 por contenedor.
- bolsas: usar PE; si no → 1000/contenedor. NUNCA 1 ni 2.
- peso_neto default: 25000 kg/contenedor. peso_bruto default: 25050.
- Proforma: cantidad en KGS, precio en USD/KG.
- cantidad_originales: "3", excepto si BL es TELEX → "TELEX".
- posicion_arancelaria: número arancelario completo tal como aparece en el PE (ej: "0713310000"); sin espacios ni puntos. La app extrae los 6 primeros dígitos cuando los necesita.
- goods_description y producto: SOLO el nombre comercial del producto. NO incluir calibre, granulometría, cosecha, condiciones de calidad, humedad, ni especificaciones técnicas. Ejemplos correctos: "Green Mung Beans", "Split Green Mung Bean", "Chickpea 8mm", "Split Chickpea". Ejemplos INCORRECTOS: "Argentina Green Mung Beans, 3.5mm UP, 2025 Crop, Sortex clean..." o cualquier texto con especificaciones de calidad.
- Regla de nombres: Poroto mung entero→"Green Mung Beans", partido→"Split Green Mung Bean", Garbanzo entero→"Chickpea" + calibre si aparece en el nombre del producto, partido→"Split Chickpea".
- aduana: desde PE; si no hay PE → "Aduana Córdoba".
- cliente_nombre/direccion: desde Contrato o Cierre (NO usar exportador).
- fecha: dejar vacío "" siempre (la app pone la fecha de hoy).
- contract_ref: número/referencia del contrato o cierre de venta.
- packing_type: tipo de envase (ej: "25 KG PP BAGS", "50 KG JUTE BAGS"); "" si no aparece.
- crop: año de cosecha del producto (ej: "2025", "2024/2025 Crop"); "" si no aparece.
- caliber: calibre o granulometría del producto (ej: "8mm", "3.5mm UP", "7mm+"); "" si no aparece.
- consolidation_date: fecha de estiba/consolidación; formato como aparezca en el documento.
- consolidation_place: lugar de consolidación; default "Sinsacate, Córdoba, Argentina".
- moisture_spec, undersize_spec, splits_spec, foreign_matter_spec, total_defects_spec: tolerancias de calidad del contrato. SIEMPRE tomarlas del mail o documento de cierre de negocio (no de otros documentos). Valores numéricos como "14", "5"; "" si no aparecen.

ESTRUCTURA JSON:
{
  "stage_detected": 1,
  "ref_ope": "",
  "vessel": "",
  "voyage": "",
  "pol": "",
  "pod": "",
  "destination": "",
  "flag": "",
  "booking": "",
  "terminal": "",
  "agencia": "",
  "dias_libres": "",
  "permiso_embarque": "",
  "aduana": "",
  "ata": "",
  "ata_cuit": "",
  "despachante": "",
  "consignee_name": "",
  "consignee_address": "",
  "notify_name": "",
  "notify_address": "",
  "cliente_nombre": "",
  "cliente_direccion": "",
  "payment_term": "",
  "incoterm": "",
  "currency": "USD",
  "bl_telex": false,
  "cantidad_originales": "3",
  "goods_description": "",
  "producto": "",
  "posicion_arancelaria": "",
  "fob_total": "",
  "fob_unitario": "",
  "num_containers": 1,
  "containers": [
    {
      "n": 1,
      "contenedor": "",
      "precinto_aduana": "",
      "precinto_linea": "",
      "bultos": "",
      "bolsas": "",
      "peso_neto": "",
      "peso_bruto": "",
      "nombre": "",
      "apellido": "",
      "dni": "",
      "tractor": "",
      "semi": ""
    }
  ],
  "total_bultos": "",
  "total_neto": "",
  "total_bruto": "",
  "total_bolsas": "",
  "pf_description": "",
  "pf_quantity": "",
  "pf_unit_value": "",
  "pf_total": "",
  "total_valor": "",
  "contract_ref": "",
  "shipper_name": "Oscar Peman y Asociados S.A.",
  "packing_type": "",
  "consolidation_date": "",
  "consolidation_place": "Sinsacate, Córdoba, Argentina",
  "moisture_spec": "",
  "undersize_spec": "",
  "splits_spec": "",
  "foreign_matter_spec": "",
  "total_defects_spec": "",
  "crop": "",
  "caliber": ""
}`;

async function callClaude(apiKey, note) {
  const blocks = await buildContentBlocks(note);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: blocks }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic API error ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const json = await res.json();
  const raw = json.content[0].text.trim().replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'');
  try { return JSON.parse(raw); }
  catch { throw new Error('Claude devolvió JSON inválido:\n' + raw.slice(0, 300)); }
}

/* ════════════════════════════════════════════════════════════════════════
   PEMAN RULES  (applied after Claude extraction)
   ════════════════════════════════════════════════════════════════════════ */

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio',
                   'julio','agosto','septiembre','octubre','noviembre','diciembre'];

function todayFecha() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function todayFechaLarga() {
  const d = new Date();
  return `Sinsacate, ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Append " %" to a value if non-empty and not already containing "%" */
function withPct(val) {
  const s = String(val ?? '').trim();
  if (s === '' || s === null) return '';
  return s.includes('%') ? s : s + ' %';
}

function applyRules(data) {
  const MAX = 10;
  const hasPermit = !!(data.permiso_embarque && data.permiso_embarque.trim());
  const hasNomina = data.containers && data.containers.some(c => c.nombre || c.tractor);
  const stage = hasPermit || hasNomina ? 2 : 1;

  const aduana = (data.aduana && data.aduana.trim()) || 'Aduana Córdoba';
  const consigneeName    = data.consignee_name    || '';
  const consigneeAddress = data.consignee_address || '';
  const isTelex = data.bl_telex === true || String(data.bl_telex).toUpperCase() === 'TELEX';
  const cantOrig = isTelex ? 'TELEX' : (data.cantidad_originales || '3');

  const numContainers = Math.max(1, Number(data.num_containers) || (data.containers?.length ?? 1));
  const inC = data.containers || [];
  const containers = [];
  for (let i = 0; i < numContainers; i++) {
    const s = inC[i] || {};
    const bolsas   = (s.bolsas && Number(s.bolsas) > 2)  ? String(s.bolsas)   : '1000';
    const pesoNeto  = (s.peso_neto  && String(s.peso_neto).trim())  ? String(s.peso_neto)  : '25000';
    const pesoBruto = (s.peso_bruto && String(s.peso_bruto).trim()) ? String(s.peso_bruto) : '25050';
    containers.push({ n:i+1, contenedor:s.contenedor||'',
      precinto_linea:s.precinto_linea||s.precinto_aduana||'',
      precinto_aduana:'',
      bultos:bolsas, bolsas, peso_neto:pesoNeto,
      peso_bruto:pesoBruto, nombre:s.nombre||'', apellido:s.apellido||'',
      dni:s.dni||'', tractor:s.tractor||'', semi:s.semi||'' });
  }

  const totalBolsas = (data.total_bolsas && Number(data.total_bolsas) > 2)
    ? String(data.total_bolsas)
    : String(containers.reduce((s,c) => s + Number(c.bolsas), 0));
  const totalNeto  = (data.total_neto  && String(data.total_neto).trim())  ? String(data.total_neto)  : String(containers.reduce((s,c) => s + Number(c.peso_neto), 0));
  const totalBruto = (data.total_bruto && String(data.total_bruto).trim()) ? String(data.total_bruto) : String(containers.reduce((s,c) => s + Number(c.peso_bruto), 0));
  const rawPos = String(data.posicion_arancelaria || '');
  const posicion     = rawPos.replace(/\D/g,'').slice(0,6);
  const posicionFull = rawPos.replace(/\D/g,'');  // full number for cert origin
  const vesselVoyage = [data.vessel, data.voyage].filter(Boolean).join(' / ');
  const pfDesc = data.pf_description || data.goods_description || data.producto || '';
  const pfQty  = data.pf_quantity  || `${totalNeto} KGS`;
  const pfUnit = data.pf_unit_value || (data.fob_unitario ? `${data.fob_unitario} USD/KG` : '');
  const pfTot  = data.pf_total || data.total_valor || data.fob_total || '';

  const map = {
    REF_OPE:data.ref_ope||'', FECHA:todayFecha(), FECHA_LARGA:todayFechaLarga(),
    VESSEL:data.vessel||'', VOYAGE:data.voyage||'', VESSEL_VOYAGE:vesselVoyage,
    POL:data.pol||'', POD:data.pod||'', DESTINATION:data.destination||'',
    FLAG:data.flag||'', BOOKING:data.booking||'', TERMINAL:data.terminal||'',
    AGENCIA:data.agencia||'', DIAS_LIBRES:data.dias_libres||'',
    PERMISO_EMBARQUE:data.permiso_embarque||'', ADUANA:aduana,
    ATA:data.ata||'', ATA_CUIT:data.ata_cuit||'', DESPACHANTE:data.despachante||'',
    CANTIDAD_ORIGINALES:cantOrig, POSICION_ARANCELARIA:posicion, POSICION_ARANCELARIA_FULL:posicionFull,
    CONSIGNEE_NAME:consigneeName, CONSIGNEE_ADDRESS:consigneeAddress,
    NOTIFY_NAME:consigneeName, NOTIFY_ADDRESS:consigneeAddress,
    CONSIGNEE_NOMBRE:consigneeName, CONSIGNEE_DIRECCION:consigneeAddress,
    NOTIFY_NOMBRE:consigneeName, NOTIFY_DIRECCION:consigneeAddress,
    CLIENTE_NOMBRE:data.cliente_nombre||consigneeName,
    CLIENTE_DIRECCION:data.cliente_direccion||consigneeAddress,
    CLIENTE_NAME:data.cliente_nombre||consigneeName,
    CLIENTE_ADDRESS:data.cliente_direccion||consigneeAddress,
    INCOTERM:data.incoterm||'', PAYMENT_TERM:data.payment_term||'', CURRENCY:data.currency||'USD',
    GOODS_DESCRIPTION:data.goods_description||data.producto||'',
    PRODUCT:data.goods_description||data.producto||'',
    PRODUCTO:data.producto||data.goods_description||'',
    TOTAL_BULTOS:totalBolsas, TOTAL_NETO:totalNeto, TOTAL_BRUTO:totalBruto, TOTAL_BOLSAS:totalBolsas,
    PF_ITEM_1:'1', PF_DESCRIPTION_1:pfDesc, PF_QUANTITY_1:pfQty, 'PF_UNIT VALUE_1':pfUnit, PF_TOTAL_1:pfTot,
    PF_ITEM_2:'', PF_DESCRIPTION_2:'', PF_QUANTITY_2:'', 'PF_UNIT VALUE_2':'', PF_TOTAL_2:'',
    PF_ITEM_3:'', PF_DESCRIPTION_3:'', PF_QUANTITY_3:'', 'PF_UNIT VALUE_3':'', PF_TOTAL_3:'',
    TOTAL_VALOR:pfTot,
    // Cert header fields
    SENDER_CITY:'Sinsacate, Córdoba',
    ISSUE_DATE:todayFecha(),
    REF_CONTRACT:'',
    SHIPPER:'OSCAR PEMAN Y ASOCIADOS S.A.',
    CLIENT:data.cliente_nombre||consigneeName,
    CLIENT_ADDRESS_LINE_1:(()=>{ const a=(data.cliente_direccion||consigneeAddress||'').trim(); const i=a.indexOf(','); return i>=0?a.slice(0,i).trim():a; })(),
    CLIENT_ADDRESS_LINE_2:(()=>{ const a=(data.cliente_direccion||consigneeAddress||'').trim(); const i=a.indexOf(','); return i>=0?a.slice(i+1).trim():''; })(),
    LOADING_PORT:data.pol||'',
    DESTINATION_PORT:data.pod||'',
    PACKING:data.packing_type||'',
    CROP:data.crop||'',
    CALIBER:data.caliber||'',
    CONSOLIDATION_DATE:data.consolidation_date||'',
    CONSOLIDATION_PLACE:data.consolidation_place||'Sinsacate, Córdoba, Argentina',
    // Quality specs — keys match template placeholders exactly (mixed-case), values in %
    'Moisture':withPct(data.moisture_spec),
    'Udersize':withPct(data.undersize_spec),
    'Splits':withPct(data.splits_spec),
    'Foreign Matter':withPct(data.foreign_matter_spec),
    'Total defects':withPct(data.total_defects_spec),
    // Fumigation cert: list of all container numbers (comma-separated)
    CONTAINERS_NUMBERS:containers.filter(c=>c.contenedor).map(c=>c.contenedor).join(', '),
    'CONTAINERS_ NUMBERS':containers.filter(c=>c.contenedor).map(c=>c.contenedor).join(', '),
  };

  for (let i = 1; i <= MAX; i++) {
    const c = containers[i-1];
    if (c) {
      map[`CONTENEDOR_${i}`]=c.contenedor; map[`PRECINTO_ADUANA_${i}`]=c.precinto_aduana;
      map[`PRECINTO_LINEA_${i}`]=c.precinto_linea; map[`SEAL_CUSTOMS_${i}`]=c.precinto_aduana;
      map[`BULTOS_${i}`]=c.bultos; map[`BOLSAS_${i}`]=c.bolsas; map[`BAGS_${i}`]=c.bolsas;
      map[`PESO_NETO_${i}`]=c.peso_neto; map[`PESO_BRUTO_${i}`]=c.peso_bruto;
      map[`NET_WEIGHT_${i}`]=c.peso_neto; map[`GROSS_WEIGHT_${i}`]=c.peso_bruto;
      map[`METROS_CUBICOS_${i}`]='32';
      map[`NOMBRE_${i}`]=c.nombre; map[`APELLIDO_${i}`]=c.apellido;
      map[`DNI_${i}`]=c.dni; map[`TRACTOR_${i}`]=c.tractor; map[`SEMI_${i}`]=c.semi;
      map[`P_NETO_${i}`]=c.peso_neto; map[`P_BRUTO_${i}`]=c.peso_bruto;
      map[`PRODUCTO_${i}`]=data.producto||data.goods_description||'';
      // Cert aliases
      map[`CONTAINER_${i}`]=c.contenedor; map[`TOTAL_BAGS_${i}`]=c.bolsas;
      map[`NET_WEIGHT_KG_${i}`]=c.peso_neto; map[`GROSS_WEIGHT_KG_${i}`]=c.peso_bruto;
      map[`OP_SAMPLE_${i}`]=''; map[`MOISTURE_${i}`]=''; map[`BELOW_SIEVE_35_${i}`]='';
      map[`SPLITS_${i}`]=''; map[`FOREIGN_MATTER_${i}`]=''; map[`TOTAL_DEFECTS_${i}`]='';
    } else {
      for (const k of [`CONTENEDOR_${i}`,`PRECINTO_ADUANA_${i}`,`PRECINTO_LINEA_${i}`,
        `SEAL_CUSTOMS_${i}`,`BULTOS_${i}`,`BOLSAS_${i}`,`BAGS_${i}`,`PESO_NETO_${i}`,
        `PESO_BRUTO_${i}`,`NET_WEIGHT_${i}`,`GROSS_WEIGHT_${i}`,`METROS_CUBICOS_${i}`,
        `NOMBRE_${i}`,`APELLIDO_${i}`,`DNI_${i}`,`TRACTOR_${i}`,`SEMI_${i}`,
        `P_NETO_${i}`,`P_BRUTO_${i}`,`PRODUCTO_${i}`,
        `CONTAINER_${i}`,`TOTAL_BAGS_${i}`,`NET_WEIGHT_KG_${i}`,`GROSS_WEIGHT_KG_${i}`,
        `OP_SAMPLE_${i}`,`MOISTURE_${i}`,`BELOW_SIEVE_35_${i}`,
        `SPLITS_${i}`,`FOREIGN_MATTER_${i}`,`TOTAL_DEFECTS_${i}`]) map[k] = '';
    }
  }

  return { map, stage, numContainers, isTelex, cantOrig };
}

/* ════════════════════════════════════════════════════════════════════════
   EXCEL TEMPLATE FILLING  (JSZip, browser-side)
   ════════════════════════════════════════════════════════════════════════ */

function xmlEscape(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function replacePlaceholders(xml, map) {
  for (const [key, val] of Object.entries(map)) {
    xml = xml.split(`[${key}]`).join(xmlEscape(String(val ?? '')));
  }
  return xml;
}

async function patchCantidadOriginales(zip, cantOrig) {
  if (cantOrig !== 'TELEX') return; // default is already 3 in the template
  const ssPath = 'xl/sharedStrings.xml';
  const wsPath = 'xl/worksheets/sheet1.xml';
  let ss = await zip.file(ssPath)?.async('text');
  let ws = await zip.file(wsPath)?.async('text');
  if (!ss || !ws) return;

  const countM  = ss.match(/count="(\d+)"/);
  const uniqueM = ss.match(/uniqueCount="(\d+)"/);
  const newIdx  = uniqueM ? parseInt(uniqueM[1], 10) : 0;
  ss = ss.replace('</sst>', '<si><t>TELEX</t></si></sst>');
  if (countM)  ss = ss.replace(`count="${countM[1]}"`,    `count="${parseInt(countM[1],10)+1}"`);
  if (uniqueM) ss = ss.replace(`uniqueCount="${uniqueM[1]}"`, `uniqueCount="${newIdx+1}"`);
  ws = ws.replace(/<c r="K17"([^>]*)><v>3<\/v><\/c>/, `<c r="K17"$1 t="s"><v>${newIdx}</v></c>`);

  zip.file(ssPath, ss);
  zip.file(wsPath, ws);
}

async function fillTemplate(templateKey, map, opts = {}) {
  const b64 = TEMPLATE_DATA[templateKey];
  if (!b64) throw new Error(`Template no encontrado: ${templateKey}`);

  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const zip   = await JSZip.loadAsync(bytes);

  // Replace in sharedStrings
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    let ss = await ssFile.async('text');
    ss = replacePlaceholders(ss, map);
    zip.file('xl/sharedStrings.xml', ss);
  }

  // Replace in all worksheets
  const wsFiles = Object.keys(zip.files).filter(n => n.startsWith('xl/worksheets/') && n.endsWith('.xml'));
  for (const name of wsFiles) {
    let ws = await zip.file(name).async('text');
    ws = replacePlaceholders(ws, map);
    zip.file(name, ws);
  }

  // Special patch for Declaracion de Embarque
  if (templateKey === 'declaracion_embarque' && opts.cantOrig) {
    await patchCantidadOriginales(zip, opts.cantOrig);
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function fillAll(stage, map, cantOrig) {
  const results = [];

  // Build filename with operation number
  const ref = (map.REF_OPE || '').trim();
  const named     = (label) => ref ? `${label} ${ref}.xlsx` : `${label}.xlsx`;
  const namedDocx = (label) => ref ? `${label} ${ref}.docx` : `${label}.docx`;

  const add = async (label, key, extra = {}) => {
    try {
      const blob = await fillTemplate(key, map, extra);
      results.push({ filename: named(label), blob });
    } catch (e) { console.error(`Error filling ${key}:`, e); }
  };

  const addDocx = async (label, genFn) => {
    try {
      const blob = await genFn(map);
      results.push({ filename: namedDocx(label), blob });
    } catch (e) { console.error(`Error generating ${label}:`, e); }
  };

  if (stage === 1) {
    await add('Packing List Aduana',   'packing_list_aduana');
    await add('Proforma',              'proforma');
  } else if (stage === 2) {
    await add('Resumen de Carga',          'resumen_carga');
    await add('Packing List Comercial',    'packing_list_comercial');
    await add('Declaracion de Embarque',   'declaracion_embarque', { cantOrig });
  } else if (stage === 3) {
    await add('Packing List Aduana',       'packing_list_aduana');
    await add('Proforma',                  'proforma');
    await add('Resumen de Carga',          'resumen_carga');
    await add('Packing List Comercial',    'packing_list_comercial');
    await add('Declaracion de Embarque',   'declaracion_embarque', { cantOrig });
    await addDocx('Certificado de Origen', generateCertOrigin);
  } else if (stage === 'solo_proforma') {
    await add('Proforma',                  'proforma');
  } else if (stage === 'solo_packing_aduana') {
    await add('Packing List Aduana',       'packing_list_aduana');
  } else if (stage === 'solo_packing_comercial') {
    await add('Packing List Comercial',    'packing_list_comercial');
  } else if (stage === 'solo_declaracion') {
    await add('Declaracion de Embarque',   'declaracion_embarque', { cantOrig });
  } else if (stage === 'solo_resumen') {
    await add('Resumen de Carga',          'resumen_carga');
  } else if (stage === 'solo_cert_origen') {
    await addDocx('Certificado de Origen', generateCertOrigin);
  }
  return results;
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN FLOW
   ════════════════════════════════════════════════════════════════════════ */
btnGenerate.addEventListener('click', analyze);

/* ── Step 1: Analyze documents with Claude ───────────────────────────────── */
async function analyze() {
  hideError();
  summaryCard.classList.add('hidden');
  comercialCard.classList.add('hidden');
  certsCard.classList.add('hidden');
  downloadButtons.innerHTML = '';

  const apiKey = apiKeyInput.value.trim() || localStorage.getItem(STORED_KEY) || '';
  if (!apiKey) { showError('Ingresá tu Anthropic API Key antes de continuar.'); return; }
  if (selectedFiles.length === 0) { showError('Adjuntá al menos un documento de la operación.'); return; }

  btnGenerate.disabled = true;
  try {
    setProgress(true, 'Enviando documentos a Claude para análisis…', 15);
    const extracted = await callClaude(apiKey, noteInput.value.trim());

    setProgress(true, 'Aplicando reglas PEMAN…', 80);
    const { map, stage, cantOrig } = applyRules(extracted);

    const sel = stageSelect.value;
    const manualStage = sel
      ? (sel.startsWith('solo_') ? sel : parseInt(sel, 10))
      : stage;

    setProgress(true, '¡Listo!', 100);
    setTimeout(() => setProgress(false), 600);

    currentMap      = map;
    currentCantOrig = cantOrig;
    currentStage    = manualStage;
    saveOperation(map, cantOrig, manualStage);
    syncOperationToSheets(map, manualStage);

    document.getElementById('savedOpBanner')?.classList.add('hidden');

    renderSummary(map, manualStage, cantOrig);

    // Show both action sections
    comercialCard.classList.remove('hidden');
    certsCard.classList.remove('hidden');
    document.getElementById('comercialGenArea').classList.remove('hidden');

  } catch (err) {
    setProgress(false);
    showError(err.message);
    console.error(err);
  } finally {
    btnGenerate.disabled = false;
  }
}

/* ── Step 2a: Generate commercial documents ──────────────────────────────── */
document.getElementById('btnGenComercial').addEventListener('click', async () => {
  const btn = document.getElementById('btnGenComercial');
  btn.disabled = true;
  btn.textContent = '⏳ Generando...';
  hideError();
  try {
    setProgress(true, 'Completando plantillas…', 50);
    const selVal    = stageSelect.value;
    const stageNow  = selVal ? (selVal.startsWith('solo_') ? selVal : parseInt(selVal, 10)) : currentStage;
    const files = await fillAll(stageNow, currentMap, currentCantOrig);
    setProgress(true, '¡Listo!', 100);
    setTimeout(() => setProgress(false), 600);
    renderDownloads(files);
    document.getElementById('comercialGenArea').classList.add('hidden');
  } catch(err) {
    setProgress(false);
    showError(err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚙️ Generar documentos comerciales';
  }
});

/* ════════════════════════════════════════════════════════════════════════
   UI HELPERS
   ════════════════════════════════════════════════════════════════════════ */

function setProgress(visible, msg = '', pct = 0) {
  progressArea.classList.toggle('hidden', !visible);
  if (visible) { progressBar.style.width = pct + '%'; progressMsg.textContent = msg; }
}

const STAGE_LABELS = {
  1: 'Etapa 1 — Packing List Aduana + Proforma',
  2: 'Etapa 2 — Resumen de Carga + Packing List Comercial + Declaración de Embarque',
  3: 'Etapa 3 — Todos los documentos',
};

function renderSummary(map, stage, cantOrig) {
  summaryContent.innerHTML = '';

  const badge = document.createElement('div');
  badge.className = `stage-badge stage-${stage}`;
  badge.textContent = STAGE_LABELS[stage] || `Etapa ${stage}`;
  summaryContent.appendChild(badge);

  // Each field: [label, mapKey, aliasKeys]
  const fields = [
    ['Operación',        'REF_OPE',              []],
    ['Buque',            'VESSEL',               []],
    ['Viaje',            'VOYAGE',               []],
    ['Booking',          'BOOKING',              []],
    ['Puerto carga',     'POL',                  []],
    ['Puerto descarga',  'POD',                  []],
    ['Consignee',        'CONSIGNEE_NAME',       ['NOTIFY_NAME','CONSIGNEE_NOMBRE','NOTIFY_NOMBRE']],
    ['Aduana',           'ADUANA',               []],
    ['Permiso Emb.',     'PERMISO_EMBARQUE',     []],
    ['ATA',              'ATA',                  []],
    ['Despachante',      'DESPACHANTE',          []],
    ['Incoterm',         'INCOTERM',             []],
    ['Prod. (EN)',       'GOODS_DESCRIPTION',    ['PRODUCT','PRODUCTO']],
    ['Pos. aranc.',      'POSICION_ARANCELARIA', []],
    ['Peso neto (kg)',   'TOTAL_NETO',           []],
    ['Peso bruto (kg)',  'TOTAL_BRUTO',          []],
  ];

  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  grid.style.gridColumn = '1 / -1';

  for (const [label, key, aliases] of fields) {
    if (!map[key]) continue;
    const d = document.createElement('div');
    d.className = 'summary-item';
    d.innerHTML = `<div class="summary-label">${esc(label)}</div>`;
    const inp = document.createElement('input');
    inp.type  = 'text';
    inp.value = String(map[key]);
    inp.className = 'summary-edit';
    inp.addEventListener('input', () => {
      map[key] = inp.value;
      aliases.forEach(a => { map[a] = inp.value; });
      if (key === 'VESSEL' || key === 'VOYAGE')
        map.VESSEL_VOYAGE = [map.VESSEL, map.VOYAGE].filter(Boolean).join(' / ');
    });
    d.appendChild(inp);
    grid.appendChild(d);
  }

  // Containers — número de contenedor + precinto aduana, ambos editables
  const contNums = [1,2,3,4,5,6,7,8,9,10].filter(i => map[`CONTENEDOR_${i}`]);
  if (contNums.length) {
    const d = document.createElement('div');
    d.className = 'summary-item cont-block';

    const lbl = document.createElement('div');
    lbl.className = 'summary-label';
    lbl.textContent = `Contenedores (${contNums.length})`;
    d.appendChild(lbl);

    // Header row
    const hdr = document.createElement('div');
    hdr.className = 'cont-row cont-header-row';
    hdr.innerHTML = '<span>Contenedor</span><span>Precinto Aduana</span>';
    d.appendChild(hdr);

    contNums.forEach(i => {
      const row = document.createElement('div');
      row.className = 'cont-row';

      const inpCont = document.createElement('input');
      inpCont.type        = 'text';
      inpCont.value       = map[`CONTENEDOR_${i}`] || '';
      inpCont.className   = 'summary-edit';
      inpCont.placeholder = `Contenedor ${i}`;
      inpCont.addEventListener('input', () => {
        map[`CONTENEDOR_${i}`]     = inpCont.value;
        map[`CONTAINER_${i}`]      = inpCont.value;
        map.CONTAINERS_NUMBERS = [1,2,3,4,5,6,7,8,9,10]
          .filter(n => map[`CONTENEDOR_${n}`]).map(n => map[`CONTENEDOR_${n}`]).join(', ');
        map['CONTAINERS_ NUMBERS'] = map.CONTAINERS_NUMBERS;
      });

      const inpPre = document.createElement('input');
      inpPre.type        = 'text';
      inpPre.value       = map[`PRECINTO_ADUANA_${i}`] || '';
      inpPre.className   = 'summary-edit';
      inpPre.placeholder = 'Precinto...';
      inpPre.addEventListener('input', () => {
        map[`PRECINTO_ADUANA_${i}`] = inpPre.value;
        map[`SEAL_CUSTOMS_${i}`]    = inpPre.value;
      });

      row.appendChild(inpCont);
      row.appendChild(inpPre);
      d.appendChild(row);
    });

    grid.appendChild(d);
  }

  summaryContent.appendChild(grid);

  // Regenerar button
  const regenRow = document.createElement('div');
  regenRow.style.cssText = 'margin-top:.75rem;display:flex;justify-content:flex-end;grid-column:1/-1;';
  const btnRegen = document.createElement('button');
  btnRegen.className = 'btn-secondary btn-sm';
  btnRegen.textContent = '↺ Regenerar con cambios';
  btnRegen.addEventListener('click', async () => {
    btnRegen.disabled = true;
    btnRegen.textContent = '⏳ Generando...';
    try {
      const selVal2   = stageSelect.value;
      const stageNow2 = selVal2 ? (selVal2.startsWith('solo_') ? selVal2 : parseInt(selVal2, 10)) : currentStage;
      const files = await fillAll(stageNow2, currentMap, currentCantOrig);
      renderDownloads(files);
      btnRegen.textContent = '✓ Documentos actualizados';
      setTimeout(() => { btnRegen.disabled = false; btnRegen.textContent = '↺ Regenerar con cambios'; }, 2500);
    } catch(e) {
      showError(e.message);
      btnRegen.disabled = false;
      btnRegen.textContent = '↺ Regenerar con cambios';
    }
  });
  regenRow.appendChild(btnRegen);
  summaryContent.appendChild(regenRow);

  summaryCard.classList.remove('hidden');
}


/* ── Render download buttons ─────────────────────────────────────────────── */
async function renderDownloads(files) {
  downloadButtons.innerHTML = '';

  for (const f of files) {
    const url     = URL.createObjectURL(f.blob);
    const isDocx  = /\.docx$/i.test(f.filename);
    const docName = f.filename.replace(/\.(xlsx|docx)$/i, '');

    const row = document.createElement('div');
    row.className = 'download-row';

    const label = document.createElement('span');
    label.className = 'download-doc-name';
    label.textContent = docName;

    const a = document.createElement('a');
    a.href      = url;
    a.download  = f.filename;
    a.className = isDocx ? 'btn-download docx' : 'btn-download xlsx';
    a.innerHTML = isDocx ? '📄 Descargar Word' : '📊 Descargar Excel';

    row.appendChild(label);
    row.appendChild(a);
    downloadButtons.appendChild(row);
  }

  // ZIP button when there are multiple files
  if (files.length > 1) {
    const ref     = (currentMap?.REF_OPE || '').trim();
    const zipName = ref ? `Documentos Comerciales ${ref}.zip` : 'Documentos Comerciales.zip';
    const zipBlob = await createZipBundle(files);
    const zipUrl  = URL.createObjectURL(zipBlob);

    const row = document.createElement('div');
    row.className = 'download-row';

    const label = document.createElement('span');
    label.className = 'download-doc-name';
    label.textContent = ref ? `Todos los documentos ${ref}` : 'Todos los documentos';

    const a = document.createElement('a');
    a.href      = zipUrl;
    a.download  = zipName;
    a.className = 'btn-download zip';
    a.innerHTML = '🗜 Descargar ZIP';

    row.appendChild(label);
    row.appendChild(a);
    downloadButtons.appendChild(row);
  }

  comercialCard.classList.remove('hidden');
  comercialCard.scrollIntoView({ behavior: 'smooth' });
}

function showError(msg) {
  errorBox.textContent = '⚠ ' + msg;
  errorBox.classList.remove('hidden');
  errorBox.scrollIntoView({ behavior: 'smooth' });
}
function hideError() { errorBox.classList.add('hidden'); }

/* ════════════════════════════════════════════════════════════════════════
   CERTIFICADOS DE CALIDAD MODULE
   ════════════════════════════════════════════════════════════════════════ */

const btnGenLab      = document.getElementById('btnGenLab');
const labDropzone    = document.getElementById('labDropzone');
const labFileInput   = document.getElementById('labFileInput');
const labFileName    = document.getElementById('labFileName');
const btnGenCerts    = document.getElementById('btnGenCerts');
const certsDownloads = document.getElementById('certsDownloads');

let labFile = null;

/* ── Lab file drag-drop ──────────────────────────────────────────────────── */
labFileInput.addEventListener('click', e => e.stopPropagation());
labDropzone.addEventListener('click', () => labFileInput.click());
labDropzone.addEventListener('dragover',  e => { e.preventDefault(); labDropzone.classList.add('drag-over'); });
labDropzone.addEventListener('dragleave', () => labDropzone.classList.remove('drag-over'));
labDropzone.addEventListener('drop', e => {
  e.preventDefault();
  labDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) setLabFile(f);
});
labFileInput.addEventListener('change', () => {
  if (labFileInput.files[0]) setLabFile(labFileInput.files[0]);
  labFileInput.value = '';
});

function setLabFile(f) {
  labFile = f;
  labFileName.textContent = `📎 ${f.name} (${fmtSize(f.size)})`;
  labFileName.classList.remove('hidden');
  btnGenCerts.disabled = false;
}

/* ── Subproceso 1: Generar Planilla para Laboratorio ─────────────────────── */
btnGenLab.addEventListener('click', async () => {
  if (!currentMap) { showError('Primero generá los documentos de la operación.'); return; }
  btnGenLab.disabled = true;
  btnGenLab.textContent = '⏳ Generando...';
  try {
    const blob = await fillLabTemplate(currentMap);
    const ref  = currentMap.REF_OPE ? ` ${currentMap.REF_OPE}` : '';
    triggerDownload(blob, `Planilla Laboratorio${ref}.xlsx`);
    btnGenLab.textContent = '✓ Descargado';
    setTimeout(() => { btnGenLab.disabled = false; btnGenLab.textContent = '📋 Descargar Planilla de Laboratorio'; }, 2000);
  } catch (e) {
    showError(e.message);
    btnGenLab.disabled = false;
    btnGenLab.textContent = '📋 Descargar Planilla de Laboratorio';
  }
});

/* ── Subproceso 2: Generar Certificados de Calidad ───────────────────────── */
btnGenCerts.addEventListener('click', async () => {
  if (!labFile) { showError('Subí la planilla con los resultados del laboratorio.'); return; }
  btnGenCerts.disabled = true;
  btnGenCerts.textContent = '⏳ Generando...';
  try {
    const files = await generateCertificates(labFile);
    renderCertsDownloads(files);
    // Sync lab results to Google Sheets (merges into existing row, only fills empty cells)
    syncOperationToSheets(currentMap, currentStage);
    btnGenCerts.textContent = '✓ Certificados generados';
    setTimeout(() => { btnGenCerts.disabled = false; btnGenCerts.textContent = '📄 Generar Certificados'; }, 2500);
  } catch (e) {
    showError(e.message);
    btnGenCerts.disabled = false;
    btnGenCerts.textContent = '📄 Generar Certificados';
  }
});

/* ── Fill lab xlsx template ──────────────────────────────────────────────── */
async function fillLabTemplate(map) {
  const bytes = Uint8Array.from(atob(LAB_TEMPLATE_B64), c => c.charCodeAt(0));
  const zip   = await JSZip.loadAsync(bytes);

  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    let ss = await ssFile.async('text');
    ss = replacePlaceholders(ss, map);
    zip.file('xl/sharedStrings.xml', ss);
  }

  const wsFiles = Object.keys(zip.files).filter(n => n.startsWith('xl/worksheets/') && n.endsWith('.xml'));
  for (const name of wsFiles) {
    let ws = await zip.file(name).async('text');
    ws = replacePlaceholders(ws, map);
    zip.file(name, ws);
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ── Parse completed lab xlsx ────────────────────────────────────────────── */
async function parseLab(file) {
  const ab   = await readArrayBuffer(file);
  const wb   = XLSX.read(ab, { type: 'array' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Build container-number → index lookup from currentMap
  const containerToIdx = {};
  for (let i = 1; i <= 10; i++) {
    const c = String(currentMap?.[`CONTAINER_${i}`] || '').trim().toUpperCase();
    if (c) containerToIdx[c] = i;
  }

  const results = {};
  // Scan all rows looking for container data (column A = container number)
  for (let r = 3; r < data.length; r++) {
    const row = data[r];
    if (!row || !String(row[0] ?? '').trim()) continue;
    const containerVal = String(row[0]).trim().toUpperCase();
    // Match by container name; fallback to row-position index
    const n = containerToIdx[containerVal] ?? (r - 2);
    if (n < 1 || n > 10) continue;
    results[`OP_SAMPLE_${n}`]      = String(row[2] ?? '');   // not a %
    results[`MOISTURE_${n}`]       = withPct(row[3]);
    results[`BELOW_SIEVE_35_${n}`] = withPct(row[4]);
    results[`SPLITS_${n}`]         = withPct(row[5]);
    results[`FOREIGN_MATTER_${n}`] = withPct(row[6]);
    results[`TOTAL_DEFECTS_${n}`]  = withPct(row[7]);
  }
  return results;
}

/* ── Split docx body by page-break paragraphs ────────────────────────────── */
/* ── Fix [CONTAINERS_NUMBERS] placeholder (may be split across XML runs) ─── */
function fixContainersNumbers(xml, value) {
  // Works at paragraph level: extract virtual text, detect placeholder, rebuild para
  return xml.replace(/<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, para => {
    const vText = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
    // Match [CONTAINERS_ NUMBERS] with optional space (already a flat string after run-join)
    if (!/\[CONTAINERS_\s*NUMBERS\]/i.test(vText)) return para;
    const newText = vText.replace(/\[CONTAINERS_\s*NUMBERS\]/gi, value);
    // Preserve paragraph opening tag, paragraph properties, and first run's properties
    const pOpen = para.match(/^(<w:p\b[^>]*>)/)?.[1] || '<w:p>';
    const pPr   = para.match(/(<w:pPr>[\s\S]*?<\/w:pPr>)/)?.[1] || '';
    const rPr   = para.match(/(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] || '';
    return `${pOpen}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(newText)}</w:t></w:r></w:p>`;
  });
}

/* ── Row removal helpers ─────────────────────────────────────────────────── */

/** Extract the concatenated plain text from all <w:t> elements in a row */
function rowText(rowXml) {
  return [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
}

/** Remove every <w:tr> whose concatenated text matches `pattern` */
function removeRowsByPattern(xml, pattern) {
  return xml.replace(/<w:tr\b[^>]*>(?:(?!<\/w:tr>)[\s\S])*?<\/w:tr>/g, row =>
    pattern.test(rowText(row)) ? '' : row
  );
}

/**
 * Expand container rows in the template so every index from 1 to numContainers
 * has matching rows. If the template only has rows for [CONTAINER_1]..[CONTAINER_3]
 * and we need 5, this clones each missing index from the previous one.
 */
function ensureContainerRows(xml, numContainers) {
  for (let i = 2; i <= numContainers; i++) {
    // If rows for index i are already present, skip
    if (new RegExp(`_${i}\\]`).test(xml)) continue;
    const prev = i - 1;
    // Clone every <w:tr> that contains _prev] placeholders and append it right after
    xml = xml.replace(/<w:tr\b[^>]*>(?:(?!<\/w:tr>)[\s\S])*?<\/w:tr>/g, row => {
      if (!new RegExp(`_${prev}\\]`).test(rowText(row))) return row;
      const cloned = row.replace(new RegExp(`_(${prev})\\]`, 'g'), `_${i}]`);
      return row + cloned;
    });
  }
  return xml;
}

/**
 * Before replacing placeholders:
 * – remove rows for container indices beyond the actual count  (e.g. [CONTAINER_4])
 * – remove the generic _N template row                        (e.g. [CONTAINER_N])
 */
function trimContainerRows(xml, numContainers) {
  for (let i = numContainers + 1; i <= 10; i++) {
    xml = removeRowsByPattern(xml, new RegExp(`\\[\\w+_${i}\\]`));
  }
  xml = removeRowsByPattern(xml, /\[\w+_N\]/);
  return xml;
}

/** Fallback: remove any row that still carries an unfilled [WORD_digit/N] placeholder */
function removeUnfilledRows(xml) {
  return removeRowsByPattern(xml, /\[[A-Z][A-Z0-9_]*_(?:\d+|N)\]/);
}

function splitByPageBreaks(bodyXml) {
  // Capture the page-break paragraph itself so split() returns interleaved parts
  const re = /(<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:br\s+w:type="page"[^>]*\/>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>)/g;
  const parts = bodyXml.split(re);
  // Even indices (0,2,4,6) are content; odd indices are the page-break paragraphs
  return parts.filter((_, i) => i % 2 === 0).filter(s => s.trim());
}

/* ── Build a docx with a specific body section ───────────────────────────── */
async function makeDocxWithBody(templateBytes, filledXml, sectionBody) {
  const zip = await JSZip.loadAsync(templateBytes);

  // Grab the document-level <w:sectPr> — the one directly before </w:body>,
  // which carries <w:headerReference> entries pointing to the background image.
  const sectPrMatch = filledXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/);
  const sectPr = sectPrMatch ? sectPrMatch[0] : '<w:sectPr/>';

  // Strip any trailing <w:sectPr> that splitByPageBreaks may have included in the
  // last section (since it lives at the tail of <w:body>). This prevents duplicates.
  const cleanBody = sectionBody.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*$/, '');

  const newXml = filledXml.replace(
    /<w:body>[\s\S]*<\/w:body>/,
    `<w:body>${cleanBody}${sectPr}</w:body>`
  );
  zip.file('word/document.xml', newXml);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ── Bundle files into a ZIP ─────────────────────────────────────────────── */
async function createZipBundle(files) {
  const z = new JSZip();
  for (const f of files) {
    z.file(f.filename, await f.blob.arrayBuffer());
  }
  return z.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

/* ── Main certificate generation ─────────────────────────────────────────── */
async function generateCertificates(file) {
  if (!currentMap) throw new Error('Primero generá los documentos de la operación.');

  const labResults    = await parseLab(file);
  Object.assign(currentMap, labResults);   // persist lab results into currentMap for Sheets sync
  const certMap       = { ...currentMap, ...labResults };

  // REF_CONTRACT siempre = número de operación PEMAN + " C"
  certMap.REF_CONTRACT = certMap.REF_OPE || '';

  // Override consolidation date with user-provided value if set
  const consolidationDateInput = document.getElementById('consolidationDate');
  if (consolidationDateInput?.value.trim()) {
    certMap.CONSOLIDATION_DATE = consolidationDateInput.value.trim();
  }

  // Override PACKING with selected bag brand
  const bagBrand = document.getElementById('bagBrandSelect')?.value.trim();
  if (bagBrand) {
    const weightMatch = (certMap.PACKING || '').match(/(\d+\s*KG)/i);
    const weight = weightMatch ? weightMatch[1].toUpperCase() : '25 KG';
    certMap.PACKING = `${weight} ${bagBrand} BAGS`;
  }
  const templateBytes = Uint8Array.from(atob(CERTS_TEMPLATE_B64), c => c.charCodeAt(0));

  // Load template and fill placeholders
  const zip = await JSZip.loadAsync(templateBytes);
  let xml   = await zip.file('word/document.xml').async('text');

  // Force Arial font on all runs (replace any w:rFonts declaration)
  xml = xml.replace(/<w:rFonts\b[^>]*\/>/g, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
  xml = xml.replace(/<w:rFonts\b[^>]*>[\s\S]*?<\/w:rFonts>/g, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
  // Also update styles.xml so default font is Arial
  let stylesXml = await zip.file('word/styles.xml').async('text').catch(() => null);
  if (stylesXml) {
    stylesXml = stylesXml.replace(/<w:rFonts\b[^>]*\/>/g, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
    stylesXml = stylesXml.replace(/<w:rFonts\b[^>]*>[\s\S]*?<\/w:rFonts>/g, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
    zip.file('word/styles.xml', stylesXml);
  }

  // Expand template rows if operation has more containers than the template (e.g. 5 vs 3)
  const numCont = [1,2,3,4,5,6,7,8,9,10].filter(i => certMap[`CONTAINER_${i}`]).length;
  xml = ensureContainerRows(xml, numCont);
  // Remove rows for unused container slots BEFORE replacement (handles _N template row too)
  xml = trimContainerRows(xml, numCont);

  // Fix [CONTAINERS_ NUMBERS] at paragraph level (handles split XML runs)
  const containersList = [1,2,3,4,5,6,7,8,9,10]
    .filter(i => certMap[`CONTAINER_${i}`]).map(i => certMap[`CONTAINER_${i}`]).join(', ');
  xml = fixContainersNumbers(xml, containersList);

  xml = replacePlaceholders(xml, certMap);

  // Fallback: remove any row still carrying an unfilled placeholder
  xml = removeUnfilledRows(xml);

  // Extract body content and split into 4 certificate sections
  const bodyMatch = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
  const body      = bodyMatch ? bodyMatch[1] : xml;
  const sections  = splitByPageBreaks(body);

  const certNames = [
    'Certificate of Analysis',
    'Weight Certificate',
    'Cleanliness and Condition Certificate',
    'Fumigation Certificate',
  ];

  const ref     = certMap.REF_OPE ? ` ${certMap.REF_OPE}` : '';
  const results = [];

  // Individual cert docx files
  const individualFiles = [];
  for (let i = 0; i < Math.min(sections.length, 4); i++) {
    const blob = await makeDocxWithBody(templateBytes, xml, sections[i]);
    individualFiles.push({ filename: `${certNames[i]}${ref}.docx`, blob });
  }
  results.push(...individualFiles);

  // ZIP with all individual certs
  if (individualFiles.length > 1) {
    const zipBlob = await createZipBundle(individualFiles);
    results.push({ filename: `Certificados${ref}.zip`, blob: zipBlob, isZip: true });
  }

  // Consolidated docx (all 4 certs, one file)
  zip.file('word/document.xml', xml);
  const consolidated = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  results.push({ filename: `Certificados Consolidados${ref}.docx`, blob: consolidated, isConsolidated: true });

  return results;
}

/* ── Render cert download buttons ────────────────────────────────────────── */
function renderCertsDownloads(files) {
  certsDownloads.innerHTML = '';
  for (const f of files) {
    const url = URL.createObjectURL(f.blob);
    const ext = f.isZip ? 'zip' : 'docx';

    const row   = document.createElement('div');
    row.className = 'download-row';

    const label = document.createElement('span');
    label.className   = 'download-doc-name';
    label.textContent = f.filename.replace(/\.(docx|zip)$/i, '');

    const a = document.createElement('a');
    a.href      = url;
    a.download  = f.filename;
    a.className = `btn-download ${ext}`;
    a.innerHTML = f.isZip ? '🗜 Descargar ZIP' : '📄 Descargar Word';

    row.appendChild(label);
    row.appendChild(a);
    certsDownloads.appendChild(row);
  }
  certsDownloads.scrollIntoView({ behavior: 'smooth' });
}

/* ════════════════════════════════════════════════════════════════════════
   CERTIFICADO DE ORIGEN
   ════════════════════════════════════════════════════════════════════════ */
async function generateCertOrigin(map) {
  // Build placeholder values from the operation map
  const originMap = {
    REFERENCE_NUMBER:   map.REF_OPE          || '',
    CONSIGNEE_NAME:     map.CONSIGNEE_NAME   || '',
    CONSIGNEE_ADDRESS:  map.CONSIGNEE_ADDRESS|| '',
    IMPORTER_NAME:      map.CONSIGNEE_NAME   || '',   // default = consignee
    IMPORTER_ADDRESS:   map.CONSIGNEE_ADDRESS|| '',
    PRODUCT:            map.PRODUCT          || map.GOODS_DESCRIPTION || '',
    CROP:               map.CROP             || '',
    CALIBER:            map.CALIBER          || '',
    GROSS_WEIGHT:       map.TOTAL_BRUTO      || '',
    NET_WEIGHT:         map.TOTAL_NETO       || '',
    BAGS:               map.TOTAL_BOLSAS     || '',
    WEIGHT:             map.TOTAL_NETO ? `${map.TOTAL_NETO} Kg` : '',
    TRANSPORT_MODE:     'Maritime',
    HS_CODE:            (map.POSICION_ARANCELARIA_FULL || map.POSICION_ARANCELARIA || '').replace(/\D/g,'').slice(0,6),
    PLACE_OF_SHIPMENT:  map.POL              || '',
    FINAL_DESTINATION:  map.DESTINATION      || map.POD || '',
  };

  const templateBytes = Uint8Array.from(atob(CERT_ORIGIN_B64), c => c.charCodeAt(0));
  const zip = await JSZip.loadAsync(templateBytes);
  let xml   = await zip.file('word/document.xml').async('text');

  // Some placeholders are split across XML runs — fix before general replacements
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // [REFERENCE_NUMBER]: pattern is <w:t>[</w:t></w:r>...<w:t>REFERENCE_NUMBER</w:t></w:r>...<w:t>]</w:t></w:r>
  xml = xml.replace(
    /<w:t>\[<\/w:t><\/w:r>[\s\S]*?<w:t>REFERENCE_NUMBER<\/w:t><\/w:r>[\s\S]*?<w:t>\]<\/w:t><\/w:r>/g,
    `<w:t xml:space="preserve">${esc(originMap.REFERENCE_NUMBER)}</w:t></w:r>`
  );

  // [WEIGHT]: pattern is <w:t>[WEIGHT</w:t></w:r>...<w:t>]</w:t></w:r>
  xml = xml.replace(
    /<w:t>\[WEIGHT<\/w:t><\/w:r>[\s\S]*?<w:t>\]<\/w:t><\/w:r>/g,
    `<w:t xml:space="preserve">${esc(originMap.WEIGHT)}</w:t></w:r>`
  );

  // Replace all other placeholders (skip ones handled above as split runs)
  const splitHandled = new Set(['REFERENCE_NUMBER', 'WEIGHT']);
  for (const [key, value] of Object.entries(originMap)) {
    if (splitHandled.has(key)) continue;
    xml = xml.replace(new RegExp(`\\[${key}\\]`, 'g'), esc(value));
  }

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ── Utility: trigger a file download from a blob ───────────────────────── */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
