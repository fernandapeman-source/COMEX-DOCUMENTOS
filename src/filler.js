'use strict';
/**
 * filler.js
 * Fills Excel template files by doing XML string-replacement inside the
 * xlsx ZIP archive. This preserves 100% of styles, merges, formulas and
 * formatting because we only touch the text content — never the structure.
 */

const AdmZip = require('adm-zip');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// ── XML escaping ─────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Core replace: walks sharedStrings + all worksheets ───────────────────────

function replacePlaceholders(xmlStr, map) {
  let result = xmlStr;
  for (const [key, val] of Object.entries(map)) {
    const placeholder = `[${key}]`;
    const escaped = escapeXml(String(val ?? ''));
    // Simple global replace — placeholders are full cell values so no split risk
    result = result.split(placeholder).join(escaped);
  }
  return result;
}

/**
 * Special handler for "CANTIDAD DE ORIGINALES" cell in Declaracion de Embarque.
 * The value lives in K17 as a plain number cell (no placeholder).
 * When BL is TELEX we need to switch it to a string.
 */
function patchCantidadOriginales(zip, cantidadOriginales) {
  const wsName = 'xl/worksheets/sheet1.xml';
  let ws = zip.readAsText(wsName);
  if (!ws) return;

  if (cantidadOriginales === 'TELEX') {
    // Add "TELEX" to sharedStrings and update the cell
    const ssName = 'xl/sharedStrings.xml';
    let ss = zip.readAsText(ssName);

    // Count current shared strings
    const countMatch = ss.match(/count="(\d+)"/);
    const uniqueMatch = ss.match(/uniqueCount="(\d+)"/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    const unique = uniqueMatch ? parseInt(uniqueMatch[1], 10) : 0;
    const newIndex = unique;

    // Append TELEX shared string
    ss = ss.replace('</sst>', `<si><t>TELEX</t></si></sst>`);
    ss = ss
      .replace(`count="${count}"`, `count="${count + 1}"`)
      .replace(`uniqueCount="${unique}"`, `uniqueCount="${unique + 1}"`);
    zip.updateFile(ssName, Buffer.from(ss, 'utf8'));

    // Replace K17 number cell with shared-string ref
    ws = ws.replace(
      /<c r="K17"([^>]*)><v>3<\/v><\/c>/,
      `<c r="K17"$1 t="s"><v>${newIndex}</v></c>`,
    );
  }
  // If "3", the cell already has value 3 — nothing to change.
  zip.updateFile(wsName, Buffer.from(ws, 'utf8'));
}

// ── Fill a single template ───────────────────────────────────────────────────

/**
 * @param {string} templateFile   filename in templates/ dir (e.g. "declaracion_embarque.xlsx")
 * @param {Object} map            flat key→value map from rules.js
 * @param {Object} opts           { cantidadOriginales }
 * @returns {Buffer}              filled xlsx as Buffer
 */
function fillTemplate(templateFile, map, opts = {}) {
  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  const zip = new AdmZip(templatePath);

  // 1. Replace in sharedStrings.xml
  const ssName = 'xl/sharedStrings.xml';
  const ssEntry = zip.getEntry(ssName);
  if (ssEntry) {
    let ss = zip.readAsText(ssName);
    ss = replacePlaceholders(ss, map);
    zip.updateFile(ssName, Buffer.from(ss, 'utf8'));
  }

  // 2. Replace in every worksheet (catches inline strings too)
  const wsEntries = zip.getEntries().filter(e =>
    e.entryName.startsWith('xl/worksheets/') && e.entryName.endsWith('.xml'),
  );
  for (const entry of wsEntries) {
    let ws = zip.readAsText(entry.entryName);
    ws = replacePlaceholders(ws, map);
    zip.updateFile(entry.entryName, Buffer.from(ws, 'utf8'));
  }

  // 3. Special patches per template
  if (templateFile === 'declaracion_embarque.xlsx' && opts.cantidadOriginales) {
    patchCantidadOriginales(zip, opts.cantidadOriginales);
  }

  return zip.toBuffer();
}

// ── Fill all templates for a given stage ─────────────────────────────────────

/**
 * Returns an array of { filename, buffer } objects.
 */
function fillAll(stage, map, opts = {}) {
  const results = [];

  const add = (outputName, templateFile, extraOpts = {}) => {
    try {
      const buffer = fillTemplate(templateFile, map, { ...opts, ...extraOpts });
      results.push({ filename: outputName, buffer });
    } catch (err) {
      console.error(`Error filling ${templateFile}:`, err.message);
    }
  };

  if (stage === 1) {
    add('Packing_List_Aduana.xlsx', 'packing_list_aduana.xlsx');
    add('Pro_Forma.xlsx', 'proforma.xlsx');
  } else if (stage === 2) {
    add('Resumen_Carga.xlsx', 'resumen_carga.xlsx');
    add('Packing_List_Comercial.xlsx', 'packing_list_comercial.xlsx');
    add('Declaracion_Embarque.xlsx', 'declaracion_embarque.xlsx', {
      cantidadOriginales: opts.cantidadOriginales,
    });
  } else {
    // Stage 3: all files
    add('Packing_List_Aduana.xlsx', 'packing_list_aduana.xlsx');
    add('Pro_Forma.xlsx', 'proforma.xlsx');
    add('Resumen_Carga.xlsx', 'resumen_carga.xlsx');
    add('Packing_List_Comercial.xlsx', 'packing_list_comercial.xlsx');
    add('Declaracion_Embarque.xlsx', 'declaracion_embarque.xlsx', {
      cantidadOriginales: opts.cantidadOriginales,
    });
  }

  return results;
}

module.exports = { fillAll };
