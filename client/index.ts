import { Context } from "@koishijs/client";
import ResetPage from "./reset.vue";
import RuntimePage from "./runtime.vue";

declare module "@koishijs/client" {
  interface Events {
    "hds-interlude/reset-profiles"(): Promise<
      Array<{ botId: string; characterName: string }>
    >;
    "hds-interlude/reset-all"(request: {
      confirmation: string;
      botId: string;
    }): Promise<{
      resetStoryId?: string;
      stories: number;
      participants: number;
      records: number;
      message: string;
    }>;
    "hds-interlude/runtime-logs"(): Promise<
      Array<{
        botId: string;
        characterName: string;
        logs: Array<{
          timestamp: number;
          level: "error" | "warn" | "info" | "debug";
          message: string;
        }>;
      }>
    >;
  }
}

export default (ctx: Context) => {
  ctx.page({
    name: "HDSI 运行监控",
    path: "/hds-interlude/runtime",
    icon: "activity:settings",
    authority: 4,
    component: RuntimePage,
  });
  ctx.page({
    name: "HDSI 重置",
    path: "/hds-interlude/reset",
    // The Console's `k-icon` uses a static registry bundled inside
    // @koishijs/client (see client/components/icons/index.ts). Any name not in
    // that registry — e.g. `activity:refresh` or `refresh-cw` — renders as an
    // empty sidebar slot. `undo` is a registered reset-style icon.
    icon: "undo",
    authority: 4,
    component: ResetPage,
  });
};
