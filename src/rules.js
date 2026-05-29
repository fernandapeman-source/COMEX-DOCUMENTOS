'use strict';
/**
 * rules.js
 * Applies mandatory PEMAN business rules on top of Claude-extracted data.
 * These rules are hard-coded and cannot be overridden by document content.
 */

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function todayFecha() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function todayFechaLarga() {
  const d = new Date();
  return `Sinsacate, ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

function todayFechaProforma() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Main rule application.
 * Receives extracted data object, returns enriched flat map
 * with all template placeholder values ready to substitute.
 */
function applyRules(data) {
  const MAX_CONTAINERS = 10;

  // ── Stage detection ──────────────────────────────────────────────────────
  const hasPermit = !!(data.permiso_embarque && data.permiso_embarque.trim());
  const hasNomina = data.containers && data.containers.some(c => c.nombre || c.tractor);
  const stage = hasPermit || hasNomina ? 2 : 1;

  // ── Dates (always today) ─────────────────────────────────────────────────
  const fecha = todayFechaProforma();
  const fechaLarga = todayFechaLarga();

  // ── Aduana ───────────────────────────────────────────────────────────────
  const aduana = (data.aduana && data.aduana.trim()) || 'Aduana Córdoba';

  // ── Notify = Consignee (always) ──────────────────────────────────────────
  const consigneeName = data.consignee_name || '';
  const consigneeAddress = data.consignee_address || '';
  const notifyName = consigneeName;
  const notifyAddress = consigneeAddress;

  // ── TELEX / Cantidad originales ──────────────────────────────────────────
  const isTelex = data.bl_telex === true || String(data.bl_telex).toUpperCase() === 'TELEX';
  const cantidadOriginales = isTelex ? 'TELEX' : (data.cantidad_originales || '3');

  // ── Containers ───────────────────────────────────────────────────────────
  const numContainers = Math.max(1, Number(data.num_containers) || (data.containers ? data.containers.length : 1));
  const inputContainers = data.containers || [];

  const containers = [];
  for (let i = 0; i < numContainers; i++) {
    const src = inputContainers[i] || {};
    const bolsas = src.bolsas && String(src.bolsas).trim() && Number(src.bolsas) > 2
      ? String(src.bolsas)
      : '1000';
    const pesoNeto = src.peso_neto && String(src.peso_neto).trim() ? String(src.peso_neto) : '25000';
    const pesoBruto = src.peso_bruto && String(src.peso_bruto).trim() ? String(src.peso_bruto) : '25050';

    containers.push({
      n: i + 1,
      contenedor: src.contenedor || '',
      precinto_aduana: src.precinto_aduana || '',
      precinto_linea: src.precinto_linea || '',
      bultos: bolsas,            // bultos = bolsas for declarations
      bolsas,
      peso_neto: pesoNeto,
      peso_bruto: pesoBruto,
      metros_cubicos: '32',      // always 32 per PEMAN rule
      nombre: src.nombre || '',
      apellido: src.apellido || '',
      dni: src.dni || '',
      tractor: src.tractor || '',
      semi: src.semi || '',
    });
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const totalBolsas = data.total_bolsas && Number(data.total_bolsas) > 2
    ? String(data.total_bolsas)
    : String(containers.reduce((s, c) => s + Number(c.bolsas), 0));

  const totalNeto = data.total_neto && String(data.total_neto).trim()
    ? String(data.total_neto)
    : String(containers.reduce((s, c) => s + Number(c.peso_neto), 0));

  const totalBruto = data.total_bruto && String(data.total_bruto).trim()
    ? String(data.total_bruto)
    : String(containers.reduce((s, c) => s + Number(c.peso_bruto), 0));

  const totalCbm = String(numContainers * 32);

  // ── Vessel / Voyage combined ─────────────────────────────────────────────
  const vesselVoyage = [data.vessel, data.voyage].filter(Boolean).join(' / ');

  // ── Proforma ─────────────────────────────────────────────────────────────
  const pfQuantity = data.pf_quantity || `${totalNeto} KGS`;
  const pfUnitValue = data.pf_unit_value || (data.fob_unitario ? `${data.fob_unitario} USD/KG` : '');
  const pfTotal = data.pf_total || data.total_valor || data.fob_total || '';
  const pfDescription = data.pf_description || data.goods_description || data.producto || '';

  // ── Posición arancelaria (6 digits only) ─────────────────────────────────
  const rawPos = String(data.posicion_arancelaria || '');
  const posicion = rawPos.replace(/\D/g, '').slice(0, 6);

  // ── Build flat placeholder map ────────────────────────────────────────────
  const map = {
    // Meta
    REF_OPE: data.ref_ope || '',
    FECHA: fecha,
    FECHA_LARGA: fechaLarga,

    // Vessel / routing
    VESSEL: data.vessel || '',
    VOYAGE: data.voyage || '',
    VESSEL_VOYAGE: vesselVoyage,
    POL: data.pol || '',
    POD: data.pod || '',
    DESTINATION: data.destination || '',
    FLAG: data.flag || '',
    BOOKING: data.booking || '',
    TERMINAL: data.terminal || '',
    AGENCIA: data.agencia || '',
    DIAS_LIBRES: data.dias_libres || '',

    // Permit / customs
    PERMISO_EMBARQUE: data.permiso_embarque || '',
    ADUANA: aduana,
    ATA: data.ata || '',
    ATA_CUIT: data.ata_cuit || '',
    DESPACHANTE: data.despachante || '',
    CANTIDAD_ORIGINALES: cantidadOriginales,
    POSICION_ARANCELARIA: posicion,

    // Parties
    CONSIGNEE_NAME: consigneeName,
    CONSIGNEE_ADDRESS: consigneeAddress,
    NOTIFY_NAME: notifyName,
    NOTIFY_ADDRESS: notifyAddress,
    CONSIGNEE_NOMBRE: consigneeName,
    CONSIGNEE_DIRECCION: consigneeAddress,
    NOTIFY_NOMBRE: notifyName,
    NOTIFY_DIRECCION: notifyAddress,

    // Client (contract / cierre — NOT the exporter)
    CLIENTE_NOMBRE: data.cliente_nombre || consigneeName,
    CLIENTE_DIRECCION: data.cliente_direccion || consigneeAddress,
    CLIENTE_NAME: data.cliente_nombre || consigneeName,
    CLIENTE_ADDRESS: data.cliente_direccion || consigneeAddress,

    // Commercial
    INCOTERM: data.incoterm || '',
    PAYMENT_TERM: data.payment_term || '',
    CURRENCY: data.currency || 'USD',

    // Product
    GOODS_DESCRIPTION: data.goods_description || data.producto || '',
    PRODUCT: data.goods_description || data.producto || '',
    PRODUCTO: data.producto || data.goods_description || '',

    // Totals
    TOTAL_BULTOS: totalBolsas,
    TOTAL_NETO: totalNeto,
    TOTAL_BRUTO: totalBruto,
    TOTAL_BOLSAS: totalBolsas,
    TOTAL_CBM: totalCbm,

    // Proforma
    PF_ITEM_1: '1',
    PF_DESCRIPTION_1: pfDescription,
    PF_QUANTITY_1: pfQuantity,
    'PF_UNIT VALUE_1': pfUnitValue,
    PF_TOTAL_1: pfTotal,
    PF_ITEM_2: '',
    PF_DESCRIPTION_2: '',
    PF_QUANTITY_2: '',
    'PF_UNIT VALUE_2': '',
    PF_TOTAL_2: '',
    PF_ITEM_3: '',
    PF_DESCRIPTION_3: '',
    PF_QUANTITY_3: '',
    'PF_UNIT VALUE_3': '',
    PF_TOTAL_3: '',
    TOTAL_VALOR: pfTotal,
  };

  // ── Per-container fields ─────────────────────────────────────────────────
  for (let i = 1; i <= MAX_CONTAINERS; i++) {
    const c = containers[i - 1];
    if (c) {
      map[`CONTENEDOR_${i}`] = c.contenedor;
      map[`PRECINTO_ADUANA_${i}`] = c.precinto_aduana;
      map[`PRECINTO_LINEA_${i}`] = c.precinto_linea;
      map[`SEAL_CUSTOMS_${i}`] = c.precinto_aduana;   // alias
      map[`BULTOS_${i}`] = c.bultos;
      map[`BOLSAS_${i}`] = c.bolsas;
      map[`BAGS_${i}`] = c.bolsas;
      map[`PESO_NETO_${i}`] = c.peso_neto;
      map[`PESO_BRUTO_${i}`] = c.peso_bruto;
      map[`NET_WEIGHT_${i}`] = c.peso_neto;
      map[`GROSS_WEIGHT_${i}`] = c.peso_bruto;
      map[`METROS_CUBICOS_${i}`] = '32';
      // Resumen de Carga fields
      map[`NOMBRE_${i}`] = c.nombre;
      map[`APELLIDO_${i}`] = c.apellido;
      map[`DNI_${i}`] = c.dni;
      map[`TRACTOR_${i}`] = c.tractor;
      map[`SEMI_${i}`] = c.semi;
      map[`P_NETO_${i}`] = c.peso_neto;
      map[`P_BRUTO_${i}`] = c.peso_bruto;
      map[`PRODUCTO_${i}`] = data.producto || data.goods_description || '';
      map[`PRECINTO_LINEA_${i}`] = c.precinto_linea;
    } else {
      // Unfilled container rows → empty strings (not "NO INFORMADO")
      map[`CONTENEDOR_${i}`] = '';
      map[`PRECINTO_ADUANA_${i}`] = '';
      map[`PRECINTO_LINEA_${i}`] = '';
      map[`SEAL_CUSTOMS_${i}`] = '';
      map[`BULTOS_${i}`] = '';
      map[`BOLSAS_${i}`] = '';
      map[`BAGS_${i}`] = '';
      map[`PESO_NETO_${i}`] = '';
      map[`PESO_BRUTO_${i}`] = '';
      map[`NET_WEIGHT_${i}`] = '';
      map[`GROSS_WEIGHT_${i}`] = '';
      map[`METROS_CUBICOS_${i}`] = '';
      map[`NOMBRE_${i}`] = '';
      map[`APELLIDO_${i}`] = '';
      map[`DNI_${i}`] = '';
      map[`TRACTOR_${i}`] = '';
      map[`SEMI_${i}`] = '';
      map[`P_NETO_${i}`] = '';
      map[`P_BRUTO_${i}`] = '';
      map[`PRODUCTO_${i}`] = '';
    }
  }

  return { map, stage, numContainers, isTelex, cantidadOriginales };
}

module.exports = { applyRules };
