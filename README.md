# wiki-llm

A personal knowledge base maintained by LLMs. You curate sources and ask questions; the LLM does the summarising, cross-referencing, and bookkeeping.

Read [`llm-wiki.md`](llm-wiki.md) for the full concept.

## How it works

```
raw/          ← you drop source documents here (immutable)
wiki/         ← LLM writes and maintains all of this
  index.md    ← catalog of every page
  log.md      ← append-only history of ingests, queries, lint passes
  sources/    ← one summary per raw source
  entities/   ← people, orgs, products
  concepts/   ← ideas, terms, frameworks
  analyses/   ← filed answers to non-trivial queries
```

Heavy operations (ingest, lint) run via Amazon Bedrock. Queries are handled interactively by whichever AI agent you're using.

## Setup

```bash
pip install -r requirements.txt
```

### AWS credentials & Bedrock model access

`wiki.py` calls Amazon Bedrock through `boto3`. To use the live path you need three things:

1. **Credentials.** Standard `boto3` resolution: `aws configure`, `AWS_PROFILE`, or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars (and `AWS_SESSION_TOKEN` if temporary). Verify with `aws sts get-caller-identity`.
2. **Model access.** Bedrock requires per-region opt-in for each model family. AWS console → **Bedrock → Model access → Manage model access**, request access to **Amazon → Nova Lite**, wait for it to flip to *Access granted*. Repeat per region.
3. **IAM permission.** Your principal needs `bedrock:InvokeModel` on the model ARN. Minimal policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": "bedrock:InvokeModel",
       "Resource": "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0"
     }]
   }
   ```

Defaults: model `amazon.nova-lite-v1:0`, region `us-east-1`. Override with `WIKI_MODEL` and `AWS_REGION` env vars. List what your account can see with:

```bash
aws bedrock list-foundation-models --region us-east-1 \
  --query 'modelSummaries[?contains(modelId, `nova-lite`)].modelId'
```

If a region requires a cross-region inference profile, use the prefixed ID (e.g. `WIKI_MODEL=us.amazon.nova-lite-v1:0`).

#### Common errors

| Symptom | Likely cause |
|---|---|
| `AWS credentials not found` | No creds resolvable — run `aws configure` or set env vars, or use `--mock`. |
| `AccessDeniedException` | Model access not granted in the console, or IAM lacks `bedrock:InvokeModel`. |
| `ValidationException` | Wrong model ID, or model not offered in `AWS_REGION`. |
| `ResourceNotFoundException` | Model ID typo — list available IDs with the command above. |

## Usage

### Ingest a source

Drop a document into `raw/`, then:

```bash
python wiki.py ingest raw/my-article.md
```

`wiki.py` calls Bedrock, writes all wiki pages (source summary, entities, concepts, index, overview, log), and commits.

#### Pulling notes from an Obsidian vault

Point `OBSIDIAN_VAULT` at the root of your vault directory and ingest will read notes directly from disk (an Obsidian vault is just a tree of `.md` files; no Obsidian app needs to be running):

```bash
OBSIDIAN_VAULT=~/Vault python wiki.py ingest "My Note"           # by name or relative path
OBSIDIAN_VAULT=~/Vault python wiki.py ingest --search "topic"    # interactive pick
```

Vault notes are cached into `raw/` so each ingest is reproducible. Use `--client {auto,obsidian,file}` to force a specific client (default `auto`); auto-detect uses the vault when `OBSIDIAN_VAULT` is set, otherwise falls back to `raw/`.

#### Mock mode (no AWS credentials)

```bash
python wiki.py --mock ingest raw/sample.md     # or: WIKI_MOCK=1
python wiki.py --mock lint
```

Stubs the Bedrock call with a deterministic placeholder response. Useful for end-to-end smoke tests without AWS. Pages produced this way are prefixed `MOCK` so they're easy to spot in git history.

### Lint the wiki

```bash
python wiki.py lint
```

Scans all wiki pages for contradictions, orphans, stale claims, and gaps. Prints a report and asks before applying fixes.

### Query

Use any AI agent with `prompts/query.md` as a prompt template. The agent reads the wiki and synthesizes an answer.

| Agent | How to query |
|-------|-------------|
| Claude Code | `/query` slash command |
| Codex / Kiro / other | paste or reference `prompts/query.md` |

## Schema

[`CLAUDE.md`](CLAUDE.md) — full operating instructions (Claude Code).
[`AGENTS.md`](AGENTS.md) — same for other agents.
[`prompts/query.md`](prompts/query.md) — agent-neutral query prompt.

## Tips

- **Obsidian Web Clipper** converts web articles to markdown for fast ingest.
- **Graph view** in Obsidian shows the shape of your wiki — hubs, orphans, clusters.
- Run `python wiki.py lint` after every ~10 ingests to keep the wiki healthy.
