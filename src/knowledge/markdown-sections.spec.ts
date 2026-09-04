import { parseMarkdownSections } from './markdown-sections';
import { DocumentParserService } from './document-parser.service';
import { ChunkingService } from './chunking.service';

describe('Markdown heading sections', () => {
  it('preserves ancestor context without mixing sibling policies', () => {
    const sections = parseMarkdownSections(
      '# Store\nintro\n## Hours\n10–22\n## Returns\n7 days\n### Exception\nOpened items excluded\n## Help\nContact support',
    );
    expect(sections).toHaveLength(5);
    expect(sections[3].title).toBe('Store / Returns / Exception');
    expect(sections[4].content).toBe('# Store\n\n## Help\n\nContact support');
    expect(sections[4].content).not.toContain('7 days');
  });
  it.each(['```', '~~~~'])(
    'does not split headings inside fenced code %s',
    (marker) => {
      const sections = parseMarkdownSections(
        `# Guide\n${marker}\n## Not a heading\n${marker}\n## Real\nBody`,
      );
      expect(sections).toHaveLength(2);
      expect(sections[0].content).toContain('## Not a heading');
      expect(sections[1].title).toBe('Guide / Real');
    },
  );
  it('handles BOM, CRLF, trailing hashes, preamble and sibling roots', () => {
    const sections = parseMarkdownSections(
      '\uFEFFintro\r\n# First ###\r\none\r\n# Second\r\ntwo',
    );
    expect(sections.map((section) => section.title)).toEqual([
      undefined,
      'First',
      'Second',
    ]);
    expect(sections[2].metadata).toMatchObject({ startLine: 4, endLine: 5 });
  });
  it('keeps heading-like prose, indented code and unterminated fences intact', () => {
    expect(
      parseMarkdownSections('#Title\n    # code\n```\n# literal'),
    ).toHaveLength(1);
  });
  it('retains plain text and heading-only input', () => {
    expect(parseMarkdownSections('plain')[0].content).toBe('plain');
    expect(parseMarkdownSections('# Only')[0].content.trim()).toBe('# Only');
    const sections = parseMarkdownSections(
      '# Shop\n## No refunds\n## Help\nContact support',
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].content).toContain('No refunds');
  });
  it('routes markdown sections into the existing bounded chunker without changing txt', async () => {
    const parser = new DocumentParserService();
    const body = Buffer.from(
      '# Shop\n## Help\nContact support\n## Hours\n10–22',
    );
    const md = await parser.parse({
      body,
      fileName: 'policy.md',
      contentType: 'text/markdown',
    });
    const txt = await parser.parse({
      body,
      fileName: 'policy.txt',
      contentType: 'text/plain',
    });
    expect(md.sections).toHaveLength(2);
    expect(txt.sections).toHaveLength(1);
    expect(
      new ChunkingService().createChunks(md.sections)[0].metadata,
    ).toMatchObject({
      parser: 'markdown-headings-v1',
      sectionTitle: 'Shop / Help',
    });
  });
});
