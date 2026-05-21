const https = require('https');
const http = require('http');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

const SHEET_ID = '11QwwtQ27S-Z0ZXSptjq2MCedSC8_O4Jo01blqDzjBTI';
const SHEET_GID_SEGURIDAD = '1053060950';

// ── Mapeo modelo → imagen EE de referencia ───────────────────
// Imágenes en /netlify/functions/ee/ del repo
const EE_BASE_URL = 'https://raw.githubusercontent.com/sorozco86/packcheck/main/netlify/functions/ee/';
const EE_MAP = {
  'DAECPM158':  'img_01.png',
  'PKECPM158':  'img_02.png',
  'DAECPM146':  'img_03.png',
  'PKECPM146':  'img_04.png',
  'DAEA750':    'img_05.png',
  'PKEA750':    'img_06.png',
  'DAQB60':     'img_07.png',
  'PKQB60':     'img_08.png',
  'DAECPM130':  'img_09.png',
  'PKECPM130':  'img_10.png',
  'DAEPRES260': 'img_11.png',
  'PKEPRES260': 'img_12.png',
  'PN-EO252':   'img_13.png',
};

// ── HTTP GET helper ───────────────────────────────────────────
function httpGet(url, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        return httpGet(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: buf.toString('utf8'), bodyBuffer: buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Timeout')); });
  });
}

// ── CSV Parser ────────────────────────────────────────────────
function parseCSV(csvData) {
  const rows = [];
  const lines = csvData.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let field = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        row.push(field.trim()); field = '';
      } else { field += ch; }
    }
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
  return obj;
}

// ── Buscar modelo en Seguridad Eléctrica ─────────────────────
async function searchSeguridad(modelNo) {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID_SEGURIDAD}`;
  const res = await httpGet(csvUrl);
  if (res.status !== 200) throw new Error('No se pudo leer checklist: ' + res.status);

  const rows = parseCSV(res.body);
  if (!rows || rows.length === 0) return { found: false, message: 'Planilla vacía' };

  const headers = rows[0];
  const COL_MODEL = 4;
  const matches = [];

  for (let i = 1; i < rows.length; i++) {
    const cellValue = (rows[i][COL_MODEL] || '').trim().toUpperCase();
    if (cellValue === modelNo || cellValue.includes(modelNo) || modelNo.includes(cellValue)) {
      matches.push(rowToObj(headers, rows[i]));
    }
  }

  if (matches.length === 0) {
    // Búsqueda fuzzy
    const fuzzy = [];
    for (let i = 1; i < rows.length; i++) {
      const cell = (rows[i][COL_MODEL] || '').trim().toUpperCase();
      const base = modelNo.replace(/[^A-Z0-9]/g, '');
      const cellBase = cell.replace(/[^A-Z0-9]/g, '');
      if (base.length >= 4 && (cellBase.includes(base.substring(0,6)) || base.includes(cellBase.substring(0,6)))) {
        fuzzy.push(rowToObj(headers, rows[i]));
      }
    }
    if (fuzzy.length > 0) return { found: true, count: fuzzy.length, data: fuzzy, fuzzy: true };
    return { found: false, message: `Modelo "${modelNo}" no encontrado en checklist` };
  }

  return { found: true, count: matches.length, data: matches };
}

// ── Obtener imagen EE de referencia ──────────────────────────
async function getEEImage(modelNo) {
  // Buscar modelo en el mapa (exacto o fuzzy)
  let filename = EE_MAP[modelNo];

  if (!filename) {
    // Búsqueda fuzzy en el mapa
    for (const [key, val] of Object.entries(EE_MAP)) {
      if (key.includes(modelNo) || modelNo.includes(key)) {
        filename = val;
        console.log(`EE fuzzy match: ${modelNo} → ${key} → ${filename}`);
        break;
      }
    }
  }

  if (!filename) {
    console.log(`EE: modelo ${modelNo} no encontrado en mapa. Disponibles: ${Object.keys(EE_MAP).join(', ')}`);
    return { found: false, message: `Sin imagen EE de referencia para ${modelNo}` };
  }

  const imageUrl = EE_BASE_URL + filename;
  console.log(`Descargando imagen EE: ${imageUrl}`);

  try {
    const res = await httpGet(imageUrl);
    if (res.status !== 200) {
      return { found: false, message: `Error descargando imagen EE: ${res.status}` };
    }
    const imageBase64 = res.bodyBuffer.toString('base64');
    console.log(`Imagen EE descargada: ${imageBase64.length} chars`);
    return {
      found: true,
      filename: filename,
      imageUrl: imageUrl,
      imageBase64: imageBase64,
      imageMime: 'image/png',
      message: `Imagen de referencia EE para ${modelNo}`
    };
  } catch(e) {
    console.log(`Error descargando EE image: ${e.message}`);
    return { found: false, message: `Error: ${e.message}` };
  }
}

// ── Handler principal ─────────────────────────────────────────
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  let modelNo = '', action = 'search';
  try {
    if (event.httpMethod === 'GET') {
      modelNo = (event.queryStringParameters && event.queryStringParameters.model) || '';
      action = (event.queryStringParameters && event.queryStringParameters.action) || 'search';
    } else {
      const body = JSON.parse(event.body || '{}');
      modelNo = body.model || '';
      action = body.action || 'search';
    }
  } catch(e) { console.log('Parse error:', e.message); }

  modelNo = modelNo.trim().toUpperCase();
  console.log(`sheets.js — model: ${modelNo} action: ${action}`);

  try {
    const [seguridadResult, eeResult] = await Promise.all([
      searchSeguridad(modelNo),
      modelNo ? getEEImage(modelNo) : Promise.resolve({ found: false })
    ]);

    console.log(`Seguridad: ${seguridadResult.found} | EE image: ${eeResult.found} (${eeResult.imageBase64 ? eeResult.imageBase64.length : 0} chars)`);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...seguridadResult, ee: eeResult })
    };
  } catch(e) {
    console.error('Handler error:', e.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message, found: false })
    };
  }
};
