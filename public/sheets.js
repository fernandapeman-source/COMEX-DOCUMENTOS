'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   PEMAN — Google Sheets Integration (browser-only, OAuth 2.0 via GIS)
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Storage keys ──────────────────────────────────────────────────────────────
const GS_CLIENT_ID  = 'peman_gs_client_id';
const GS_SHEET_ID   = 'peman_gs_sheet_id';
const GS_TOKEN_KEY  = 'peman_gs_token';
const GS_TOKEN_EXP  = 'peman_gs_token_exp';

// ── Sheets API base ──────────────────────────────────────────────────────────
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── Column definitions — all operation fields ────────────────────────────────
const GS_COLUMNS = [
  // Identificación
  { key: 'REF_OPE',                   header: 'N° Operación' },
  { key: 'FECHA',                      header: 'Fecha Generación' },
  { key: '_STAGE',                     header: 'Etapa' },
  { key: '_LAST_UPDATE',               header: 'Última Actualización' },
  // Vessel / Logística
  { key: 'VESSEL',                     header: 'Buque' },
  { key: 'VOYAGE',                     header: 'Viaje' },
  { key: 'VESSEL_VOYAGE',              header: 'Buque / Viaje' },
  { key: 'FLAG',                       header: 'Bandera' },
  { key: 'POL',                        header: 'Puerto Origen (POL)' },
  { key: 'POD',                        header: 'Puerto Destino (POD)' },
  { key: 'DESTINATION',                header: 'Destino Final' },
  { key: 'BOOKING',                    header: 'Booking' },
  { key: 'TERMINAL',                   header: 'Terminal' },
  { key: 'AGENCIA',                    header: 'Agencia Marítima' },
  { key: 'DIAS_LIBRES',                header: 'Días Libres' },
  // Aduana / Legal
  { key: 'PERMISO_EMBARQUE',           header: 'Permiso de Embarque' },
  { key: 'ADUANA',                     header: 'Aduana' },
  { key: 'ATA',                        header: 'ATA N°' },
  { key: 'ATA_CUIT',                   header: 'ATA CUIT' },
  { key: 'DESPACHANTE',                header: 'Despachante' },
  { key: 'POSICION_ARANCELARIA_FULL',  header: 'Posición Arancelaria (Completa)' },
  { key: 'POSICION_ARANCELARIA',       header: 'Posición Arancelaria (6 dígitos)' },
  { key: 'CANTIDAD_ORIGINALES',        header: 'B/L Originales' },
  // Consignee / Notify / Cliente
  { key: 'CONSIGNEE_NAME',             header: 'Consignee Nombre' },
  { key: 'CONSIGNEE_ADDRESS',          header: 'Consignee Dirección' },
  { key: 'NOTIFY_NAME',                header: 'Notify Nombre' },
  { key: 'NOTIFY_ADDRESS',             header: 'Notify Dirección' },
  { key: 'CLIENTE_NOMBRE',             header: 'Cliente Nombre' },
  { key: 'CLIENTE_DIRECCION',          header: 'Cliente Dirección' },
  // Producto
  { key: 'PRODUCT',                    header: 'Producto' },
  { key: 'GOODS_DESCRIPTION',          header: 'Descripción Mercadería' },
  { key: 'CROP',                       header: 'Cosecha (Crop)' },
  { key: 'CALIBER',                    header: 'Calibre' },
  { key: 'PACKING',                    header: 'Tipo Embalaje' },
  { key: 'CONSOLIDATION_DATE',         header: 'Fecha Consolidación' },
  { key: 'CONSOLIDATION_PLACE',        header: 'Lugar Consolidación' },
  // Comercial
  { key: 'INCOTERM',                   header: 'Incoterm' },
  { key: 'PAYMENT_TERM',               header: 'Condición de Pago' },
  { key: 'CURRENCY',                   header: 'Moneda' },
  { key: 'PF_QUANTITY_1',              header: 'Cantidad (Proforma)' },
  { key: 'PF_UNIT VALUE_1',            header: 'Precio Unitario' },
  { key: 'TOTAL_VALOR',                header: 'Valor Total (FOB)' },
  // Pesos y cantidades
  { key: 'TOTAL_NETO',                 header: 'Peso Neto Total (kg)' },
  { key: 'TOTAL_BRUTO',                header: 'Peso Bruto Total (kg)' },
  { key: 'TOTAL_BOLSAS',               header: 'Total Bolsas/Bultos' },
  { key: 'TOTAL_CBM',                  header: 'Total CBM (m³)' },
  // Contenedores (resumen)
  { key: 'CONTAINERS_NUMBERS',         header: 'Todos los Contenedores' },
  // Specs de calidad (contrato)
  { key: 'Moisture',                   header: 'Spec Humedad (%)' },
  { key: 'Udersize',                   header: 'Spec Undersize (%)' },
  { key: 'Splits',                     header: 'Spec Splits (%)' },
  { key: 'Foreign Matter',             header: 'Spec Foreign Matter (%)' },
  { key: 'Total defects',              header: 'Spec Total Defects (%)' },
];

