import { Context } from 'koishi';
import { AlterAnalysisDecision, AlterAnalysisRequest, AlterSystemConfig, ChatActionCapabilities, CompactionDecision, CompactionRequest, ImageSubject, NarrativeDecision, NarrativeProvider, OverlayCompactionDecision, OverlayCompactionRequest, EarlyNarrativeReply, NarrativeCompactor, NarrativeEmbedder, NarrativeImage, NarrativeRequest, SchedulePreplanProposal, SchedulePreplanReviewRequest, StickerCatalogEntry, TimelinePlan, TimelinePlanRequest } from './types';
import { NarrativeReviewRequest, NarrativeTimeAudit } from './narrative-consistency';
import { ModelRoutingTable } from './model-routing';
export { configuredProviders, effectiveMainModelId, resolveModelRouting, usesRemoteProviders, ZHIPU_OFFICIAL_CHAT_ENDPOINT, } from './model-routing';
export { storyLocalTimeContext } from './time';
export type ProviderResponseFormat = 'json-object' | 'prompt-only';
export type ProviderStrategy = 'priority' | 'round-robin';
export type ZhipuReasoningEffort = 'low' | 'high' | 'max';
export type DeepSeekThinkingMode = 'disabled' | 'enabled';
export type ProviderMode = 'openai-compatible' | 'zhipu-official' | 'openai-official' | 'deepseek-official' | 'moonshot-official' | 'dashscope-official' | 'siliconflow-official' | 'openrouter' | 'gemini-openai';
export declare const ZHIPU_FIRST_VISIBLE_TOKEN_TIMEOUT = 45000;
export interface StickerDescription {
    description: string;
    aliases: string[];
}
export interface StickerDescriber {
    available(): boolean;
    describeSticker(dataUri: string, mimeType: string, fileName: string, animated: boolean, responseFormat?: ProviderResponseFormat, maxTokens?: number): Promise<StickerDescription | undefined>;
}
/** Converts current user images into factual text for a text-only main narrator.
 * Results are transient and deliberately have no memory API. */
