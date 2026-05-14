// Chat panel with mocked AI responses + citations

const { useState: useStateC, useRef: useRefC, useEffect: useEffectC } = React;

const SUGGESTIONS = [
  'What\'s the on-call paging procedure?',
  'How does the indexer handle S3 events?',
  'Where do I file a postmortem?',
  'Summarize the billing service',
];

const CANNED_REPLIES = [
  {
    match: /(page|on.?call|incident|sev)/i,
    text: <>
      <p>For SEV-1 and SEV-2 incidents, the on-call engineer is paged through PagerDuty service <code>prod-platform</code>. After acknowledging within 5 minutes, you should:</p>
      <p>1. Open <code>#inc-YYYY-MM-DD-summary</code> and declare the SEV with <code>/incident declare</code>.<br/>2. Take the IC role until you hand it off explicitly.<br/>3. Post a status-page update at least every 30 minutes during a SEV-1.</p>
      <p>Always prefer mitigation over resolution — roll back deploys before debugging code.</p>
    </>,
    cites: [
      { id: 'doc-prod-incident', title: 'Production Incident Response', section: '§1 Detection & Paging' },
      { id: 'doc-prod-incident', title: 'Production Incident Response', section: '§3 Mitigation' },
    ],
  },
  {
    match: /(index|s3|pipeline|reindex|sqs)/i,
    text: <>
      <p>Producers write Markdown to <code>s3://wikillm/tenants/&lt;tenant&gt;/shared/&lt;path&gt;.md</code> with three required metadata headers (<code>x-wikillm-source</code>, <code>x-wikillm-author</code>, <code>x-wikillm-tags</code>).</p>
      <p>S3 PUTs trigger an SQS notification to the <code>wikillm-indexer</code> worker, which is idempotent. The worker fetches the object, verifies the SHA-256 checksum, parses frontmatter, tokenizes the body into OpenSearch, and upserts metadata into Postgres. Cached HTML keyed by the old checksum is invalidated.</p>
      <p>To force a full reindex, run <code>wikillmctl reindex --tenant=&lt;tenant&gt;</code>.</p>
    </>,
    cites: [
      { id: 'doc-data-pipeline', title: 'Data Pipeline Architecture', section: '§2 Ingestion contract' },
      { id: 'doc-data-pipeline', title: 'Data Pipeline Architecture', section: '§3 Indexing' },
    ],
  },
  {
    match: /(billing|stripe|invoice|charge)/i,
    text: <>
      <p>The billing service wraps Stripe and exposes a tenant-scoped API for plan changes, invoicing, and metered usage.</p>
      <p>All write endpoints require an <code>Idempotency-Key</code> header — the convention is a UUIDv7 keyed on <code>(tenant_id, action, request_id)</code>. Stripe webhooks land at <code>/v1/billing/webhooks/stripe</code> and are persisted to <code>billing.webhook_events</code> before processing so they can be replayed on failure.</p>
    </>,
    cites: [
      { id: 'doc-billing-svc', title: 'Billing Service', section: '§2 Idempotency' },
      { id: 'doc-billing-svc', title: 'Billing Service', section: '§3 Webhooks' },
    ],
  },
  {
    match: /(postmortem|review|incident review)/i,
    text: <>
      <p>Schedule a blameless review within three business days of resolution. The IC drafts the timeline; the team adds context. The output is a doc in <code>incidents/</code> with timeline, root causes, customer impact (in numbers), what worked, and action items with owners and due dates.</p>
      <p>Action items must be filed as Linear tickets <em>before</em> the review meeting ends — items without owners do not exist.</p>
    </>,
    cites: [
      { id: 'doc-prod-incident', title: 'Production Incident Response', section: '§5 Post-Incident Review' },
    ],
  },
];

const DEFAULT_REPLY = {
  text: <>
    <p>I searched the indexed content but couldn't find a confident answer. Try rephrasing or use the search palette (<code>⌘K</code>) for keyword matches.</p>
    <p>Tip: I only see documents you have permission to read. If you expect a result and don't see it, check that the doc is in a space your group can access.</p>
  </>,
  cites: [],
};

