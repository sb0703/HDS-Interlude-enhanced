import { UserReportedTime } from './types';
/** Extract evidence, not a guessed daily routine. Ambiguous clocks stay ambiguous. */
export declare function extractUserReportedTimes(content: string, now: Date, timezone: string): UserReportedTime[];
/** A conservative clock signal. A live reading may occur anywhere in the
 * narrated interval; only an explicit endpoint claim means "now". */
export declare function narrativeClockConflict(script: string | undefined, from: Date, now: Date, timezone: string): {
    observed: string;
    expected: string;
    elapsedMinutes: number;
    from: string;
    explicitNow: boolean;
};
