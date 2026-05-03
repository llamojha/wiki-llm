"""Build the vault navigation tree from index.md (or S3 folder hierarchy as fallback)."""
from __future__ import annotations

import re

import frontmatter

from app import s3
from app.models import DocLeaf, FolderNode, TreeNode

_SKIP = {"index.md", "log.md"}


def _stem_to_title(stem: str) -> str:
    """kebab-case-or_snake → Title Case."""
    return re.sub(r"[-_]+", " ", stem).title()


def _key_to_name(key: str) -> str:
    stem = key.rsplit("/", 1)[-1].removesuffix(".md")
    return _stem_to_title(stem)


def _insert(root: list[TreeNode], parts: list[str], key: str, name: str) -> None:
    """Recursively insert a doc leaf into the folder tree."""
    if len(parts) == 1:
        root.append(DocLeaf(id=key, name=name))
        return
    # Derive folder_id from the key prefix at the current depth.
    depth = len(key.split("/")) - len(parts)
    folder_id = "folder:" + "/".join(key.split("/")[: depth + 1])
    folder_name = parts[0]
    for node in root:
        if isinstance(node, FolderNode) and node.id == folder_id:
            _insert(node.children, parts[1:], key, name)
            return
    folder = FolderNode(id=folder_id, name=_stem_to_title(folder_name))
    _insert(folder.children, parts[1:], key, name)
    root.append(folder)


def _build_tree(keys: list[str], names: dict[str, str]) -> list[TreeNode]:
    root: list[TreeNode] = []
    for key in keys:
        parts = key.split("/")
        name = names.get(key, _key_to_name(key))
        _insert(root, parts, key, name)
    return root


def get_tree() -> list[TreeNode]:
    """
    Build the navigation tree.

    1. Try to read index.md and parse the nav list.
    2. Fall back to listing all .md keys under the vault prefix.
    Unlisted keys (present in S3 but not in index.md) are appended under an "Unlisted" folder.
    """
    listed_keys: list[str] = []
    names: dict[str, str] = {}
    index_available = False

    try:
        raw = s3.get_object("index.md")
        post = frontmatter.loads(raw)
        for line in post.content.splitlines():
            m = re.match(r"^\s*[-*]\s+(.+\.md)\s*$", line)
            if m:
                key = m.group(1).strip()
                if key not in _SKIP:
                    listed_keys.append(key)
        index_available = True
    except KeyError:
        pass

    if not index_available:
        all_keys = [k for k in s3.list_objects() if k not in _SKIP]
        return _build_tree(all_keys, names)

    # Only fetch the full listing when we need to find unlisted keys.
    all_keys = [k for k in s3.list_objects() if k not in _SKIP]
    listed_set = set(listed_keys)
    unlisted = [k for k in all_keys if k not in listed_set]

    tree = _build_tree(listed_keys, names)

    if unlisted:
        unlisted_folder = FolderNode(id="folder:__unlisted", name="Unlisted")
        unlisted_folder.children = _build_tree(unlisted, names)
        tree.append(unlisted_folder)

    return tree
