#!/usr/bin/env python3
"""wiki.py — Bedrock-powered ingest and lint for wiki-llm."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Protocol

import boto3

MODEL_ID = os.environ.get("WIKI_MODEL", "amazon.nova-lite-v2:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

ROOT = Path(__file__).parent
WIKI = ROOT / "wiki"
RAW = ROOT / "raw"

MOCK = os.environ.get("WIKI_MOCK") == "1"


# ── Vault clients ────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    stem = Path(name).stem.lower()
    return re.sub(r"[^a-z0-9]+", "-", stem).strip("-") or "note"


class VaultClient(Protocol):
    name: str

    def read(self, name: str) -> str: ...
    def search(self, query: str) -> list[str]: ...
    def available(self) -> bool: ...


class ObsidianClient:
    name = "obsidian"

    def __init__(self) -> None:
        vault_env = os.environ.get("OBSIDIAN_VAULT", "")
        self.vault = Path(vault_env).expanduser() if vault_env else None

    def available(self) -> bool:
        return self.vault is not None and self.vault.is_dir()

    def _inside_vault(self, candidate: Path) -> bool:
        assert self.vault is not None
        try:
            candidate.resolve().relative_to(self.vault.resolve())
            return True
        except ValueError:
            return False

    def _resolve(self, name: str) -> Path:
        if self.vault is None:
            raise RuntimeError("OBSIDIAN_VAULT not set")
        direct = self.vault / name
        if direct.is_file() and self._inside_vault(direct):
            return direct
        if direct.suffix == "":
            direct_md = direct.with_suffix(".md")
            if direct_md.is_file() and self._inside_vault(direct_md):
                return direct_md
        target_name = name if name.endswith(".md") else f"{name}.md"
        target_stem = Path(name).stem
        for path in self.vault.rglob("*.md"):
            if any(part.startswith(".") for part in path.relative_to(self.vault).parts):
                continue
            if not self._inside_vault(path):
                continue
            if path.name == target_name or path.stem == target_stem:
                return path
        raise FileNotFoundError(f"note not found in vault: {name}")

    def read(self, name: str) -> str:
        return self._resolve(name).read_text(encoding="utf-8")

    def search(self, query: str) -> list[str]:
        if self.vault is None or not self.vault.is_dir():
            return []
        q = query.lower()
        hits: list[str] = []
        for path in sorted(self.vault.rglob("*.md")):
            rel = path.relative_to(self.vault)
            if any(part.startswith(".") for part in rel.parts):
                continue
            if not self._inside_vault(path):
                continue
            head = path.read_text(encoding="utf-8", errors="ignore")[:200].lower()
            if q in rel.name.lower() or q in head:
                hits.append(str(rel))
        return hits


class FileClient:
    name = "file"

    def available(self) -> bool:
        return True

    def _resolve(self, name: str) -> Path:
        candidate = Path(name)
        if not candidate.is_absolute() and not candidate.exists():
            candidate = RAW / name
        if candidate.suffix == "" and not candidate.exists():
            candidate = candidate.with_suffix(".md")
        if not candidate.exists():
            raise FileNotFoundError(f"note not found: {name}")
        return candidate

    def read(self, name: str) -> str:
        return self._resolve(name).read_text(encoding="utf-8")

    def search(self, query: str) -> list[str]:
        if not RAW.exists():
            return []
        q = query.lower()
        hits: list[str] = []
        for path in sorted(RAW.glob("*.md")):
            head = path.read_text(encoding="utf-8", errors="ignore")[:200].lower()
            if q in path.name.lower() or q in head:
                hits.append(path.name)
        return hits


def select_client(choice: str) -> VaultClient:
    if choice == "obsidian":
        client = ObsidianClient()
        if not client.available():
            sys.exit("--client obsidian requested but OBSIDIAN_VAULT is unset or not a directory")
        return client
    if choice == "file":
        return FileClient()
    obs = ObsidianClient()
    return obs if obs.available() else FileClient()


# ── Bedrock ──────────────────────────────────────────────────────────────────

def invoke(system: str, user: str) -> str:
    if MOCK:
        return _mock_invoke(system, user)
    client = boto3.client("bedrock-runtime", region_name=AWS_REGION)
    resp = client.converse(
        modelId=MODEL_ID,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": 16384},
    )
    return resp["output"]["message"]["content"][0]["text"]


def _mock_invoke(system: str, user: str) -> str:
    today = date.today().isoformat()
    if "Audit all provided wiki pages" in system:
        log_match = re.search(r"=== wiki/log\.md ===\n(.*?)(?=\n===|\Z)", user, re.DOTALL)
        log_body = log_match.group(1).rstrip() if log_match else "# Log\n"
        new_log = (
            f"{log_body}\n\n## [{today}] lint | MOCK\n"
            "Mock lint pass — no real audit performed.\n"
        )
        return (
            "1. (mock) low — no real audit performed; install AWS creds for real lint.\n\n"
            f'<file path="wiki/log.md">\n{new_log}</file>'
        )

    src_match = re.search(r"Source file: raw/([^\n]+)", user)
    src_name = src_match.group(1).strip() if src_match else "unknown.md"
    slug = _slugify(src_name)

    index_match = re.search(r"Current wiki/index\.md:\n(.*?)\n\nCurrent wiki/log\.md:", user, re.DOTALL)
    index_body = (index_match.group(1).strip() if index_match else "").strip()
    if not index_body or "(empty)" in index_body:
        index_body = (
            "---\ntitle: \"Wiki Index\"\ntype: index\n"
            f"updated: {today}\n---\n\n# Wiki Index\n\n## Sources\n"
            "| Page | Summary | Date | Raw File |\n|------|---------|------|----------|\n"
        )
    if f"sources/{slug}" not in index_body:
        new_row = f"| [[sources/{slug}]] | MOCK summary | {today} | {src_name} |"
        sources_idx = index_body.find("## Sources")
        next_section = (
            index_body.find("\n## ", sources_idx + len("## Sources"))
            if sources_idx != -1
            else -1
        )
        if next_section != -1:
            prefix = index_body[:next_section].rstrip()
            suffix = index_body[next_section:]
            index_body = f"{prefix}\n{new_row}\n{suffix}"
        else:
            index_body = index_body.rstrip() + f"\n{new_row}\n"

    log_match = re.search(r"Current wiki/log\.md:\n(.*?)\n\nCurrent wiki/overview\.md:", user, re.DOTALL)
    log_body = (log_match.group(1).strip() if log_match else "# Log\n").strip()
    if "(empty)" in log_body:
        log_body = "# Log\n"
    new_log = f"{log_body}\n\n## [{today}] ingest | MOCK {src_name}\nMock ingest — no Bedrock call.\n"

    overview = (
        f"---\ntitle: \"Overview\"\ntype: overview\nupdated: {today}\n---\n\n"
        "# Overview (MOCK)\n\nMock overview — regenerated on each mock ingest.\n"
    )
    source_page = (
        f"---\ntitle: \"MOCK {src_name}\"\ntype: source\ntags: [mock]\n"
        f"sources: [{src_name}]\ncreated: {today}\nupdated: {today}\n---\n\n"
        f"# MOCK {src_name}\n\nStub summary written by mock mode.\n"
    )
    entity_page = (
        f"---\ntitle: \"MOCK Entity\"\ntype: entity\ntags: [mock]\n"
        f"sources: [{src_name}]\ncreated: {today}\nupdated: {today}\n---\n\n"
        f"# MOCK Entity\n\nPlaceholder entity from [[sources/{slug}]].\n"
    )
    return (
        f'<file path="wiki/sources/{slug}.md">\n{source_page}</file>\n'
        f'<file path="wiki/index.md">\n{index_body.rstrip()}\n</file>\n'
        f'<file path="wiki/overview.md">\n{overview}</file>\n'
        f'<file path="wiki/log.md">\n{new_log}</file>\n'
        f'<file path="wiki/entities/mock-entity.md">\n{entity_page}</file>\n'
    )


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


def _interactive_pick(matches: list[str]) -> str:
    if not matches:
        sys.exit("no matches")
    for i, name in enumerate(matches, 1):
        print(f"  {i}. {name}")
    raw_choice = input(f"Pick #: [1-{len(matches)}] ").strip()
    try:
        idx = int(raw_choice)
    except ValueError:
        sys.exit(f"invalid selection: {raw_choice}")
    if not 1 <= idx <= len(matches):
        sys.exit(f"out of range: {idx}")
    return matches[idx - 1]


def _stage_to_raw(name: str, content: str) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    cache = RAW / Path(name).name
    if cache.suffix == "":
        cache = cache.with_suffix(".md")
    if cache.exists() and cache.read_text() != content:
        answer = input(f"  {cache.name} already in raw/ with different content. Overwrite? [y/N] ")
        if answer.lower() != "y":
            sys.exit("aborted")
    cache.write_text(content)
    print(f"  cached vault note → raw/{cache.name}")
    return cache


def cmd_ingest(source_file: str | None, client: VaultClient, search: str | None) -> None:
    if search:
        print(f"Searching {client.name} for '{search}' ...")
        matches = client.search(search)
        source_file = _interactive_pick(matches)

    if not source_file:
        sys.exit("no source provided (pass a file or --search QUERY)")

    print(f"Source: {source_file} (client={client.name})")
    if MOCK:
        print("  [mock mode — Bedrock calls stubbed]")

    source_content = client.read(source_file)

    if isinstance(client, ObsidianClient):
        src = _stage_to_raw(source_file, source_content)
    else:
        src = Path(source_file)
        if not src.is_absolute() and not src.exists():
            src = RAW / source_file
        if src.suffix == "" and not src.exists():
            src = src.with_suffix(".md")

    print(f"Ingesting {src.name} ...")
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
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Stub the Bedrock call (also enabled by WIKI_MOCK=1)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest", help="Process a source into the wiki")
    p_ingest.add_argument("file", nargs="?", help="Filename in raw/, vault note, or full path")
    p_ingest.add_argument(
        "--client",
        choices=["auto", "obsidian", "file"],
        default="auto",
        help="Which vault client to use (default: auto-detect)",
    )
    p_ingest.add_argument(
        "--search",
        metavar="QUERY",
        help="Search the vault interactively and pick a note to ingest",
    )

    sub.add_parser("lint", help="Audit the wiki for contradictions, orphans, and gaps")

    args = parser.parse_args()

    global MOCK
    if args.mock:
        MOCK = True

    if args.command == "ingest":
        if args.file and args.search:
            sys.exit("pass either a file or --search, not both")
        client = select_client(args.client)
        cmd_ingest(args.file, client, args.search)
    elif args.command == "lint":
        cmd_lint()


if __name__ == "__main__":
    main()
