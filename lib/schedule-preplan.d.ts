import { SchedulePreplanDay, SchedulePreplanException, SchedulePreplanRecord, SchedulePreplanRegime, SchedulePreplanWindow, ScriptEntry } from './types';
export interface SchedulePreplanConfig {
    enabled: boolean;
    horizonDays: number;
    reviewAfterLocalHour: number;
    anchorAutoAdvance: boolean;
    variationLevel: 'stable' | 'contextual' | 'granular';
    candidateActivationProbability: number;
    candidateRevealMinutes: number;
}
export declare const DEFAULT_SCHEDULE_PREPLAN_CONFIG: SchedulePreplanConfig;
/** @deprecated Legacy parser, not called by the runtime. Current profiles are
 * interpreted by the contextual schedule planner without a fixed workweek.
 * Extract only explicitly clocked weekday blocks from the character profile.
 * This is deliberately host-side and narrow: an author-written schedule is
 * stronger evidence than a background model guessing a routine from prose. */
export declare function configuredWeekdaySchedule(profile: string | undefined, from: string): SchedulePreplanRegime | undefined;
export declare function resolveSchedulePreplanConfig(value?: Partial<SchedulePreplanConfig>): SchedulePreplanConfig;
export declare function normalizeSchedulePreplanRecord(value: unknown): SchedulePreplanRecord | undefined;
export declare function schedulePreplanReviewDue(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, config: SchedulePreplanConfig): boolean;
export declare function schedulePreplanNeedsModel(record: SchedulePreplanRecord | undefined, evidence: ScriptEntry[], today: string, timezone: string, config: SchedulePreplanConfig): boolean;
export declare function refreshSchedulePreplan(record: SchedulePreplanRecord, today: string, timezone: string, config: SchedulePreplanConfig, now: Date, reason?: string): SchedulePreplanRecord;
export declare function applySchedulePreplanProposal(current: SchedulePreplanRecord | undefined, proposalValue: unknown, evidence: ScriptEntry[], today: string, timezone: string, config: SchedulePreplanConfig, now: Date, variationLevel?: SchedulePreplanConfig['variationLevel'], authorProfileEvidence?: boolean): SchedulePreplanRecord | undefined;
export declare function materializeSchedulePreplan(regimes: SchedulePreplanRegime[], exceptions: SchedulePreplanException[], startDate: string, horizonDays: number): SchedulePreplanDay[];
/** Project only the coming twelve hours; the rest of the stored horizon never enters the main prompt. */
export declare function schedulePreplanWindow(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, hours?: number, config?: Pick<SchedulePreplanConfig, 'candidateActivationProbability' | 'candidateRevealMinutes'>): SchedulePreplanWindow | null;
export declare function nextSchedulePreplanTransition(record: SchedulePreplanRecord | undefined, now: Date, timezone: string, maxHours?: number): Date;
