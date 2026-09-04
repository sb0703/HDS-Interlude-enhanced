/** Normalize only model-produced visible-message separators. Story prose and
 * incoming user text must never pass through this compatibility layer. */
export declare function normalizeMessageSeparators(value: unknown, separator?: string): string;
