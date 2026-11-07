/**
 * Defensive prose converter that translates stray HTML tags in AI chat explanations
 * into standard Markdown, strips unsafe scripts/attributes, and preserves code blocks.
 */

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => {
    return HTML_ENTITY_MAP[match] || match;
  });
}

function convertHtmlFragment(html: string): string {
  let text = html;

  // 1. Remove dangerous script and style elements entirely
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // 2. Convert headers (h1 to h6)
  text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  text = text.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');
  text = text.replace(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi, '\n\n##### $1\n\n');
  text = text.replace(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi, '\n\n###### $1\n\n');

  // 3. Convert formatting tags (strong, b, em, i)
  text = text.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  text = text.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');

  // 4. Convert links
  text = text.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 5. Convert lists
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n');

  // 6. Convert paragraphs, divs, line breaks
  text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n');

  // 7. Convert inline code tag
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // 8. Unwrap span and other container tags
  text = text.replace(/<\/?(?:span|section|article|main|nav|header|footer)\b[^>]*>/gi, '');

  // 9. Strip any remaining stray tags
  text = text.replace(/<[^>]+>/g, '');

  // 10. Decode HTML entities
  text = decodeEntities(text);

  return text;
}

/**
 * Converts HTML tags inside Markdown prose into clean Markdown,
 * while leaving fenced and inline code blocks untouched.
 */
export function safeHtmlToMarkdown(content: string): string {
  if (!content) return '';

  // Quick check: if there is no '<', return content as is
  if (!content.includes('<')) {
    return content;
  }

  // Split content by fenced code blocks (```...```) to protect code inside fences
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts
    .map((part) => {
      // If this part is a code fence, preserve it exactly as-is
      if (part.startsWith('```') && part.endsWith('```')) {
        return part;
      }
      return convertHtmlFragment(part);
    })
    .join('');
}
