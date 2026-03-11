export type ExtractedUrl = {
  url: string;
  source: "entities" | "regex";
};

const URL_REGEX = /https?:\/\/[^\s)<>"]+/gi;

function isShortUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "t.co" || h === "bit.ly" || h === "tinyurl.com" || h === "ow.ly";
  } catch {
    return false;
  }
}

function isFilteredUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Filter shortlinks — handled separately as fallback
    if (isShortUrl(url)) {
      return true;
    }
    // Filter pic.twitter.com image links
    if (parsed.hostname === "pic.twitter.com") {
      return true;
    }
    // Filter self-referential tweet links (x.com/*/status/*)
    if (
      (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") &&
      /\/status\/\d+/.test(parsed.pathname)
    ) {
      return true;
    }
    return false;
  } catch {
    return true; // Invalid URL — filter out
  }
}

export function extractUrls(tweetText: string, rawJson: unknown): ExtractedUrl[] {
  const seen = new Set<string>();
  const results: ExtractedUrl[] = [];
  const shortUrls: string[] = []; // t.co etc. — kept as fallback

  function add(url: string, source: ExtractedUrl["source"]) {
    const normalized = url.replace(/\/+$/, ""); // strip trailing slashes
    if (seen.has(normalized)) return;

    if (isShortUrl(normalized)) {
      // Don't add yet — save as fallback in case entities don't provide expanded URLs
      if (!shortUrls.includes(normalized)) shortUrls.push(normalized);
      return;
    }

    if (isFilteredUrl(normalized)) return;

    seen.add(normalized);
    results.push({ url: normalized, source });
  }

  // Parse entities from raw JSON
  if (rawJson && typeof rawJson === "object") {
    const json = rawJson as Record<string, unknown>;
    const entities = json.entities as Record<string, unknown> | undefined;
    if (entities) {
      const urls = entities.urls as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(urls)) {
        for (const entry of urls) {
          const expanded = entry.expanded_url ?? entry.url;
          if (typeof expanded === "string") {
            add(expanded, "entities");
          }
        }
      }
    }
  }

  // Regex scan for additional URLs in tweet text
  const matches = tweetText.match(URL_REGEX);
  if (matches) {
    for (const match of matches) {
      add(match, "regex");
    }
  }

  // Fallback: if no real URLs were found, include shortlinks for resolution
  if (results.length === 0 && shortUrls.length > 0) {
    for (const shortUrl of shortUrls) {
      if (!seen.has(shortUrl)) {
        seen.add(shortUrl);
        results.push({ url: shortUrl, source: "regex" });
      }
    }
  }

  return results;
}
