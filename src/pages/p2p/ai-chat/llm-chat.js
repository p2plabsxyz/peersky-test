const SYSTEM_PROMPT =
  'You are PeerSky, the built-in assistant of the PeerSky Browser. ' +
  'PeerSky is a local-first, peer-to-peer browser created by P2P Labs. ' +
  'You value privacy, decentralization, autonomy, and community-driven publishing. ' +
  'Give smart, accurate answers. If unclear, say so. ' +
  'Never help with harmful, illegal, or privacy-violating activities.';

const APP_ID  = 'ai-chat';
const LS_SID  = 'ai-chat-sid';
const LS_MSGS = 'ai-chat-msgs-v1';
const LS_PINS   = 'ai-chat-pinned';
const LS_DRAFT  = 'ai-chat-draft';
const LS_TITLES = 'ai-chat-titles';

let currentSessionId     = null;
let memoryEnabled        = false;
let visionSupported      = false;
let pendingImage         = null;
let isBusy               = false;
let abortController      = null;
let ctxTargetSession     = null;
let activeInferSessionId = null;
let activeInferMsgEl     = null;

const messagesEl    = document.getElementById('messages');
const promptBox     = document.getElementById('promptBox');
const sendBtn       = document.getElementById('send-btn');
const sendIcon      = document.getElementById('send-icon');
const newChatBtn    = document.getElementById('new-chat-btn');
const historyList   = document.getElementById('history-list');
const attachBtn     = document.getElementById('attach-btn');
const fileInput     = document.getElementById('file-input');
const attachPreview = document.getElementById('attachment-preview');
const attachThumb   = document.getElementById('attach-thumb');
const attachRemove  = document.getElementById('attach-remove');
const dropOverlay   = document.getElementById('drop-overlay');
const ctxMenu       = document.getElementById('chat-ctx-menu');
const renameModal   = document.getElementById('rename-modal');
const deleteModal   = document.getElementById('delete-modal');

function genSessionId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function getPinned()    { try { return new Set(JSON.parse(localStorage.getItem(LS_PINS) || '[]')); } catch { return new Set(); } }
function savePinned(s)  { try { localStorage.setItem(LS_PINS, JSON.stringify([...s])); } catch {} }
function getTitles()       { try { return JSON.parse(localStorage.getItem(LS_TITLES) || '{}'); } catch { return {}; } }
function saveTitle(sid, t) { try { const m = getTitles(); m[sid] = t; localStorage.setItem(LS_TITLES, JSON.stringify(m)); } catch {} }

