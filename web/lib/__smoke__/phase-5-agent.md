# Phase 5 — Ask-Wiki Agent · Manual Smoke Checklist

Walk this before declaring the feature shipped, and before every meaningful change to `web/lib/agent.ts`, `web/lib/agent-prompts.ts`, or `web/components/chat-panel.tsx`.

Prereqs:
- `pnpm dev` running in `web/`
- AWS credentials with `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `s3:GetObject`, `s3:PutObject` on the vault bucket
- A vault with at least 3 curated docs in the shared library and 1 doc in the personal library

---

## 1. Simple question with a hit

**Goal:** Verify end-to-end happy path — search, read, cited answer.

1. Open the chat panel (FAB or `⌘K`-style trigger).
2. Scope is **Both** by default.
3. Type a question that matches one of your shared docs (e.g. "How does the indexer handle S3 events?").
4. Send.

**Expect:**
- Tokens stream live into the assistant bubble.
- At least one **citation** appears below the bubble after the answer.
- Clicking a citation opens that doc in the main reader.
- Network panel: `POST /api/chat` returns `application/x-ndjson` with `Transfer-Encoding: chunked`.
- S3: a new line appended to `_system/usage-log.jsonl` (or `users/<id>/_system/usage-log.jsonl` if you tested with `My` scope).

---

## 2. No-hits refusal

**Goal:** Verify the refuse-then-force flow.

1. Ask a question that has no answer in the vault (e.g. "Tell me about quantum dolphins").
2. Send.

**Expect:**
- Agent searches (you'll see a brief delay), comes back empty.
- Bubble contains the refusal message.
- A **"Draft anyway (no sources)"** button is rendered below the refusal.
- Click the button.
- Agent runs again with `forceUnsourcedGeneration: true`.
- The next response should emit a `propose_page` event.
- The preview block's body **opens with**: `_No vault sources — drafted from general knowledge._`
- Save button works (→ section 5).

---

## 3. Explicit generation

**Goal:** Verify Path A (implicit `propose_page` triggered by phrasing).

1. Ask: "Write me a runbook for handling a stuck S3 ingest job."
2. Send.

**Expect:**
- Agent may search/read relevant docs first.
- Eventually emits `propose_page`.
- Preview block appears with title + Markdown body + Save / Discard buttons.
- Save → `POST /api/docs` returns 201 → preview disappears, doc opens in reader, sidebar refreshes to show the new page in My wiki.

---

## 4. Slug collision on save

**Goal:** Verify error surfaces from the save flow.

1. Trigger another generation that would land on a slug already in your personal wiki (e.g. ask twice for the same page).
2. Click Save on the second proposal.

**Expect:**
- Save call returns 409.
- Error toast in the chat panel reads e.g. `A page with slug "stuck-s3-ingest" already exists`.
- Preview block stays open so the user can retry (currently means: the agent has to be re-asked with a different slug — future improvement: editable slug in the preview).

---

## 5. Post-hoc Save-as-page (Path B)

**Goal:** Verify the casual save path that routes through the Editor.

1. Ask a normal question that gets a normal cited answer.
2. After the answer finishes streaming, click **Save as page in My wiki** below the bubble.

**Expect:**
- Chat panel closes.
- Editor opens with:
  - Title pre-filled (derived from the question)
  - Body pre-filled with the answer text + a `## Citations` section listing the cites
- User can edit freely.
- Existing Editor Save → `POST /api/docs` → new doc lives in `users/<id>/authored/personal/`.

---

## 6. Scope selector

**Goal:** Verify scope honors the chat panel's selector.

1. Set scope to **Shared** only.
2. Ask a question whose answer lives only in your personal wiki.

**Expect:**
- Agent searches shared, finds nothing relevant, refuses.

3. Switch to **My** only and ask the same question.

**Expect:**
- Agent searches user scope only, finds and cites the personal doc.

4. Switch to **Both** and ask a question that requires synthesizing shared and personal.

**Expect:**
- Citations cross scopes.

---

## 7. Stream cancellation

**Goal:** Verify aborting mid-stream is clean.

1. Send a long question (e.g. "Compile a comprehensive summary of every doc in my vault").
2. Mid-stream, close the chat panel.

**Expect:**
- Stream aborts client-side (fetch's AbortController fires).
- Server's `controller.close()` runs in the `finally`.
- No orphan log entry beyond what was already streamed (the log writes once on done/error).
- Re-opening the panel: prior conversation is still visible (it's in-memory state).

---

## 8. Context document hint

**Goal:** Verify the `contextDocId` plumbing.

1. Open a specific doc.
2. Open the chat panel — note the "context: current doc" label in the chat input row.
3. Ask: "What's this doc about?"

**Expect:**
- Agent treats the open doc as a strong hint (may read it directly).
- Citation includes the open doc.

---

## When something is wrong

| Symptom | Likely cause |
|---|---|
| Citation count is 0 but the answer has facts | Agent answered without calling `read_document` — tighten the system prompt's citation rule |
| `propose_page` triggered on a Q&A turn | Agent over-triggering — tighten the generation rule examples |
| Streaming hangs around 60s | Vercel Edge timeout — verify `runtime: 'nodejs'` is in `app/api/chat/route.ts` |
| `Cannot find module @smithy/types` at build time | Re-introduced direct import; use the local `DocumentType` alias in `agent.ts` |
| 500 on `POST /api/chat` | Check CloudWatch / server logs; most likely missing IAM permission for Bedrock |
| Pending-tab badge doesn't disable Send button | Wrong button; we now disable on `thinking` only |

---

## Open follow-ups (not part of this smoke)

- Editable slug in the preview block before Save (currently slug is fixed by the agent's choice)
- Live Markdown rendering during streaming (currently buffer until done)
- Server-side rate limit on `POST /api/chat`
- Chat history persistence (deferred to Phase 6)
