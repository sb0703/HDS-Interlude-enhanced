/** Immutable row high-water marks. Wall clocks cannot hide older future-dated rows. */
export declare const TIMELINE_TABLES: readonly ["interlude_script_entry", "interlude_memory", "interlude_fact", "interlude_intent", "interlude_state_patch", "interlude_overlay_snapshot", "interlude_web_observation", "interlude_scene", "interlude_arc"];
export interface TimelineBoundary {
    at: string;
    cutoffs: Record<string, number>;
}
export declare function normalizeTimelineBoundary(value: unknown): TimelineBoundary | undefined;
export declare function timelineBoundaryQuery(table: string, query: unknown, boundary?: TimelineBoundary): unknown;
