const https = require('https');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY no configurada.' } })
    };
  }

  let bodyStr;
  try {
    bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  } catch(e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'Body error: ' + e.message } })
    };
  }

  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch(e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'JSON invalido: ' + e.message } })
    };
  }

  const hasPDF = (body.messages || []).some(m =>
    (Array.isArray(m.content) ? m.content : []).some(b => b.type === 'document')
  );

  const sizeMB = (Buffer.byteLength(bodyStr, 'utf8') / 1024 / 1024).toFixed(2);
  console.log('Request size:', sizeMB, 'MB | hasPDF:', hasPDF);

  // Use node https directly to avoid fetch timeout issues
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
        'anthropic-version': '2023-06-01',
        ...(hasPDF ? { 'anthropic-beta': 'pdfs-2024-09-25' } : {})
      }
    };

    let responseData = '';
    let statusCode = 200;

    const req = https.request(options, (res) => {
      statusCode = res.statusCode;
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        console.log('Anthropic status:', statusCode, '| Response size:', responseData.length);
        resolve({
          statusCode,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: responseData
        });
      });
    });

    req.on('error', (e) => {
      console.log('Request error:', e.message);
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: { message: 'Proxy error: ' + e.message } })
      });
    });

    req.setTimeout(840000, () => {
      req.destroy();
      resolve({
        statusCode: 504,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: { message: 'Timeout: el analisis tardo mas de 14 minutos.' } })
      });
    });

    req.write(postData);
    req.end();
  });
};
