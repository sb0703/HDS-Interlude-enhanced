import { Context, Schema } from 'koishi';
import { Config as InterludeConfig, FullResetResult, InterludeRuntimeLogProfile, InterludeService } from './service';
declare module 'koishi' {
    interface Context {
        interlude: InterludeService;
    }
}
declare module '@koishijs/console' {
    interface Events {
        'hds-interlude/reset-profiles'(): ResetProfile[];
        'hds-interlude/reset-all'(request: ResetRequest): Promise<FullResetResult & {
            message: string;
        }>;
        'hds-interlude/runtime-logs'(): InterludeRuntimeLogProfile[];
    }
}
export declare const name = "hds-interlude";
export declare const version = "0.1.4-beta3";
export declare const reusable = true;
export declare const inject: {
    required: string[];
    optional: string[];
};
export declare const RESET_CONFIRMATION_PHRASE = "\u91CD\u7F6E\u5168\u90E8\u6545\u4E8B";
interface ResetProfile {
    botId: string;
    characterName: string;
}
interface ResetRequest {
    confirmation: string;
    botId: string;
}
export declare function resolveBotScopedTarget<T>(targets: ReadonlyMap<string, T>, selfId: unknown, fallback: T): T;
export declare function sharedCommandContext(ctx: Context): Context;
export declare const Config: Schema<InterludeConfig>;
export declare function apply(ctx: Context, config: InterludeConfig): void;
export * from './narrator';
export * from './service';
export * from './types';
