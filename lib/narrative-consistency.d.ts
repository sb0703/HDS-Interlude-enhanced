import { NarrativeDecision, NarrativeRequest, ScenePresenceDraft, TimelinePlan, UserReportedTime } from './types';
export interface ReviewDelivery {
    target: string;
    content: string;
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
export interface NarrativeReview {
    verdict: 'pass' | 'reject';
    issues: NarrativeReviewIssue[];
    checks?: SemanticCheck[];
    reportedTimes?: UserReportedTime[];
}
export interface SemanticCheck {
    kind: 'time' | 'progression';
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
