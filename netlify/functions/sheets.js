const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

const SHEET_ID = '11QwwtQ27S-Z0ZXSptjq2MCedSC8_O4Jo01blqDzjBTI';
const SHEET_GID_SEGURIDAD = '1053060950';   // Checklist Seguridad Eléctrica
const SHEET_GID_EE = '954640049';           // Checklist Eficiencia Energetica

// ── Helper: HTTP GET con promesa ──────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const handler = (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    };
    const req = (url.startsWith('https') ? https : require('http')).get(url, handler);
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
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

// ── Buscar modelo en hoja Seguridad Eléctrica (CSV) ──────────
async function searchSeguridad(modelNo) {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID_SEGURIDAD}`;
  const res = await httpGet(csvUrl);
  if (res.status !== 200) throw new Error('No se pudo leer el checklist de seguridad');

  const rows = parseCSV(res.body);
  if (!rows || rows.length === 0) return { found: false, message: 'Planilla vacía' };

  const headers = rows[0];
  const COL_MODEL = 4; // Columna E

  const matches = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cellValue = (row[COL_MODEL] || '').trim().toUpperCase();
    if (cellValue === modelNo || cellValue.includes(modelNo) || modelNo.includes(cellValue)) {
      matches.push(rowToObj(headers, row));
    }
  }

  if (matches.length === 0) {
    // Búsqueda fuzzy
    const fuzzy = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cell = (row[COL_MODEL] || '').trim().toUpperCase();
      const base = modelNo.replace(/[^A-Z0-9]/g, '');
      const cellBase = cell.replace(/[^A-Z0-9]/g, '');
      if (base.length >= 4 && (cellBase.includes(base.substring(0, 6)) || base.includes(cellBase.substring(0, 6)))) {
        fuzzy.push(rowToObj(headers, row));
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
    return { found: false, message: 'GOOGLE_SHEETS_API_KEY no configurada' };
  }

  try {
    // Paso 1: Leer fila 4 (títulos de modelos) de la hoja EE
    // La API de Sheets usa notación A1, fila 4 = row index 3
    const rangeModelos = `'Checklist Eficiencia Energetica'!A4:ZZ4`;
    const urlModelos = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rangeModelos)}?key=${apiKey}`;

    const resModelos = await httpGet(urlModelos);
    if (resModelos.status !== 200) {
      return { found: false, message: 'Error leyendo hoja EE: ' + resModelos.status };
    }

    const dataModelos = JSON.parse(resModelos.body);
    const filaModelos = (dataModelos.values && dataModelos.values[0]) || [];

    // Buscar columna del modelo
    let colIndex = -1;
    const modelUpper = modelNo.toUpperCase().trim();
    for (let i = 0; i < filaModelos.length; i++) {
      const cellVal = (filaModelos[i] || '').toString().toUpperCase().trim();
      if (cellVal === modelUpper || cellVal.includes(modelUpper) || modelUpper.includes(cellVal)) {
        colIndex = i;
        break;
      }
    }

    if (colIndex === -1) {
      return { found: false, message: `Modelo "${modelNo}" no encontrado en hoja EE (fila 4)` };
    }

    // Convertir índice a letra de columna (0=A, 1=B, etc.)
    function colToLetter(n) {
      let letter = '';
      n = n + 1; // 1-based
      while (n > 0) {
        const rem = (n - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        n = Math.floor((n - 1) / 26);
      }
      return letter;
    }

    const colLetter = colToLetter(colIndex);
    console.log(`Modelo ${modelNo} encontrado en columna ${colLetter} (índice ${colIndex}) de hoja EE`);

    // Paso 2: Obtener metadata de imágenes via API de imágenes de Sheets
    // Usamos el endpoint de imágenes celulares de la API
    const urlImages = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${apiKey}&fields=sheets(properties(title,sheetId),data(rowData(values(userEnteredValue,effectiveValue,formattedValue,hyperlink))))&ranges='Checklist Eficiencia Energetica'!${colLetter}6`;

    const resImages = await httpGet(urlImages);
    if (resImages.status !== 200) {
      return {
        found: true,
        model: modelNo,
        col: colLetter,
        colIndex: colIndex,
        message: 'Modelo encontrado pero no se pudo leer imagen: ' + resImages.status,
        imageUrl: null
      };
    }

    const dataImages = JSON.parse(resImages.body);

    // Extraer URL de imagen si existe
    let imageUrl = null;
    try {
      const sheets = dataImages.sheets || [];
      for (const sheet of sheets) {
        const rowData = (sheet.data && sheet.data[0] && sheet.data[0].rowData) || [];
        for (const row of rowData) {
          const values = row.values || [];
          for (const cell of values) {
            // Buscar IMAGE() formula o hyperlink con imagen
            const uev = cell.userEnteredValue || {};
            if (uev.formulaValue && uev.formulaValue.toUpperCase().includes('IMAGE')) {
              const match = uev.formulaValue.match(/IMAGE\s*\(\s*["']([^"']+)["']/i);
              if (match) imageUrl = match[1];
            }
            if (cell.hyperlink) imageUrl = cell.hyperlink;
          }
        }
      }
    } catch(e) {
      console.log('Error parsing image data:', e.message);
    }

    // Paso 3: Si hay URL de imagen, descargarla como base64
    let imageBase64 = null;
    let imageMime = 'image/png';
    if (imageUrl) {
      try {
        const resImg = await httpGet(imageUrl);
        if (resImg.status === 200) {
          imageBase64 = Buffer.from(resImg.body, 'binary').toString('base64');
          if (imageUrl.toLowerCase().includes('.jpg') || imageUrl.toLowerCase().includes('.jpeg')) {
            imageMime = 'image/jpeg';
          }
        }
      } catch(e) {
        console.log('Error downloading image:', e.message);
      }
    }

    // Paso 4: Intentar también con el endpoint de renderizado de celdas
    // Si no tenemos imagen aún, intentar con la API de imágenes embebidas
    if (!imageBase64) {
      try {
        const urlCellImages = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/developerMetadata?key=${apiKey}`;
        // Alternativa: usar el thumbnail de la celda via Drive API
        const urlThumb = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${apiKey}&fields=sheets(data(rowMetadata,columnMetadata))&includeGridData=true&ranges='Checklist Eficiencia Energetica'!${colLetter}6:${colLetter}6`;
        const resThumb = await httpGet(urlThumb);
        console.log('Thumb response status:', resThumb.status);
        console.log('Thumb response (first 500):', resThumb.body.substring(0, 500));
      } catch(e) {
        console.log('Error fetching thumb:', e.message);
      }
    }

    return {
      found: true,
      model: modelNo,
      col: colLetter,
      colIndex: colIndex,
      imageUrl: imageUrl,
      imageBase64: imageBase64,
      imageMime: imageMime,
      message: imageBase64
        ? `Imagen de referencia EE encontrada para ${modelNo}`
        : `Modelo encontrado en columna ${colLetter} pero imagen no disponible via API`
    };

  } catch(e) {
    console.log('searchEEImage error:', e.message);
    return { found: false, message: 'Error consultando hoja EE: ' + e.message };
  }
}

// ── Handler principal ─────────────────────────────────────────
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  let modelNo = '';
  let action = 'search'; // 'search' | 'ee_image'

  if (event.httpMethod === 'GET') {
    modelNo = (event.queryStringParameters && event.queryStringParameters.model) || '';
    action = (event.queryStringParameters && event.queryStringParameters.action) || 'search';
  } else if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      modelNo = body.model || '';
      action = body.action || 'search';
    } catch(e) {}
  }

  modelNo = modelNo.trim().toUpperCase();

  try {
    if (action === 'ee_image') {
      // Solo buscar imagen EE
      const eeResult = await searchEEImage(modelNo);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(eeResult)
      };
    }

    // Acción default: buscar en Seguridad Eléctrica + imagen EE en paralelo
    const [seguridadResult, eeResult] = await Promise.all([
      searchSeguridad(modelNo),
      modelNo ? searchEEImage(modelNo) : Promise.resolve({ found: false })
    ]);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...seguridadResult,
        ee: eeResult
      })
    };

  } catch(e) {
    console.error('Handler error:', e.message);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error interno: ' + e.message })
    };
  }
};
