import type { SourceCard, SourceCardClaim } from './types.js';

const MAX_TITLE_LEN = 120;
const MAX_SUMMARY_LEN = 1200;
const MAX_CLAIMS = 20;
const MAX_LIST_ITEMS = 30;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown, limit = MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const str = asString(item);
    if (str) out.push(str);
    if (out.length >= limit) break;
  }
  return out;
}

function asClaims(value: unknown): SourceCardClaim[] {
  if (!Array.isArray(value)) return [];
  const out: SourceCardClaim[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) out.push({ text });
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const text = asString(rec.text);
      if (text) {
        const evidence = asString(rec.evidence);
        out.push(evidence ? { text, evidence } : { text });
      }
    }
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}

function extractJsonObject(response: string): string {
  const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced?.[1] ?? response;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Bedrock returned no JSON object');
  }
  return text.slice(start, end + 1);
}

export function parseSourceCard(response: string, rawKey: string): SourceCard {
  const parsed = JSON.parse(extractJsonObject(response)) as Record<string, unknown>;
  const title = asString(parsed.title).slice(0, MAX_TITLE_LEN);
  const summary = asString(parsed.summary).slice(0, MAX_SUMMARY_LEN);
  if (!title) throw new Error('Source card missing title');
  if (!summary) throw new Error('Source card missing summary');

  return {
    rawKey,
    title,
    summary,
    claims: asClaims(parsed.claims),
    entities: asStringArray(parsed.entities),
    concepts: asStringArray(parsed.concepts),
    suggestedSpaces: asStringArray(parsed.suggestedSpaces).map(slugifyLabel).filter(Boolean),
    suggestedPages: asStringArray(parsed.suggestedPages),
    tags: asStringArray(parsed.tags).map(slugifyLabel).filter(Boolean),
  };
}

export function slugifyLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function sourceSlug(card: SourceCard, rawKey: string, hash?: string): string {
  const titleSlug = slugifyLabel(card.title);
  const suffix = hash ? `-${hash.replace(/^sha256:/, '').slice(0, 8)}` : '';
  if (titleSlug) return `${titleSlug}${suffix}`;
  const fileName = rawKey.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'source';
  return `${slugifyLabel(fileName) || 'source'}${suffix}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(values: string[]): string {
  return `[${values.map(yamlString).join(', ')}]`;
}

export function renderSourcePage(card: SourceCard, rawKey: string, hash: string): string {
  const now = new Date().toISOString();
  const claims = card.claims.length
    ? card.claims.map((claim) => {
      const evidence = claim.evidence ? `\n  Evidence: ${claim.evidence}` : '';
      return `- ${claim.text}${evidence}`;
    }).join('\n')
    : '- No atomic claims extracted.';
  const entities = card.entities.length ? card.entities.map((e) => `- [[${e}]]`).join('\n') : '- None identified.';
  const concepts = card.concepts.length ? card.concepts.map((c) => `- [[${c}]]`).join('\n') : '- None identified.';

  return `---
title: ${yamlString(card.title)}
type: source
source_type: generated
sources: ${yamlArray([rawKey])}
raw_key: ${yamlString(rawKey)}
raw_hash: ${yamlString(hash)}
tags: ${yamlArray(card.tags)}
created: ${now}
updated: ${now}
---

# ${card.title}

## Summary

${card.summary}

## Claims

${claims}

## Entities

${entities}

## Concepts

${concepts}
`;
}

export function resolveOutputSpace(requestedSpace: string, card: SourceCard): string {
  if (requestedSpace !== '__all') return requestedSpace;
  return card.suggestedSpaces[0] || 'inbox';
}
