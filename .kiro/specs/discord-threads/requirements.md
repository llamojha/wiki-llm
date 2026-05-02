# Discord Threads Support

## Goal
Enable AIvaro to create and manage Discord threads for conversations, keeping channels clean and enabling context-aware discussions.

## User Stories

### Story 1: Auto-Thread Creation
As a user, when I interact with AIvaro, it creates a thread for the conversation instead of posting in the main channel.

### Story 2: Thread Continuity
As a user, I can continue a conversation in a thread and AIvaro maintains context.

### Story 3: Thread Lifecycle
As a user, threads are automatically archived when conversations end.

---

## Scope

### In Scope
- Auto-create thread on initial response
- Thread-aware message tracking (state per thread)
- Thread lifecycle management (auto-archive, close)
- Works with ambient channels and DMs
- Configurable: always thread vs selective threading

### Out of Scope
- Thread permissions management
- Cross-thread references
- Thread search/indexing

---

## Behavior

### Thread Creation
- When AIvaro responds to a message, create a thread from that message
- Thread name: first 50 chars of user's message or generated summary
- All subsequent responses go to the thread

### Thread Tracking
- Store thread ID with conversation context
- Map: channelId → threadId → conversation state
- Detect when user replies in thread vs new message

### Thread Lifecycle
- Auto-archive after X minutes of inactivity (configurable)
- Option to "close" thread explicitly
- Re-open if user replies to archived thread

---

## Configuration

```env
AIVARO_THREADS_ENABLED=true
AIVARO_THREADS_AUTO_CREATE=true
AIVARO_THREADS_ARCHIVE_AFTER_MINUTES=60
AIVARO_THREADS_SELECTIVE=false  # if true, only thread for certain commands
```

---

## Tasks

### Task 1: Thread Creation
- Detect when to create thread (new conversation vs continuation)
- Use Discord.js `startThread` API
- Generate thread name from context

### Task 2: Thread-Aware State
- Update conversation state to track thread IDs
- Map messages to correct thread context
- Handle thread lookup on incoming messages

### Task 3: Thread Lifecycle
- Implement inactivity detection
- Auto-archive threads after timeout
- Handle re-opening archived threads

### Task 4: Configuration
- Add thread config options
- Support selective threading (only for certain commands)

---

## Acceptance Criteria

- [ ] AIvaro creates thread on initial response
- [ ] Subsequent messages in thread maintain context
- [ ] Thread name reflects conversation topic
- [ ] Threads auto-archive after inactivity
- [ ] Works in ambient channels
- [ ] Works with DM mode (no thread needed, already 1:1)
