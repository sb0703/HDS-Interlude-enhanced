import { ScriptEntry, WorkingDetail, WorkingDetailDraft } from './types';
/** Built only from the caller's privacy-filtered history. A stored window is
 * evidence of past narration, not a fresh trigger or proof of message delivery. */
export declare function recentContinuityContext(entries: ScriptEntry[], now: Date): {
    lastNarratedBeat: {
        entryId: number;
        participantId: string;
        windowEndedAt: string;
        kind: import("./types").TimelineBeatKind;
        summary: string;
    };
    alreadyNarrated: {
        entryId: number;
        participantId: string;
        windowEndedAt: string;
        kind: import("./types").TimelineBeatKind;
        summary: string;
    }[];
    deliveredMessages: {
        entryId: number;
        participantId: string;
        kind: string;
        direction: string;
        occurredAt: string;
        content: string;
    }[];
};
/** Explicit resolution removes a scratchpad item; omission still preserves it.
 * Evidence must come from this compaction batch, never a fabricated entry id. */
export declare function mergeWorkingDetails(existing: WorkingDetail[], drafts: WorkingDetailDraft[], entries: ScriptEntry[], now: Date): WorkingDetail[];