export interface VisionDescriber {
    available(): boolean;
    describeImages(images: NarrativeImage[], userText?: string, detail?: VisionDetail): Promise<string[] | undefined>;
}
export interface ProviderConfig {
    /** Legacy internal identifier. New Console rows derive identity from the model connection. */
    id?: string;
    label: string;
    enabled: boolean;
    endpoint: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number;
    maxTokens: number;
    timeout: number;
    responseFormat: ProviderResponseFormat;
    extraHeaders: string;
    extraBody: string;
    mode?: ProviderMode;
    /** One model connection can be assigned directly to each HDSI task. */
    useForMain?: boolean;
    useForCompaction?: boolean;
    useForAlter?: boolean;
    useForEmbedding?: boolean;
    useForStickers?: boolean;
    useForVision?: boolean;
    zhipuOfficial?: boolean;
    reasoningEffort?: ZhipuReasoningEffort;
    deepseekOfficial?: boolean;
    deepseekThinking?: DeepSeekThinkingMode;
    deepseekReasoningEffort?: ZhipuReasoningEffort;
    dashscopeRegion?: 'beijing' | 'singapore' | 'us';
    /** Optional billing prices per one million tokens; 0 disables cost logging. */
    priceInput?: number;
    priceOutput?: number;
    priceCachedInput?: number;
}
export interface FailoverConfig {
    enabled: boolean;
    strategy: ProviderStrategy;
    maxAttemptsPerProvider: number;
    cooldownMinutes: number;
}
export interface ModelConfig {
    /** @deprecated Remote mode is inferred from enabled provider rows. */
    mode?: 'fallback' | 'openai-compatible';
    providers: ProviderConfig[];
    failover: FailoverConfig;
    mainPrompt?: string;
    formatPrompt?: string;
    fixedPrompt: string;
    stylePrompt: string;
    /** Central model catalogue. Task-specific settings may reference an entry by id. */
    models?: ModelProfile[];
    mainModelId?: string;
    mainTemperature?: number;
    mainTopP?: number;
    mainMaxTokens?: number;
    mainTimeout?: number;
    mainResponseFormat?: ProviderResponseFormat;
    /** Manual opt-in for streaming JSON transport; unavailable providers remain on full-response mode. */
    mainStreamingMode?: 'off' | 'experimental';
    /** cache-first reorders the user payload so stable blocks (history, memory layers) precede
     * per-turn fields, letting provider prefix caches hit across consecutive turns. */
    mainPayloadOrder?: 'legacy' | 'cache-first';
    /** Contextual audit before persistence; uses the configured compaction route. */
    consistencyReview?: boolean;
    consistencyReviewHistoryCharacters?: number;
    compaction?: CompactionConfig;
    embedding?: EmbeddingConfig;
    /** OpenAI-compatible native image inputs for the current private-message turn. */
    vision?: VisionConfig;
    /** Optional second-pass guard that rejects drafts contradicting explicit character canon. */
    canonGuard?: CanonGuardConfig;
    /** Independently configured text-to-image endpoint. It never reuses the chat route implicitly. */
    imageGeneration?: ImageGenerationConfig;
    audio?: AudioConfig;
}
export interface CanonGuardConfig {
    enabled: boolean;
    maxRewriteAttempts: number;
    maxTokens: number;
    timeout: number;
}
export interface VisionConfig {
    enabled: boolean;
    /** native passes image_url to main narration; sidecar makes temporary factual observations. */
    mode?: 'native' | 'sidecar';
    detail?: VisionDetail;
    /** Longest allowed image edge for native vision inputs; 0 disables downscaling.
     * Downscaling re-renders the image through the optional Puppeteer service and
     * silently passes the original through when Puppeteer is unavailable. */
    maxImageDimension?: 0 | 512 | 768 | 1024;
}
export type VisionDetail = 'low' | 'high' | 'auto';
/** A dedicated image route, separate from chat, embedding and recognition. */
export interface ImageGenerationConfig {
    enabled: boolean;
    mode: ImageGenerationMode;
    endpoint: string;
    apiKey: string;
    model: string;
    size: string;
    quality: string;
    timeout: number;
    maxPromptCharacters: number;
    extraHeaders: string;
    extraBody: string;
    characterReference?: CharacterReferenceImageConfig;
}
export interface CharacterReferenceImageConfig {
    enabled: boolean;
    source: string;
    model: string;
}
export type ImageGenerationMode = 'openai-images' | 'dashscope-qwen-image';
export interface GeneratedImage {
    url: string;
    revisedPrompt?: string;
}
export interface ImageGenerator {
    generate(prompt: string, options?: {
        subject?: ImageSubject;
        characterAppearance?: string;
    }): Promise<GeneratedImage>;
}
export interface AudioConfig {
    enabled: boolean;
    /** SnowLuma server-side transcode container for QQ voice records.
     * Raw SILK cannot be read by multimodal models, so the OneBot get_record
     * action is always asked for this output format. */
    outFormat?: 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac' | 'amr';
    /** Hard upper bound for one native audio attachment; larger files are skipped. */
    maxFileSizeMB?: number;
    /** Audio attachments accepted per incoming event. */
    maxPerMessage?: number;
}
export interface ModelProfile {
    id: string;
    label: string;
    enabled?: boolean;
    providerId: string;
    model: string;
    maxTokens: number;
    timeout: number;
    responseFormat: ProviderResponseFormat;
}
export interface CompactionConfig {
    enabled: boolean;
    modelId?: string;
    providerId: string;
    model: string;
    temperature: number;
    topP: number;
    maxTokens: number;
    timeout: number;
    responseFormat: ProviderResponseFormat;
    mainPrompt?: string;
    fixedPrompt: string;
    stylePrompt: string;
}
/**
 * Embedding is deliberately configured separately from chat generation. A single
 * provider can be reused for its credentials, while the endpoint and model may
 * point at a cheaper or local vector model.
 */
