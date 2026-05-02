# Workflow Automation Migration

## Goal
Migrate vibeSprint issue-to-PR workflow capabilities into AIvaro as an internal capability.

## User Stories

### Story 1: Trigger Issue Execution
As a user, I can trigger issue-to-PR workflow from Discord with `run issue <id>`.

### Story 2: Plan Workflow
As a user, I can label an issue `type:plan` and AIvaro will post a plan for approval before implementing.

### Story 3: Workflow Status
As a user, I can check the status of running and past workflows with `run status`.

### Story 4: Failure Handling
As a user, when a workflow fails, I see a clear error and can retry.

---

## Scope

### In Scope
- Polling for issues from GitHub Project boards
- Kiro executor integration
- Git operations (branch, commit, push, PR)
- Status updates (labels, column moves)
- Failure handling + retry logic
- Plan workflow (`type:plan` → plan comment → approval → implement)
- Run history and status tracking
- Integration with existing approval system

### Out of Scope
- Event-driven webhooks (polling only)
- Multi-repo parallel execution (v2)
- Custom workflow definitions (v2)

---

## Architecture

### Migration Source
vibeSprint implementation in `/vibeSprint` directory:
- Phase 1: Foundation + Polling ✅
- Phase 2: Robustness ✅
- Phase 3: Plan Workflow ✅

### Target Architecture
Migrate into AIvaro as:
- `WorkflowService` (enhanced from existing)
- `KiroExecutorService` (new)
- `GitOperationsService` (shared with GitHub repo management)
- `ProjectBoardService` (new)

---

## Commands

### Workflow Commands
```
run issue <id> [plan|implement]
run status [run-id]
run retry <run-id>
run cancel <run-id>
```

### Project Board Commands
```
project link <owner/repo> <project-number>
project columns [project-id]
project set-column <field-name>
```

---

## Workflow States

```
pending → running → completed
                 ↘ failed → retrying → running
```

### Run Record
```typescript
interface WorkflowRun {
  id: string;
  issueId: string;
  issueNumber: number;
  repo: string;
  mode: 'plan' | 'implement';
  status: 'pending' | 'running' | 'completed' | 'failed';
  branch?: string;
  prNumber?: number;
  error?: string;
  output?: string;
  createdAt: Date;
  completedAt?: Date;
}
```

---

## Tasks

### Task 1: Kiro Executor Service
- Create `KiroExecutorService`
- Invoke kiro-cli with issue context
- Capture stdout/stderr
- Handle timeouts
- Strip ANSI codes from output

### Task 2: Git Operations Integration
- Use shared `GitOperationsService` from GitHub repo management
- Create branch: `agent/<issue>-<slug>`
- Commit with `Refs #<issue>`
- Push to origin
- Open PR with `Fixes #<issue>`

### Task 3: Project Board Service
- Create `ProjectBoardService`
- GraphQL queries for Project V2
- Fetch issues in target column
- Move issues between columns
- Read/write field values

### Task 4: Workflow Orchestration
- Enhance existing `WorkflowService`
- Coordinate: executor → git → status updates
- Handle plan vs implement modes
- Store run records in state

### Task 5: Plan Workflow
- Detect `type:plan` label on issue
- Run kiro in plan-only mode
- Post plan as comment
- Wait for `/approve` comment
- Transition to implement after approval

### Task 6: Failure Handling
- Detect failures from executor exit code
- Add `failed` label to issue
- Post error summary as comment
- Support retry via `run retry <id>`
- Escalation: retry → failed (no auto-retry after threshold)

### Task 7: Status Updates
- Add `running` label when execution starts
- Move issue to "In Progress" column
- Add `pr-opened` label when PR created
- Remove `running` label on completion

### Task 8: Run History
- Store all runs in SQLite
- Query for `run status` command
- Include: issue, status, duration, error if failed

---

## Configuration

```env
AIVARO_WORKFLOW_ENABLED=true
AIVARO_WORKFLOW_POLL_INTERVAL_MS=60000
AIVARO_WORKFLOW_TIMEOUT_MS=600000
AIVARO_WORKFLOW_MAX_RETRIES=2
AIVARO_KIRO_CLI_PATH=kiro-cli
```

---

## Acceptance Criteria

- [ ] `run issue <id>` triggers workflow execution
- [ ] Workflow creates branch, commits, opens PR
- [ ] Issue moved to In Progress, labeled correctly
- [ ] `run status` shows current and recent runs
- [ ] Failed runs post error comment on issue
- [ ] `run retry <id>` re-attempts failed run
- [ ] `type:plan` label triggers plan workflow
- [ ] Plan posted as comment, waits for approval
- [ ] After approval, implementation runs
- [ ] Run history persisted and queryable
