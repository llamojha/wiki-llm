import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_list_vaults(s3_bucket):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/vaults")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == "default"
    assert data[0]["bucket"] == "test-bucket"


@pytest.mark.asyncio
async def test_get_tree_from_index_md(s3_bucket):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/vaults/default/tree")
    assert resp.status_code == 200
    tree = resp.json()

    # top-level should be folders: wiki
    ids = {n["id"] for n in tree}
    assert "folder:wiki" in ids

    wiki = next(n for n in tree if n["id"] == "folder:wiki")
    child_ids = {c["id"] for c in wiki["children"]}
    assert "wiki/getting-started.md" in child_ids
    assert "wiki/architecture.md" in child_ids

    # ops sub-folder
    ops = next(c for c in wiki["children"] if c.get("type") == "folder")
    assert ops["id"] == "folder:wiki/ops"
    ops_child_ids = {c["id"] for c in ops["children"]}
    assert "wiki/ops/runbook.md" in ops_child_ids
    assert "wiki/ops/alerts.md" in ops_child_ids


@pytest.mark.asyncio
async def test_get_tree_unknown_vault(s3_bucket):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/vaults/nonexistent/tree")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_tree_fallback_no_index(s3_bucket):
    """When index.md is absent the tree falls back to S3 folder hierarchy."""
    # delete index.md from the mock bucket
    import boto3
    client = boto3.client("s3", region_name="us-east-1")
    client.delete_object(Bucket="test-bucket", Key="vault/index.md")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client_http:
        resp = await client_http.get("/vaults/default/tree")
    assert resp.status_code == 200
    tree = resp.json()
    # all docs should still appear somewhere in the tree
    all_ids = _flatten_ids(tree)
    assert "wiki/getting-started.md" in all_ids


@pytest.mark.asyncio
async def test_get_tree_deep_nesting(s3_bucket):
    """folder_id must be correct at every depth level (regression for the slice bug)."""
    import boto3
    client = boto3.client("s3", region_name="us-east-1")
    # Add a 3-level deep doc not in index.md so it lands in Unlisted
    client.put_object(
        Bucket="test-bucket",
        Key="vault/a/b/c/deep.md",
        Body=b"---\ntitle: Deep\n---\n# Deep",
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        resp = await http.get("/vaults/default/tree")
    assert resp.status_code == 200
    all_ids = _flatten_ids(resp.json())

    # Correct folder ids at each depth
    assert "folder:a" in all_ids
    assert "folder:a/b" in all_ids
    assert "folder:a/b/c" in all_ids
    assert "a/b/c/deep.md" in all_ids
    # The doc key must NOT appear as a folder id
    assert "folder:a/b/c/deep.md" not in all_ids


def _flatten_ids(nodes: list) -> set:
    ids = set()
    for n in nodes:
        ids.add(n["id"])
        if n.get("children"):
            ids |= _flatten_ids(n["children"])
    return ids
