import crypto from 'node:crypto';

const DEFAULT_CHUNK_TARGET_CHARS = 1800;
const DEFAULT_CHUNK_OVERLAP_CHARS = 180;

export function normalizeKbDocument({ content, sourceUri, contentType = '' }) {
  const raw = String(content ?? '');
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw) || contentType.includes('html');
  const normalized = looksLikeHtml ? htmlToDocument(raw) : plainTextToDocument(raw);
  const title = normalized.title || inferTitleFromSource(sourceUri) || 'Untitled KB article';
  const body = collapseWhitespace(normalized.body);

  return {
    id: kbDocumentId(sourceUri || `${title}:${body.slice(0, 100)}`),
    sourceUri,
    productType: inferProductType(sourceUri, body),
    title: cleanTitle(title),
    body,
    contentType: looksLikeHtml ? 'text/html' : 'text/plain',
    importedAt: new Date().toISOString(),
  };
}

export function chunkKbDocument(document, {
  targetChars = DEFAULT_CHUNK_TARGET_CHARS,
  overlapChars = DEFAULT_CHUNK_OVERLAP_CHARS,
} = {}) {
  const paragraphs = splitIntoParagraphs(document.body);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;

    if (next.length <= targetChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = paragraph.length > targetChars ? '' : overlapText(current, overlapChars);
    }

    if (paragraph.length > targetChars) {
      chunks.push(...splitLongParagraph(paragraph, targetChars, overlapChars));
      current = '';
      continue;
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks
    .map((content, index) => ({
      id: `${document.id}:${index + 1}`,
      documentId: document.id,
      sourceUri: document.sourceUri,
      title: document.title,
      productType: document.productType,
      content,
      charCount: content.length,
      chunkIndex: index + 1,
    }))
    .filter((chunk) => chunk.content.trim().length >= 40);
}

export function extractKbLinks(html, baseUri) {
  const links = new Set();
  const pattern = /<a\b[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const href = match[1] ?? match[2] ?? match[3];

    try {
      const link = new URL(decodeEntities(href), baseUri);

      if (link.origin !== new URL(baseUri).origin) {
        continue;
      }

      if (!link.pathname.startsWith('/kb/') || link.pathname === '/kb/') {
        continue;
      }

      link.hash = '';
      link.search = '';
      links.add(link.href);
    } catch {
      // Ignore malformed page links. The source document is still importable.
    }
  }

  return [...links].sort();
}

export function kbDocumentId(source) {
  return `kb_${crypto.createHash('sha1').update(String(source)).digest('hex').slice(0, 18)}`;
}

function htmlToDocument(html) {
  const title = extractTitle(html);
  const articleHtml = extractPrimaryArticleHtml(html);
  const body = decodeEntities(
    articleHtml
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<pre\b[^>]*>/gi, '\n')
      .replace(/<\/pre>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|li|ol|ul|tr)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  );

  return {
    title,
    body,
  };
}

function plainTextToDocument(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => line.length <= 120 && !/[.!?]$/.test(line));

  return {
    title: heading ?? '',
    body: content,
  };
}

function extractPrimaryArticleHtml(html) {
  const contentMatch = html.match(
    /<div\b[^>]*class=(?:"[^"]*\bcontent\b[^"]*"|'[^']*\bcontent\b[^']*'|[^\s>]*content[^\s>]*)[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<a\b[^>]*class=(?:"[^"]*\bbutton\b[^"]*"|'[^']*\bbutton\b[^']*'|[^\s>]*button[^\s>]*)/iu,
  );

  if (contentMatch) {
    return contentMatch[1];
  }

  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);

  if (articleMatch) {
    return articleMatch[1];
  }

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

function extractTitle(html) {
  const heroTitle = html.match(
    /<p\b[^>]*class=(?:"[^"]*\btitle\b[^"]*"|'[^']*\btitle\b[^']*'|[^\s>]*title[^\s>]*)[^>]*>([\s\S]*?)<\/p>/i,
  );

  if (heroTitle) {
    return stripTags(heroTitle[1]);
  }

  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);

  if (h1) {
    return stripTags(h1[1]);
  }

  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title ? stripTags(title[1]).split('|')[0] : '';
}

function stripTags(value) {
  return decodeEntities(String(value).replace(/<[^>]+>/g, ' ')).trim();
}

function cleanTitle(title) {
  return collapseWhitespace(title).replace(/\s+\|\s+The Longhorn Knowledge Base$/i, '').trim();
}

function splitIntoParagraphs(text) {
  return collapseWhitespace(text)
    .split(/\n{2,}|\r?\n(?=#{1,6}\s|[A-Z][^.\n]{2,80}$|- )/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitLongParagraph(paragraph, targetChars, overlapChars) {
  const chunks = [];
  let start = 0;

  while (start < paragraph.length) {
    const end = Math.min(paragraph.length, start + targetChars);
    chunks.push(paragraph.slice(start, end).trim());
    start = end >= paragraph.length ? end : Math.max(start + 1, end - overlapChars);
  }

  return chunks;
}

function overlapText(text, overlapChars) {
  return text.slice(Math.max(0, text.length - overlapChars)).trim();
}

function collapseWhitespace(text) {
  return String(text)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash);/g,
      (_, entity) =>
        ({
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
          nbsp: ' ',
          rsquo: "'",
          lsquo: "'",
          rdquo: '"',
          ldquo: '"',
          ndash: '-',
          mdash: '-',
        })[entity],
    );
}

function inferTitleFromSource(sourceUri) {
  if (!sourceUri) {
    return '';
  }

  try {
    const segments = new URL(sourceUri).pathname.split('/').filter(Boolean);
    const slug = segments.at(-1) ?? segments.at(-2);
    return slug ? slug.replaceAll('-', ' ') : '';
  } catch {
    return '';
  }
}

function inferProductType(sourceUri, body) {
  const text = `${sourceUri ?? ''}\n${body}`.toLowerCase();
  return text.includes('longhorn') ? 'longhorn' : 'unknown';
}
