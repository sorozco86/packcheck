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
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'Body error: ' + e.message } }) };
  }

  // Log size for debugging
  const sizeMB = (Buffer.byteLength(bodyStr, 'utf8') / 1024 / 1024).toFixed(2);
  console.log('Request size:', sizeMB, 'MB');

  if (parseFloat(sizeMB) > 20) {
    return {
      statusCode: 413,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'Payload demasiado grande: ' + sizeMB + ' MB. Maximo 20 MB.' } })
    };
  }

  let body;
  try {
    body = JSON.parse(bodyStr);
  } catch(e) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'JSON invalido: ' + e.message } }) };
  }

  const hasPDF = (body.messages || []).some(m =>
    (Array.isArray(m.content) ? m.content : []).some(b => b.type === 'document')
  );

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    };
    if (hasPDF) headers['anthropic-beta'] = 'pdfs-2024-09-25';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const text = await response.text();
    console.log('Anthropic status:', response.status, '| Response size:', text.length, 'chars');
    if (!response.ok) console.log('Error:', text.slice(0, 400));

    return {
      statusCode: response.status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: text
    };
  } catch(err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'Proxy error: ' + err.message } })
    };
  }
};
