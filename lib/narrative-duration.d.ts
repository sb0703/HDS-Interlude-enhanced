/** Language-level duration quantities only. Whether they describe newly
 * completed actions is decided against the candidate by the time auditor. */
export interface NarrativeDurationAnchor {
    id: number;
    excerpt: string;
    quantity: string;
    minimumMinutes: number;
}
export declare function narrativeDurationAnchors(script: string): NarrativeDurationAnchor[];
