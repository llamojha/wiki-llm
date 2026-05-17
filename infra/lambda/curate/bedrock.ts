import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type SystemContentBlock,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.BEDROCK_MODEL ?? 'eu.amazon.nova-2-lite-v1:0';
const region = process.env.BEDROCK_REGION ?? 'eu-central-1';

let _client: BedrockRuntimeClient | null = null;

function client(): BedrockRuntimeClient {
  if (!_client) _client = new BedrockRuntimeClient({ region });
  return _client;
}

export async function converse(system: string, userMessage: string): Promise<string> {
  const systemBlocks: SystemContentBlock[] = [{ text: system }];
  const messages: Message[] = [
    { role: 'user', content: [{ text: userMessage }] },
  ];

  const res = await client().send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: systemBlocks,
      messages,
      inferenceConfig: { maxTokens: 32768 },
    }),
  );

  const output = res.output;
  if (!output || !('message' in output) || !output.message?.content) {
    throw new Error('Bedrock returned empty response');
  }

  const textBlock = output.message.content.find(
    (block): block is ContentBlock.TextMember => 'text' in block,
  );

  if (!textBlock) {
    throw new Error('Bedrock response contained no text block');
  }

  return textBlock.text;
}
