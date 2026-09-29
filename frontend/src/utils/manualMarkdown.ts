// Minimal parser for the in-app User Guide (frontend/src/content/manual/*.md).
//
// Supports only the subset the manual uses: `<!-- id: x -->` section markers,
// `##` / `###` headings, paragraphs, `-` bullet lists, `1.` numbered lists and
// inline **bold**, *italic*, `code` and [links](url). The output is plain data;
// ManualView renders it as React elements, so no HTML string is ever injected.

export type ManualInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type ManualBlock =
  | { kind: 'h3'; content: ManualInline[] }
  | { kind: 'p'; content: ManualInline[] }
  | { kind: 'ul'; items: ManualInline[][] }
  | { kind: 'ol'; items: ManualInline[][] };

export interface ManualSection {
  id: string;
  title: string;
  blocks: ManualBlock[];
}

const ID_MARKER = /^<!--\s*id:\s*([a-z0-9-]+)\s*-->$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;
// Order matters: code first so ** or * inside backticks stays literal.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Only http(s) links and in-page anchors are rendered as links. */
export function isSafeManualHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith('#');
}

export function parseManualInline(text: string): ManualInline[] {
  const out: ManualInline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'strong', text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'em', text: m[3] });
    else if (m[4] !== undefined && m[5] !== undefined) {
      out.push(
        isSafeManualHref(m[5])
          ? { kind: 'link', text: m[4], href: m[5] }
          : { kind: 'text', text: m[4] }
      );
    }
    last = index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Split a manual into `##` sections. Text before the first `##` is ignored. */
export function parseManual(source: string): ManualSection[] {
  const sections: ManualSection[] = [];
  // Mutable accumulators live on one object so the flush() closure and the
  // loop see the same state.
  const acc: {
    pendingId: string | null;
    current: ManualSection | null;
    paragraph: string[];
    list: { kind: 'ul' | 'ol'; items: string[] } | null;
  } = { pendingId: null, current: null, paragraph: [], list: null };

  const flush = () => {
    if (acc.current && acc.paragraph.length > 0) {
      acc.current.blocks.push({ kind: 'p', content: parseManualInline(acc.paragraph.join(' ')) });
    }
    if (acc.current && acc.list) {
      acc.current.blocks.push({
        kind: acc.list.kind,
        items: acc.list.items.map(parseManualInline),
      });
    }
    acc.paragraph = [];
    acc.list = null;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idMatch = ID_MARKER.exec(line);
    if (idMatch) {
      flush();
      acc.pendingId = idMatch[1];
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      const title = line.slice(3).trim();
      acc.current = { id: acc.pendingId ?? slugify(title), title, blocks: [] };
      sections.push(acc.current);
      acc.pendingId = null;
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      acc.current?.blocks.push({ kind: 'h3', content: parseManualInline(line.slice(4).trim()) });
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const itemText = bullet?.[1] ?? numbered?.[1];
    if (itemText !== undefined) {
      const kind = bullet ? 'ul' : 'ol';
      if (acc.paragraph.length > 0 || (acc.list && acc.list.kind !== kind)) flush();
      if (!acc.list) acc.list = { kind, items: [] };
      acc.list.items.push(itemText);
      continue;
    }
    if (acc.list) {
      // A wrapped continuation line of the previous list item.
      acc.list.items[acc.list.items.length - 1] += ` ${line}`;
      continue;
    }
    acc.paragraph.push(line);
  }
  flush();
  return sections;
}
