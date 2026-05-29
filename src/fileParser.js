'use strict';
/**
 * fileParser.js
 * Converts uploaded files (PDF, XLSX, DOCX) into structures the Claude API can consume.
 * PDFs go as base64 (Claude natively handles them).
 * XLSX / DOCX are converted to plain text first.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const XLSX = require('xlsx');

// ─── PDF ────────────────────────────────────────────────────────────────────

function parsePdf(filePath) {
  const data = fs.readFileSync(filePath);
  return {
    type: 'pdf',
    name: path.basename(filePath),
    base64: data.toString('base64'),
    mediaType: 'application/pdf',
  };
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

function parseXlsx(filePath) {
  const workbook = XLSX.readFile(filePath);
  const lines = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { defval: '' });
    if (csv.trim()) {
      lines.push(`=== Hoja: ${sheetName} ===`);
      lines.push(csv);
    }
  }
  return {
    type: 'text',
    name: path.basename(filePath),
    text: lines.join('\n'),
  };
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

function parseDocx(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const xml = zip.readAsText('word/document.xml');
    // Strip XML tags, collapse whitespace
    const text = xml
      .replace(/<w:p[ >]/g, '\n<w:p>')         // paragraph breaks
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      type: 'text',
      name: path.basename(filePath),
      text,
    };
  } catch {
    return { type: 'text', name: path.basename(filePath), text: '' };
  }
}

// ─── Public ──────────────────────────────────────────────────────────────────

function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return parsePdf(filePath);
  if (ext === '.xlsx' || ext === '.xls') return parseXlsx(filePath);
  if (ext === '.docx' || ext === '.doc') return parseDocx(filePath);
  // fallback: plain text
  return {
    type: 'text',
    name: path.basename(filePath),
    text: fs.readFileSync(filePath, 'utf8'),
  };
}

module.exports = { parseFile };
