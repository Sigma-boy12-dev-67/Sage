// netlify/functions/chat.js

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

function getUserId(context) {
  return context?.clientContext?.user?.sub || null;
}

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
  };
}

async function saveConversation(userId, conversation) {
  const url = process.env.SUPABASE_URL;

  if (!url || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('Supabase environment variables are missing.');
  }

  const endpoint = `${url}/rest/v1/chats`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: userId,
      chat_id: conversation.id,
      title: conversation.title,
      messages: conversation.messages,
      created_at: new Date(conversation.createdAt).toISOString(),
      updated_at: new Date(conversation.updatedAt).toISOString(),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('Supabase save error:', response.status, detail);
    throw new Error('Could not save conversation.');
  }
}

async function loadConversations(userId) {
  const url = process.env.SUPABASE_URL;

  const query =
    `${url}/rest/v1/chats` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,chat_id,title,messages,created_at,updated_at` +
    `&order=updated_at.desc`;

  const response = await fetch(query, {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('Supabase load error:', response.status, detail);
    throw new Error('Could not load conversations.');
  }

  const rows = await response.json();

  return rows.map((row) => ({
    id: row.chat_id,
    title: row.title,
    messages: row.messages || [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }));
}

async function deleteConversation(userId, chatId) {
  const url = process.env.SUPABASE_URL;

  const query =
    `${url}/rest/v1/chats` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&chat_id=eq.${encodeURIComponent(chatId)}`;

  const response = await fetch(query, {
    method: 'DELETE',
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('Supabase delete error:', response.status, detail);
    throw new Error('Could not delete conversation.');
  }
}

exports.handler = async (event, context) => {
  const headers = jsonHeaders;

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed.' }),
    };
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error('GROQ_API_KEY is not set.');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Server is missing its API key configuration.',
      }),
    };
  }

  let payload;

  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'Invalid request body.',
      }),
    };
  }

  const action = payload.action || 'chat';
  const userId = getUserId(context);

  // -------------------------
  // LOAD CLOUD CONVERSATIONS
  // -------------------------
  if (action === 'load') {
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'You must be logged in.',
        }),
      };
    }

    try {
      const conversations = await loadConversations(userId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ conversations }),
      };
    } catch (err) {
      console.error(err);

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Could not load your conversations.',
        }),
      };
    }
  }

  // -------------------------
  // SAVE CLOUD CONVERSATION
  // -------------------------
  if (action === 'save') {
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'You must be logged in.',
        }),
      };
    }

    const conversation = payload.conversation;

    if (!conversation || !conversation.id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'A valid conversation is required.',
        }),
      };
    }

    try {
      await saveConversation(userId, conversation);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
        }),
      };
    } catch (err) {
      console.error(err);

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Could not save your conversation.',
        }),
      };
    }
  }

  // -------------------------
  // DELETE CLOUD CONVERSATION
  // -------------------------
  if (action === 'delete') {
    if (!userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: 'You must be logged in.',
        }),
      };
    }

    if (!payload.chatId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'A chat ID is required.',
        }),
      };
    }

    try {
      await deleteConversation(userId, payload.chatId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
        }),
      };
    } catch (err) {
      console.error(err);

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Could not delete the conversation.',
        }),
      };
    }
  }

  // -------------------------
  // NORMAL AI CHAT
  // -------------------------

  const { messages } = payload;

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'A non-empty "messages" array is required.',
      }),
    };
  }

  const sanitizedMessages = messages
    .filter(
      (m) =>
        m &&
        typeof m.content === 'string' &&
        ['user', 'assistant', 'system'].includes(m.role)
    )
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  if (sanitizedMessages.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'No valid messages were provided.',
      }),
    };
  }

  const SYSTEM_PROMPT = {
    role: 'system',
    content:
      'You are Sage, a helpful, friendly AI assistant. If asked your name, say you are Sage.',
  };

  const outgoingMessages =
    sanitizedMessages[0]?.role === 'system'
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
          error:
            "We're getting a lot of requests right now. Please wait a moment and try again.",
        }),
      };
    }

    if (!response.ok) {
      let detail = '';

      try {
        const errJson = await response.json();
        detail = errJson?.error?.message || '';
      } catch (e) {}

      console.error(
        'Groq API error:',
        response.status,
        detail
      );

      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error:
            'The AI service had a problem responding. Please try again in a moment.',
        }),
      };
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;

    if (!reply) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Received an empty response from the AI service.',
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error(
      'Unexpected error calling Groq:',
      err
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Unexpected server error. Please try again shortly.',
      }),
    };
  }
};
