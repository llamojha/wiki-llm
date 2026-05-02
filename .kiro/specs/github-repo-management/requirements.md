# GitHub Repository Management

## Goal
Enable AIvaro to clone, track, and operate on GitHub repositories — both local and cloud-hosted.

## User Stories

### Story 1: Register Repositories
As a user, I can register GitHub repos for AIvaro to track and operate on.

### Story 2: Clone Cloud Repos
As a user, I can have AIvaro clone a cloud repo into a workspace for operations.

### Story 3: Track Repo Activity
As a user, AIvaro keeps me informed about activity in my tracked repos.

### Story 4: Repo Health Summary
As a user, I can ask "repo status" and get a health summary of my repos.

### Story 5: Git Operations
As a user, I can have AIvaro perform git operations (branch, commit, push) with approval.

---

## Scope

### In Scope
- Register repos (local path or owner/repo format)
- Clone cloud repos into `.aivaro/workspace/<repo-slug>`
- Track activity: commits, PRs, issues, branch changes
- Repo health summaries
- Stale PR/issue detection
- Failed CI checks alerts
- Git operations (pull, branch, commit, push) — approval-gated
- Background polling for updates

### Out of Scope
- Full CI/CD pipeline management
- GitHub Actions workflow editing
- Multi-remote support (v2)

---

## Commands

### Registration Commands
```
repo register <owner/repo>
repo register <local-path>
repo unregister <owner/repo | local-path>
repo list
```

### Status Commands
```
repo status [owner/repo]
repo health [owner/repo]
repo stale [owner/repo]
```

### Git Operation Commands (approval-gated)
```
repo pull <owner/repo>
repo branch <owner/repo> <branch-name>
repo commit <owner/repo> <message>
repo push <owner/repo>
```

---

## Architecture

### Workspace Structure
```
.aivaro/
└── workspace/
    └── <owner>-<repo>/
        └── ... (cloned repo contents)
```

### Repo Registration
```typescript
interface RegisteredRepo {
  id: string;
  source: 'local' | 'cloud';
  owner?: string;
  name: string;
  localPath?: string;
  workspacePath?: string;
  registeredAt: Date;
  lastSyncedAt?: Date;
}
```

### Activity Tracking
```typescript
interface RepoActivity {
  repoId: string;
  commits: CommitSummary[];
  pullRequests: PRSummary[];
  issues: IssueSummary[];
  failedChecks: FailedCheck[];
  lastChecked: Date;
}
```

---

## Tasks

### Task 1: Repo Registration Service
- Create `RepoRegistrationService`
- Store registered repos in state
- Support both local and cloud repos
- Validate repo exists and is accessible

### Task 2: Workspace Manager
- Create `WorkspaceManager` service
- Handle clone operations into `.aivaro/workspace/`
- Manage workspace cleanup and storage limits
- Track workspace paths for registered repos

### Task 3: Git Operations Service
- Create `GitOperationsService`
- Wrap simple-git or similar library
- Operations: clone, pull, branch, commit, push
- Handle authentication (PAT from env)

### Task 4: GitHub Activity Tracker
- Create `GitHubActivityTracker` service
- Poll for new commits, PRs, issues
- Detect failed CI checks
- Store activity state for comparison

### Task 5: Repo Health Service
- Create `RepoHealthService`
- Calculate health metrics:
  - Open PRs age
  - Stale issues
  - Failed checks
  - Branch divergence
- Generate health summary text

### Task 6: Stale Item Detection
- Detect stale PRs (no activity for X days)
- Detect stale issues
- Detect abandoned branches
- Include in proactive alerts

### Task 7: Background Polling
- Add repo polling to proactive agent
- Configurable interval
- Store last-seen state for change detection

### Task 8: Git Operation Commands
- Implement `repo pull`, `repo branch`, `repo commit`, `repo push`
- All write operations require approval
- Dry-run shows what would happen

---

## Configuration

```env
AIVARO_GITHUB_PAT=<github-personal-access-token>
AIVARO_WORKSPACE_PATH=.aivaro/workspace
AIVARO_REPO_POLL_INTERVAL_MS=300000  # 5 min
AIVARO_STALE_PR_DAYS=7
AIVARO_STALE_ISSUE_DAYS=14
```

---

## Acceptance Criteria

- [ ] `repo register owner/repo` clones repo to workspace
- [ ] `repo register /local/path` links existing local repo
- [ ] `repo list` shows all registered repos
- [ ] `repo status` shows health summary for all repos
- [ ] `repo health owner/repo` shows detailed health metrics
- [ ] Stale PRs and issues detected and reported
- [ ] Failed CI checks trigger alerts
- [ ] `repo pull` updates local copy (approval-gated)
- [ ] `repo branch`, `commit`, `push` work with approval
- [ ] Background polling keeps activity state fresh
