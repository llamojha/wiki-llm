import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetWith } from '@/lib/s3-mock';
import { getObject, listObjects } from '@/lib/s3';
import { __resetVaultMode } from '@/lib/vault-mode';
import { ManagedPageError } from '@/lib/managed-pages';
import { reparentManagedPage } from '@/lib/managed-reparent';

/**
 * Re-parent is a metadata-only edit (plan 027): it rewrites the target page's
 * frontmatter `parent_id` in place and never moves the S3 object. These pin the
 * "no object move" guarantee and the validation guards (dangling parent,
 * cross-space, cycle).
 */
describe('reparentManagedPage', () => {
  beforeEach(() => {
    __resetVaultMode();
    process.env.VAULT_MODE = 'managed';
    __resetWith({
      'pages/wiki/platform.md': '---\nid: pg_plat\ntitle: Platform\nspace: wiki\n---\nbody',
      'pages/wiki/aws.md': '---\nid: pg_aws\ntitle: AWS\nspace: wiki\n---\nbody',
      'pages/wiki/lambda.md':
        '---\nid: pg_lambda\ntitle: Lambda\nspace: wiki\nparent_id: pg_plat\n---\nlambda body',
      'pages/articles/p.md': '---\nid: pg_p\ntitle: P\nspace: articles\n---\nbody',
    });
  });

  afterEach(() => {
    delete process.env.VAULT_MODE;
    __resetVaultMode();
  });

  it('rewrites parent_id in place — the S3 key does NOT change', async () => {
    const before = (await listObjects()).slice().sort();
    const result = await reparentManagedPage('pages/wiki/lambda.md', 'pg_aws');

    expect(result).toEqual({ key: 'pages/wiki/lambda.md', parentId: 'pg_aws' });
    // No object move: the exact same set of keys exists afterwards.
    expect((await listObjects()).slice().sort()).toEqual(before);

    // Frontmatter parent_id updated; body + id preserved.
    const { data, content } = matter(await getObject('pages/wiki/lambda.md'));
    expect(data.parent_id).toBe('pg_aws');
    expect(data.id).toBe('pg_lambda');
    expect(content.trim()).toBe('lambda body');
  });

  it('re-parents to root by clearing parent_id (parentId null)', async () => {
    await reparentManagedPage('pages/wiki/lambda.md', null);
    const { data } = matter(await getObject('pages/wiki/lambda.md'));
    expect(data.parent_id).toBeUndefined();
  });

  it('rejects a dangling parent id (404)', async () => {
    await expect(reparentManagedPage('pages/wiki/lambda.md', 'pg_missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects a cross-space parent (400)', async () => {
    await expect(reparentManagedPage('pages/wiki/lambda.md', 'pg_p')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a cycle (409): cannot parent a page under its own descendant', async () => {
    // lambda's parent is platform; making platform a child of lambda is a cycle.
    await expect(reparentManagedPage('pages/wiki/platform.md', 'pg_lambda')).rejects.toMatchObject(
      { status: 409 },
    );
  });

  it('rejects a non-managed key (400)', async () => {
    await expect(reparentManagedPage('_system/x.md', 'pg_aws')).rejects.toBeInstanceOf(
      ManagedPageError,
    );
  });
});
