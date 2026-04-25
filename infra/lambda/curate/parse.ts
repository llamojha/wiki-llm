import type { FileBlock } from './types.js';

export function parseFileBlocks(response: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const re = /<file\s+path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(response)) !== null) {
    const path = match[1].trim();
    const content = match[2];
    if (path && content !== undefined) {
      blocks.push({ path, content });
    }
  }
  return blocks;
}
