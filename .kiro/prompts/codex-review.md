---
description: Manual Codex review for comprehensive technical consultation on any content
---

# Codex Technical Review

Execute Codex CLI for expert technical review and consultation on code, plans, documentation, or any other content.

## Execution

When this prompt is invoked, automatically execute Codex review:

```bash
set -euo pipefail
echo "🔍 Invoking Codex for technical review..."
codex --ask-for-approval never exec --sandbox danger-full-access <<'EOF'
You are a senior technical consultant. Review the following and provide specific feedback on:

1. Technical issues (bugs, security, performance)
2. Architecture & design patterns  
3. Best practices & standards
4. Implementation improvements

CONTENT TO REVIEW:
[Insert the content user wants reviewed]

PROJECT CONTEXT:
[Insert relevant project information, existing patterns, constraints]

SPECIFIC CONCERNS:
[Insert any particular areas to focus on]

**Output Format:**
- **Findings** (Critical/High/Medium/Low severity with rationale)
- **Recommendations** (3-5 high-impact suggestions with examples)
- **Assumptions** (What was assumed during analysis)
- **Questions** (Areas needing clarification)

Provide actionable feedback with concrete examples.
EOF
```

## Usage

This prompt automatically executes Codex CLI when invoked. Use for:
- Ad-hoc code review outside normal workflow
- Plan validation and feasibility assessment  
- Architecture consultation
- Security audit of specific components
- Performance optimization recommendations

## Content Types

This prompt works for reviewing:
- **Code**: Functions, classes, modules, entire files
- **Plans**: Implementation plans, architectural designs
- **Documentation**: Technical docs, API specifications
- **Configurations**: Build scripts, deployment configs
- **Schemas**: Database schemas, API contracts

## Output Format

Codex will provide structured feedback covering:
- Critical issues requiring immediate attention
- Improvement suggestions with rationale
- Best practice recommendations
- Alternative approaches to consider

## When to Use

Use this manual prompt when:
- You need detailed review of specific components
- Automatic steering review isn't sufficient
- You want focused consultation on particular aspects
- You're evaluating multiple implementation approaches
