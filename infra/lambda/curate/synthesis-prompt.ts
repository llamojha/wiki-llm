import type { SourceCard } from './types.js';
import type { Cluster, ClusterMember } from './cluster.js';

/**
 * Prompt assembly + page rendering for the synthesis pass.
 * See specs/synthesis-pipeline.md — implements task #3.
 *
 * Bedrock returns the body Markdown only; this module wraps it with
 * deterministic frontmatter so the file shape matches the contract in the
 * spec (and the existing `renderSourcePage` style).
 */

const SYSTHESIS_SYSTEM_PROMPT = `You synthesize a single wiki rollup page from multiple source documents.

You receive the page title, its category (concept|feature|project), and a numbered list of source cards. Each card has a summary and atomic claims with evidence.

Return Markdown only — no frontmatter, no code fence, no preamble. The first line of your output must be a top-level "# {title}" heading.

Rules:
- Start with a brief "## Overview" section (2-4 sentences) introducing the topic.
- Organize the source claims into themed "##" sections, NOT a flat dump.
- Cite every factual claim with bracketed markers like [1], [2] matching the source numbers below.
- When two sources directly contradict, surface the contradiction in a "## Contradictions" subsection rather than silently picking one.
- Use [[double-bracket wikilinks]] for entities and concepts that may have their own pages elsewhere.
- Keep the page focused — synthesize, do not exhaustively repeat. 500-1500 words is the target band.
- Do not invent facts. Every claim must trace to one of the numbered sources.`;

export function buildSynthesisSystemPrompt(): string {
  return SYSTHESIS_SYSTEM_PROMPT;
}

/**
 * Per-cluster user prompt. Receives the cluster and the SourceCards keyed by
 * cardHash so the numbered list aligns with `cluster.members[].citationIndex`.
 */
export function buildSynthesisUserPrompt(
  cluster: Cluster,
  cardsByHash: Map<string, SourceCard>,
): string {
  const numbered = cluster.members
    .map((member) => renderNumberedSource(member, cardsByHash.get(member.cardHash)))
    .join('\n\n');

  return `Title: ${cluster.title}
Category: ${cluster.category.replace(/s$/, '')}

Sources (cite as [1], [2], ...):

${numbered}

Write the synthesized "${cluster.title}" page.`;
}

function renderNumberedSource(member: ClusterMember, card: SourceCard | undefined): string {
  if (!card) {
    return `[${member.citationIndex}] (missing source-card for ${member.cardHash})`;
  }
  const claims = card.claims.length
    ? card.claims
        .map((c) => {
          const ev = c.evidence ? ` (evidence: ${c.evidence})` : '';
          return `  - ${c.text}${ev}`;
        })
        .join('\n')
    : '  - (no atomic claims extracted)';

  return `[${member.citationIndex}] ${card.title}
  Source page: ${member.sourcePage}
  Summary: ${card.summary}
  Claims:
${claims}`;
}

// ─── Page rendering ───────────────────────────────────────────────────────

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(values: string[]): string {
  return `[${values.map(yamlString).join(', ')}]`;
}

/**
 * Singularize the category for the `type:` frontmatter field
 * (concepts → concept, features → feature, projects → project).
 */
function typeForCategory(category: Cluster['category']): string {
  return category.replace(/s$/, '');
}

/**
 * Wrap the Bedrock body with deterministic frontmatter. The body is trusted
 * to start with `# {title}` per the system prompt; if it doesn't, prepend
 * one defensively so the rendered page always has an H1.
 */
export function renderRollupPage(
  cluster: Cluster,
  bedrockBody: string,
): string {
  const now = new Date().toISOString();
  const body = bedrockBody.trim().startsWith('#')
    ? bedrockBody.trim()
    : `# ${cluster.title}\n\n${bedrockBody.trim()}`;

  const sources = cluster.members.map((m) => m.sourcePage);
  const contributingCards = cluster.members.map((m) => m.cardHash);

  return `---
title: ${yamlString(cluster.title)}
type: ${typeForCategory(cluster.category)}
source_type: generated
sources: ${yamlArray(sources)}
contributing_cards: ${yamlArray(contributingCards)}
cluster_hash: ${yamlString(cluster.clusterHash)}
tags: ${yamlArray(cluster.tags)}
created: ${now}
updated: ${now}
---

${body}
`;
}

/**
 * S3 key for a cluster's rollup page within a scope+space.
 * Pure — takes the generated prefix as input rather than a scope object so
 * it stays testable.
 */
export function rollupPageKey(
  generatedPrefix: string,
  cluster: Cluster,
): string {
  return `${generatedPrefix}${cluster.category}/${cluster.slug}.md`;
}
