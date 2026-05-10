import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type Message,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.INGEST_MODEL ?? 'amazon.nova-2-lite-v1:0';
const region = process.env.VAULT_REGION ?? 'us-east-1';

let _client: BedrockRuntimeClient | null = null;

function client(): BedrockRuntimeClient {
  if (!_client) _client = new BedrockRuntimeClient({ region });
  return _client;
}

export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Call Bedrock converse API with tool_use to get structured JSON output.
 * Returns the parsed JSON from the tool call.
 */
export async function converseWithTool<T>(
  system: string,
  userMessage: string,
  tool: ToolSchema,
): Promise<T> {
  const systemBlocks: SystemContentBlock[] = [{ text: system }];
  const messages: Message[] = [
    { role: 'user', content: [{ text: userMessage }] },
  ];

  const toolConfig = {
    tools: [
      {
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: { json: tool.inputSchema },
        },
      },
    ],
  } as ConverseCommandInput['toolConfig'];

  try {
    const res = await client().send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: systemBlocks,
        messages,
        toolConfig,
        inferenceConfig: { maxTokens: 16384 },
      }),
    );

    // Extract tool_use block from response
    const output = res.output;
    if (!output || !('message' in output) || !output.message?.content) {
      throw new Error('Bedrock returned empty response');
    }

    const toolUse = output.message.content.find(
      (block): block is ContentBlock.ToolUseMember => 'toolUse' in block,
    );

    if (!toolUse) {
      // Model responded with text instead of tool call — extract any JSON
      const textBlock = output.message.content.find(
        (block): block is ContentBlock.TextMember => 'text' in block,
      );
      if (textBlock) {
        throw new Error(`Model did not use tool. Response: ${textBlock.text.slice(0, 200)}`);
      }
      throw new Error('Model did not use tool and returned no text');
    }

    return toolUse.toolUse.input as T;
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };

    if (e.name === 'AccessDeniedException') {
      console.error(
        `Bedrock denied access to ${MODEL_ID} in ${region}.\n` +
        '  Fix: AWS console → Bedrock → Model access → request access.\n' +
        '  Ensure IAM principal has bedrock:InvokeModel permission.',
      );
      process.exit(1);
    }
    if (e.name === 'ValidationException') {
      console.error(
        `Bedrock validation error for model=${MODEL_ID} region=${region}.\n` +
        `  ${e.message}\n` +
        '  Common causes: model ID typo, model not in this region.\n' +
        '  Override with INGEST_MODEL env var.',
      );
      process.exit(1);
    }
    if (e.name === 'ThrottlingException') {
      console.error(`Bedrock throttled. Retry in a moment.\n  ${e.message}`);
      process.exit(1);
    }
    if (e.name === 'ResourceNotFoundException') {
      console.error(
        `Model ${MODEL_ID} not found in ${region}.\n` +
        '  Try: aws bedrock list-foundation-models --region ' + region,
      );
      process.exit(1);
    }

    throw err;
  }
}
