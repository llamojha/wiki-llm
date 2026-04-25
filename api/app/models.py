from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field


class VaultSummary(BaseModel):
    id: str
    name: str
    bucket: str
    prefix: str
    region: str


# --- Tree nodes ---

class DocLeaf(BaseModel):
    type: Literal["doc"] = "doc"
    id: str  # S3 key relative to prefix, e.g. "wiki/getting-started.md"
    name: str  # display name derived from frontmatter title or filename stem


class FolderNode(BaseModel):
    type: Literal["folder"] = "folder"
    id: str  # "folder:<path>", e.g. "folder:wiki/ops"
    name: str
    children: list[TreeNode] = Field(default_factory=list)


TreeNode = Annotated[DocLeaf | FolderNode, Field(discriminator="type")]

FolderNode.model_rebuild()


# --- Document response ---

class DocResponse(BaseModel):
    id: str           # S3 key relative to prefix
    title: str
    path: str         # human-readable breadcrumb, e.g. "wiki / ops / runbook"
    s3_key: str       # full S3 key including prefix
    source_type: str  # "authored" | "generated" | "uploaded"
    updated: str
    author: str
    tags: list[str]
    checksum: str
    raw_markdown: str


class SearchResult(BaseModel):
    id: str
    title: str
    path: str
    snippet: str
    rank: float