(async function init() {
  try { memoryEnabled = window.llmMemory ? await window.llmMemory.isEnabled() : false; }
  catch { memoryEnabled = false; }

  const savedSid = localStorage.getItem(LS_SID);

  const lsSaved = loadMsgsFromLS(savedSid);
  if (lsSaved.length && savedSid) {
    currentSessionId = savedSid;
    showWelcome(false);
    for (const m of lsSaved) addMessage(m.role, m.content, false);
    highlightActiveSession(savedSid);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else if (savedSid && memoryEnabled && window.llmMemory) {
    try {
      const entries = await window.llmMemory.list({ sessionId: savedSid });
      if (entries.length) {
        currentSessionId = savedSid;
        showWelcome(false);
        for (const e of entries) { if (e.role !== 'system') addMessage(e.role, e.content, false); }
        highlightActiveSession(savedSid);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        saveMsgsToLS();
      }
    } catch { /* fall through */ }
  }

  if (!currentSessionId) startNewSession();

  await loadSidebar();
  await detectVision();
  try { const d = localStorage.getItem(LS_DRAFT); if (d) { promptBox.value = d; autoResize(); } } catch {}
})();

function saveMsgsToLS() {
  try {
    const msgs = [...messagesEl.querySelectorAll('.message')].map(m => ({
      role: m.dataset.role,
      content: m.querySelector('.msg-bubble').textContent
    }));
    if (currentSessionId) localStorage.setItem(`${LS_MSGS}-${currentSessionId}`, JSON.stringify(msgs));
    localStorage.setItem(LS_SID, currentSessionId);
  } catch {}
}

function loadMsgsFromLS(sid) {
  try {
    const data = localStorage.getItem(`${LS_MSGS}-${sid}`);
    if (data) return JSON.parse(data);
    const lastSid = localStorage.getItem(LS_SID);
    if (sid === lastSid) return JSON.parse(localStorage.getItem(LS_MSGS) || '[]');
    return [];
  } catch { return []; }
}

async function detectVision() {
  try {
    if (!window._llmBridge) return;
    const info = await window._llmBridge.modelInfo();
    visionSupported = !!info?.vision;
  } catch { visionSupported = false; }
  attachBtn.classList.toggle('visible', visionSupported);
}

function startNewSession() {
  currentSessionId = genSessionId();
  try { localStorage.setItem(LS_SID, currentSessionId); localStorage.removeItem(LS_MSGS); } catch {}
  messagesEl.innerHTML = '';
  clearAttachment();
  showWelcome(true);
  highlightActiveSession(null);
}

function showWelcome(show) {
  let w = document.getElementById('welcome');
  if (show && !w) {
    w = document.createElement('div');
    w.id = 'welcome';
    const h = document.createElement('h2');
    h.textContent = '\uD83E\uDD16 PeerSky AI';
    const p1 = document.createElement('p');
    p1.textContent = 'A local AI chat powered by your own model. Prompts stay on your device.';
    const p2 = document.createElement('p');
    const a  = document.createElement('a');
    a.href = 'peersky://settings/llm';
    a.textContent = 'Settings \u2192 AI / LLMs';
    p2.append('Enable LLM in ', a);
    w.append(h, p1, p2);
    messagesEl.appendChild(w);
  } else if (!show && w) {
    w.remove();
  }
}

async function loadSidebar() {
  if (!memoryEnabled || !window.llmMemory) {
    historyList.textContent = '';
    const d = document.createElement('div');
    d.className = 'history-empty';
    const a = document.createElement('a');
    a.href = 'peersky://settings/llm';
    a.textContent = 'Settings';
    d.append('Enable memory in ', a, ' to see history.');
    historyList.appendChild(d);
    return;
  }
  let sessions;
  try { sessions = await window.llmMemory.listSessions({ appId: APP_ID, limit: 100 }); }
  catch { sessions = []; }

  if (!sessions.length) {
    historyList.textContent = '';
    const d = document.createElement('div');
    d.className = 'history-empty';
    d.textContent = 'No history yet.';
    historyList.appendChild(d);
    return;
  }

  const pinned = getPinned();
  sessions.sort((a, b) => {
    const ap = pinned.has(a.sessionId) ? 0 : 1;
    const bp = pinned.has(b.sessionId) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return b.ts > a.ts ? 1 : -1;
  });

  historyList.textContent = '';
  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'history-item' + (pinned.has(s.sessionId) ? ' pinned' : '');
    item.dataset.sessionId = s.sessionId;

    const info = document.createElement('div');
    info.className = 'history-item-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'history-item-title';
    titleEl.textContent = getTitles()[s.sessionId] || s.title || 'Untitled';
    const metaEl = document.createElement('div');
    metaEl.className = 'history-item-meta';
    metaEl.textContent = relTime(s.ts) + ' \u00B7 ' + s.messageCount + ' msg';
    info.append(titleEl, metaEl);

    const dots = document.createElement('button');
    dots.className = 'history-item-dots';
    dots.title = 'Options';
    const di = document.createElement('img');
    di.src = './assets/svg/three-dots-vertical.svg';
    di.alt = '';
    dots.appendChild(di);
    dots.addEventListener('click', (e) => {
      e.stopPropagation();
      openCtxMenu(e, s.sessionId, pinned.has(s.sessionId));
    });

    item.append(info, dots);
    item.addEventListener('click', () => loadSession(s.sessionId));
    historyList.appendChild(item);
  }
  highlightActiveSession(currentSessionId);
}

function highlightActiveSession(sid) {
  for (const el of historyList.querySelectorAll('.history-item')) {
    el.classList.toggle('active', el.dataset.sessionId === sid);
  }
}

