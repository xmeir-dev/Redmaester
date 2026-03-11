// Shared X article GraphQL/DOM parsing utilities
// Used by both playwright-scraper.ts and browserbase-scraper.ts

export const MIN_CONTENT_LENGTH = 50;

// Convert X article GraphQL rich text blocks to markdown
export function graphqlContentToMarkdown(data: unknown): string | null {
  try {
    const json = data as Record<string, unknown>;
    const content = findArticleContent(json);
    if (!content) return null;

    if (Array.isArray(content)) {
      return content
        .map((block: unknown) => richTextBlockToMarkdown(block))
        .filter(Boolean)
        .join("\n\n");
    }

    if (typeof content === "string") return content;
    return null;
  } catch {
    return null;
  }
}

// Recursively search for article content in GraphQL response
export function findArticleContent(obj: unknown, depth = 0): unknown {
  if (depth > 10 || !obj || typeof obj !== "object") return null;

  const record = obj as Record<string, unknown>;

  if (record.content && Array.isArray(record.content)) {
    const first = (record.content as unknown[])[0];
    if (first && typeof first === "object") return record.content;
  }

  if (typeof record.body === "string" && record.body.length > MIN_CONTENT_LENGTH) {
    return record.body;
  }

  if (typeof record.text === "string" && record.text.length > MIN_CONTENT_LENGTH) {
    return record.text;
  }

  for (const value of Object.values(record)) {
    const found = findArticleContent(value, depth + 1);
    if (found) return found;
  }

  return null;
}

export function richTextBlockToMarkdown(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, unknown>;

  const text = typeof b.text === "string" ? b.text : "";
  const type = typeof b.type === "string" ? b.type : "";

  switch (type) {
    case "heading":
    case "header": {
      const level = typeof b.level === "number" ? b.level : 2;
      return "#".repeat(level) + " " + text;
    }
    case "paragraph":
    case "text":
      return text;
    case "blockquote":
    case "quote":
      return text
        .split("\n")
        .map((line: string) => "> " + line)
        .join("\n");
    case "code":
    case "codeBlock":
      return "```\n" + text + "\n```";
    case "list":
    case "unordered_list": {
      const items = Array.isArray(b.items) ? b.items : [];
      return items.map((item: unknown) => "- " + String(item)).join("\n");
    }
    case "ordered_list": {
      const items = Array.isArray(b.items) ? b.items : [];
      return items.map((item: unknown, i: number) => `${i + 1}. ${String(item)}`).join("\n");
    }
    case "image": {
      const url = typeof b.url === "string" ? b.url : "";
      const alt = typeof b.alt === "string" ? b.alt : "";
      return url ? `![${alt}](${url})` : "";
    }
    default:
      return text;
  }
}

// Find a string value by key name recursively in nested object
export function findNestedString(obj: unknown, key: string, depth = 0): string | null {
  if (depth > 10 || !obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;

  if (typeof record[key] === "string" && (record[key] as string).length > 0) {
    return record[key] as string;
  }

  for (const value of Object.values(record)) {
    const found = findNestedString(value, key, depth + 1);
    if (found) return found;
  }

  return null;
}
