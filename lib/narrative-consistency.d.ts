import { NarrativeDecision, NarrativeRequest, ScenePresenceDraft, TimelinePlan, UserReportedTime } from './types';
export interface ReviewDelivery {
    target: string;
    content: string;
    bubbles?: string[];
}
export interface NarrativeReviewFailure {
    stage: 'routing' | 'review' | 'review-repair' | 'reported-times' | 'reported-times-repair';
    reason: string;
}
export interface NarrativeReviewRequest {
    /** Host-only diagnostics; never serialized into model input. */
    onFailure?: (failure: NarrativeReviewFailure) => void;
    context: NarrativeRequest;
    candidate: NarrativeDecision;
    allowedDeliveries: ReviewDelivery[];
    alreadyDelivered: ReviewDelivery[];
    retrievalHints?: Array<{
        previousId: number;
        similarity: number;
    }>;
    requireSemanticChecks?: boolean;
    requireDeliveryCheck?: boolean;
    memoryAudit?: boolean;
    memoryBaseline?: {
        scene: unknown;
        arc: unknown;
    };
    presenceUpdates?: ScenePresenceDraft[];
    evidenceCharacterBudget?: number;
}
export interface NarrativeReviewIssue {
    target: 'plan' | 'script' | 'delivery' | 'presence' | 'expression';
    kind: 'state-conflict' | 'event-replay' | 'causality' | 'time' | 'delivery';
    candidateExcerpt: string;
    evidenceRefs: string[];
    reason: string;
    repair: string;
}
export interface NarrativeTimeAudit {
    verdict: 'pass' | 'reject' | 'uncertain';
    /** Exact, contiguous candidate text if the audit found a completed event outside the interval. */
    excerpt?: string;
    reason?: string;
    durationAssessments?: Array<{
        anchorId: number;
        relation: 'completed' | 'planned' | 'remembered' | 'ambiguous';
    }>;
}
export interface NarrativeReview {
    verdict: 'pass' | 'reject';
    issues: NarrativeReviewIssue[];
    checks?: SemanticCheck[];
    reportedTimes?: UserReportedTime[];
}
/** A reset/rebase story has no active original yet; typical routines are not
 * evidence of completed events earlier on its first local day. */
export declare function isFreshNarrativeStart(context: NarrativeRequest): boolean;
export interface SemanticCheck {
    kind: 'time' | 'progression' | 'delivery';
    status: 'consistent' | 'uncertain' | 'conflict';
    evidenceRefs: string[];
    summary: string;
}
/** All semantic judgements use scoped evidence, never a universal routine. */
export declare function narrativeReviewPrompt(memoryAudit?: boolean): string;
export declare function toNarrativeReviewPayload(request: NarrativeReviewRequest): {
    evidence: {
        ref: string;
        value: unknown;
    }[];
    allowedEvidenceRefs: string[];
    candidate: {
        script: string;
        plan: TimelinePlan;
        presenceUpdates: ScenePresenceDraft[];
        nativeFace: import("./types").NativeFaceDraft;
    };
    memoryAudit: boolean;
    requireSemanticChecks: boolean;
    requireDeliveryCheck: boolean;
    retrievalHints: {
        previousId: number;
        similarity: number;
    }[];
};
/** Missing or ungrounded reviewer output is unavailable, never pass. */
export declare function normalizeNarrativeReview(value: unknown, request: NarrativeReviewRequest): NarrativeReview | undefined;
/** A content-free diagnostic suitable for logs and a schema repair prompt. */
export declare function narrativeReviewInvalidReason(value: unknown, request: NarrativeReviewRequest): string;
export declare function narrativeReviewRepairPrompt(reason: string, request?: NarrativeReviewRequest): string;
export declare function reviewRecoveryText(review: NarrativeReview): string;
export declare function reviewNeedsReplan(review: NarrativeReview, plan: TimelinePlan | undefined): boolean;
