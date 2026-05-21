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
const SHEET_GID_EE = '954640049';

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
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: body.toString('utf8'), bodyBuffer: body });
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
      } else {
        field += ch;
      }
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

// ── Columna index → letra ─────────────────────────────────────
function colToLetter(n) {
  let letter = '';
  n = n + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

// ── Buscar modelo en Seguridad Eléctrica (CSV) ────────────────
async function searchSeguridad(modelNo) {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID_SEGURIDAD}`;
  const res = await httpGet(csvUrl);
  if (res.status !== 200) throw new Error('No se pudo leer checklist seguridad: ' + res.status);

  const rows = parseCSV(res.body);
  if (!rows || rows.length === 0) return { found: false, message: 'Planilla vacía' };

  const headers = rows[0];
  const COL_MODEL = 4;

  const matches = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cellValue = (row[COL_MODEL] || '').trim().toUpperCase();
    if (cellValue === modelNo || cellValue.includes(modelNo) || modelNo.includes(cellValue)) {
      matches.push(rowToObj(headers, row));
    }
  }

  if (matches.length === 0) {
    const fuzzy = [];
    for (let i = 1; i < rows.length; i++) {
      const cell = (rows[i][COL_MODEL] || '').trim().toUpperCase();
      const base = modelNo.replace(/[^A-Z0-9]/g, '');
      const cellBase = cell.replace(/[^A-Z0-9]/g, '');
      if (base.length >= 4 && (cellBase.includes(base.substring(0, 6)) || base.includes(cellBase.substring(0, 6)))) {
        fuzzy.push(rowToObj(headers, rows[i]));
      }
    }
    if (fuzzy.length > 0) return { found: true, count: fuzzy.length, data: fuzzy, fuzzy: true };
    return { found: false, message: `Modelo "${modelNo}" no encontrado en checklist` };
  }

  return { found: true, count: matches.length, data: matches };
}

// ── Buscar imagen EE del modelo via Google Sheets API ─────────
async function searchEEImage(modelNo) {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    console.log('GOOGLE_SHEETS_API_KEY no configurada');
    return { found: false, message: 'API key no configurada' };
  }

  // Paso 1: Leer fila 4 para encontrar la columna del modelo
  const rangeModelos = encodeURIComponent("'Checklist Eficiencia Energetica'!A4:ZZ4");
  const urlModelos = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${rangeModelos}?key=${apiKey}`;
  console.log('Consultando fila 4 de EE...');

  const resModelos = await httpGet(urlModelos);
  console.log('Fila 4 status:', resModelos.status);

  if (resModelos.status !== 200) {
    console.log('Error fila 4:', resModelos.body.substring(0, 300));
    return { found: false, message: 'Error leyendo hoja EE: ' + resModelos.status + ' - ' + resModelos.body.substring(0, 200) };
  }

  const dataModelos = JSON.parse(resModelos.body);
  const filaModelos = (dataModelos.values && dataModelos.values[0]) || [];
  console.log('Modelos en fila 4:', filaModelos.length, 'columnas');
  console.log('Primeros modelos:', filaModelos.slice(0, 5).join(', '));

  // Buscar columna del modelo
  let colIndex = -1;
  const modelUpper = modelNo.toUpperCase().trim();
  for (let i = 0; i < filaModelos.length; i++) {
    const cellVal = (filaModelos[i] || '').toString().toUpperCase().trim();
    if (cellVal === modelUpper || cellVal.includes(modelUpper) || modelUpper.includes(cellVal)) {
      colIndex = i;
      console.log('Modelo encontrado en columna', i, '=', colToLetter(i), 'valor:', filaModelos[i]);
      break;
    }
  }

  if (colIndex === -1) {
    console.log('Modelo no encontrado en fila 4. Modelos disponibles:', filaModelos.join(', '));
    return { found: false, message: `Modelo "${modelNo}" no encontrado en hoja EE. Columnas disponibles: ${filaModelos.slice(0,10).join(', ')}` };
  }

  const colLetter = colToLetter(colIndex);

  // Paso 2: Leer celda fila 6 de esa columna
  const rangeCelda = encodeURIComponent(`'Checklist Eficiencia Energetica'!${colLetter}6`);
  const urlCelda = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${rangeCelda}?key=${apiKey}`;
  console.log('Leyendo celda EE:', colLetter + '6');

  const resCelda = await httpGet(urlCelda);
  console.log('Celda EE status:', resCelda.status);

  let cellContent = '';
  if (resCelda.status === 200) {
    const dataCelda = JSON.parse(resCelda.body);
    cellContent = (dataCelda.values && dataCelda.values[0] && dataCelda.values[0][0]) || '';
    console.log('Contenido celda EE:', cellContent.substring(0, 200));
  }

  // Paso 3: Intentar leer imagen via API con includeGridData
  const urlGrid = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${apiKey}&includeGridData=true&ranges=${encodeURIComponent(`'Checklist Eficiencia Energetica'!${colLetter}6:${colLetter}6`)}&fields=sheets(data(rowData(values(userEnteredValue,effectiveValue,formattedValue,hyperlink,userEnteredFormat))))`;
  console.log('Leyendo grid data para imagen...');

  const resGrid = await httpGet(urlGrid);
  console.log('Grid status:', resGrid.status);

  let imageUrl = null;
  let imageBase64 = null;
  let imageMime = 'image/png';

  if (resGrid.status === 200) {
    const gridData = JSON.parse(resGrid.body);
    console.log('Grid data (first 500):', JSON.stringify(gridData).substring(0, 500));

    try {
      const sheets = gridData.sheets || [];
      for (const sheet of sheets) {
        const data = sheet.data || [];
        for (const d of data) {
          const rowData = d.rowData || [];
          for (const row of rowData) {
            const values = row.values || [];
            for (const cell of values) {
              const uev = cell.userEnteredValue || {};
              // Buscar formula IMAGE()
              if (uev.formulaValue) {
                console.log('Formula en celda EE:', uev.formulaValue);
                const match = uev.formulaValue.match(/IMAGE\s*\(\s*["']([^"']+)["']/i);
                if (match) { imageUrl = match[1]; console.log('Image URL from formula:', imageUrl); }
              }
              if (cell.hyperlink) {
                console.log('Hyperlink en celda EE:', cell.hyperlink);
                imageUrl = imageUrl || cell.hyperlink;
              }
            }
          }
        }
      }
    } catch(e) {
      console.log('Error parseando grid:', e.message);
    }
  }

  // Paso 4: Si tenemos URL, descargar imagen como base64
  if (imageUrl) {
    try {
      console.log('Descargando imagen desde:', imageUrl);
      const resImg = await httpGet(imageUrl);
      if (resImg.status === 200) {
        imageBase64 = resImg.bodyBuffer.toString('base64');
        if (imageUrl.toLowerCase().match(/\.(jpg|jpeg)/)) imageMime = 'image/jpeg';
        else if (imageUrl.toLowerCase().includes('.gif')) imageMime = 'image/gif';
        console.log('Imagen descargada, base64 length:', imageBase64.length);
      } else {
        console.log('Error descargando imagen:', resImg.status);
      }
    } catch(e) {
      console.log('Error descargando imagen:', e.message);
    }
  }

  return {
    found: true,
    model: modelNo,
    col: colLetter,
    colIndex: colIndex,
    cellContent: cellContent,
    imageUrl: imageUrl,
    imageBase64: imageBase64,
    imageMime: imageMime,
    message: imageBase64
      ? `Imagen de referencia EE encontrada para ${modelNo}`
      : `Modelo ${modelNo} en columna ${colLetter}, imagen no disponible (formula: ${imageUrl || 'ninguna'})`
  };
}

// ── Handler principal ─────────────────────────────────────────
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  let modelNo = '';
  let action = 'search';

  try {
    if (event.httpMethod === 'GET') {
      modelNo = (event.queryStringParameters && event.queryStringParameters.model) || '';
      action = (event.queryStringParameters && event.queryStringParameters.action) || 'search';
    } else {
      const body = JSON.parse(event.body || '{}');
      modelNo = body.model || '';
      action = body.action || 'search';
    }
  } catch(e) {
    console.log('Parse body error:', e.message);
  }

  modelNo = modelNo.trim().toUpperCase();
  console.log('sheets.js - model:', modelNo, 'action:', action);

  try {
    if (action === 'ee_image') {
      const eeResult = await searchEEImage(modelNo);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(eeResult)
      };
    }

    // Búsqueda principal: seguridad + EE en paralelo
    const results = await Promise.allSettled([
      searchSeguridad(modelNo),
      modelNo ? searchEEImage(modelNo) : Promise.resolve({ found: false })
    ]);

    const seguridadResult = results[0].status === 'fulfilled'
      ? results[0].value
      : { found: false, message: 'Error: ' + results[0].reason.message };

    const eeResult = results[1].status === 'fulfilled'
      ? results[1].value
      : { found: false, message: 'Error EE: ' + results[1].reason.message };

    console.log('Seguridad found:', seguridadResult.found, 'EE found:', eeResult.found, 'EE image:', !!eeResult.imageBase64);

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
      body: JSON.stringify({ error: 'Error interno: ' + e.message, found: false })
    };
  }
};
