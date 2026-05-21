const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

// ID de la planilla y rango a leer
const SHEET_ID = '11QwwtQ27S-Z0ZXSptjq2MCedSC8_O4Jo01blqDzjBTI';
const SHEET_GID = '1053060950';
const RANGE = 'A1:Z500'; // Ajustar según el tamaño real de la planilla

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Obtener el modelo buscado desde query param o body
  let modelNo = '';
  if (event.httpMethod === 'GET') {
    modelNo = (event.queryStringParameters && event.queryStringParameters.model) || '';
  } else if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      modelNo = body.model || '';
    } catch(e) {}
  }

  modelNo = modelNo.trim().toUpperCase();

  // Obtener nombre de la hoja desde el GID
  // Usamos la URL de exportación CSV que es pública sin API key
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

  return new Promise((resolve) => {
    https.get(csvUrl, (res) => {
      // Manejar redirecciones
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        https.get(redirectUrl, (res2) => {
          let data = '';
          res2.on('data', chunk => { data += chunk; });
          res2.on('end', () => {
            resolve(processCSV(data, modelNo));
          });
        }).on('error', (e) => {
          resolve({
            statusCode: 500,
            headers: { ...CORS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Error al obtener la planilla: ' + e.message })
          });
        });
        return;
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve(processCSV(data, modelNo));
      });
    }).on('error', (e) => {
      resolve({
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error de conexión: ' + e.message })
      });
    });
  });
};

function processCSV(csvData, modelNo) {
  try {
    // Parsear CSV simple (maneja comillas)
    const rows = parseCSV(csvData);
    if (!rows || rows.length === 0) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ found: false, model: modelNo, message: 'Planilla vacía o no accesible', rows: [] })
      };
    }

    const headers = rows[0];
    console.log('Headers:', headers.join(' | '));
    console.log('Total rows:', rows.length);
    console.log('Buscando modelo:', modelNo);

    // Columna E = índice 4 (0-based)
    const COL_MODEL = 4;

    // Si no hay modelo, devolver todas las filas (primeras 5 para diagnóstico)
    if (!modelNo) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          found: false,
          model: '',
          message: 'No se especificó modelo',
          headers: headers,
          sample: rows.slice(1, 6).map(r => rowToObj(headers, r))
        })
      };
    }

    // Buscar el modelo en columna E (índice 4)
    const matches = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cellValue = (row[COL_MODEL] || '').trim().toUpperCase();
      if (cellValue === modelNo || cellValue.includes(modelNo) || modelNo.includes(cellValue)) {
        matches.push(rowToObj(headers, row));
      }
    }

    if (matches.length === 0) {
      // Buscar coincidencia parcial más flexible
      const fuzzy = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        for (let j = 0; j < row.length; j++) {
          const val = (row[j] || '').trim().toUpperCase();
          if (val && modelNo && val.includes(modelNo.substring(0, 4))) {
            fuzzy.push(rowToObj(headers, row));
            break;
          }
        }
      }
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          found: false,
          model: modelNo,
          message: 'Modelo no encontrado en columna E',
          fuzzy: fuzzy.slice(0, 3),
          headers: headers
        })
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        found: true,
        model: modelNo,
        count: matches.length,
        data: matches,
        headers: headers
      })
    };

  } catch(e) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error procesando planilla: ' + e.message })
    };
  }
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h || 'col_' + i] = row[i] || '';
  });
  return obj;
}

function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    rows.push(parseCSVLine(line));
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}