// Agregar columnas por contenedor (hasta 10)
for (let i = 1; i <= 10; i++) {
  GS_COLUMNS.push(
    { key: `CONTAINER_${i}`,         header: `Contenedor ${i}` },
    { key: `BOLSAS_${i}`,            header: `Bolsas Cont.${i}` },
    { key: `PESO_NETO_${i}`,         header: `Peso Neto Cont.${i} (kg)` },
    { key: `PESO_BRUTO_${i}`,        header: `Peso Bruto Cont.${i} (kg)` },
    { key: `PRECINTO_ADUANA_${i}`,   header: `Precinto Aduana Cont.${i}` },
    { key: `PRECINTO_LINEA_${i}`,    header: `Precinto Línea Cont.${i}` },
    { key: `NOMBRE_${i}`,            header: `Chofer Nombre Cont.${i}` },
    { key: `APELLIDO_${i}`,          header: `Chofer Apellido Cont.${i}` },
    { key: `DNI_${i}`,               header: `DNI Chofer Cont.${i}` },
    { key: `TRACTOR_${i}`,           header: `Tractor Cont.${i}` },
    { key: `SEMI_${i}`,              header: `Semi Cont.${i}` },
    // Resultados de laboratorio por contenedor
    { key: `OP_SAMPLE_${i}`,         header: `Muestra Cont.${i}` },
    { key: `MOISTURE_${i}`,          header: `Humedad Cont.${i} (%)` },
    { key: `BELOW_SIEVE_35_${i}`,    header: `Undersize Cont.${i} (%)` },
    { key: `SPLITS_${i}`,            header: `Splits Cont.${i} (%)` },
    { key: `FOREIGN_MATTER_${i}`,    header: `Foreign Matter Cont.${i} (%)` },
    { key: `TOTAL_DEFECTS_${i}`,     header: `Total Defects Cont.${i} (%)` },
  );
}

// ── Token helpers ─────────────────────────────────────────────────────────────
function gsGetToken() {
  const token = localStorage.getItem(GS_TOKEN_KEY);
  const exp   = parseInt(localStorage.getItem(GS_TOKEN_EXP) || '0', 10);
  if (!token || Date.now() > exp - 60_000) return null;   // null if expired/missing
  return token;
}

function gsSetToken(token, expiresIn) {
  localStorage.setItem(GS_TOKEN_KEY, token);
  localStorage.setItem(GS_TOKEN_EXP, String(Date.now() + expiresIn * 1000));
}

function gsClearToken() {
  localStorage.removeItem(GS_TOKEN_KEY);
  localStorage.removeItem(GS_TOKEN_EXP);
}

function gsIsConnected() { return !!gsGetToken(); }

function gsGetClientId()  { return localStorage.getItem(GS_CLIENT_ID) || ''; }
function gsGetSheetId()   { return localStorage.getItem(GS_SHEET_ID)  || ''; }
function gsSetClientId(v) { localStorage.setItem(GS_CLIENT_ID, v.trim()); }
function gsSetSheetId(v)  { localStorage.setItem(GS_SHEET_ID,  v.trim()); }

// ── OAuth — popup flow ────────────────────────────────────────────────────────
function gsConnect() {
  return new Promise((resolve, reject) => {
    const clientId = gsGetClientId();
    if (!clientId) { reject(new Error('Ingresá el Client ID de Google primero.')); return; }

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  window.location.origin + '/oauth2callback.html',
      response_type: 'token',
      scope:         'https://www.googleapis.com/auth/spreadsheets',
      prompt:        'select_account',
    });

    const url    = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    const popup  = window.open(url, 'gs_auth', 'width=500,height=640,menubar=no,toolbar=no');
    if (!popup) { reject(new Error('No se pudo abrir el popup. Permitir popups para este sitio.')); return; }

    // Listen for the callback redirect
    const interval = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(interval);
          if (gsIsConnected()) resolve();
          else reject(new Error('Autenticación cancelada.'));
          return;
        }
        const hash = popup.location.hash;
        if (hash && hash.includes('access_token')) {
          const p = new URLSearchParams(hash.slice(1));
          const token     = p.get('access_token');
          const expiresIn = parseInt(p.get('expires_in') || '3600', 10);
          if (token) {
            gsSetToken(token, expiresIn);
            clearInterval(interval);
            popup.close();
            resolve();
          }
        }
      } catch (_) { /* cross-origin — wait for redirect back */ }
    }, 300);

    // Timeout after 3 minutes
    setTimeout(() => {
      clearInterval(interval);
      try { popup.close(); } catch (_) {}
      reject(new Error('Tiempo de espera agotado para la autenticación.'));
    }, 180_000);
  });
}

