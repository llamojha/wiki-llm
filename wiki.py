#!/usr/bin/env python3
"""wiki.py — Bedrock-powered ingest and lint for wiki-llm."""

import argparse
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import boto3

MODEL_ID = os.environ.get("WIKI_MODEL", "amazon.nova-lite-v2:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

ROOT = Path(__file__).parent
WIKI = ROOT / "wiki"
RAW = ROOT / "raw"


# ── Bedrock ──────────────────────────────────────────────────────────────────

def invoke(system: str, user: str) -> str:
    client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    resp = client.converse(
        modelId=MODEL_ID,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": 16384},
    )
    return resp["output"]["message"]["content"][0]["text"]


def parse_files(text: str) -> dict[str, str]:
    """Extract <file path="...">...</file> blocks from LLM response."""
    out = {}
    for m in re.finditer(r'<file path="([^"]+)">(.*?)</file>', text, re.DOTALL):
        out[m.group(1)] = m.group(2).strip()
    return out


def apply_files(files: dict[str, str]) -> None:
    for rel, content in files.items():
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content + "\n")
        print(f"  wrote {rel}")


def git_commit(msg: str) -> None:
    subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
    result = subprocess.run(["git", "commit", "-m", msg], cwd=ROOT)
    if result.returncode != 0:
        print("  (nothing to commit)")


# ── Ingest ───────────────────────────────────────────────────────────────────

INGEST_SYSTEM = """\
You are a wiki maintainer for a personal knowledge base stored as markdown files.
Process a new source document and integrate it into the existing wiki.

Output ONLY file contents in XML blocks — one block per file to create or update:
<file path="wiki/sources/slug.md">...content...</file>

Produce these files:
1. wiki/sources/<slug>.md — structured summary with YAML frontmatter
2. wiki/index.md — updated catalog (add new row; preserve all existing rows exactly)
3. wiki/overview.md — updated high-level synthesis
4. wiki/log.md — full file with new entry appended at the bottom
5. wiki/entities/<name>.md — one file per significant person, org, or product (create or update)
6. wiki/concepts/<name>.md — one file per key idea or framework (create or update)

Rules:
- Every page needs YAML frontmatter: title, type, tags, sources, created, updated
- Link between pages using [[Page Title]] wikilinks on first mention
- Slug = lowercase, hyphens only, no special characters
- Preserve ALL existing rows in index.md — only add new rows
- Preserve ALL existing log entries — only append the new one at the bottom
- Flag contradictions with existing content explicitly rather than silently overwriting
- Today's date is provided in the user message
"""


def cmd_ingest(source_file: str) -> None:
    src = Path(source_file)
    if not src.exists():
        src = RAW / source_file
    if not src.exists():
        sys.exit(f"File not found: {source_file}")

    print(f"Ingesting {src.name} ...")

    source_content = src.read_text()
    index = (WIKI / "index.md").read_text() if (WIKI / "index.md").exists() else ""
    log = (WIKI / "log.md").read_text() if (WIKI / "log.md").exists() else ""
    overview = (WIKI / "overview.md").read_text() if (WIKI / "overview.md").exists() else ""

    existing = []
    for subdir in ("entities", "concepts"):
        d = WIKI / subdir
        if d.exists():
            for p in sorted(d.glob("*.md")):
                existing.append(f"=== wiki/{subdir}/{p.name} ===\n{p.read_text()}")

    user_msg = f"""Today's date: {date.today().isoformat()}

Source file: raw/{src.name}
--- SOURCE START ---
{source_content}
--- SOURCE END ---

Current wiki/index.md:
{index or "(empty)"}

Current wiki/log.md:
{log or "(empty)"}

Current wiki/overview.md:
{overview or "(empty)"}

Existing entity/concept pages:
{"".join(existing) if existing else "(none yet)"}

Process this source and output all new/updated wiki files.
"""

    print("Calling Bedrock ...")
    response = invoke(INGEST_SYSTEM, user_msg)
    files = parse_files(response)

    if not files:
        print("No <file> blocks found in response. Raw output:\n")
        print(response)
        sys.exit(1)

    print(f"Writing {len(files)} file(s):")
    apply_files(files)
    git_commit(f"ingest: {src.stem}")
    print("Done.")


# ── Lint ─────────────────────────────────────────────────────────────────────

LINT_SYSTEM = """\
You are a wiki maintainer. Audit all provided wiki pages for quality issues.

Check for:
1. Contradictions — claims across pages that conflict with each other
2. Orphan pages — pages with no inbound [[wikilinks]] from other pages
3. Missing concept pages — terms used frequently but lacking a wiki/concepts/ page
4. Stale claims — assertions superseded by newer ingested sources
5. Cross-reference gaps — entity/concept names mentioned but not linked
6. Data gaps — questions the wiki cannot yet answer; suggest sources to find

Output a numbered lint report with severity (low / medium / high) per issue.

Then output any corrected files as XML blocks:
<file path="wiki/...">...fixed content...</file>

Always include an updated wiki/log.md with the lint entry appended at the bottom:
<file path="wiki/log.md">...full log with new entry...</file>

Omit files that need no changes (except log.md — always include it).
"""


def cmd_lint() -> None:
    pages = []
    for path in sorted(WIKI.rglob("*.md")):
        rel = path.relative_to(ROOT)
        pages.append(f"=== {rel} ===\n{path.read_text()}")

    if not pages:
        print("Wiki is empty — nothing to lint.")
        return

    print(f"Sending {len(pages)} page(s) to Bedrock ...")
    user_msg = f"Today's date: {date.today().isoformat()}\n\n" + "\n\n".join(pages)
    response = invoke(LINT_SYSTEM, user_msg)

    report_end = response.find("<file ")
    report = response[:report_end].strip() if report_end != -1 else response.strip()
    print("\n" + report)

    files = parse_files(response)
    if files:
        answer = input(f"\nApply {len(files)} fix(es)? [y/N] ")
        if answer.lower() == "y":
            apply_files(files)
            git_commit("lint: apply fixes")
    else:
        print("\nNo file fixes suggested.")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="wiki-llm maintenance via Amazon Bedrock Nova Lite"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest", help="Process a raw source into the wiki")
    p_ingest.add_argument("file", help="Filename in raw/ or full path")

    sub.add_parser("lint", help="Audit the wiki for contradictions, orphans, and gaps")

    args = parser.parse_args()

    if args.command == "ingest":
        cmd_ingest(args.file)
    elif args.command == "lint":
        cmd_lint()


if __name__ == "__main__":
    main()
