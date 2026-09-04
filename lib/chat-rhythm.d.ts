import { ChatRhythmConfig, ChatRhythmPrompt, ChatRhythmState, RhythmSignature } from './types';
export declare function resolveChatRhythmConfig(value?: Partial<ChatRhythmConfig>): ChatRhythmConfig;
export declare function rhythmShape(length: number): RhythmSignature['shape'][number];
export declare function rhythmTail(text: string): RhythmSignature['tail'];
export declare function extractRhythmSignature(content: string, separator?: string): RhythmSignature;
export declare function updateChatRhythm(previous: ChatRhythmState | undefined, signature: RhythmSignature, configValue?: Partial<ChatRhythmConfig>, updatedAt?: string): ChatRhythmState;
export declare function chatRhythmPrompt(state: ChatRhythmState | undefined, characterName: string): ChatRhythmPrompt | undefined;
export declare function normalizeChatRhythmState(value: unknown, configValue?: Partial<ChatRhythmConfig>): ChatRhythmState | undefined;
