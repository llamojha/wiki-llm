import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type Message,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.INGEST_MODEL ?? 'eu.amazon.nova-2-lite-v1:0';
const region = process.env.BEDROCK_REGION ?? 'eu-central-1';

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

  const res = await client().send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: systemBlocks,
      messages,
      toolConfig,
      inferenceConfig: { maxTokens: 16384 },
    }),
  );

  const output = res.output;
  if (!output || !('message' in output) || !output.message?.content) {
    throw new Error('Bedrock returned empty response');
  }

  const toolUse = output.message.content.find(
    (block): block is ContentBlock.ToolUseMember => 'toolUse' in block,
  );

  if (!toolUse) {
    const textBlock = output.message.content.find(
      (block): block is ContentBlock.TextMember => 'text' in block,
    );
    throw new Error(
      `Model did not use tool. Response: ${textBlock?.text?.slice(0, 200) ?? 'empty'}`,
    );
  }

  return toolUse.toolUse.input as T;
}
