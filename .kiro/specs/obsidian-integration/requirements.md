# Obsidian/Wiki LLM Integration

## Goal
Integrate AIvaro with an Obsidian vault, enabling semantic search and retrieval of personal knowledge base content.

## User Stories

### Story 1: Query Obsidian Vault
As a user, I can ask AIvaro questions and it will search my Obsidian vault for relevant notes.

### Story 2: Cross-Reference Conversations
As a user, AIvaro can link Discord conversations to relevant wiki entries.

### Story 3: Write to Vault (Approval-Gated)
As a user, I can have AIvaro write meeting notes or decisions to my Obsidian vault with approval.

---

## Scope

### In Scope
- Index Obsidian vault content (markdown files)
- Semantic search over vault content
- Query: "What did I write about X?"
- Metadata extraction (tags, links, frontmatter)
- Optional write-back (approval-gated)
- File watcher for vault changes

### Out of Scope
- Real-time sync with Obsidian app
- Attachment/file indexing (images, PDFs)
- Graph view integration
- Multi-vault support (v2)

---

## Architecture

### Indexing Approach
- Point AIvaro to Obsidian vault path
- Walk directory, read all `.md` files
- Extract: content, frontmatter, tags, wikilinks
- Store in vector store or use existing knowledge tool

### Query Flow
```
User query
    ↓
Embed query
    ↓
Search indexed vault content
    ↓
Return relevant notes/snippets
    ↓
AIvaro synthesizes response
```

### Write Flow (Approval-Gated)
```
User: "save this to my vault"
    ↓
AIvaro creates pending write
    ↓
User approves
    ↓
AIvaro writes markdown file to vault
```

---

## Configuration

```env
AIVARO_OBSIDIAN_ENABLED=true
AIVARO_OBSIDIAN_VAULT_PATH=/path/to/vault
AIVARO_OBSIDIAN_INDEX_INTERVAL_MS=300000  # 5 min
AIVARO_OBSIDIAN_WRITE_ENABLED=true
AIVARO_OBSIDIAN_DEFAULT_FOLDER=AIvaro
```

---

## Tasks

### Task 1: Vault Scanner
- Create `VaultScanner` service
- Walk vault directory
- Read all `.md` files
- Extract frontmatter, tags, wikilinks

### Task 2: Content Indexer
- Create `VaultIndexer` service
- Chunk content for embedding
- Store in vector store or knowledge tool
- Track file hashes for incremental updates

### Task 3: Query Integration
- Add `wiki <query>` command
- Search indexed content
- Return relevant snippets
- Synthesize response with context

### Task 4: File Watcher
- Watch vault directory for changes
- Re-index modified files
- Handle file renames/deletes

### Task 5: Write Capability
- Create `VaultWriter` service
- Write markdown files to vault
- Respect folder structure
- Approval-gated via existing system

### Task 6: Metadata Extraction
- Parse YAML frontmatter
- Extract `#tags` from content
- Parse `[[wikilinks]]`
- Include in search index

---

## Commands

```
wiki <query>           # Search vault
wiki reindex           # Force full reindex
wiki stats             # Show vault stats
wiki save <title> :: <content>  # Write to vault (approval-gated)
```

---

## Acceptance Criteria

- [ ] Vault path configured and validated
- [ ] All markdown files indexed
- [ ] `wiki <query>` returns relevant notes
- [ ] Tags and frontmatter included in search
- [ ] File changes detected and re-indexed
- [ ] `wiki save` writes to vault with approval
- [ ] Stats show vault overview (file count, last indexed)
