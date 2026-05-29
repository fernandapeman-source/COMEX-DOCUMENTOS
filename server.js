'use strict';
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseFile } = require('./src/fileParser');
const { extractData } = require('./src/extractor');
const { applyRules } = require('./src/rules');
const { fillAll } = require('./src/filler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Upload config: temp dir, max 20 files, 50 MB each ────────────────────────
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── POST /api/generate ────────────────────────────────────────────────────────
app.post('/api/generate', upload.array('files'), async (req, res) => {
  const uploadedPaths = (req.files || []).map(f => f.path);

  try {
    const apiKey = req.body.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'Falta la API key de Anthropic.' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se adjuntaron documentos.' });
    }

    // Rename temp files with original extensions so parsers detect type
    const parsedFiles = req.files.map(f => {
      const ext = path.extname(f.originalname).toLowerCase();
      const newPath = f.path + ext;
      fs.renameSync(f.path, newPath);
      return parseFile(newPath);
    });

    // Extract structured data via Claude
    const extracted = await extractData(parsedFiles, apiKey, req.body.note || '');

    // Apply PEMAN rules
    const { map, stage, cantidadOriginales } = applyRules(extracted);

    // Allow manual stage override from frontend
    const finalStage = req.body.stage ? parseInt(req.body.stage, 10) : stage;

    // Fill templates
    const files = fillAll(finalStage, map, { cantidadOriginales });

    // Build response: send files as base64 JSON
    const output = files.map(f => ({
      filename: f.filename,
      data: f.buffer.toString('base64'),
    }));

    res.json({
      stage: finalStage,
      files: output,
      summary: buildSummary(extracted, map, finalStage),
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  } finally {
    // Clean up temp files
    for (const p of uploadedPaths) {
      try { fs.unlinkSync(p); } catch {}
      try { fs.unlinkSync(p + '.pdf'); } catch {}
      try { fs.unlinkSync(p + '.xlsx'); } catch {}
      try { fs.unlinkSync(p + '.docx'); } catch {}
    }
  }
});

// ── Summary for UI display ────────────────────────────────────────────────────
function buildSummary(extracted, map, stage) {
  return {
    ref_ope: map.REF_OPE,
    stage,
    vessel: map.VESSEL,
    voyage: map.VOYAGE,
    booking: map.BOOKING,
    consignee: map.CONSIGNEE_NAME,
    aduana: map.ADUANA,
    permiso: map.PERMISO_EMBARQUE,
    containers: map.CONTENEDOR_1 ? [
      map.CONTENEDOR_1,
      map.CONTENEDOR_2,
      map.CONTENEDOR_3,
      map.CONTENEDOR_4,
    ].filter(Boolean) : [],
    total_neto: map.TOTAL_NETO,
    total_bruto: map.TOTAL_BRUTO,
    cantidad_originales: map.CANTIDAD_ORIGINALES,
  };
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚢 PEMAN Comex App corriendo en http://localhost:${PORT}\n`);
});
