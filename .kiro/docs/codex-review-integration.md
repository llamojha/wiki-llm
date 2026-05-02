# Codex Review Integration - Usage Guide

## Overview

The Codex Review Integration System provides three complementary ways to leverage Codex CLI for technical consultation and code review within your Kiro workflow:

1. **Automatic Steering** - Seamless integration that triggers on all operations
2. **Manual Prompt** - On-demand review for specific content
3. **Consultant Agent** - Complex review workflows via subagent delegation

## Prerequisites

Ensure Codex CLI is installed and available:
```bash
npm install -g @openai/codex
codex --version  # Verify installation
```

## Usage Patterns

### 1. Automatic Steering Review
**File**: `.kiro/steering/codex-review.md`
**Trigger**: Automatic on all Kiro operations
**Use Case**: Continuous review during development workflow

The steering file automatically invokes Codex review after any significant task completion. No user action required - feedback appears inline during execution.

**Example Workflow**:
```
User: "Generate a user authentication system"
Kiro: [Generates code]
Codex: [Automatically reviews and provides feedback]
Kiro: [Continues with original task]
```

### 2. Manual Prompt Review
**File**: `.kiro/prompts/codex-review.md`
**Trigger**: Manual invocation via prompt
**Use Case**: Ad-hoc review of specific content

Use when you need focused review outside the normal workflow:
```bash
kiro chat "Use the codex-review prompt to analyze this function: [paste code]"
```

**Best For**:
- Reviewing existing code before refactoring
- Getting second opinion on implementation approaches
- Detailed analysis of specific components
- Security audit of critical functions

### 3. Consultant Agent Delegation
**File**: `.kiro/agents/codex-consultant.json`
**Trigger**: Subagent delegation
**Use Case**: Complex multi-step review workflows

Delegate complex review tasks to the Codex consultant:
```bash
kiro chat "Delegate to codex-consultant agent: Review the entire authentication module for security vulnerabilities"
```

**Best For**:
- Comprehensive system reviews
- Architecture validation
- Multi-file analysis
- Strategic technical guidance

## Integration Testing

### Test 1: Steering File Integration
1. Make a simple code change
2. Verify Codex review triggers automatically
3. Confirm feedback displays inline

### Test 2: Manual Prompt Usage
1. Run: `kiro chat "Use codex-review prompt to analyze [some code]"`
2. Verify Codex CLI executes with proper prompt structure
3. Confirm detailed feedback is provided

### Test 3: Agent Delegation
1. Run: `kiro chat "Delegate to codex-consultant: Review this implementation"`
2. Verify subagent system invokes Codex consultant
3. Confirm comprehensive analysis is returned

## Command Reference

**Codex Headless Command** (used by all approaches):
```bash
codex --ask-for-approval never exec --sandbox danger-full-access
```

**Manual Prompt Invocation**:
```bash
kiro chat "Use the codex-review prompt to [describe what to review]"
```

**Agent Delegation**:
```bash
kiro chat "Delegate to codex-consultant agent: [describe review task]"
```

## Troubleshooting

**Issue**: Codex CLI not found
**Solution**: Install with `npm install -g @openai/codex`

**Issue**: Steering not triggering
**Solution**: Verify `.kiro/steering/codex-review.md` has `inclusion: always`

**Issue**: Agent not available
**Solution**: Verify `.kiro/agents/codex-consultant.json` exists and is valid JSON

**Issue**: Reviews too verbose
**Solution**: Modify prompt templates to request more concise feedback

## Best Practices

1. **Use steering for continuous feedback** during active development
2. **Use manual prompts for focused analysis** of specific components  
3. **Use agent delegation for comprehensive reviews** of entire systems
4. **Combine approaches** - steering for ongoing feedback, manual for deep dives
5. **Review Codex feedback critically** - it's advisory, not authoritative

## Integration with VibeSprint

The Codex review system integrates seamlessly with VibeSprint's issue-to-PR workflow:
- Steering provides automatic review during code generation
- Manual prompts enable review of existing code before changes
- Agent delegation supports comprehensive pre-implementation analysis

All three approaches respect the "memory only" requirement - feedback is displayed during execution but not persisted to files or issues.
