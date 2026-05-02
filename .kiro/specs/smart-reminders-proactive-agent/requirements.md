# Smart Reminders & Proactive Agent

## Goal
Enable AIvaro to set time-based reminders and proactively check in with the user based on activity patterns and system state.

## User Stories

### Story 1: Time-based Reminders
As a user, I can say "remind me to check the PR in 2 hours" and AIvaro will ping me at that time.

### Story 2: Context-linked Follow-ups
As a user, I can say "follow up on the auth refactor tomorrow morning" and AIvaro will remind me with context.

### Story 3: Proactive Good Morning
As a user, I receive a good morning message with a summary of what's important today.

### Story 4: Inactivity Check-in
As a user, if I haven't interacted with AIvaro in X days, it checks in on me.

### Story 5: Important State Alerts
As a user, AIvaro proactively notifies me when something important happens (blocked issue, failed CI, waiting PR).

---

## Scope

### In Scope
- `remind me to <action> in <time>` command
- `follow up on <topic> [in/at <time>]` command
- Proactive agent running on 15-30 min cron cycle
- Good morning digest at configurable time
- Inactivity detection and check-in messages
- Important state detection (GitHub, Linear, workflows)
- Configurable quiet hours
- Delivery via DM or ambient channel

### Out of Scope
- Calendar integration (separate feature)
- Location-based reminders
- Recurring reminders (v2)

---

## Commands

### Reminder Commands
```
remind me to <action> in <duration>
remind me to <action> at <time>
follow up on <topic> [in <duration> | at <time>]
reminders [list|clear <id>]
```

Examples:
- `remind me to check the deploy in 30 minutes`
- `remind me to review the PR at 3pm`
- `follow up on the auth issue tomorrow morning`
- `reminders list`

---

## Proactive Agent Behavior

### Cron Cycle (15-30 min configurable)
1. Check current time against configured schedules
2. Check for important state changes:
   - GitHub: new PRs assigned, failed checks, stale PRs
   - Linear: blocked issues, issues moved to review, new assignments
   - Workflows: run failures, pending approvals
3. Check last interaction timestamp
4. Generate proactive message if conditions met

### Trigger Conditions

| Condition | Action |
|-----------|--------|
| Configured morning time | Send good morning digest |
| Important state detected | Send alert |
| No interaction in X days | Send check-in message |
| Reminder due | Send reminder |

### Good Morning Digest
- Greeting
- Today's calendar (if integrated)
- Assigned PRs waiting review
- Blocked issues
- In-progress work
- Reminders for today

### Inactivity Check-in
- Triggered after X days of no interaction (configurable, default 2)
- Friendly message: "Haven't heard from you in a while. How's it going?"
- Optional summary of what's happened since last interaction

---

## Configuration

```env
AIVARO_PROACTIVE_ENABLED=true
AIVARO_PROACTIVE_INTERVAL_MS=1800000  # 30 min
AIVARO_PROACTIVE_MORNING_TIME=08:00
AIVARO_PROACTIVE_INACTIVITY_DAYS=2
AIVARO_PROACTIVE_QUIET_HOURS_START=22:00
AIVARO_PROACTIVE_QUIET_HOURS_END=07:00
AIVARO_PROACTIVE_DELIVERY_TARGETS=ambient-channel,dm
```

---

## Tasks

### Task 1: Reminder Storage
- Add reminder model to state store
- Fields: id, action, topic, dueAt, createdAt, delivered, deliveryTarget
- CRUD operations

### Task 2: Reminder Commands
- Parse `remind me` and `follow up` commands
- Natural language duration parsing ("in 30 minutes", "tomorrow morning")
- Store reminders in state

### Task 3: Reminder Delivery
- Background job to check due reminders
- Deliver via DM or ambient channel
- Mark as delivered

### Task 4: Proactive Agent Service
- New service: `ProactiveAgentService`
- Runs on configurable interval
- Checks all trigger conditions
- Generates and sends proactive messages

### Task 5: State Change Detection
- Integrate with GitHub/Linear services
- Track "last seen" state for important items
- Detect changes: new assignments, status changes, failures

### Task 6: Inactivity Tracking
- Track last interaction timestamp per user
- Check against configured threshold
- Generate check-in message

### Task 7: Good Morning Digest
- Scheduled job at configured time
- Gather: assigned PRs, blocked issues, in-progress work, today's reminders
- Format as friendly digest message

### Task 8: Quiet Hours
- Skip proactive messages during quiet hours
- Queue for delivery after quiet hours end (optional)

---

## Acceptance Criteria

- [ ] `remind me to X in Y` creates and delivers reminder at correct time
- [ ] `follow up on X` creates context-linked reminder
- [ ] `reminders list` shows pending reminders
- [ ] Good morning digest sends at configured time
- [ ] Inactivity check-in triggers after X days of no interaction
- [ ] Important state changes trigger proactive alerts
- [ ] Quiet hours respected (no proactive messages)
- [ ] Delivery target configurable (DM vs ambient channel)
