const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

exports.handler = async function(event) {

  // ── Preflight CORS ──────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  // ── API Key ─────────────────────────────────────────────────
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY no configurada.' } })
    };
  }

  // ── Parse body ──────────────────────────────────────────────
  let bodyStr;
  try {
    bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  } catch(e) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Body error: ' + e.message } })
    };
  }

  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch(e) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'JSON inválido: ' + e.message } })
    };
  }

  const sizeMB = (Buffer.byteLength(bodyStr, 'utf8') / 1024 / 1024).toFixed(2);
  console.log('Request size:', sizeMB, 'MB | model:', body.model || '?', '| max_tokens:', body.max_tokens || '?');

  // ── Forward a Anthropic ─────────────────────────────────────
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    };

    let responseData = '';
    let statusCode = 200;

    const req = https.request(options, (res) => {
      statusCode = res.statusCode;
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        console.log('Anthropic status:', statusCode);
        if (statusCode !== 200) console.log('Error body:', responseData.slice(0, 500));
        resolve({
          statusCode,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: responseData
        });
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e.message);
      resolve({
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { message: 'Proxy error: ' + e.message } })
      });
    });

    req.setTimeout(840000, () => {
      req.destroy();
      resolve({
        statusCode: 504,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { message: 'Timeout después de 14 minutos.' } })
      });
    });

    req.write(postData);
    req.end();
  });
};
