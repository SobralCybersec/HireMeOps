const MAX_EXTERNAL_TEXT = 12_000;

export interface UntrustedWebResult {
  trusted: false;
  source: string;
  content: string;
}

/** Keep web content as data. Callers must not interpret it as instructions. */
export function asUntrustedWebResult(source: string, content: string): UntrustedWebResult {
  return {
    trusted: false,
    source: source.slice(0, 500),
    content: content.replaceAll("\u0000", "").slice(0, MAX_EXTERNAL_TEXT),
  };
}
