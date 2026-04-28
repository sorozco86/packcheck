exports.handler = async function(event) {
  // CORS preflight
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
      body: JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY no configurada en Netlify Environment Variables.' } })
    };
  }

  let body;
  try {
    // event.body can be base64-encoded by Netlify for binary payloads
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    body = JSON.parse(raw);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'Body inválido: ' + e.message } })
    };
  }

  // Log payload size for debugging
  const payloadSize = JSON.stringify(body).length;
  console.log('Payload size bytes:', payloadSize, '(', (payloadSize/1024/1024).toFixed(2), 'MB)');
  console.log('Model:', body.model, '| Messages count:', body.messages?.length);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    console.log('Anthropic status:', response.status);
    if (!response.ok) {
      console.log('Anthropic error body:', text.slice(0, 500));
    }

    return {
      statusCode: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: text
    };
  } catch (err) {
    console.log('Fetch error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { message: 'Error en proxy: ' + err.message } })
    };
  }
};
