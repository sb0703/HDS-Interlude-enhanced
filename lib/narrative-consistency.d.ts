import { NarrativeDecision, NarrativeRequest, ScenePresenceDraft, TimelinePlan } from './types';
export interface ReviewDelivery {
    target: string;
    content: string;
}
export interface NarrativeReviewRequest {
    context: NarrativeRequest;
    candidate: NarrativeDecision;
    allowedDeliveries: ReviewDelivery[];
    alreadyDelivered: ReviewDelivery[];
    repetitionSignal?: {
        similarity: number;
        previousId?: number;
    };
    clockSignal?: {
        observed: string;
        expected: string;
        from: string;
        explicitNow: boolean;
    };
    presenceUpdates?: ScenePresenceDraft[];
    evidenceCharacterBudget?: number;
}
export interface NarrativeReviewIssue {
    target: 'plan' | 'script' | 'delivery' | 'presence';
    kind: 'state-conflict' | 'event-replay' | 'causality' | 'time' | 'delivery';
    candidateExcerpt: string;
    evidenceRefs: string[];
    reason: string;
    repair: string;
}
export interface NarrativeReview {
    verdict: 'pass' | 'reject';
    issues: NarrativeReviewIssue[];
}
/** All semantic judgements use scoped evidence, never a universal routine. */
export declare function narrativeReviewPrompt(): string;
export declare function toNarrativeReviewPayload(request: NarrativeReviewRequest): {
    evidence: {
        ref: string;
        value: unknown;
    }[];
    candidate: {
        script: string;
        plan: TimelinePlan;
        presenceUpdates: ScenePresenceDraft[];
    };
    repetitionSignal: {
        similarity: number;
        previousId?: number;
    };
    clockSignal: {
        observed: string;
        expected: string;
        from: string;
        explicitNow: boolean;
    };
};
/** Missing or ungrounded reviewer output is unavailable, never pass. */
export declare function normalizeNarrativeReview(value: unknown, request: NarrativeReviewRequest): NarrativeReview | undefined;
/** A content-free diagnostic suitable for logs and a schema repair prompt. */
export declare function narrativeReviewInvalidReason(value: unknown, request: NarrativeReviewRequest): string;
export declare function narrativeReviewRepairPrompt(reason: string): string;
export declare function reviewRecoveryText(review: NarrativeReview): string;
export declare function reviewNeedsReplan(review: NarrativeReview, plan: TimelinePlan | undefined): boolean;
