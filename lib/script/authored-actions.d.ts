import type { NarrativeDecision } from '../types';
export interface AuthoredAction {
    id: string;
    start: number;
    end: number;
    content: string;
}
/** Host-owned source before markup removal or invalid-reference cleanup. */
export declare function authoredActionRecoveryDraft(decision: NarrativeDecision): NarrativeDecision;
/** Syntax only: unwrap authored speech, never infer an action from prose.
 * Duplicate ids are not executable references. The original words survive. */
export declare function readAuthoredActions(script: string): {
    prose: string;
    actions: AuthoredAction[];
};
/** Resolve the same authored words before any transport normalization. Legacy
 * content remains compatible; a broken explicit reference cannot send another
 * independently authored answer. Delayed drafts retain their existing path. */
export declare function resolveAuthoredActions(decision: NarrativeDecision, alreadySent?: boolean, separator?: string): NarrativeDecision;
export declare function hasUnresolvedAuthoredActions(decision: NarrativeDecision): boolean;
/** Resolve an explicit multi-bubble mirror only when every authored span
 * matches the original mirror in order. No prose is promoted to a message. */
export declare function recoverExplicitAuthoredMirror(decision: NarrativeDecision, separator?: string): NarrativeDecision | undefined;
export declare function completeLegacyBubbleBlock(prose: string, content: string, separator: string): string;
