(() => {
  'use strict';

  const STORAGE_KEY = 'groq-chat-conversations';
  const API_ENDPOINT = '/api/chat';

  /** @type {{id: string, title: string, messages: {role: string, content: string}[], createdAt: number}[]} */
  let conversations = [];
  let activeId = null;
  let isSending = false;
  let pendingDeleteId = null;

  // ---------- DOM references ----------
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const chatListEl = document.getElementById('chatList');
  const chatTitleEl = document.getElementById('chatTitle');
  const messagesContainer = document.getElementById('messagesContainer');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const messagesEl = document.getElementById('messages');
  const composerInput = document.getElementById('composerInput');
  const sendBtn = document.getElementById('sendBtn');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalMessage = document.getElementById('modalMessage');
  const modalCancelBtn = document.getElementById('modalCancelBtn');
  const modalConfirmBtn = document.getElementById('modalConfirmBtn');
  const userArea = document.getElementById('userArea');

  // ---------- Authentication ----------
  function renderUserArea(user) {
    if (!userArea) return;

    if (user) {
      const email = escapeHtml(user.email || 'Logged-in user');

      userArea.innerHTML = `
        <div class="account-row">
          <span class="account-status-dot"></span>
          <span class="account-email" title="${email}">
            ${email}
          </span>
        </div>

        <button
          type="button"
          id="logoutBtn"
          class="auth-link-button"
        >
          Log out
        </button>
      `;

      const logoutBtn = document.getElementById('logoutBtn');

      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          netlifyIdentity.logout();
        });
      }

    } else {

      userArea.innerHTML = `
        <div class="auth-actions">

          <button
            type="button"
            id="signupBtn"
            class="auth-button auth-button-primary"
          >
            Sign up
          </button>

          <button
            type="button"
            id="loginBtn"
            class="auth-button auth-button-secondary"
          >
            Log in
          </button>

        </div>
      `;

      const signupBtn = document.getElementById('signupBtn');
      const loginBtn = document.getElementById('loginBtn');

      if (signupBtn) {
        signupBtn.addEventListener('click', () => {
          netlifyIdentity.open('signup');
        });
      }

      if (loginBtn) {
        loginBtn.addEventListener('click', () => {
          netlifyIdentity.open('login');
        });
      }
    }
  }

  function initializeAuthentication() {
    if (typeof netlifyIdentity === 'undefined') {
      console.error('Netlify Identity is not available.');
      return;
    }

    netlifyIdentity.on('init', (user) => {
      renderUserArea(user);
    });

    netlifyIdentity.on('login', (user) => {
      renderUserArea(user);
      netlifyIdentity.close();
    });

    netlifyIdentity.on('logout', () => {
      renderUserArea(null);
    });

    netlifyIdentity.on('error', (error) => {
      console.error('Netlify Identity error:', error);
    });

    netlifyIdentity.init();
  }

  // ---------- Persistence ----------
  function loadConversations() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      conversations = raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load conversations', e);
      conversations = [];
    }
  }

  function saveConversations() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(conversations)
      );
    } catch (e) {
      console.error('Failed to save conversations', e);
    }
  }

  // ---------- Helpers ----------
  function genId() {
    return (
      'c_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function getActiveConversation() {
    return conversations.find((c) => c.id === activeId) || null;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Very small markdown subset:
  // fenced code blocks, inline code, **bold**
  function renderMarkdown(text) {
    const escaped = escapeHtml(text);
    const codeBlocks = [];

    let out = escaped.replace(
      /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g,
      (_, _lang, code) => {
        const idx = codeBlocks.length;

        codeBlocks.push(
          `<pre><code>${code.replace(/\n$/, '')}</code></pre>`
        );

        return `\u0000CODEBLOCK${idx}\u0000`;
      }
    );

    out = out.replace(
      /`([^`\n]+)`/g,
      '<code>$1</code>'
    );

    out = out.replace(
      /\*\*([^*]+)\*\*/g,
      '<strong>$1</strong>'
    );

    out = out.replace(
      /\u0000CODEBLOCK(\d+)\u0000/g,
      (_, idx) => codeBlocks[Number(idx)]
    );

    return out;
  }

  function titleFromMessage(text) {
    const trimmed = text
      .trim()
      .replace(/\s+/g, ' ');

    if (trimmed.length <= 40) {
      return trimmed;
    }

    return trimmed.slice(0, 40).trim() + '…';
  }

  // ---------- Sidebar ----------
  function renderChatList() {
    chatListEl.innerHTML = '';

    if (conversations.length === 0) {
      const empty = document.createElement('div');

      empty.className = 'chat-list-empty';
      empty.textContent = 'No conversations yet';

      chatListEl.appendChild(empty);

      return;
    }

    const sorted = [...conversations].sort(
      (a, b) => b.createdAt - a.createdAt
    );

    for (const convo of sorted) {

      const item = document.createElement('div');

      item.className =
        'chat-list-item' +
        (convo.id === activeId ? ' active' : '');

      item.dataset.id = convo.id;

      const title = document.createElement('span');

      title.className = 'title';
      title.textContent = convo.title || 'New chat';

      const delBtn = document.createElement('button');

      delBtn.className = 'delete-btn';
      delBtn.setAttribute(
        'aria-label',
        'Delete chat'
      );

      delBtn.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="3 6 5 6 21 6"></polyline>' +
        '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
        '<path d="M10 11v6"></path>' +
        '<path d="M14 11v6"></path>' +
        '<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>' +
        '</svg>';

      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestDeleteConversation(convo.id);
      });

      item.appendChild(title);
      item.appendChild(delBtn);

      item.addEventListener('click', () => {
        setActiveConversation(convo.id);
        closeSidebarMobile();
      });

      chatListEl.appendChild(item);
    }
  }

  function openSidebarMobile() {
    sidebar.classList.add('open');
    scrim.classList.add('open');
  }

  function closeSidebarMobile() {
    sidebar.classList.remove('open');
    scrim.classList.remove('open');
  }

  // ---------- Conversation lifecycle ----------
  function createConversation() {
    const convo = {
      id: genId(),
      title: '',
      messages: [],
      createdAt: Date.now(),
    };

    conversations.push(convo);
    activeId = convo.id;

    saveConversations();
    renderChatList();
    renderActiveConversation();
  }

  function setActiveConversation(id) {
    activeId = id;

    renderChatList();
    renderActiveConversation();
  }

  function requestDeleteConversation(id) {
    pendingDeleteId = id;

    const convo = conversations.find(
      (c) => c.id === id
    );

    modalMessage.textContent =
      convo && convo.title
        ? `This will permanently delete "${convo.title}".`
        : 'This will permanently delete this conversation.';

    modalOverlay.classList.add('open');
  }

  function confirmDeleteConversation() {
    if (!pendingDeleteId) return;

    const id = pendingDeleteId;

    conversations = conversations.filter(
      (c) => c.id !== id
    );

    if (activeId === id) {
      activeId = null;
    }

    saveConversations();
    renderChatList();
    renderActiveConversation();
    closeModal();
  }

  function closeModal() {
    pendingDeleteId = null;
    modalOverlay.classList.remove('open');
  }

  // ---------- Rendering active conversation ----------
  function renderActiveConversation() {
    const convo = getActiveConversation();

    if (!convo) {

      chatTitleEl.textContent = 'New chat';

      welcomeScreen.style.display = 'flex';

      messagesEl.style.display = 'none';

      messagesEl.innerHTML = '';

      return;
    }

    chatTitleEl.textContent =
      convo.title || 'New chat';

    welcomeScreen.style.display = 'none';

    messagesEl.style.display = 'flex';

    messagesEl.innerHTML = '';

    for (const msg of convo.messages) {

      appendMessageBubble(
        msg.role,
        msg.content,
        {
          scroll: false,
          isError: msg.isError
        }
      );
    }

    scrollToBottom();
  }

  function appendMessageBubble(
    role,
    content,
    opts = {}
  ) {
    const {
      scroll = true,
      isError = false
    } = opts;

    const wrap =
      document.createElement('div');

    wrap.className =
      `message ${role}`;

    const avatar =
      document.createElement('div');

    avatar.className =
      `avatar ${
        role === 'user'
          ? 'user-avatar'
          : 'assistant-avatar'
      }`;

    avatar.textContent =
      role === 'user' ? 'U' : 'S';

    const bubble =
      document.createElement('div');

    bubble.className =
      'bubble' +
      (isError ? ' error-bubble' : '');

    bubble.innerHTML =
      renderMarkdown(content);

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);

    messagesEl.appendChild(wrap);

    if (scroll) {
      scrollToBottom();
    }

    return wrap;
  }

  function appendTypingIndicator() {
    const wrap =
      document.createElement('div');

    wrap.className =
      'message assistant';

    wrap.id =
      'typingIndicator';

    const avatar =
      document.createElement('div');

    avatar.className =
      'avatar assistant-avatar';

    avatar.textContent = 'S';

    const bubble =
      document.createElement('div');

    bubble.className = 'bubble';

    bubble.innerHTML =
      '<div class="typing-indicator">' +
      '<span></span>' +
      '<span></span>' +
      '<span></span>' +
      '</div>';

    wrap.appendChild(avatar);
    wrap.appendChild(bubble);

    messagesEl.appendChild(wrap);

    scrollToBottom();
  }

  function removeTypingIndicator() {
    const el =
      document.getElementById(
        'typingIndicator'
      );

    if (el) {
      el.remove();
    }
  }

  function scrollToBottom() {
    messagesContainer.scrollTop =
      messagesContainer.scrollHeight;
  }

  // ---------- Sending messages ----------
  async function sendMessage(text) {
    const trimmed = text.trim();

    if (!trimmed || isSending) {
      return;
    }

    let convo =
      getActiveConversation();

    if (!convo) {

      convo = {
        id: genId(),
        title: '',
        messages: [],
        createdAt: Date.now(),
      };

      conversations.push(convo);
      activeId = convo.id;
    }

    if (!convo.title) {

      convo.title =
        titleFromMessage(trimmed);

      chatTitleEl.textContent =
        convo.title;
    }

    convo.messages.push({
      role: 'user',
      content: trimmed
    });

    welcomeScreen.style.display =
      'none';

    messagesEl.style.display =
      'flex';

    appendMessageBubble(
      'user',
      trimmed
    );

    saveConversations();
    renderChatList();

    composerInput.value = '';

    autoResizeTextarea();

    setSending(true);

    appendTypingIndicator();

    try {

      const apiMessages =
        convo.messages.map((m) => ({
          role: m.role,
          content: m.content
        }));

      const res =
        await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            messages: apiMessages
          }),
        });

      let data;

      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }

      removeTypingIndicator();

      if (
        !res.ok ||
        !data ||
        data.error
      ) {

        const errorText =
          (data && data.error) ||
          'Something went wrong. Please try again.';

        convo.messages.push({
          role: 'assistant',
          content: errorText,
          isError: true
        });

        appendMessageBubble(
          'assistant',
          errorText,
          { isError: true }
        );

      } else {

        const reply =
          data.reply ||
          '(no response)';

        convo.messages.push({
          role: 'assistant',
          content: reply
        });

        appendMessageBubble(
          'assistant',
          reply
        );
      }

    } catch (err) {

      removeTypingIndicator();

      const errorText =
        'Could not reach the server. Check your connection and try again.';

      convo.messages.push({
        role: 'assistant',
        content: errorText,
        isError: true
      });

      appendMessageBubble(
        'assistant',
        errorText,
        { isError: true }
      );

    } finally {

      saveConversations();
      renderChatList();
      setSending(false);
    }
  }

  function setSending(sending) {
    isSending = sending;

    sendBtn.disabled = sending;
    composerInput.disabled = sending;

    if (!sending) {
      composerInput.focus();
    }
  }

  // ---------- Composer ----------
  function autoResizeTextarea() {
    composerInput.style.height =
      'auto';

    const newHeight =
      Math.min(
        composerInput.scrollHeight,
        200
      );

    composerInput.style.height =
      newHeight + 'px';
  }

  // ---------- Event listeners ----------
  newChatBtn.addEventListener(
    'click',
    () => {

      activeId = null;

      renderChatList();
      renderActiveConversation();

      closeSidebarMobile();

      composerInput.focus();
    }
  );

  openSidebarBtn.addEventListener(
    'click',
    openSidebarMobile
  );

  closeSidebarBtn.addEventListener(
    'click',
    closeSidebarMobile
  );

  scrim.addEventListener(
    'click',
    closeSidebarMobile
  );

  sendBtn.addEventListener(
    'click',
    () => {
      sendMessage(
        composerInput.value
      );
    }
  );

  composerInput.addEventListener(
    'keydown',
    (e) => {

      if (
        e.key === 'Enter' &&
        !e.shiftKey
      ) {

        e.preventDefault();

        sendMessage(
          composerInput.value
        );
      }
    }
  );

  composerInput.addEventListener(
    'input',
    autoResizeTextarea
  );

  document
    .querySelectorAll('.suggestion-card')
    .forEach((card) => {

      card.addEventListener(
        'click',
        () => {

          const prompt =
            card.dataset.prompt;

          if (prompt) {
            sendMessage(prompt);
          }
        }
      );
    });

  modalCancelBtn.addEventListener(
    'click',
    closeModal
  );

  modalConfirmBtn.addEventListener(
    'click',
    confirmDeleteConversation
  );

  modalOverlay.addEventListener(
    'click',
    (e) => {

      if (
        e.target === modalOverlay
      ) {
        closeModal();
      }
    }
  );

  document.addEventListener(
    'keydown',
    (e) => {

      if (
        e.key === 'Escape' &&
        modalOverlay.classList.contains('open')
      ) {
        closeModal();
      }
    }
  );

  // ---------- Init ----------
  function init() {

    initializeAuthentication();

    loadConversations();

    renderChatList();

    renderActiveConversation();

    autoResizeTextarea();
  }

  init();

})();