async function loadSession(sessionId) {
  const lsSaved = loadMsgsFromLS(sessionId);
  if (lsSaved.length) {
    currentSessionId = sessionId;
    try { localStorage.setItem(LS_SID, sessionId); } catch {}
    messagesEl.innerHTML = '';
    showWelcome(false);
    for (const m of lsSaved) addMessage(m.role, m.content, false);
    if (isBusy && activeInferSessionId === sessionId && activeInferMsgEl) {
      messagesEl.appendChild(activeInferMsgEl);
    }
    highlightActiveSession(sessionId);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }
  if (!window.llmMemory) return;
  let entries;
  try { entries = await window.llmMemory.list({ sessionId }); }
  catch { return; }
  if (!entries?.length) {
    if (isBusy && activeInferSessionId === sessionId && activeInferMsgEl) {
      currentSessionId = sessionId;
      try { localStorage.setItem(LS_SID, sessionId); } catch {}
      messagesEl.innerHTML = '';
      showWelcome(false);
      messagesEl.appendChild(activeInferMsgEl);
      highlightActiveSession(sessionId);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    return;
  }
  currentSessionId = sessionId;
  try { localStorage.setItem(LS_SID, sessionId); } catch {}
  messagesEl.innerHTML = '';
  showWelcome(false);
  for (const e of entries) { if (e.role !== 'system') addMessage(e.role, e.content, false); }
  if (isBusy && activeInferSessionId === sessionId && activeInferMsgEl) {
    messagesEl.appendChild(activeInferMsgEl);
  }
  highlightActiveSession(sessionId);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  saveMsgsToLS();
}

function openCtxMenu(e, sessionId, isPinned) {
  ctxTargetSession = sessionId;
  document.getElementById('ctx-pin').textContent = isPinned ? 'Unpin' : 'Pin';
  ctxMenu.style.top  = e.clientY + 'px';
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.classList.add('open');
}

document.addEventListener('click', () => ctxMenu.classList.remove('open'));
ctxMenu.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('ctx-pin').addEventListener('click', () => {
  if (!ctxTargetSession) return;
  const pins = getPinned();
  if (pins.has(ctxTargetSession)) pins.delete(ctxTargetSession); else pins.add(ctxTargetSession);
  savePinned(pins);
  ctxMenu.classList.remove('open');
  loadSidebar();
});

document.getElementById('ctx-rename').addEventListener('click', () => {
  ctxMenu.classList.remove('open');
  if (!ctxTargetSession) return;
  const titles = getTitles();
  const item = historyList.querySelector(`.history-item[data-session-id="${ctxTargetSession}"]`);
  const current = titles[ctxTargetSession] || item?.querySelector('.history-item-title')?.textContent || '';
  const inp = document.getElementById('rename-input');
  inp.value = current;
  document.getElementById('rename-modal').classList.add('open');
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
});

document.getElementById('rename-cancel').addEventListener('click', () => {
  document.getElementById('rename-modal').classList.remove('open');
  ctxTargetSession = null;
});

document.getElementById('rename-save').addEventListener('click', () => {
  const newTitle = document.getElementById('rename-input').value.trim();
  if (newTitle && ctxTargetSession) {
    saveTitle(ctxTargetSession, newTitle);
    const item = historyList.querySelector(`.history-item[data-session-id="${ctxTargetSession}"]`);
    if (item) item.querySelector('.history-item-title').textContent = newTitle;
  }
  document.getElementById('rename-modal').classList.remove('open');
  ctxTargetSession = null;
});

document.getElementById('rename-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  document.getElementById('rename-save').click();
  if (e.key === 'Escape') document.getElementById('rename-cancel').click();
});

document.getElementById('ctx-delete').addEventListener('click', () => {
  ctxMenu.classList.remove('open');
  deleteModal.classList.add('open');
});

document.getElementById('delete-cancel').addEventListener('click', () => {
  deleteModal.classList.remove('open');
  ctxTargetSession = null;
});

document.getElementById('delete-confirm').addEventListener('click', async () => {
  deleteModal.classList.remove('open');
  if (!ctxTargetSession || !window.llmMemory) return;
  try { await window.llmMemory.clear({ sessionId: ctxTargetSession }); } catch {}
  if (ctxTargetSession === currentSessionId) {
    try { localStorage.removeItem(LS_MSGS); } catch {}
    startNewSession();
  }
  ctxTargetSession = null;
  loadSidebar();
});

newChatBtn.addEventListener('click', () => { startNewSession(); loadSidebar(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!localStorage.getItem(LS_SID) && messagesEl.querySelectorAll('.message').length) {
      startNewSession();
      loadSidebar();
    }
  }
});

