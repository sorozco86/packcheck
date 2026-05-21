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

const BASE_URL = 'https://raw.githubusercontent.com/sorozco86/packcheck/main/netlify/functions/';

// ── Mapeo modelo → imagen EE ──────────────────────────────────
const EE_MAP = {
  'DAECPM158':  'ee/img_01.png',
  'PKECPM158':  'ee/img_02.png',
  'DAECPM146':  'ee/img_03.png',
  'PKECPM146':  'ee/img_04.png',
  'DAEA750':    'ee/img_05.png',
  'PKEA750':    'ee/img_06.png',
  'DAQB60':     'ee/img_07.png',
  'PKQB60':     'ee/img_08.png',
  'DAECPM130':  'ee/img_09.png',
  'PKECPM130':  'ee/img_10.png',
  'DAEPRES260': 'ee/img_11.png',
  'PKEPRES260': 'ee/img_12.png',
  'PN-EO252':   'ee/img_13.png',
};

// ── Mapeo clase enchufe → imágenes de referencia ─────────────
const ENCHUFE_MAP = {
  'CLASE I':  ['enchufe/enc_10.png', 'enchufe/enc_07.jpeg'],  // pictograma + foto real 3 patas
  'CLASE II': ['enchufe/enc_02.png', 'enchufe/enc_08.jpeg'],  // pictograma + foto real 2 patas
  'CLASE III':['enchufe/enc_01.png'],                          // solo pictograma (inalámbrico)
};

// ── HTTP GET helper ───────────────────────────────────────────
function httpGet(url, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      if ([301,302,307].includes(res.statusCode)) {
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
        if (inQuote && line[i+1] === '"') { field += '"'; i++; }
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

// ── Descargar imagen como base64 ──────────────────────────────
async function downloadImage(path) {
  const url = BASE_URL + path;
  try {
    const res = await httpGet(url);
    if (res.status !== 200) {
      console.log(`Image ${path} status: ${res.status}`);
      return null;
    }
    const mime = path.endsWith('.jpeg') || path.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    return { base64: res.bodyBuffer.toString('base64'), mime, url };
  } catch(e) {
    console.log(`Error downloading ${path}:`, e.message);
    return null;
  }
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
  let filename = EE_MAP[modelNo];

  if (!filename) {
    for (const [key, val] of Object.entries(EE_MAP)) {
      if (key.includes(modelNo) || modelNo.includes(key)) {
        filename = val;
        console.log(`EE fuzzy: ${modelNo} → ${key}`);
        break;
      }
    }
  }

  if (!filename) {
    console.log(`EE: ${modelNo} no en mapa. Disponibles: ${Object.keys(EE_MAP).join(', ')}`);
    return { found: false, message: `Sin imagen EE para ${modelNo}` };
  }

  const img = await downloadImage(filename);
  if (!img) return { found: false, message: `Error descargando EE ${filename}` };

  console.log(`EE imagen descargada: ${filename} (${img.base64.length} chars)`);
  return { found: true, filename, imageBase64: img.base64, imageMime: img.mime };
}

// ── Obtener imágenes de referencia de enchufe ─────────────────
async function getEnchufeImages(claseEnchufe) {
  // Normalizar clase
  const claseUpper = (claseEnchufe || '').toUpperCase().trim();
  let key = null;
  if (claseUpper.includes('I') && !claseUpper.includes('II') && !claseUpper.includes('III')) key = 'CLASE I';
  else if (claseUpper.includes('III')) key = 'CLASE III';
  else if (claseUpper.includes('II')) key = 'CLASE II';

  if (!key) {
    console.log(`Enchufe: clase no reconocida: "${claseEnchufe}"`);
    return { found: false, message: `Clase enchufe no reconocida: ${claseEnchufe}` };
  }

  const paths = ENCHUFE_MAP[key];
  console.log(`Descargando imágenes enchufe ${key}: ${paths.join(', ')}`);

  const images = [];
  for (const path of paths) {
    const img = await downloadImage(path);
    if (img) images.push({ filename: path, base64: img.base64, mime: img.mime });
  }

  return {
    found: images.length > 0,
    clase: key,
    images,
    message: `${images.length} imágenes de referencia para ${key}`
  };
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
    // Buscar seguridad primero para obtener la clase de enchufe
    const seguridadResult = await searchSeguridad(modelNo);

    // Extraer clase de enchufe del checklist
    let claseEnchufe = '';
    if (seguridadResult.found && seguridadResult.data && seguridadResult.data[0]) {
      const row = seguridadResult.data[0];
      // Buscar por clave exacta, trimmed, o parcial
      for (const [k, v] of Object.entries(row)) {
        const kNorm = k.trim().toLowerCase().replace(/[^a-z]/g, '');
        if ((kNorm === 'enchufe' || kNorm.includes('enchufe')) && v && v.trim()) {
          claseEnchufe = v.trim();
          break;
        }
      }
      console.log('Clase enchufe del checklist: "' + claseEnchufe + '"');
      console.log('Keys disponibles:', Object.keys(row).join(' | '));
    }

    // Descargar EE e imágenes de enchufe en paralelo
    const [eeResult, enchufeResult] = await Promise.all([
      modelNo ? getEEImage(modelNo) : Promise.resolve({ found: false }),
      claseEnchufe ? getEnchufeImages(claseEnchufe) : Promise.resolve({ found: false, message: 'Clase enchufe no disponible' })
    ]);

    console.log(`Seguridad: ${seguridadResult.found} | EE: ${eeResult.found} | Enchufe imgs: ${enchufeResult.found} (${enchufeResult.images ? enchufeResult.images.length : 0})`);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...seguridadResult,
        ee: eeResult,
        enchufe_ref: enchufeResult
      })
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