export interface EmbeddingConfig {
    enabled: boolean;
    /** Enable semantic query embedding on the latency-sensitive live turn. */
    liveQuery?: boolean;
    /** Filter the sticker catalog to the most semantically relevant entries before injection. */
    semanticStickerFilter?: boolean;
    /** Vectorize raw history entries and recall the most relevant older moments per turn. */
    semanticHistory?: boolean;
    /** Reuses apiKey and extraHeaders from a configured chat provider. */
    providerId: string;
    modelId?: string;
    /** OpenAI-compatible /embeddings endpoint. Leave empty to derive it from the chat endpoint. */
    endpoint: string;
    model: string;
    /** 0 omits the optional OpenAI dimensions parameter. */
    dimensions: number;
    timeout: number;
    maxInputCharacters: number;
    /** Number of legacy facts to vectorize in each background maintenance pass. */
    backfillBatchSize: number;
}
export interface CanonReview {
    compliant: boolean;
    conflicts: string[];
}
export declare class SilentNarrator implements NarrativeProvider {
    decide(): Promise<NarrativeDecision>;
}
export declare class SilentCompactor implements NarrativeCompactor {
    compact(): Promise<CompactionDecision>;
    compactOverlay(): Promise<OverlayCompactionDecision>;
    planSchedulePreplan(): Promise<SchedulePreplanProposal | undefined>;
    planTimeline(): Promise<TimelinePlan | undefined>;
}
/** A no-op embedder lets memory retrieval fall back to rule-based ranking. */
export declare class SilentEmbedder implements NarrativeEmbedder {
    embed(): Promise<number[]>;
}
/** OpenAI Images and DashScope Qwen Image client with an optional protagonist-only reference route. */
export declare class OpenAICompatibleImageGenerator implements ImageGenerator {
    private ctx;
    private config;
    constructor(ctx: Context, config: ImageGenerationConfig);
    generate(prompt: string, options?: {
        subject?: ImageSubject;
        characterAppearance?: string;
    }): Promise<GeneratedImage>;
    private generateDashscope;
}
/**
 * Minimal OpenAI-compatible embedding client. It intentionally performs no
 * chat-provider failover: an embedding failure is non-fatal and the caller
 * simply uses importance/confidence/recency ranking for that turn.
 */
