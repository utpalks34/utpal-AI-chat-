(() => {
  "use strict";

  const TYPING_SPEED = 9; // ms per 2 chars

  const KB = {
    about: { text: "I'm Utpal Kant Sharma — an AI engineer based in Guwahati, Assam, finishing a B.Tech in Computer Science at The Assam Kaziranga University (2026, CGPA 8.08).\n\nI build agentic systems: LangGraph-orchestrated RAG pipelines, multi-agent workflows, and LLM products with real guardrails, evals and tracing. Ask me about projects, stack, or experience." },
    projects: { text: "Three things I'd show first —", cards: [
      { title: 'SEVA — Smart City Feedback', meta: 'Django · PostGIS · Gemini API · HF Transformers', points: ['Automated complaint classification: 87% severity / 92% category accuracy — cut manual triage by 65%', 'PostGIS geo-spatial clustering → heat maps of high-priority civic zones', 'Full DRF + PostgreSQL + JWT backend'] },
      { title: 'Enterprise Agentic RAG', meta: 'LangGraph · Qdrant · NeMo Guardrails · Docker', points: ['Planner / retriever / responder graph with conditional routing and persistent memory', 'NeMo Guardrails blocks jailbreaks before retrieval; FlashRank reranking + Portkey model failover', 'LangSmith/Logfire tracing with a 6-metric RAGAS eval suite'] },
      { title: 'Multi-Agent Research Assistant', meta: 'LangChain · Tavily API · Streamlit', points: ['Search → Reader → Writer → Critic pipeline that autonomously gathers web sources', '3-tier scraping fallback (trafilatura → readability → BeautifulSoup)', "Self-critique loop: the Critic scores and revises the Writer’s report"] }
    ]},
    skills: { text: "My stack, by layer —", cards: [
      { title: 'AI / Agentic', meta: 'core focus', tags: ['LangChain','LangGraph','RAG','LLMs','Vector DBs','MCP','Prompt Engineering','Fine-tuning','OpenAI','Gemini','Groq','Hugging Face','Chroma','Qdrant','Claude Code'] },
      { title: 'Backend', meta: '', tags: ['Django','DRF','FastAPI','REST APIs','PostgreSQL','PostGIS','JWT'] },
      { title: 'Languages & Tools', meta: '', tags: ['Python','SQL','Docker','AWS EC2/S3','Git','Cursor AI','NumPy','Pandas','Scikit-learn'] }
    ]},
    experience: { text: "Most recent role —", cards: [
      { title: 'Data Science Intern — Amtron', meta: 'Assam Electronics Development Corp · Dec 2024 – Jan 2025', points: ['Optimized SQL across 10,000+ record databases: query time 45s → under 15s (joins, aggregations, composite indexing)', 'Built end-to-end ML pipelines in Python, Pandas and NumPy — classification and regression on real operational data', 'Matplotlib dashboards turning SQL output into executive-ready KPI reports'] }
    ]},
    education: { text: "B.Tech in Computer Science & Engineering, The Assam Kaziranga University (2022–2026) — CGPA 8.08/10.\nCoursework: DSA, ML, DBMS, OS, Computer Networks.", cards: [
      { title: 'IBM RAG & Agentic AI Professional Certificate', meta: 'Coursera · ID YB15NDMCH302', points: ['9-course specialization: RAG architectures, agentic workflows, LangChain, LangGraph, CrewAI, AutoGen, MCP'] }
    ]},
    contact: { text: "Always up for talking agents, RAG, or a role where I can ship them. Reach me here —", links: [
      { label: 'utpalksharma156@gmail.com', href: 'mailto:utpalksharma156@gmail.com' },
      { label: 'github.com/utpalks34', href: 'https://github.com/utpalks34' },
      { label: 'linkedin ↗', href: 'https://linkedin.com/in/utpal-kant-sharma' },
      { label: '+91 6000592864', href: 'tel:+916000592864' }
    ]},
    fallback: { text: "I'm a scoped model — my training data is 100% Utpal. Try: projects, skills, experience, education, or contact." }
  };

  const HISTORY = [
    { header: 'Today' },
    { q: 'What has Utpal built with LangGraph?' },
    { q: 'Show me the SEVA smart city project' },
    { q: "What's in his AI and agentic stack?" },
    { q: 'How does his RAG pipeline handle guardrails?' },
    { header: '5 Days Ago' },
    { q: 'Tell me about his Amtron internship' },
    { q: 'Which certifications does he hold?' },
    { q: 'What did he study, and where?' },
    { header: '7 Days Ago' },
    { q: 'How do I reach Utpal for a role?' },
    { q: 'Who is Utpal Kant Sharma?' }
  ];

  const state = { messages: [], thinking: false, draft: '', tab: 'AI Chat' };
  let nextId = 1;
  let typeInterval = null;
  let sendTimer = null;

  const el = {
    tabs: document.getElementById('tabs'),
    rail: document.getElementById('rail'),
    railBottom: document.querySelector('.rail-bottom'),
    chips: document.getElementById('chips'),
    historyList: document.getElementById('historyList'),
    messagesScroll: document.getElementById('messagesScroll'),
    emptyState: document.getElementById('emptyState'),
    messageList: document.getElementById('messageList'),
    draftInput: document.getElementById('draftInput'),
    sendBtn: document.getElementById('sendBtn'),
    composerClear: document.getElementById('composerClear'),
    railClear: document.getElementById('railClear'),
    chatMenu: document.getElementById('chatMenu'),
    newChatBtn: document.getElementById('newChatBtn'),
    historyPanel: document.getElementById('historyPanel'),
    historyToggle: document.getElementById('historyToggle'),
    historyClose: document.getElementById('historyClose'),
    historyBackdrop: document.getElementById('historyBackdrop'),
  };

  function match(q) {
    const s = q.toLowerCase();
    if (/(project|built|build|seva|rag|agent|langgraph|guardrail|portfolio)/.test(s)) return KB.projects;
    if (/(skill|stack|tech|tool|language|know)/.test(s)) return KB.skills;
    if (/(experience|intern|job|role at|amtron|company|work)/.test(s)) return KB.experience;
    if (/(education|study|studied|college|university|degree|cert|course|cgpa)/.test(s)) return KB.education;
    if (/(contact|reach|email|hire|hiring|phone|linkedin|github|resume|cv|role)/.test(s)) return KB.contact;
    if (/(who|about|utpal|intro|hi|hello|hey)/.test(s)) return KB.about;
    return KB.fallback;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function finishCurrent() {
    clearInterval(typeInterval);
    state.messages.forEach(m => { if (m.typing) { m.text = m.full; m.typing = false; m.done = true; } });
    renderMessages();
  }

  function startTyping(reply) {
    const id = nextId++;
    const msg = {
      id, role: 'bot', text: '', full: reply.text, typing: true, done: false,
      cards: (reply.cards || []).map(c => ({ ...c, meta: c.meta || '', points: c.points || [], tags: c.tags || [] })),
      links: reply.links || []
    };
    state.messages.push(msg);
    state.thinking = false;
    renderMessages();

    let i = 0;
    typeInterval = setInterval(() => {
      i += 2;
      const done = i >= msg.full.length;
      msg.text = msg.full.slice(0, i);
      msg.typing = !done;
      msg.done = done;
      renderMessages();
      if (done) clearInterval(typeInterval);
    }, TYPING_SPEED);
  }

  function send(text) {
    const t = (text || '').trim();
    if (!t) return;
    finishCurrent();
    clearTimeout(sendTimer);
    const id = nextId++;
    state.messages.push({ id, role: 'user', text: t, done: true, cards: [], links: [] });
    state.draft = '';
    state.thinking = true;
    state.tab = 'AI Chat';
    el.draftInput.value = '';
    renderTabs();
    renderMessages();
    sendTimer = setTimeout(() => startTyping(match(t)), 620);
  }

  function reset() {
    clearInterval(typeInterval);
    clearTimeout(sendTimer);
    state.messages = [];
    state.thinking = false;
    state.draft = '';
    el.draftInput.value = '';
    renderMessages();
  }

  function renderTabs() {
    const tabs = ['Work', 'AI Chat', 'Stack', 'Contact'];
    el.tabs.innerHTML = '';
    tabs.forEach(label => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (label === state.tab ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        state.tab = label;
        renderTabs();
        const map = { Work: 'Projects', Stack: 'Skills & stack', Contact: 'Contact' };
        if (map[label]) send(map[label]);
      });
      el.tabs.appendChild(btn);
    });
  }

  function renderRail() {
    const railDefs = [
      { icon: '◈', label: 'Projects', q: 'Projects' },
      { icon: '▤', label: 'Experience', q: 'Experience' },
      { icon: '❊', label: 'Skills', q: 'Skills & stack' },
      { icon: '⚖', label: 'Education', q: 'Education & certs' },
      { icon: '⌗', label: 'About', q: 'Who is Utpal?' },
      { icon: '✉', label: 'Contact', q: 'Contact' }
    ];
    railDefs.forEach((r, i) => {
      const btn = document.createElement('button');
      btn.className = 'rail-btn' + (i % 2 ? ' alt' : '');
      btn.title = r.label;
      btn.textContent = r.icon;
      btn.addEventListener('click', () => send(r.q));
      el.rail.insertBefore(btn, el.railBottom);
    });
  }

  function renderChips() {
    const chips = [
      { label: 'Projects', icon: '◈' },
      { label: 'Skills & stack', icon: '❊' },
      { label: 'Experience', icon: '▤' },
      { label: 'Contact', icon: '✉' }
    ];
    el.chips.innerHTML = '';
    chips.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.innerHTML = `<span class="chip-icon">${c.icon}</span>${c.label}`;
      btn.addEventListener('click', () => send(c.label));
      el.chips.appendChild(btn);
    });
  }

  function renderHistory() {
    el.historyList.innerHTML = '';
    HISTORY.forEach(h => {
      if (h.header) {
        const div = document.createElement('div');
        div.className = 'history-group-label';
        div.textContent = h.header;
        el.historyList.appendChild(div);
      } else {
        const btn = document.createElement('button');
        btn.className = 'history-item';
        btn.innerHTML = `<span class="history-item-icon">◍</span><span class="history-item-label">${escapeHtml(h.q)}</span>`;
        btn.addEventListener('click', () => send(h.q));
        el.historyList.appendChild(btn);
      }
    });
  }

  function cardHtml(card) {
    const hasPoints = card.points && card.points.length;
    const hasTags = card.tags && card.tags.length;
    return `
      <div class="card">
        <div class="card-head">
          <span class="card-title">${escapeHtml(card.title)}</span>
          <span class="card-meta">${escapeHtml(card.meta)}</span>
        </div>
        ${hasPoints ? `<ul class="card-points">${card.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
        ${hasTags ? `<div class="card-tags">${card.tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  function messageHtml(m) {
    if (m.role === 'bot') {
      const showCaret = !!m.typing;
      const showCards = m.done && m.cards.length > 0;
      const showLinks = m.done && m.links.length > 0;
      return `
        <div class="msg">
          <div class="bot-row">
            <span class="bot-avatar"></span>
            <div class="bot-bubble">
              <div class="bot-text">${escapeHtml(m.text)}${showCaret ? '<span class="caret"></span>' : ''}</div>
              ${showCards ? `<div class="cards">${m.cards.map(cardHtml).join('')}</div>` : ''}
              ${showLinks ? `<div class="msg-links">${m.links.map(l => `<a class="msg-link" href="${l.href}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join('')}</div>` : ''}
            </div>
          </div>
        </div>`;
    }
    return `
      <div class="msg">
        <div class="user-row">
          <div class="user-bubble">${escapeHtml(m.text)}</div>
        </div>
      </div>`;
  }

  function renderMessages() {
    const isEmpty = state.messages.length === 0 && !state.thinking;
    el.emptyState.classList.toggle('hidden', !isEmpty);

    let html = state.messages.map(messageHtml).join('');
    if (state.thinking) {
      html += `
        <div class="thinking-row">
          <span class="bot-avatar"></span>
          <div class="thinking-bubble"><span></span><span></span><span></span></div>
        </div>`;
    }
    el.messageList.innerHTML = html;
    el.messagesScroll.scrollTop = el.messagesScroll.scrollHeight;
  }

  function wireComposer() {
    el.draftInput.addEventListener('input', e => { state.draft = e.target.value; });
    el.draftInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(state.draft); });
    el.sendBtn.addEventListener('click', () => send(state.draft));
    el.composerClear.addEventListener('click', reset);
    el.railClear.addEventListener('click', reset);
    el.chatMenu.addEventListener('click', reset);
    el.newChatBtn.addEventListener('click', reset);
  }

  function wireMobileDrawer() {
    if (!el.historyPanel || !el.historyToggle) return;

    function openDrawer() {
      el.historyPanel.classList.add('open');
      if (el.historyBackdrop) el.historyBackdrop.classList.add('open');
    }
    function closeDrawer() {
      el.historyPanel.classList.remove('open');
      if (el.historyBackdrop) el.historyBackdrop.classList.remove('open');
    }

    el.historyToggle.addEventListener('click', openDrawer);
    if (el.historyClose) el.historyClose.addEventListener('click', closeDrawer);
    if (el.historyBackdrop) el.historyBackdrop.addEventListener('click', closeDrawer);
    el.historyList.addEventListener('click', closeDrawer);
    el.newChatBtn.addEventListener('click', closeDrawer);
  }

  function init() {
    renderTabs();
    renderRail();
    renderChips();
    renderHistory();
    renderMessages();
    wireComposer();
    wireMobileDrawer();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
