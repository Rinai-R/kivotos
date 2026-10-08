export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-kivotos-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-kivotos-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-kivotos-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-kivotos-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-kivotos-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-kivotos-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-kivotos-markdown-align";
export const MARKDOWN_COPY_SRC_ATTRIBUTE = "data-kivotos-markdown-src";
export const MARKDOWN_COPY_ALT_ATTRIBUTE = "data-kivotos-markdown-alt";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { kivotosMarkdownTag: "blockquote" },
  br: { kivotosMarkdownTag: "br" },
  code: { kivotosMarkdownTag: "code" },
  h1: { kivotosMarkdownTag: "h1" },
  h2: { kivotosMarkdownTag: "h2" },
  h3: { kivotosMarkdownTag: "h3" },
  h4: { kivotosMarkdownTag: "h4" },
  h5: { kivotosMarkdownTag: "h5" },
  h6: { kivotosMarkdownTag: "h6" },
  hr: { kivotosMarkdownTag: "hr" },
  ignore: { kivotosMarkdownIgnore: "true" },
  li: { kivotosMarkdownTag: "li" },
  listMarker: { kivotosMarkdownIgnore: "true", kivotosMarkdownListMarker: "true" },
  ol: { kivotosMarkdownTag: "ol" },
  p: { kivotosMarkdownTag: "p" },
  pre: { kivotosMarkdownTag: "pre" },
  s: { kivotosMarkdownTag: "s" },
  strong: { kivotosMarkdownTag: "strong" },
  em: { kivotosMarkdownTag: "em" },
  table: { kivotosMarkdownTag: "table" },
  tbody: { kivotosMarkdownTag: "tbody" },
  td: { kivotosMarkdownTag: "td" },
  th: { kivotosMarkdownTag: "th" },
  thead: { kivotosMarkdownTag: "thead" },
  tr: { kivotosMarkdownTag: "tr" },
  ul: { kivotosMarkdownTag: "ul" },
  unwrap: { kivotosMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    kivotosMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { kivotosMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

/**
 * An image copies as the Markdown it came from. The rendered `img` points at a preview
 * URL for data and workspace images, and carries no alt text of its own.
 */
export function markdownCopyImageDataSet(source: string, alt: string | undefined) {
  return {
    kivotosMarkdownTag: "img",
    kivotosMarkdownSrc: source,
    ...(alt ? { kivotosMarkdownAlt: alt } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { kivotosMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