export declare class OpenAICompatibleEmbedder implements NarrativeEmbedder {
    private ctx;
    private config;
    private readonly routing;
    constructor(ctx: Context, config: ModelConfig, routing?: ModelRoutingTable);
    identity(): string;
    embed(input: string): Promise<number[]>;
}
export declare class OpenAICompatibleNarrator implements NarrativeProvider {
    private ctx;
    private config;
    private onUsage?;
    /**
     * 主写作与压缩共用服务商选择、冷却和 OpenAI 兼容协议；二者的提示词和
     * token/temperature 配置不同，因此同一个实例可承担两个接口。
     */
    private cooldownUntil;
    private roundRobinOffset;
    private readonly logger?;
    private readonly routing;
    constructor(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable);
    private assignedProviders;
    available(): boolean;
    visionAvailable(): boolean;
    decide(request: NarrativeRequest): Promise<NarrativeDecision>;
    /** 思考型网关把 reasoning 计入 completion 预算：带小 cap 的侧端 JSON 任务
     * 会被推理挤到只剩残句（invalid JSON / Unterminated string at position N）。
     * 首次解析失败时去掉 max_tokens 原样重试一次；成功路径不多发任何请求。
     * 非流式响应逐一尝试全部文本字段（content/reasoning_content 等），与
     * parseChatJsonResponse 的宽容度一致。 */
    private sideTaskJson;
    compact(request: CompactionRequest): Promise<CompactionDecision>;
    planTimeline(request: TimelinePlanRequest): Promise<TimelinePlan | undefined>;
    auditTimelinePlan(request: TimelinePlanRequest, plan: TimelinePlan): Promise<'pass' | 'reject' | 'uncertain'>;
    auditNarrativeTime(request: NarrativeRequest, script: string): Promise<NarrativeTimeAudit>;
    reviewNarrative(request: NarrativeReviewRequest): Promise<any>;
    planSchedulePreplan(request: SchedulePreplanReviewRequest): Promise<SchedulePreplanProposal | undefined>;
    compactOverlay(request: OverlayCompactionRequest): Promise<OverlayCompactionDecision>;
    analyzeAlter(request: AlterAnalysisRequest, alterConfig: AlterSystemConfig): Promise<AlterAnalysisDecision>;
    describeSticker(dataUri: string, mimeType: string, fileName: string, animated: boolean, responseFormat?: ProviderResponseFormat, maxTokens?: number): Promise<StickerDescription | undefined>;
    describeImages(images: NarrativeImage[], userText?: string, detail?: VisionDetail): Promise<string[] | undefined>;
    /** Record one provider response's token usage (if the provider reports any). */
    private collectUsage;
    private emitUsage;
    private selectRouteProviders;
    private requestProvider;
    private requestCanonReview;
}
export declare function createNarrator(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): NarrativeProvider;
export declare function createImageGenerator(ctx: Context, config: ModelConfig): ImageGenerator;
export declare function createStickerDescriber(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): StickerDescriber;
export declare function createVisionDescriber(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): VisionDescriber;
export declare function createCompactor(ctx: Context, config: ModelConfig, silentLogs?: boolean, onUsage?: (record: TokenUsageRecord) => void, routing?: ModelRoutingTable): NarrativeCompactor;
export declare function createEmbedder(ctx: Context, config: ModelConfig, routing?: ModelRoutingTable): NarrativeEmbedder;
/** Returns the first complete transport object while the rest of the JSON is
 * still arriving. The contract asks for this field first, but scanning only
 * accepts a fully closed top-level value and never sends partial text. */
export declare function extractEarlyNarrativeReply(raw: string, group: boolean): EarlyNarrativeReply | undefined;
/** Normalized token accounting for one provider response. `cachedInputTokens`
 * is the provider-reported subset of input tokens served from prefix cache. */
export interface TokenUsageRecord {
    task: string;
    providerLabel: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    /** Prices per one million tokens; 0/undefined disables cost reporting. */
    priceInput?: number;
    priceOutput?: number;
    priceCachedInput?: number;
}
/** Accepts the OpenAI `usage` shape, DeepSeek's legacy cache fields, or anything
 * providers invent; unknown shapes simply yield an empty record. */
export declare function parseTokenUsage(usage: unknown): {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
};
/** Sum usage across attempts (failover/recovery each consume tokens); identity
 * and pricing come from the last record, i.e. the attempt that produced the
 * final answer. */
export declare function aggregateTokenUsages(records: TokenUsageRecord[]): TokenUsageRecord | undefined;
/** Billing for one record. Cached tokens are a subset of input tokens and are
 * billed at the cache price; everything else at the plain input price. */
export declare function computeTokenCost(record: TokenUsageRecord): {
    inputCost: number;
    outputCost: number;
    total: number;
    saved: number;
} | undefined;
/** One human-readable log line: usage numbers, cache hit rate, and optional
 * billing. Absent fields are simply omitted instead of printed as zero. */
