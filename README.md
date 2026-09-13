# Sage

A ChatGPT-style chatbot web app named "Sage," built with plain HTML,
CSS, and vanilla JavaScript, backed by a Netlify serverless function
that proxies requests to the [Groq API](https://groq.com). Your API
key never reaches the browser, and conversation history is stored
only in your own browser's `localStorage` — nothing is stored
server-side.

## Features

- Clean, dark, ChatGPT-style UI
- Collapsible sidebar with full chat history; becomes a mobile overlay
  with a scrim on small screens
- "New chat" button and a topbar showing the active chat's title
- Welcome screen with 4 clickable suggestion prompts
- Auto-resizing composer textarea (Enter to send, Shift+Enter for a
  new line)
- Multiple conversations: create, switch, and delete (with a themed
  confirmation modal — no native browser `confirm()`)
- Conversations auto-title themselves from the first message
- Typing indicator while waiting on a response
- Light markdown support in responses: fenced code blocks, inline
  code, and **bold** text
- Friendly, human-readable error messages (including a specific
  message for rate limiting)
- Credits section in the sidebar footer

## Project structure

```
.
├── index.html
├── style.css
├── script.js
├── netlify.toml
├── package.json
├── netlify/
│   └── functions/
│       └── chat.js
└── README.md
```

## Prerequisites

- A [Groq API key](https://console.groq.com/keys) (free to create)
- A [Netlify](https://www.netlify.com/) account
- [Node.js](https://nodejs.org/) 18+ if you want to run things locally
- (Optional) the [Netlify CLI](https://docs.netlify.com/cli/get-started/):
  `npm install -g netlify-cli`

## Local development

1. Install the Netlify CLI if you haven't already:

   ```bash
   npm install -g netlify-cli
   ```

2. From the project folder, create a `.env` file (or use
   `netlify env:set`) with your Groq key:

   ```bash
   echo "GROQ_API_KEY=your_key_here" > .env
   ```

3. Start the local dev server, which serves the static files **and**
   runs the Netlify function so `/api/chat` works exactly like it will
   in production:

   ```bash
   netlify dev
   ```

4. Open the URL it prints (usually `http://localhost:8888`).

## Deploying to Netlify

### Option A — Netlify CLI

```bash
netlify init      # link or create a new site
netlify deploy --prod
```

### Option B — Git-based deploy

1. Push this project to a GitHub/GitLab/Bitbucket repository.
2. In the Netlify dashboard, click **Add new site → Import an existing
   project**, and select your repository.
3. Netlify will read `netlify.toml` automatically:
   - `publish = "."` — serves the static files from the project root
   - `functions = "netlify/functions"` — deploys `chat.js` as a
     serverless function
   - The `/api/chat` redirect points to the function so the frontend
     never needs to know the real `/.netlify/functions/chat` path.
4. **Set your environment variable**: in the Netlify dashboard go to
   **Site configuration → Environment variables** and add:

   | Key | Value |
   |---|---|
   | `GROQ_API_KEY` | your Groq API key |

5. Trigger a deploy (or it will deploy automatically on push).

That's it — no build step is required since this is plain HTML/CSS/JS.

## How it works

- The frontend (`script.js`) keeps all conversations in an array
  persisted to `localStorage` under the key `groq-chat-conversations`.
- When you send a message, the full message history for the active
  conversation is POSTed as JSON to `/api/chat`.
- `netlify.toml` redirects `/api/chat` to the `chat` serverless
  function.
- The function (`netlify/functions/chat.js`) reads `GROQ_API_KEY` from
  the environment, calls Groq's OpenAI-compatible endpoint
  (`https://api.groq.com/openai/v1/chat/completions`) using the
  `openai/gpt-oss-120b` model, and returns `{ reply: "..." }`.
- If Groq returns an error, the function returns a clean
  `{ error: "..." }` message — including a specific friendly message
  when Groq responds with a 429 (rate limit).

## Customizing

- **Model**: change the `MODEL` constant in
  `netlify/functions/chat.js` to any other Groq-supported model.
- **Credits section**: edit the email/GitHub link in the
  `.sidebar-footer` block of `index.html`.
- **Suggestion prompts**: edit the four `.suggestion-card` buttons in
  `index.html` (the `data-prompt` attribute is what gets sent when
  clicked).
- **Theme colors**: tweak the CSS custom properties at the top of
  `style.css` (`:root { ... }`).

## Privacy note

Conversation history lives only in your browser's `localStorage`. The
only data that leaves your device is the message history sent to
`/api/chat` for generating a reply — nothing is persisted on the
server.
