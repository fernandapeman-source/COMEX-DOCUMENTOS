'use strict';
/**
 * extractor.js
 * Sends documents to Claude and extracts a structured JSON with all
 * export-document fields, respecting PEMAN source-priority rules.
 */

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `Eres un especialista en comercio exterior argentino.
Recibirás uno o más documentos de una operación de exportación (PE, Booking, Contrato, Cierre, Nómina, etc.).
Tu tarea es extraer TODOS los datos relevantes y devolver exclusivamente un JSON válido con la estructura indicada.

REGLAS DE PRIORIDAD DE FUENTES:
- PE (Permiso de Embarque): fuente máxima para pesos, bultos, bolsas, FOB, Incoterm, Aduana, Posición arancelaria, ATA, Despachante.
- Booking: Vessel, Voyage, POL, POD, Terminal, ETD, ETA, días libres, cantidad de contenedores.
- Contrato: Buyer/Consignee/Notify, dirección completa, descripción comercial, Payment term, BL TELEX.
- Cierre: cliente, mercadería, volumen, payment term, BL TELEX, observaciones.
- Nómina (Excel): contenedor, chofer (nombre/apellido), DNI, tractor, semi, precinto.
- Si un dato no está en PE, buscarlo en Booking → Contrato → Cierre → Nómina → otros.

REGLAS ESPECIALES:
- notify_name y notify_address SIEMPRE iguales a consignee_name y consignee_address.
- metros_cubicos: siempre 32 por contenedor (no calcular).
- bolsas: usar PE; si no hay PE → 1000 por contenedor.
- peso_neto por contenedor: usar PE; default 25000 kg.
- peso_bruto por contenedor: usar PE; default 25050 kg.
- NUNCA usar 1 o 2 como cantidad de bolsas.
- Proforma: cantidad en KGS, precio en USD/KG.
- cantidad_originales: "3" salvo que sea TELEX → poner "TELEX".
- TELEX se detecta en contrato, cierre o instrucciones del cliente.
- Para posición arancelaria usar SOLO los primeros 6 dígitos numéricos.
- Descripción de mercadería según producto:
  * Poroto mung entero → "Green Mung Beans"
  * Poroto mung partido → "Split Green Mung Bean"
  * Garbanzo entero → "Chickpea" + calibre
  * Garbanzo partido → "Split Chickpea"
- aduana: desde PE; si no hay PE → "Aduana Córdoba".
- cliente_nombre/cliente_direccion: desde Contrato o Cierre (no usar el exportador).
- Para Packing List Aduana, el campo CLIENTE es el cliente del contrato/cierre.
- fecha de emisión: NO tomar de documentos; siempre dejar vacío (""), la app la fija.

ESTRUCTURA JSON REQUERIDA (devolver SOLO el JSON, sin markdown):
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
      "metros_cubicos": "32",
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
  "total_valor": ""
}`;

/**
 * Build Claude message content blocks from parsed files.
 */
function buildContentBlocks(parsedFiles, userNote) {
  const blocks = [];

  for (const f of parsedFiles) {
    if (f.type === 'pdf') {
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: f.base64,
        },
        title: f.name,
      });
    } else {
      blocks.push({
        type: 'text',
        text: `=== DOCUMENTO: ${f.name} ===\n${f.text}`,
      });
    }
  }

  const stageNote = userNote ? `\nNota del usuario: ${userNote}` : '';
  blocks.push({
    type: 'text',
    text: `Extrae todos los datos de los documentos anteriores y devuelve el JSON según la estructura indicada.${stageNote}`,
  });

  return blocks;
}

/**
 * Call Claude to extract data from uploaded documents.
 * Returns a parsed JS object matching the JSON schema above.
 */
async function extractData(parsedFiles, apiKey, userNote = '') {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildContentBlocks(parsedFiles, userNote),
      },
    ],
  });

  const raw = response.content[0].text.trim();

  // Strip markdown code fences if present
  const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude devolvió JSON inválido:\n${raw.slice(0, 500)}`);
  }

  return data;
}

module.exports = { extractData };