window.addEventListener('focus', () => detectVision());

sendBtn.addEventListener('click', () => {
  if (isBusy) { abortController?.abort(); } else { send(); }
});

promptBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isBusy) send(); }
});
promptBox.addEventListener('input', () => {
  autoResize();
  try { localStorage.setItem(LS_DRAFT, promptBox.value); } catch {}
});

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (f) loadImageFile(f);
});
attachRemove.addEventListener('click', clearAttachment);

document.getElementById('history-search').addEventListener('input', () => {
  const q = document.getElementById('history-search').value.toLowerCase();
  for (const item of historyList.querySelectorAll('.history-item')) {
    const title = item.querySelector('.history-item-title')?.textContent.toLowerCase() || '';
    item.style.display = q && !title.includes(q) ? 'none' : '';
  }
});

function resolveCssColor(cssVar, prop = 'background-color') {
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;top:-9999px;left:-9999px;${prop === 'background-color' ? 'background' : 'color'}:var(${cssVar})`;
  document.body.appendChild(d);
  const val = getComputedStyle(d)[prop === 'background-color' ? 'backgroundColor' : 'color'];
  d.remove();
  return val || '';
}

function buildPrintHtml(title) {
  const chatBg    = resolveCssColor('--chat-bg');
  const msgOther  = resolveCssColor('--msg-other');
  const msgSelf   = resolveCssColor('--msg-self');
  const textClr   = resolveCssColor('--text', 'color');
  const mutedClr  = resolveCssColor('--muted', 'color');
  const borderClr = resolveCssColor('--border');

  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const msgs = [...messagesEl.querySelectorAll('.message')].map(m => {
    const isUser = m.dataset.role === 'user';
    const content = m.querySelector('.msg-bubble').textContent;
    return `<div class="msg ${isUser ? 'user' : 'assistant'}">
  <div class="role">${isUser ? 'You' : 'Assistant'}</div>
  <div class="bubble">${esc(content)}</div>
</div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
@page { margin: 1.5cm 1.5cm 2.5cm; size: A4; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: ${chatBg}; color: ${textClr};
  padding: 1.5rem; line-height: 1.5;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1.doc-title {
  font-size: 1.1rem; font-weight: 600; margin-bottom: 1.5rem;
  padding-bottom: 0.5rem; border-bottom: 1px solid ${borderClr};
}
.msg {
  display: flex; flex-direction: column;
  max-width: 72%; margin-bottom: 1rem; break-inside: avoid;
}
.msg.user { align-items: flex-end; margin-left: 28%; }
.msg.assistant { align-items: flex-start; }
.role { font-size: 0.7rem; font-weight: 600; color: ${mutedClr}; margin-bottom: 3px; }
.bubble {
  padding: 0.55rem 0.85rem; border-radius: 16px;
  font-size: 0.9rem; white-space: pre-wrap; word-break: break-word; max-width: 100%;
}
.msg.user .bubble { background: ${msgSelf}; color: ${textClr}; border-top-right-radius: 4px; }
.msg.assistant .bubble { background: ${msgOther}; color: ${textClr}; border-top-left-radius: 4px; }
.print-footer {
  position: fixed; bottom: 0; left: 0; right: 0;
  text-align: center; font-size: 8pt; color: ${mutedClr};
  padding: 6px; border-top: 1px solid ${borderClr}; background: ${chatBg};
}
</style>
</head>
<body>
<h1 class="doc-title">${esc(title)}</h1>
${msgs}
<div class="print-footer">Created by PeerSky AI &middot; peersky://ai-chat</div>
</body>
</html>`;
}

document.getElementById('pdf-btn').addEventListener('click', async () => {
  const rawTitle = getTitles()[currentSessionId]
    || historyList.querySelector('.history-item.active .history-item-title')?.textContent
    || 'AI Chat';
  const sessionTitle = rawTitle.replace(/^\u{1F4CC}\s*/u, '').trim() || 'AI Chat';
  const html = buildPrintHtml(sessionTitle);
  const fileName = sessionTitle.replace(/[^\p{L}\p{N}\s._-]/gu, '').trim() + '.pdf';

  if (window.peersky?.printToPdf) {
    await window.peersky.printToPdf(html, fileName);
    return;
  }
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const pw = window.open(url, '_blank');
  if (pw) {
    pw.addEventListener('load', () => {
      setTimeout(() => {
        pw.addEventListener('afterprint', () => { URL.revokeObjectURL(url); pw.close(); });
        pw.focus(); pw.print();
      }, 200);
    });
  }
});

let dragCtr = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault(); if (!visionSupported) return;
  dragCtr++; dropOverlay.classList.add('visible');
});
document.addEventListener('dragleave', (e) => {
  e.preventDefault(); dragCtr--;
  if (dragCtr <= 0) { dragCtr = 0; dropOverlay.classList.remove('visible'); }
});
document.addEventListener('dragover',  (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault(); dragCtr = 0; dropOverlay.classList.remove('visible');
  if (!visionSupported) return;
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith('image/')) loadImageFile(f);
});

function loadImageFile(file) {
  if (!file.type.startsWith('image/')) return;
  const r = new FileReader();
  r.onload = () => {
    pendingImage = { dataUrl: r.result, mimeType: file.type };
    attachThumb.src = r.result;
    attachPreview.style.display = 'block';
  };
  r.readAsDataURL(file);
}

function clearAttachment() {
  pendingImage = null; attachThumb.src = ''; attachPreview.style.display = 'none';
}

function autoResize() {
  promptBox.style.height = 'auto';
  promptBox.style.height = Math.min(promptBox.scrollHeight, 128) + 'px';
}

async function send() {
  const prompt = promptBox.value.trim();
  if (!prompt && !pendingImage) return;
  promptBox.value = '';
  autoResize();
  try { localStorage.removeItem(LS_DRAFT); } catch {}
  showWelcome(false);

  const msgEl = addMessage('user', prompt);
  if (pendingImage) {
    const img = document.createElement('img');
    img.src = pendingImage.dataUrl;
    msgEl.querySelector('.msg-bubble').appendChild(img);
    msgEl._imageData = pendingImage;
  }
  clearAttachment();
  saveMsgsToLS();
  await saveToMemory('user', prompt);
  await runInference();
  loadSidebar();
}

function addMessage(role, content, save = true) {
  const div = document.createElement('div');
  div.className = 'message ' + (role === 'user' ? 'msg-user' : 'msg-assistant');
  div.dataset.role = role;

  const roleEl = document.createElement('div');
  roleEl.className = 'msg-role';
  roleEl.textContent = role === 'user' ? 'You' : 'Assistant';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (content) bubble.textContent = content;

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const copyBtn = makeActionBtn('./assets/svg/copy.svg', 'Copy');
  copyBtn.addEventListener('click', () => safeCopy(bubble.textContent));
  actions.appendChild(copyBtn);

  const editArea = document.createElement('div');
  editArea.className = 'msg-edit-area';
  const editTA = document.createElement('textarea');
  editTA.className = 'msg-edit-textarea';
  const editBtns = document.createElement('div');
  editBtns.className = 'msg-edit-btns';
  const sendEditBtn = document.createElement('button');
  sendEditBtn.className = 'msg-edit-send';
  sendEditBtn.textContent = 'Send';
  const cancelEditBtn = document.createElement('button');
  cancelEditBtn.className = 'msg-edit-cancel';
  cancelEditBtn.textContent = 'Cancel';
  cancelEditBtn.addEventListener('click', () => editArea.classList.remove('open'));
  editBtns.append(sendEditBtn, cancelEditBtn);
  editArea.append(editTA, editBtns);

  if (role === 'user') {
    const editBtn = makeActionBtn('./assets/svg/edit.svg', 'Edit');
    editBtn.addEventListener('click', () => { editTA.value = bubble.textContent; editArea.classList.add('open'); editTA.focus(); });
    actions.appendChild(editBtn);
    sendEditBtn.addEventListener('click', () => {
      const newContent = editTA.value.trim();
      if (!newContent) return;
      bubble.textContent = newContent;
      editArea.classList.remove('open');
      const msgs = [...messagesEl.querySelectorAll('.message')];
      msgs.slice(msgs.indexOf(div) + 1).forEach(m => m.remove());
      runInference();
    });
  } else {
    const retryBtn = makeActionBtn('./assets/svg/arrow-repeat.svg', 'Retry');
    retryBtn.addEventListener('click', () => {
      const allMsgs = [...messagesEl.querySelectorAll('.message')];
      const idx = allMsgs.indexOf(div);
      allMsgs.slice(idx).forEach(m => m.remove());
      runInference();
    });
    actions.appendChild(retryBtn);
  }

  div.append(roleEl, bubble, actions, editArea);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (save) saveMsgsToLS();
  return div;
}

function makeActionBtn(src, title) {
  const btn = document.createElement('button');
  btn.className = 'msg-action-btn';
  btn.title = title;
  const img = document.createElement('img');
  img.src = src; img.alt = title;
  btn.appendChild(img);
  return btn;
}

function safeCopy(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else { fallbackCopy(text); }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

function setBusy(busy) {
  isBusy = busy;
  sendBtn.classList.toggle('busy', busy);
  sendIcon.src = busy ? './assets/svg/x.svg' : './assets/svg/arrow-up.svg';
  promptBox.disabled = busy;
}

function serializeMessages() {
  return [...messagesEl.querySelectorAll('.message')].map(m => {
    const text = m.querySelector('.msg-bubble').textContent;
    const imgData = m._imageData;
    if (imgData) return { role: m.dataset.role, content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: imgData.dataUrl } }] };
    return { role: m.dataset.role, content: text };
  });
}

async function buildMemoryContext() {
  if (!memoryEnabled || !window.llmMemory) return '';
  try {
    const recent = await window.llmMemory.list({ limit: 50 });
    if (!recent.length) return '';
    const lines = recent.map(e =>
      '[' + e.appId + ' ' + (e.ts || '').slice(0, 16) + '] ' + e.role + ': ' + e.content.slice(0, 300)
    );
    return '\n\nThe user\'s recent activity across PeerSky apps (use as context when relevant):\n' + lines.join('\n');
  } catch { return ''; }
}

async function runInference() {
  if (!window.llm) return;
  activeInferSessionId = currentSessionId;
  setBusy(true);
  abortController = new AbortController();

  const history = serializeMessages();
  const memCtx  = await buildMemoryContext();
  const msgs    = [{ role: 'system', content: SYSTEM_PROMPT + memCtx }, ...history];

  activeInferMsgEl = addMessage('assistant', '', false);
  const bubble = activeInferMsgEl.querySelector('.msg-bubble');
  const thinking = document.createElement('span');
  thinking.className = 'msg-thinking';
  thinking.textContent = 'Thinking\u2026';
  bubble.appendChild(thinking);
  setInferBadge(activeInferSessionId, true);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  let assistantContent = '';
  try {
    for await (const chunk of window.llm.chat({ messages: msgs })) {
      if (abortController.signal.aborted) break;
      assistantContent += chunk?.content || '';
      bubble.textContent = assistantContent;
      if (activeInferSessionId === currentSessionId) messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    if (assistantContent) await saveToMemory('assistant', assistantContent, activeInferSessionId);
  } catch (err) {
    bubble.textContent = abortController.signal.aborted
      ? (assistantContent || '\u2715 Cancelled')
      : '\u26A0\uFE0F ' + (err.message || String(err));
  } finally {
    setBusy(false);
    abortController = null;
    setInferBadge(activeInferSessionId, false);
    if (activeInferSessionId === currentSessionId) {
      saveMsgsToLS();
    } else {
      try {
        const existing = JSON.parse(localStorage.getItem(`${LS_MSGS}-${activeInferSessionId}`) || '[]');
        const finalContent = assistantContent || bubble.textContent;
        if (finalContent) existing.push({ role: 'assistant', content: finalContent });
        localStorage.setItem(`${LS_MSGS}-${activeInferSessionId}`, JSON.stringify(existing));
      } catch {}
    }
    activeInferSessionId = null;
    activeInferMsgEl = null;
  }
}

function setInferBadge(sessionId, on) {
  const item = historyList.querySelector(`.history-item[data-session-id="${sessionId}"]`);
  if (item) item.classList.toggle('generating', on);
}

async function saveToMemory(role, content, sessionId = currentSessionId) {
  if (!memoryEnabled || !window.llmMemory) return;
  try {
    await window.llmMemory.add({ appId: APP_ID, sessionId, role, content, model: '', ts: new Date().toISOString() });
  } catch {}
}

function relTime(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
