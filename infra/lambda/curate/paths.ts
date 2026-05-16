export const DEFAULT_USER_ID = process.env.VAULT_USER_ID ?? 'amllamojha';
export const USER_ROOT = `users/${DEFAULT_USER_ID}`;
export const RAW_PREFIX = 'raw/';
export const GENERATED_ROOT = 'generated';
export const SYSTEM_ROOT = '_system';

export function generatedPrefix(space: string): string {
  return `${GENERATED_ROOT}/${space}/`;
}

export function systemKey(name: string): string {
  return `${SYSTEM_ROOT}/${name}`.replace(/\/+/g, '/');
}
