// netlify/functions/chat.js
//
// Proxies chat requests to the Groq API so the API key never reaches
// the browser. Expects a POST body of { messages: [{role, content}, ...] }
// and returns { reply: "..." } on success or { error: "..." } on failure.

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed.' }),
    };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY is not set in environment variables.');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server is missing its API key configuration.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid request body.' }),
    };
  }

  const { messages } = payload;

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'A non-empty "messages" array is required.' }),
    };
  }

  // Only forward the fields Groq expects, and keep it to role/content.
  const sanitizedMessages = messages
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
    .map((m) => ({ role: m.role, content: m.content }));

  if (sanitizedMessages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'No valid messages were provided.' }),
    };
  }

  const SYSTEM_PROMPT = {
    role: 'system',
    content:
      'You are Sage, a helpful, friendly AI assistant. If asked your name, say you are Sage.',
  };

  // Only add the system prompt if the client hasn't already sent one.
  const outgoingMessages = sanitizedMessages[0]?.role === 'system'
    ? sanitizedMessages
    : [SYSTEM_PROMPT, ...sanitizedMessages];

  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: outgoingMessages,
        temperature: 0.7,
      }),
    });

    if (response.status === 429) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: "We're getting a lot of requests right now. Please wait a moment and try again.",
        }),
      };
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errJson = await response.json();
        detail = errJson?.error?.message || '';
      } catch (e) {
        // ignore parse failure, fall back to generic message
      }
      console.error('Groq API error:', response.status, detail);

      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error: 'The AI service had a problem responding. Please try again in a moment.',
        }),
      };
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;

    if (!reply) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Received an empty response from the AI service.' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error('Unexpected error calling Groq API:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Unexpected server error. Please try again shortly.' }),
    };
  }
};
