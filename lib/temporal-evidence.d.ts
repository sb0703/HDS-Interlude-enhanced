import { UserReportedTime } from './types';
/** Complete source and receive-time anchor, without language-specific guesses. */
export declare function temporalEvidence(content: string, now: Date, timezone: string): {
    statement: string;
    receivedAt: string;
    receivedAtLocal: {
        timezone: string;
        utc: string;
        local: string;
        date: string;
        time: string;
        hour: number;
        weekday: string;
        offset: string;
        period: string;
        periodZh: "上午" | "下午" | "傍晚/晚上" | "夜间";
        daylightExpectation: string;
    };
    interpretation: "unresolved";
};
/** Validate semantic extraction, never infer meaning from words or clock forms. */
export declare function normalizeUserReportedTimes(value: unknown, source: string, now: Date, timezone: string): UserReportedTime[] | undefined;