export declare function formatTokenUsageLine(record: TokenUsageRecord): string;
export declare function canonGuardPrompt(): string;
export declare function normalizeCanonReview(value: unknown): CanonReview;
export declare function systemPrompt(phase: NarrativeRequest['phase'], mainPrompt: string | undefined, formatPrompt: string | undefined, fixedPrompt: string, baseStylePrompt: string, storyStylePrompt: string, refreshContinuity?: boolean, alterEnabled?: boolean, agencyEnabled?: boolean, perspectiveEnabled?: boolean, outputRecovery?: boolean, chatCapabilities?: ChatActionCapabilities, hasQuotedMessage?: boolean, stickerCatalog?: StickerCatalogEntry[], schedulePreplanEnabled?: boolean, streamingReplyFirst?: boolean, cacheFirstPayload?: boolean, groupTurn?: boolean, writingOptions?: NarrativeRequest['writingOptions'], canonRecovery?: string[], narrativeRecovery?: string): string;
export declare function writingAffordances(options?: NarrativeRequest['writingOptions']): string;
export declare function storyStateForPrompt(state: NarrativeRequest['story']['state']): {
    extensions: {
        [x: string]: unknown;
    };
    automation: {
        quietUntil?: string;
        nextAdvanceAt?: string;
        timelineDirectorRefused?: boolean;
        lastAutoAdvanceAt?: string;
        lastUserMessageAt?: string;
        conversationFollowUpAt?: string[];
        conversationFollowUpParticipantId?: string;
    };
    schemaVersion?: number;
    settingOverlay: import("./types").StorySettingOverlay;
    activeSceneId?: number;
    activeArcId?: number;
    narrativeUpdateCount: number;
    lastContinuityUpdateAt?: string;
    scenePresence?: import("./types").ScenePresenceState[];
    workingDetailResolutions?: Record<string, number>;
};
export type RecentScriptOwnership = 'protagonist-narrative' | 'user-delivered-message' | 'protagonist-delivered-message' | 'external-group-message' | 'system-event';
export declare function recentScriptOwnership(entry: Pick<NarrativeRequest['recentEntries'][number], 'kind' | 'actor'>): RecentScriptOwnership;
export declare function toPromptPayload(request: NarrativeRequest, options?: {
    cacheFirst?: boolean;
}): import("./script/context-compiler").CompiledNarrativeContext;
/** Compact ownership tags for cache-first payloads: one short label replaces the
 * kind/actor/participantId triple. Distinctions the ownership label alone would
 * lose (group posting, platform actions) survive as suffixes. */