// ── Sheets API helpers ────────────────────────────────────────────────────────
async function sheetsGet(token, spreadsheetId, range) {
  const r = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Sheets API error ${r.status}`);
  }
  return r.json();
}

async function sheetsUpdate(token, spreadsheetId, range, values) {
  const r = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values }),
    }
  );
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Sheets API error ${r.status}`);
  }
  return r.json();
}

async function sheetsAppend(token, spreadsheetId, values) {
  const r = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values }),
    }
  );
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Sheets API error ${r.status}`);
  }
  return r.json();
}

// Convierte número de columna (1-based) a letra(s): 1→A, 26→Z, 27→AA…
function colToLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── Ensure header row ─────────────────────────────────────────────────────────
async function ensureHeaders(token, sheetId) {
  const data = await sheetsGet(token, sheetId, 'A1:1');
  const firstRow = (data.values || [])[0] || [];
  const headers = GS_COLUMNS.map(c => c.header);

  if (firstRow[0] !== 'N° Operación') {
    // Sheet vacío — crear todos los headers
    await sheetsUpdate(token, sheetId, `A1:${colToLetter(headers.length)}1`, [headers]);
  } else if (firstRow.length < headers.length) {
    // Sheet existente con menos columnas — agregar las nuevas al final
    const missing = headers.slice(firstRow.length);
    const startCol = colToLetter(firstRow.length + 1);
    const endCol   = colToLetter(headers.length);
    await sheetsUpdate(token, sheetId, `${startCol}1:${endCol}1`, [missing]);
  }
}

// ── Find existing row by REF_OPE ──────────────────────────────────────────────
async function findOperationRow(token, sheetId, refOpe) {
  const data = await sheetsGet(token, sheetId, 'A:A');
  const rows = data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === refOpe) return i + 1;  // 1-indexed sheet row
  }
  return null;
}

// ── Build row values from map ─────────────────────────────────────────────────
function buildRowValues(map, stage) {
  const stageLabels = { 1: 'Etapa 1 - Pre-embarque', 2: 'Etapa 2 - Embarque', 3: 'Etapa 3 - Post-embarque' };
  const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' });
  const enhanced = { ...map, _STAGE: stageLabels[stage] || `Etapa ${stage}`, _LAST_UPDATE: now };
  return GS_COLUMNS.map(col => {
    const v = enhanced[col.key];
    return (v !== undefined && v !== null) ? String(v) : '';
  });
}

// ── Main sync function ────────────────────────────────────────────────────────
async function gsSyncOperation(map, stage) {
  const token   = gsGetToken();
  const sheetId = gsGetSheetId();

  if (!token)   throw new Error('No autenticado con Google. Conectá tu cuenta en Configuración.');
  if (!sheetId) throw new Error('No configuraste el ID del Google Sheet. Completalo en Configuración.');

  await ensureHeaders(token, sheetId);

  const refOpe      = map.REF_OPE || '';
  const newValues   = buildRowValues(map, stage);
  const existingRow = refOpe ? await findOperationRow(token, sheetId, refOpe) : null;

  if (existingRow) {
    // Operación existe → traer datos actuales y solo llenar celdas vacías
    const lastCol = colToLetter(GS_COLUMNS.length);
    const current = await sheetsGet(token, sheetId, `A${existingRow}:${lastCol}${existingRow}`);
    const existing = (current.values || [])[0] || [];

    const merged = newValues.map((newVal, i) => {
      if (i === 2 || i === 3) return newVal;           // Etapa y Última Actualización siempre se actualizan
      const cur = existing[i] || '';
      return cur !== '' ? cur : newVal;                // mantener existente, completar si vacío
    });

    await sheetsUpdate(token, sheetId, `A${existingRow}:${lastCol}${existingRow}`, [merged]);
    return { action: 'updated', row: existingRow };
  } else {
    // Nueva operación → agregar fila
    await sheetsAppend(token, sheetId, [newValues]);
    return { action: 'created' };
  }
}
