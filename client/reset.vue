<template>
  <k-layout>
    <el-scrollbar class="reset-scroll">
      <main class="reset-page">
        <section class="reset-card">
          <p class="eyebrow">HDS INTERLUDE</p>
          <h1>一键重置故事</h1>
          <p class="lead">
            从当前 Console 配置重新建立人物与世界，清空已经运行产生的故事状态。
          </p>

          <label class="profile-picker">
            <span>要重置的角色</span>
            <select
              v-model="selectedBotId"
              :disabled="busy || !profiles.length"
            >
              <option
                v-for="profile in profiles"
                :key="profile.botId"
                :value="profile.botId"
              >
                {{ profile.characterName || "未命名角色" }}（QQ
                {{ maskBotId(profile.botId) }}）
              </option>
            </select>
          </label>

          <div class="scope-grid">
            <div>
              <h2>将被重置</h2>
              <ul>
                <li>所选角色的 Canon 与 Perspective</li>
                <li>参与者关系及其演化状态</li>
                <li>世界、场景、剧情弧线和时间线</li>
                <li>长期记忆、事实、意图与待办</li>
                <li>Overlay、Agency、Alter 和连续性快照</li>
              </ul>
            </div>
            <div class="preserved">
              <h2>不会修改</h2>
              <ul>
                <li>模型连接与 API Key</li>
                <li>OneBot / NapCat 配置</li>
                <li>图片生成与人物参考图配置</li>
                <li>当前 Console 中的 storyDefaults</li>
              </ul>
            </div>
          </div>

          <div class="warning">
            此操作无法从界面撤销。只会影响上方所选 QQ
            对应角色；人物设定会以该角色实例的 storyDefaults 为新的起点。
          </div>

          <button class="reset-button" :disabled="busy" @click="resetAll">
            {{ busy ? "正在重置…" : "一键重置所选角色故事" }}
          </button>

          <p v-if="message" class="result" :class="{ error: failed }">
            {{ message }}
          </p>
        </section>
      </main>
    </el-scrollbar>
  </k-layout>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { send } from "@koishijs/client";

interface ResetResult {
  resetStoryId?: string;
  stories: number;
  participants: number;
  records: number;
  message: string;
}

const busy = ref(false);
const failed = ref(false);
const message = ref("");
const profiles = ref<Array<{ botId: string; characterName: string }>>([]);
const selectedBotId = ref("");

function maskBotId(value: string) {
  return value.length < 5 ? "***" : `${value.slice(0, 3)}***${value.slice(-2)}`;
}

onMounted(async () => {
  try {
    profiles.value = await send("hds-interlude/reset-profiles");
    selectedBotId.value = profiles.value[0]?.botId ?? "";
  } catch (error) {
    failed.value = true;
    message.value = `无法读取角色列表：${error instanceof Error ? error.message : String(error)}`;
  }
});

async function resetAll() {
  if (busy.value) return;
  if (!selectedBotId.value) {
    failed.value = true;
    message.value = "没有可重置的 HDSI 角色实例。";
    return;
  }
  const profile = profiles.value.find(
    (item) => item.botId === selectedBotId.value,
  );
  const confirmed = window.confirm(
    `确认重置「${profile?.characterName || "当前角色"}」的 Canon、关系、剧情与记忆吗？其它角色不会受影响，模型密钥与 OneBot 配置会保留。`,
  );
  if (!confirmed) return;
  busy.value = true;
  failed.value = false;
  message.value = "";
  try {
    const result = (await send("hds-interlude/reset-all", {
      confirmation: "重置全部故事",
      botId: selectedBotId.value,
    })) as ResetResult;
    message.value = `${result.message}（处理 ${result.stories} 个故事、${result.participants} 个参与者、${result.records} 条记录）`;
  } catch (error) {
    failed.value = true;
    message.value = `重置失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.reset-scroll {
  height: 100%;
}

.reset-page {
  min-height: 100%;
  /* Koishi's desktop status bar overlays the lower edge of extension pages. */
  padding: 48px 24px;
  display: grid;
  place-items: start center;
  color: var(--fg1);
}

.reset-card {
  width: min(840px, 100%);
  padding: 36px;
  border: 1px solid var(--k-color-divider, rgba(127, 127, 127, 0.25));
  border-radius: 16px;
  background: var(--k-card-bg, rgba(127, 127, 127, 0.06));
}

.eyebrow {
  margin: 0 0 8px;
  color: #f07845;
  font-weight: 800;
  letter-spacing: 0.16em;
}

h1 {
  margin: 0;
  font-size: 30px;
}
.lead {
  margin: 12px 0 28px;
  color: var(--fg2);
  line-height: 1.7;
}

.profile-picker {
  display: grid;
  gap: 8px;
  margin: 0 0 20px;
  color: var(--fg2);
  font-weight: 700;
}

.profile-picker select {
  width: 100%;
  padding: 10px 12px;
  color: var(--fg1);
  border: 1px solid var(--k-color-divider, rgba(127, 127, 127, 0.25));
  border-radius: 8px;
  background: var(--k-card-bg, rgba(127, 127, 127, 0.06));
}

.scope-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.scope-grid > div {
  padding: 20px;
  border-radius: 12px;
  background: rgba(220, 70, 70, 0.08);
}

.scope-grid .preserved {
  background: rgba(58, 165, 105, 0.09);
}
h2 {
  margin: 0 0 12px;
  font-size: 16px;
}
ul {
  margin: 0;
  padding-left: 20px;
  color: var(--fg2);
  line-height: 1.9;
}

.warning {
  margin: 20px 0;
  padding: 14px 16px;
  border-left: 4px solid #dc4646;
  background: rgba(220, 70, 70, 0.08);
  line-height: 1.65;
}

.reset-button {
  width: 100%;
  border: 0;
  border-radius: 10px;
  padding: 14px 20px;
  background: #c83d3d;
  color: white;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.reset-button:hover:not(:disabled) {
  background: #ae3030;
}
.reset-button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.result {
  margin: 18px 0 0;
  color: #38a169;
  line-height: 1.6;
}
.result.error {
  color: #dc4646;
}

@media (max-width: 680px) {
  .reset-page {
    padding: 20px 12px;
  }
  .reset-card {
    padding: 22px;
  }
  .scope-grid {
    grid-template-columns: 1fr;
  }
}
</style>
