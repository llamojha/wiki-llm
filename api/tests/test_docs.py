import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_get_doc_with_frontmatter(s3_bucket):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/docs/wiki/getting-started.md")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "wiki/getting-started.md"
    assert data["title"] == "Getting Started"
    assert data["path"] == "wiki / getting-started"
    assert data["source_type"] == "authored"
    assert "# Getting Started" in data["raw_markdown"]
    assert data["checksum"].startswith("sha256:")


@pytest.mark.asyncio
async def test_get_doc_without_frontmatter(s3_bucket):
    """Title falls back to filename stem when frontmatter is absent."""
    import boto3
    client = boto3.client("s3", region_name="us-east-1")
    client.put_object(
        Bucket="test-bucket",
        Key="vault/wiki/no-frontmatter.md",
        Body=b"# Just a heading\n\nNo frontmatter here.",
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        resp = await http.get("/docs/wiki/no-frontmatter.md")
    assert resp.status_code == 200
    assert resp.json()["title"] == "No Frontmatter"


@pytest.mark.asyncio
async def test_get_doc_not_found(s3_bucket):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/docs/wiki/does-not-exist.md")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_doc_generated_source_type(s3_bucket):
    import boto3
    client = boto3.client("s3", region_name="us-east-1")
    client.put_object(
        Bucket="test-bucket",
        Key="vault/generated/ai-page.md",
        Body=b"---\ntitle: AI Page\n---\n# AI Page",
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        resp = await http.get("/docs/generated/ai-page.md")
    assert resp.status_code == 200
    assert resp.json()["source_type"] == "generated"
