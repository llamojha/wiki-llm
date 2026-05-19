/**
 * Suggested first-turn prompts for the chat panel's empty state.
 *
 * Previously this module also held `CANNED_REPLIES` and `DEFAULT_REPLY` —
 * the mock canned-reply dataset used before Phase 5 wired in the real
 * Bedrock agent. Those were removed when the agent shipped.
 */
export const SUGGESTIONS = [
  "What's the on-call paging procedure?",
  'How does the indexer handle S3 events?',
  'Where do I file a postmortem?',
  'Summarize the billing service',
];
