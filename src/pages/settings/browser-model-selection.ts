export const DEFAULT_BROWSER_MODEL = "chatgpt-web-session";

function gptScore(normalized: string, match: RegExpMatchArray): number[] {
  return [
    3,
    /(?:^|[-_.])thinking(?:$|[-_.])/i.test(normalized) ? 1 : 0,
    Number(match[1]),
    Number(match[2] ?? 0),
    Number(match[3] ?? 0),
  ];
}

function modelScore(model: string): number[] {
  const normalized = model.toLowerCase();
  if (normalized === DEFAULT_BROWSER_MODEL) return [0, 0, 0, 0];
  const gpt = normalized.match(/^gpt[-_.](\d+)(?:[-_.](\d+))?(?:[-_.](\d+))?/i);
  if (gpt) return gptScore(normalized, gpt);
  const oSeries = normalized.match(/^o(\d+)/i);
  return oSeries ? [2, 0, Number(oSeries[1]), 0, 0] : [1, 0, 0, 0, 0];
}

function compareScores(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function choosePreferredBrowserModel(models: string[]): string {
  const unique = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  return (
    unique.sort(
      (left, right) =>
        compareScores(modelScore(left), modelScore(right)) || left.localeCompare(right),
    )[0] ?? DEFAULT_BROWSER_MODEL
  );
}

export function isAutomaticBrowserModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === "" || normalized === DEFAULT_BROWSER_MODEL;
}

export function encodeBrowserModel(site: string, model: string): string {
  const normalized = model.trim();
  return normalized === "" ? site : `${site}/${normalized}`;
}
