# MVP Regression Smoke Checklist

Run against a real S3-backed dev vault after deploy.

1. Create a page from **New page**. Confirm the object lands under `users/<id>/authored/personal/`, `users/<id>/_system/index.md` includes it, and chat can cite it with scope **My**.
2. Try creating another page with the same slug. Confirm the UI shows the server conflict message and the original page is unchanged.
3. Star and unstar a document. Confirm the toolbar state persists after reload and **Starred** lists only starred documents.
4. Open **Recent**. Confirm it is populated from S3 metadata/frontmatter and opens real document URLs.
5. Search in **Shared** and **My wiki** sidebar scopes. Confirm results are restricted to the selected scope and include path/snippet/source metadata.
6. Click a home prompt that starts with "Create a wiki page". Confirm it opens Ask-Wiki and uses the real `/api/chat` proposal flow, not a local generated mock.
7. Upload a raw file, process pending, and finalize. Confirm generated pages land under `generated/<space>/` or `users/<id>/generated/<space>/` according to scope, then appear in search.
8. Run `pnpm ingest add <file> --space wiki --no-ingest`, then `pnpm ingest run --space wiki`. Confirm the CLI uses `raw/`, writes `generated/wiki/`, and updates `_system/indexes/wiki.md` plus `_system/index.md`.
