import type { ParsedDocumentSection } from './document-parser.service';

// ATX headings outside fenced code delimit sections; ancestors retain document context.
export function parseMarkdownSections(text: string): ParsedDocumentSection[] {
  const sections: ParsedDocumentSection[] = [];
  let headings: { level: number; text: string }[] = [];
  let body: string[] = [];
  let startLine = 1;
  let fence: { marker: string; length: number } | undefined;
  const flush = (endLine: number, preserveHeading = false) => {
    if (!body.join('\n').trim() && !(preserveHeading && headings.length))
      return;
    sections.push({
      title: headings.map((heading) => heading.text).join(' / ') || undefined,
      content: [
        ...headings.map(
          (heading) => `${'#'.repeat(heading.level)} ${heading.text}`,
        ),
        body.join('\n').trim(),
      ].join('\n\n'),
      metadata: {
        sourceType: 'md',
        parser: 'markdown-headings-v1',
        headingPath: headings.map((heading) => heading.text),
        startLine,
        endLine,
      },
    });
  };
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  lines.forEach((line, index) => {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      body.push(line);
      if (
        delimiter &&
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = undefined;
      return;
    }
    if (delimiter && (delimiter[1][0] !== '`' || !delimiter[2].includes('`'))) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      body.push(line);
      return;
    }
    const heading = /^ {0,3}(#{1,6})(?:[\t ]+(.*?)|[\t ]*)$/.exec(line);
    if (!heading) {
      body.push(line);
      return;
    }
    const level = heading[1].length;
    flush(index, level <= (headings.at(-1)?.level ?? 0));
    body = [];
    headings = headings.filter((parent) => parent.level < level);
    headings.push({
      level,
      text: (heading[2] ?? '').replace(/[\t ]+#+[\t ]*$/, '').trim(),
    });
    startLine = index + 1;
  });
  flush(lines.length, true);
  // Keep heading-only documents indexable without inventing a body.
  return sections.length
    ? sections
    : [
        {
          content: text.trim(),
          metadata: { sourceType: 'md', parser: 'markdown-headings-v1' },
        },
      ];
}