function ChatPanel({ open, onClose, onOpenDoc, onSavePage, contextDoc }) {
  const [messages, setMessages] = useStateC([
    {
      role: 'assistant',
      content: <>
        <p>Hi — I'm the WikiLLM assistant. I can answer questions grounded in your team's docs, with citations.</p>
        <p>Ask me anything about runbooks, services, or your personal notes. I only see what you have access to.</p>
      </>,
      cites: [],
    },
  ]);
  const [input, setInput] = useStateC('');
  const [thinking, setThinking] = useStateC(false);
  const bodyRef = useRefC(null);

  useEffectC(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, thinking, open]);

  const send = (text) => {
    if (!text.trim()) return;
    const userMsg = { role: 'user', content: text };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setThinking(true);
    setTimeout(() => {
      const reply = CANNED_REPLIES.find(r => r.match.test(text)) || DEFAULT_REPLY;
      setMessages(m => [...m, { role: 'assistant', question: text, content: reply.text, cites: reply.cites }]);
      setThinking(false);
    }, 900 + Math.random() * 500);
  };

  // Listen for ask prompts from elsewhere in the app
  useEffectC(() => {
    const onAsk = (e) => { if (open) send(e.detail); };
    window.addEventListener('wikillm:ask', onAsk);
    return () => window.removeEventListener('wikillm:ask', onAsk);
  }, [open]);

  const saveAsPage = (msg) => {
    const title = msg.question
      ? msg.question.replace(/\?$/, '').slice(0, 60)
      : 'Saved answer';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    onSavePage({
      title,
      path: `personal / saved / ${slug}.md`,
      s3: `s3://wikillm/tenants/acme/users/u-1042/wiki/saved/${slug}.md`,
      source: 'personal',
      updated: 'just now',
      author: 'you · via assistant',
      tags: ['saved', 'ai-generated'],
      checksum: 'sha256:gen-' + Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6),
      generated: true,
      question: msg.question,
      answer: msg.content,
      cites: msg.cites,
    });
  };

  return (
    <div className={"chat-panel" + (open ? ' open' : '')}>
      <div className="chat-head">
        {ICONS.spark}
        <span>Ask the wiki</span>
        <span className="badge-beta">MVP 2 · beta</span>
        <span style={{ flex: 1 }}></span>
        <button className="icon-btn" onClick={onClose} title="Close">{ICONS.close}</button>
      </div>
      <div className="chat-context">
        <span style={{ color: 'var(--fg-3)' }}>scope</span>
        <span className="scope-name">{contextDoc ? `this doc + shared` : 'shared + my wiki'}</span>
        <span style={{ flex: 1 }}></span>
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>permission-filtered</span>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} className={"msg " + m.role}>
            <div className="bubble">{m.content}</div>
            {m.cites && m.cites.length > 0 && (
              <div className="citations">
                {m.cites.map((c, j) => (
                  <button key={j} className="citation" onClick={() => onOpenDoc(c.id)}>
                    <span className="num">{j+1}</span>
                    <span className="ctitle">{c.title} <span style={{ color: 'var(--fg-3)' }}>· {c.section}</span></span>
                  </button>
                ))}
              </div>
            )}
            {m.role === 'assistant' && i > 0 && m.cites && m.cites.length > 0 && (
              <div className="msg-actions">
                <button className="msg-action primary" onClick={() => saveAsPage(m)}>
                  {ICONS.plus} Save as page in My wiki
                </button>
                <button className="msg-action">{ICONS.copy} Copy</button>
                <span style={{ flex: 1 }}></span>
                <span className="msg-meta">grounded in {m.cites.length} source{m.cites.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className="msg assistant">
            <div className="thinking">
              <span className="dt"></span><span className="dt"></span><span className="dt"></span>
              <span style={{ marginLeft: 4 }}>searching docs…</span>
            </div>
          </div>
        )}
        {messages.length <= 1 && (
          <div className="chat-suggest">
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
      </div>
      <div className="chat-input">
        <div className="chat-input-box">
          <textarea value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
                    }}
                    placeholder="Ask about anything in your docs…"
                    rows={1}/>
          <div className="chat-input-actions">
            <button className="btn ghost icon-only" title="Attach context">{ICONS.attach}</button>
            <span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{contextDoc ? 'context: current doc' : 'context: all wikis'}</span>
            <span className="grow"></span>
            <button className="btn primary" onClick={() => send(input)} disabled={!input.trim()}>
              {ICONS.send} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ChatPanel = ChatPanel;
