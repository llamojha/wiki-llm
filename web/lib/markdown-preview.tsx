import { Fragment, type ReactNode } from 'react';

// Tiny mock markdown renderer — handles h1/h2/h3, lists, code fences,
// paragraphs, **bold**, `inline code`. Intentionally minimal; replaced by
// `remark` + `rehype-sanitize` when Phase 2 wires real document rendering.

export function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

type RenderedMarkdownProps = { title: string; body: string };

export function RenderedMarkdown({ body }: RenderedMarkdownProps) {
  const lines = body.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      out.push(<pre key={key++}><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    if (line.startsWith('# ')) { out.push(<h1 key={key++}>{line.slice(2)}</h1>); i++; continue; }
    if (line.startsWith('## ')) { out.push(<h2 key={key++}>{line.slice(3)}</h2>); i++; continue; }
    if (line.startsWith('### ')) { out.push(<h3 key={key++}>{line.slice(4)}</h3>); i++; continue; }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2)); i++; }
      out.push(<ul key={key++}>{items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(<p key={key++}>{renderInline(line)}</p>);
    i++;
  }
  return <>{out}</>;
}
