// netlify/functions/chat.js
//
// Sage backend:
// - Sends chat messages to Groq
// - Saves/loads/deletes logged-in users' conversations in Supabase
// - Keeps Groq and Supabase secret keys on the server

const GROQ_ENDPOINT =
  'https://api.groq.com/openai/v1/chat/completions';

const MODEL = 'openai/gpt-oss-120b';

const SUPABASE_TABLE = 'chats';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

// Get the logged-in Netlify Identity user.
// Netlify provides this through the function context when the
// frontend sends the user's Identity JWT.
function getNetlifyUser(context) {
  return context?.clientContext?.user || null;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ''),
    secretKey,
  };
}

async function supabaseRequest(path, options = {}) {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error(
      'SUPABASE_URL or SUPABASE_SECRET_KEY is not configured.'
    );
  }

  const response = await fetch(
    `${config.url}/rest/v1/${SUPABASE_TABLE}${path}`,
    {
      ...options,
      headers: {
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json',
        Prefer: options.prefer || 'return=representation',
        ...(options.headers || {}),
      },
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error(
      'Supabase error:',
      response.status,
      data
    );

    throw new Error(
      typeof data === 'object' && data?.message
        ? data.message
        : 'Supabase request failed.'
    );
  }

  return data;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(
      (m) =>
        m &&
        typeof m.content === 'string' &&
        (
          m.role === 'user' ||
          m.role === 'assistant' ||
          m.role === 'system'
        )
    )
    .map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.isError ? { isError: true } : {}),
    }));
}

async function saveConversation(userId, conversation) {
  if (!conversation || !conversation.id) {
    throw new Error('Invalid conversation.');
  }

  const messages = sanitizeMessages(
    conversation.messages
  );

  const title =
    typeof conversation.title === 'string' &&
    conversation.title.trim()
      ? conversation.title.trim()
      : 'New chat';

  const createdAt =
    Number.isFinite(conversation.createdAt)
      ? new Date(conversation.createdAt).toISOString()
      : new Date().toISOString();

  const updatedAt = new Date().toISOString();

  const rows = await supabaseRequest(
    `?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(conversation.id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        title,
        messages,
        updated_at: updatedAt,
      }),
    }
  );

  // If the conversation didn't already exist, create it.
  if (!Array.isArray(rows) || rows.length === 0) {
    const inserted = await supabaseRequest('', {
      method: 'POST',
      body: JSON.stringify({
        id: conversation.id,
        user_id: userId,
        title,
        messages,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    });

    return Array.isArray(inserted)
      ? inserted[0]
      : inserted;
  }

  return rows[0];
}

async function loadConversations(userId) {
  const data = await supabaseRequest(
    `?user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`,
    {
      method: 'GET',
    }
  );

  return Array.isArray(data) ? data : [];
}

async function deleteConversation(userId, conversationId) {
  await supabaseRequest(
    `?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(conversationId)}`,
    {
      method: 'DELETE',
      prefer: 'return=minimal',
    }
  );
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return json(405, {
      error: 'Method not allowed.',
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, {
      error: 'Invalid request body.',
    });
  }

  const action = payload.action || 'chat';

  // ---------- Authenticated actions ----------

  if (
    action === 'load' ||
    action === 'save' ||
    action === 'delete'
  ) {
    const user = getNetlifyUser(context);

    if (!user) {
      return json(401, {
        error: 'You must be logged in to use saved chats.',
      });
    }

    const userId = user.sub || user.id;

    if (!userId) {
      return json(401, {
        error: 'Could not identify the logged-in user.',
      });
    }

    try {
      if (action === 'load') {
        const conversations =
          await loadConversations(userId);

        return json(200, {
          conversations,
        });
      }

      if (action === 'save') {
        const conversation =
          await saveConversation(
            userId,
            payload.conversation
          );

        return json(200, {
          conversation,
        });
      }

      if (action === 'delete') {
        const conversationId =
          payload.conversationId;

        if (!conversationId) {
          return json(400, {
            error: 'A conversation ID is required.',
          });
        }

        await deleteConversation(
          userId,
          conversationId
        );

        return json(200, {
          success: true,
        });
      }
    } catch (err) {
      console.error(
        'Supabase operation failed:',
        err
      );

      return json(500, {
        error:
          'Could not access saved chat history. Please try again.',
      });
    }
  }

  // ---------- Groq chat ----------

  const apiKey =
    process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error(
      'GROQ_API_KEY is not set in environment variables.'
    );

    return json(500, {
      error:
        'Server is missing its API key configuration.',
    });
  }

  const messages =
    sanitizeMessages(payload.messages);

  if (messages.length === 0) {
    return json(400, {
      error:
        'A non-empty "messages" array is required.',
    });
  }

  const SYSTEM_PROMPT = {
    role: 'system',
    content:
      'You are Sage, a helpful, friendly AI assistant. If asked your name, say you are Sage.',
  };

  const outgoingMessages =
    messages[0]?.role === 'system'
      ? messages
      : [SYSTEM_PROMPT, ...messages];

  try {
    const response = await fetch(
      GROQ_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          Authorization:
            `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: outgoingMessages,
          temperature: 0.7,
        }),
      }
    );

    if (response.status === 429) {
      return json(429, {
        error:
          "We're getting a lot of requests right now. Please wait a moment and try again.",
      });
    }

    if (!response.ok) {
      let detail = '';

      try {
        const errJson =
          await response.json();

        detail =
          errJson?.error?.message || '';
      } catch {
        // Ignore parse failure.
      }

      console.error(
        'Groq API error:',
        response.status,
        detail
      );

      return json(response.status, {
        error:
          'The AI service had a problem responding. Please try again in a moment.',
      });
    }

    const data =
      await response.json();

    const reply =
      data?.choices?.[0]?.message?.content;

    if (!reply) {
      return json(502, {
        error:
          'Received an empty response from the AI service.',
      });
    }

    return json(200, {
      reply,
    });
  } catch (err) {
    console.error(
      'Unexpected error calling Groq API:',
      err
    );

    return json(500, {
      error:
        'Unexpected server error. Please try again shortly.',
    });
  }
};