export declare function compactScriptTag(kind: string, actor: string): "system" | "user" | "protagonist(group)" | "protagonist(action)" | "protagonist" | "protagonist-narration" | "group-member";
export declare function promptVisibleMessageContent(content: string, ownership: RecentScriptOwnership): string;
export declare function compactPromptEntries(entries: NarrativeRequest['recentEntries'], characterBudget: number, protectedSince?: Date): import("./types").ScriptEntry[];
export declare function toTimelinePlanPayload(request: TimelinePlanRequest): {
    recentScriptContinuation: {
        content: string;
        occurredAt: Date;
        hostTimelineLedger?: string;
    };
    canon: {
        character: import("./types").CharacterSetting;
        perspective: string;
        world: string;
        location: string;
    };
    evolvingSetting: import("./types").StorySettingOverlay;
    interval: {
        from: string;
        now: string;
        storyTimezone: string;
        fromLocal: string;
        nowLocal: string;
        fromLocalContext: {
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
        nowLocalContext: {
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
    };
    phase: "advance" | "conversation-follow-up" | "intent-due";
    currentParticipant: {
        id: string;
        displayName: string;
    };
    activeScene: {
        hook: string;
        summary: string;
    };
    schedule: import("./types").SchedulePreplanWindow;
    dueIntents: {
        streamRecovery?: boolean;
        pendingReplyDraft?: string;
        id: number;
        type: string;
        summary: string;
        notBefore: string;
    }[];
    recentContinuity: {
        lastNarratedBeat: {
            entryId: number;
            participantId: string;
            windowEndedAt: string;
            kind: string;
            summary: string;
        };
        alreadyNarrated: {
            entryId: number;
            participantId: string;
            windowEndedAt: string;
            kind: string;
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
    facts: {
        scope: "character" | "world" | "relationship" | "event" | "promise";
        content: string;
        unresolved: boolean;
        sourceEntryIds: number[];
        lastSeenAt: Date;
        lastSeenAtLocal: {
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
    }[];
    recentEntries: {
        kind: string;
        actor: string;
        content: string;
        occurredAt: string;
    }[];
    recovery?: string;
};
export declare function toCompactionPayload(request: CompactionRequest): {
    interval: {
        from: string;
        now: string;
        fromLocal: {
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
        nowLocal: {
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
    };
    setting: {
        character: {
            name: string;
            profile: string;
        };
        user: {
            displayName: string;
            profile: string;
        };
        relationship: string;
        world: string;
        perspective: string;
        supportingCast: string;
        location: string;
        style: string;
        timezone: string;
    };
    evolvingState: {
        extensions: {
            [x: string]: unknown;
        };
        automation: {
            quietUntil?: string;
            nextAdvanceAt?: string;
            timelineDirectorRefused?: boolean;
            lastAutoAdvanceAt?: string;
            lastUserMessageAt?: string;
            conversationFollowUpAt?: string[];
            conversationFollowUpParticipantId?: string;
        };
        schemaVersion?: number;
        activeSceneId?: number;
        activeArcId?: number;
        narrativeUpdateCount: number;
        lastContinuityUpdateAt?: string;
        scenePresence?: import("./types").ScenePresenceState[];
        workingDetailResolutions?: Record<string, number>;
    };
    existingWorkingDetails: import("./types").WorkingDetail[];
    scene: import("./types").InterludeScene;
    arc: import("./types").InterludeArc;
    existingDevelopmentCandidates: {
        id: number;
        status: import("./types").StatePatchStatus;
        target: import("./types").StatePatchTarget;
        path: string;
        participantId: string;
        proposedValue: string;
        confidence: number;
        sourceEntryIds: number[];
    }[];
    deliveryReality: {
        sourceEntryId: number;
        eventId: any;
        segments: any;
    }[];
    interactionEvidence: {
        participantId: string;
        feedbackEntryId: number;
        priorCommunicationEntryId: number;
        interpretationEntryIds: number[];
        responseEntryIds: number[];
    }[];
    precedingEntries: {
        id: number;
        kind: string;
        actor: string;
        participantId: string;
        content: string;
        occurredAt: string;
    }[];
    participants: {
        unreadMessageCount: number;
        pendingReplyCount: number;
        updatedAt: string;
        personId?: string;
        openThreads?: string[];
        relationshipNotes?: string[];
        relationshipNotesAuthority?: string;
        displayName?: string;
        profile?: string;
        relationship?: string;
        relationshipOverlay?: string;
        lastUserMessageAt?: string;
        lastCharacterMessageAt?: string;
        id: string;
    }[];
    existingFacts: {
        importance: number;
        confidence: number;
        id: number;
        participantId: string;
        scope: "character" | "world" | "relationship" | "event" | "promise";
        content: string;
        unresolved: boolean;
        status: "active" | "superseded";
        sourceEntryIds: number[];
        authority: string;
        knowledge: import("./script/knowledge-evidence").KnowledgeEvidence;
    }[];
    entries: {
        narrativeAuthority?: string;
        lifeHandoff?: import("./script/life-handoff").LifeHandoff;
        proposedTimeline?: unknown;
        timelineEvidence?: unknown;
        communicationOutcome?: string;
        id: number;
        participantId: string;
        kind: string;
        actor: string;
        content: string;
        occurredAt: string;
        occurredAtLocal: {
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
    }[];
    schedulePreplanReview: {
        localDate: string;
        horizonDays: number;
        current: {
            revision: number;
            timezone: string;
            validFrom: string;
            validThrough: string;
            regimes: import("./types").SchedulePreplanRegime[];
            exceptions: import("./types").SchedulePreplanException[];
            reviewReason: string;
        };
        evidenceEntries: {
            id: number;
            kind: string;
            actor: string;
            content: string;
            occurredAt: string;
            occurredAtLocal: {
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
        }[];
    };
};
