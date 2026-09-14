import { researchIntentSchema } from "./schemas";

export function planResearchQueries(input: unknown): string[] {
  const intent = researchIntentSchema.parse(input);
  const base = intent.intent;
  const planned = [base, ...intent.sourceHints.map((hint) => `${base} site:${hint}`)];
  return [...new Set(planned)].slice(0, intent.maxQueries);
}
