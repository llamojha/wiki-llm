import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * Web-side Bedrock client + streaming Converse wrapper.
 *
 * Mirror of `infra/lambda/curate/bedrock.ts` but for the Next.js Route
 * Handler runtime and using `ConverseStreamCommand` instead of the
 * non-streaming `ConverseCommand`. Used by the Phase 5 Ask-Wiki agent.
 *
 * Reads `BEDROCK_MODEL` and `BEDROCK_REGION` env vars with the same defaults
 * as the Lambda so deployments share one knob per dimension.
 */

export const MODEL_ID = process.env.BEDROCK_MODEL ?? 'eu.amazon.nova-2-lite-v1:0';
const region = process.env.BEDROCK_REGION ?? 'eu-central-1';

let _client: BedrockRuntimeClient | null = null;

function client(): BedrockRuntimeClient {
  if (!_client) _client = new BedrockRuntimeClient({ region });
  return _client;
}

/**
 * Issue a streaming Converse request and return the async iterable of model
 * events.
 *
 * `modelId` defaults to `MODEL_ID` so callers can usually omit it. Throws if
 * the API call fails before streaming starts — the SDK gives back an output
 * with `stream === undefined` in that case, which would propagate as a
 * confusing "iterable is undefined" error downstream.
 *
 * Pass `abortSignal` to cancel the request server-side when the client
 * disconnects mid-stream — otherwise the Bedrock call keeps running until
 * Bedrock itself finishes, wasting tokens.
 */
export async function converseStream(
  opts: Omit<ConverseStreamCommandInput, 'modelId'> & { modelId?: string },
  abortSignal?: AbortSignal,
): Promise<AsyncIterable<ConverseStreamOutput>> {
  const res = await client().send(
    new ConverseStreamCommand({
      modelId: opts.modelId ?? MODEL_ID,
      ...opts,
    }),
    { abortSignal },
  );
  if (!res.stream) {
    throw new Error('Bedrock ConverseStream returned no stream — request likely failed before streaming began');
  }
  return res.stream;
}
