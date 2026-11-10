<script setup>
import { nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  planCommuteRoute,
  searchPlaceCandidates,
} from "../services/public-map";
import {
  parseBreakfastChat,
  selectBreakfastRecommendations,
} from "../services/chat";
import { selectUnambiguousPlace } from "../services/place-match";

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  breakfastPois: {
    type: Array,
    required: true,
  },
  route: {
    type: Object,
    default: null,
  },
  initialMessage: {
    type: String,
    default: "",
  },
  autoStart: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close", "planned", "clear"]);

const originText = ref("人民广场");
const destinationText = ref("张江高科");
const selectedOrigin = ref(null);
const selectedDestination = ref(null);
const suggestions = reactive({ origin: [], destination: [] });
const searching = reactive({ origin: false, destination: false });
const activeField = ref("");
const mode = ref("transit");
const loading = ref(false);
const errorMessage = ref("");
const result = ref(null);
const chatMessage = ref("");
const chatBusy = ref(false);
const manualOpen = ref(false);
const activeIntent = ref({});
const assistantMessage = ref("");
const lastAutoStarted = ref("");
const debounceTimers = new Map();
const requestVersions = { origin: 0, destination: 0 };

const chatExamples = [
  "我早上 8:30 前到静安寺上班，从上海大学宝山校区出发，想在地铁沿线买包子，预算 15 元，绕行不超过 8 分钟",
  "从人民广场到张江高科，坐地铁，早餐想清淡一点，步行取餐不超过 5 分钟",
  "从上海大学宝山校区到徐家汇，想买热乎、方便带走的早餐，绕路不要超过 6 分钟",
];

const modes = [
  { value: "transit", label: "公共交通" },
  { value: "driving", label: "驾车" },
  { value: "walking", label: "步行" },
];

function fieldState(field) {
  return field === "origin"
    ? {
        text: originText,
        selected: selectedOrigin,
      }
    : {
        text: destinationText,
        selected: selectedDestination,
      };
}

function clearSuggestions(field) {
  suggestions[field] = [];
}

async function loadSuggestions(field, text = fieldState(field).text.value) {
  const keyword = text.trim();
  const selected = fieldState(field).selected;
  if (!keyword) {
    clearSuggestions(field);
    selected.value = null;
    return;
  }
  if (selected.value && selected.value.name === keyword) return;

  const version = ++requestVersions[field];
  searching[field] = true;
  try {
    const candidates = await searchPlaceCandidates(keyword, 8);
    if (requestVersions[field] !== version) return;
    suggestions[field] = candidates;
  } catch {
    if (requestVersions[field] === version) suggestions[field] = [];
  } finally {
    if (requestVersions[field] === version) searching[field] = false;
  }
}

function onLocationInput(field) {
  activeIntent.value = {};
  fieldState(field).selected.value = null;
  clearSuggestions(field);
  activeField.value = field;
  clearTimeout(debounceTimers.get(field));
  debounceTimers.set(
    field,
    window.setTimeout(() => loadSuggestions(field), 260)
  );
}

function selectCandidate(field, candidate) {
  const state = fieldState(field);
  state.selected.value = candidate;
  state.text.value = candidate.name;
  suggestions[field] = [];
  activeField.value = "";
  errorMessage.value = "";
}

function swapEndpoints() {
  const previousText = originText.value;
  const previousSelection = selectedOrigin.value;
  originText.value = destinationText.value;
  selectedOrigin.value = selectedDestination.value;
  destinationText.value = previousText;
  selectedDestination.value = previousSelection;
  suggestions.origin = [];
  suggestions.destination = [];
  errorMessage.value = "";
  activeIntent.value = {};
}

async function resolveEndpoint(field) {
  const state = fieldState(field);
  if (state.selected.value) return state.selected.value;

  const candidates = await searchPlaceCandidates(state.text.value.trim(), 8);
  const automaticCandidate = selectUnambiguousPlace(
    state.text.value.trim(),
    candidates
  );
  if (automaticCandidate) {
    state.selected.value = automaticCandidate;
    state.text.value = automaticCandidate.name;
    suggestions[field] = [];
    activeField.value = "";
    return automaticCandidate;
  }
  if (candidates.length > 1) {
    suggestions[field] = candidates;
    activeField.value = field;
    manualOpen.value = true;
    const label = field === "origin" ? "起点" : "终点";
    throw new Error(`“${state.text.value.trim()}”有多个${label}候选，请先选择一个准确地点。`);
  }
  state.selected.value = candidates[0];
  state.text.value = candidates[0].name;
  return candidates[0];
}

function setMode(value) {
  mode.value = value;
  activeIntent.value = {};
}

async function executePlan({ message = "" } = {}) {
  if (loading.value) return;
  if (!originText.value.trim() || !destinationText.value.trim()) {
    errorMessage.value = "请填写起点和终点。";
    return;
  }

  loading.value = true;
  errorMessage.value = "";
  result.value = null;

  try {
    const origin = await resolveEndpoint("origin");
    const destination = await resolveEndpoint("destination");
    const planned = await planCommuteRoute({
      originText: originText.value,
      destinationText: destinationText.value,
      origin,
      destination,
      mode: mode.value,
      breakfastPois: props.breakfastPois,
      preferences: activeIntent.value,
    });
    if (message && planned.recommendationCandidates?.length) {
      try {
        const aiResult = await selectBreakfastRecommendations({
          message,
          intent: activeIntent.value,
          candidates: planned.recommendationCandidates,
        });
        planned.recommendations = aiResult.recommendations;
        planned.aiSummary =
          aiResult.selector === "local-ranking"
            ? `模型接口不可用或额度不足，已使用本地规则解析。${aiResult.assistantMessage}`
            : aiResult.assistantMessage;
        planned.recommendationSelector = aiResult.selector;
      } catch (error) {
        planned.aiSummary =
          "模型接口暂不可用，已按绕行时间、预算和口味关键词完成本地排序。";
        planned.recommendationSelector = "local-ranking";
        planned.aiFallbackReason =
          error instanceof Error ? error.message : "模型推荐暂不可用。";
      }
    }
    result.value = planned;
    assistantMessage.value =
      planned.aiSummary ||
      (activeIntent.value.preferences?.length
        ? `已优先匹配：${activeIntent.value.preferences.join("、")}。`
        : "");
    emit("planned", planned);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "通勤路线规划失败。";
  } finally {
    loading.value = false;
  }
}

async function planRoute() {
  await executePlan();
}

function useChatExample(example) {
  chatMessage.value = example;
  errorMessage.value = "";
}

async function planFromChat() {
  const message = chatMessage.value.trim();
  if (!message || chatBusy.value || loading.value) {
    if (!message) errorMessage.value = "请先描述通勤路线和早餐偏好。";
    return;
  }

  chatBusy.value = true;
  errorMessage.value = "";
  assistantMessage.value = "";
  try {
    const intent = await parseBreakfastChat(message);
    activeIntent.value = intent;
    if (intent.originQuery) {
      originText.value = intent.originQuery;
      selectedOrigin.value = null;
      suggestions.origin = [];
    }
    if (intent.destinationQuery) {
      destinationText.value = intent.destinationQuery;
      selectedDestination.value = null;
      suggestions.destination = [];
    }
    if (["transit", "driving", "walking"].includes(intent.mode)) {
      mode.value = intent.mode;
    }
    if (intent.missingFields?.length) {
      manualOpen.value = true;
      errorMessage.value =
        "请在聊天中同时说明起点和终点，例如“从上海大学宝山校区到静安寺上班”。";
      return;
    }
    assistantMessage.value =
      intent.assistantMessage ||
      `已识别：${originText.value} → ${destinationText.value}${
        intent.preferences?.length
          ? ` · 偏好 ${intent.preferences.join("、")}`
          : ""
      }`;
    await executePlan({ message });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "聊天需求解析失败。";
  } finally {
    chatBusy.value = false;
  }
}

function clearRoute() {
  result.value = null;
  errorMessage.value = "";
  activeIntent.value = {};
  assistantMessage.value = "";
  emit("clear");
}

watch(
  () => props.route,
  (route) => {
    if (!route) result.value = null;
  }
);

watch(
  () => [props.open, props.initialMessage, props.autoStart],
  async ([open, initialMessage, autoStart]) => {
    if (!open) {
      lastAutoStarted.value = "";
      return;
    }
    if (!selectedOrigin.value) loadSuggestions("origin");
    if (!selectedDestination.value) loadSuggestions("destination");
    const message = initialMessage.trim();
    if (message) chatMessage.value = message;
    if (
      message &&
      autoStart &&
      lastAutoStarted.value !== message &&
      !chatBusy.value &&
      !loading.value
    ) {
      lastAutoStarted.value = message;
      await nextTick();
      await planFromChat();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  debounceTimers.forEach((timer) => window.clearTimeout(timer));
});
</script>

<template>
  <Transition name="planner">
    <div v-if="open" class="planner-layer" role="dialog" aria-modal="true" aria-labelledby="planner-title">
      <button class="planner-scrim" type="button" aria-label="关闭通勤早餐推荐" @click="emit('close')" />
      <aside class="planner-panel">
        <header class="planner-head">
          <div>
            <p class="planner-eyebrow">COMMUTE BREAKFAST ROUTE</p>
            <h2 id="planner-title">通勤早餐推荐</h2>
            <p>直接描述通勤路线、预算和口味，也可以手动确认起点与终点。</p>
          </div>
          <button class="close-button" type="button" aria-label="关闭" @click="emit('close')">
            ×
          </button>
        </header>

        <div class="planner-form">
          <section class="chat-request" aria-labelledby="chat-request-title">
            <div class="chat-request-head">
              <div>
                <span id="chat-request-title">AI 早餐助手</span>
                <small>智谱 GLM-4.7-Flash · 高峰期自动切换 4.5-Flash</small>
              </div>
              <span class="chat-status">
                {{
                  activeIntent.parser === "free-llm"
                    ? activeIntent.model || "模型在线"
                    : "智能解析"
                }}
              </span>
            </div>
            <textarea
              v-model="chatMessage"
              rows="4"
              maxlength="1200"
              placeholder="例如：我 8:30 前到静安寺上班，从上海大学宝山校区出发，想在地铁沿线买包子，预算 15 元，绕行不超过 8 分钟。"
              @keydown.ctrl.enter.prevent="planFromChat"
            />
            <div class="chat-examples" aria-label="聊天示例">
              <button
                v-for="example in chatExamples"
                :key="example"
                type="button"
                @click="useChatExample(example)"
              >
                {{ example.slice(0, 18) }}…
              </button>
            </div>
            <button
              class="chat-primary"
              type="button"
              :disabled="chatBusy || loading"
              @click="planFromChat"
            >
              {{ chatBusy ? "正在理解需求…" : "让 AI 解析并推荐早餐" }}
            </button>
            <p v-if="assistantMessage" class="assistant-message">
              {{ assistantMessage }}
            </p>
          </section>

          <details
            class="manual-adjust"
            :open="manualOpen"
            @toggle="manualOpen = $event.currentTarget.open"
          >
            <summary>
              <span>手动调整起点、终点和通勤方式</span>
              <small>可选</small>
            </summary>
            <div class="manual-adjust-body">
          <div class="location-field">
            <label for="origin-input">起点</label>
            <div class="input-wrap">
              <input
                id="origin-input"
                v-model="originText"
                type="text"
                placeholder="例如：上海大学（宝山）"
                autocomplete="off"
                @input="onLocationInput('origin')"
                @focus="activeField = 'origin'"
              />
              <button
                v-if="originText"
                class="clear-input"
                type="button"
                aria-label="清空起点"
                @click="originText = ''; selectedOrigin = null; suggestions.origin = []"
              >
                ×
              </button>
            </div>
            <div
              v-if="selectedOrigin"
              class="selected-place"
            >
              已选：{{ selectedOrigin.district }} · {{ selectedOrigin.address || selectedOrigin.name }}
            </div>
            <div v-if="activeField === 'origin' && (searching.origin || suggestions.origin.length)" class="candidate-box">
              <p v-if="searching.origin">正在搜索起点候选…</p>
              <button
                v-for="candidate in suggestions.origin"
                v-else
                :key="candidate.id"
                type="button"
                @click="selectCandidate('origin', candidate)"
              >
                <strong>{{ candidate.name }}</strong>
                <span>{{ candidate.district }} · {{ candidate.address || candidate.type }}</span>
              </button>
            </div>
          </div>

          <div class="location-field">
            <label for="destination-input">终点</label>
            <div class="input-wrap">
              <input
                id="destination-input"
                v-model="destinationText"
                type="text"
                placeholder="例如：张江高科"
                autocomplete="off"
                @input="onLocationInput('destination')"
                @focus="activeField = 'destination'"
              />
              <button
                v-if="destinationText"
                class="clear-input"
                type="button"
                aria-label="清空终点"
                @click="destinationText = ''; selectedDestination = null; suggestions.destination = []"
              >
                ×
              </button>
            </div>
            <div
              v-if="selectedDestination"
              class="selected-place"
            >
              已选：{{ selectedDestination.district }} · {{ selectedDestination.address || selectedDestination.name }}
            </div>
            <div v-if="activeField === 'destination' && (searching.destination || suggestions.destination.length)" class="candidate-box">
              <p v-if="searching.destination">正在搜索终点候选…</p>
              <button
                v-for="candidate in suggestions.destination"
                v-else
                :key="candidate.id"
                type="button"
                @click="selectCandidate('destination', candidate)"
              >
                <strong>{{ candidate.name }}</strong>
                <span>{{ candidate.district }} · {{ candidate.address || candidate.type }}</span>
              </button>
            </div>
          </div>

          <button class="swap-button" type="button" @click="swapEndpoints">
            ↑↓ 交换起点与终点
          </button>

          <div class="mode-field">
            <span>通勤方式</span>
            <div role="group" aria-label="通勤方式">
              <button
                v-for="item in modes"
                :key="item.value"
                type="button"
                :class="{ 'is-active': mode === item.value }"
                :aria-pressed="mode === item.value"
                @click="setMode(item.value)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>

          <div class="planner-actions">
            <button class="primary-action" type="button" :disabled="loading" @click="planRoute">
              {{ loading ? "正在规划真实路线…" : "使用当前地点规划" }}
            </button>
            <button
              v-if="route"
              class="secondary-action"
              type="button"
              @click="clearRoute"
            >
              清除路线
            </button>
          </div>
            </div>
          </details>
        </div>

        <p v-if="errorMessage" class="planner-error" role="alert">
          {{ errorMessage }}
        </p>

        <section v-if="result" class="planner-result" aria-live="polite">
          <div class="route-summary">
            <div>
              <span>路线</span>
              <strong>{{ result.origin.name }} → {{ result.destination.name }}</strong>
            </div>
            <div class="route-metrics">
              <span>{{ result.modeLabel }}</span>
              <strong>{{ result.durationMinutes ?? "—" }} 分钟</strong>
              <span>{{ result.distanceKm }} 公里</span>
            </div>
          </div>

          <section class="text-recommendation" aria-labelledby="text-recommendation-title">
            <div class="text-recommendation-head">
              <span id="text-recommendation-title">文字推荐</span>
              <small>{{ result.recommendationSelector === "free-llm" ? "智谱整理" : "本地规则整理" }}</small>
            </div>
            <p>
              {{ assistantMessage || "已根据路线、绕行时间和早餐偏好完成排序。" }}
            </p>
            <ol v-if="result.recommendations.length">
              <li
                v-for="poi in result.recommendations"
                :key="`text-${poi.id}`"
              >
                <strong>{{ poi.name }}</strong>
                <span>
                  {{ poi.aiReason || poi.matchReasons?.join("、") || "绕行时间和综合排序较合适" }}；
                  距路线约 {{ poi.routeDistance }} 米，早餐绕行约
                  {{ poi.detourMinutes }} 分钟，含早餐全程约
                  {{ poi.totalMinutes }} 分钟。
                </span>
              </li>
            </ol>
          </section>

          <div class="result-title">
            <div>
              <h3>路线附近早餐</h3>
              <p>按绕行时间、预算、口味偏好与评分综合排序</p>
            </div>
            <span>{{ result.recommendations.length }} 个推荐</span>
          </div>

          <div v-if="result.recommendations.length" class="recommendation-list">
            <article
              v-for="(poi, index) in result.recommendations"
              :key="poi.id"
              class="recommendation-item"
            >
              <span class="recommendation-index">{{ String(index + 1).padStart(2, "0") }}</span>
              <div class="recommendation-copy">
                <strong>{{ poi.name }}</strong>
                <span>{{ poi.category }} · {{ poi.address || poi.district }}</span>
                <small>
                  距路线 {{ poi.routeDistance }} 米
                  <template v-if="poi.rating"> · 评分 {{ poi.rating.toFixed(1) }}</template>
                </small>
                <small v-if="poi.aiReason || poi.matchReasons?.length" class="match-reason">
                  {{ poi.aiReason || poi.matchReasons.join(" · ") }}
                </small>
              </div>
              <div class="recommendation-time">
                <strong>+{{ poi.detourMinutes }} 分</strong>
                <span>全程约 {{ poi.totalMinutes }} 分</span>
              </div>
            </article>
          </div>

          <p v-else class="empty-result">
            这条路线附近暂未找到满足距离条件的早餐 POI，可以尝试更换起终点或通勤方式。
          </p>

          <p class="method-note">
            聊天需求由智谱 GLM-4.7-Flash 或本地规则解析；地点、路线和早餐 POI 仍使用真实地图数据。
            绕行时间按“路线垂直距离 × 往返 ÷ 75 米/分钟”估算，未包含排队等待时间。
          </p>
        </section>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.planner-layer {
  position: fixed;
  z-index: 1000;
  inset: 0;
  pointer-events: none;
}

.planner-scrim {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(31, 48, 48, 0.18);
  pointer-events: auto;
  cursor: pointer;
}

.planner-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: min(470px, calc(100vw - 32px));
  padding: clamp(18px, 1.35vw, 24px);
  display: flex;
  flex-direction: column;
  overflow: auto;
  border: 1px solid rgba(80, 67, 48, 0.16);
  border-radius: 18px;
  background:
    radial-gradient(circle at 100% 0, rgba(228, 93, 49, 0.14), transparent 26%),
    #fff9ef;
  box-shadow: 0 22px 70px rgba(48, 34, 20, 0.24);
  pointer-events: auto;
}

.planner-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
}

.planner-eyebrow {
  margin: 0 0 5px;
  color: var(--accent);
  font-family: var(--font-serif);
  font-size: 10px;
  letter-spacing: 0.18em;
}

.planner-head h2 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(25px, 1.75vw, 34px);
  font-weight: 500;
}

.planner-head p:last-child {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.close-button {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: rgba(247, 239, 223, 0.72);
  color: var(--ink);
  font-size: 23px;
  line-height: 1;
  cursor: pointer;
}

.planner-form {
  margin-top: 20px;
  display: grid;
  gap: 13px;
}

.chat-request {
  display: grid;
  gap: 10px;
  padding: 13px;
  border: 1px solid rgba(228, 93, 49, 0.2);
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(228, 93, 49, 0.09), transparent 62%),
    rgba(255, 249, 239, 0.72);
}

.chat-request-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.chat-request-head > div {
  display: grid;
  gap: 3px;
}

.chat-request-head > div > span {
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
}

.chat-request-head small {
  color: var(--muted);
  font-size: 9px;
  line-height: 1.45;
}

.chat-status {
  padding: 4px 7px;
  border: 1px solid rgba(228, 93, 49, 0.22);
  border-radius: 999px;
  background: rgba(255, 249, 239, 0.7);
  color: var(--accent);
  font-size: 8px;
  white-space: nowrap;
}

.chat-request textarea {
  width: 100%;
  min-height: 84px;
  padding: 10px 11px;
  resize: vertical;
  border: 1px solid rgba(80, 67, 48, 0.16);
  border-radius: 9px;
  background: rgba(255, 252, 246, 0.86);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  outline: none;
}

.chat-request textarea:focus {
  border-color: rgba(228, 93, 49, 0.55);
  box-shadow: 0 0 0 3px rgba(228, 93, 49, 0.09);
}

.chat-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.chat-examples button {
  max-width: 100%;
  padding: 5px 8px;
  overflow: hidden;
  border: 1px solid rgba(80, 67, 48, 0.1);
  border-radius: 999px;
  background: rgba(247, 239, 223, 0.68);
  color: var(--muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.chat-examples button:hover,
.chat-examples button:focus-visible {
  border-color: rgba(228, 93, 49, 0.34);
  color: var(--accent);
}

.chat-primary {
  min-height: 42px;
  border: 0;
  border-radius: 9px;
  background: var(--ink);
  color: var(--surface);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.chat-primary:disabled {
  cursor: wait;
  opacity: 0.68;
}

.assistant-message {
  margin: 0;
  padding: 8px 9px;
  border-left: 2px solid var(--accent);
  background: rgba(247, 239, 223, 0.58);
  color: var(--muted);
  font-size: 10px;
  line-height: 1.55;
}

.manual-adjust {
  border-top: 1px solid var(--line);
  color: var(--muted);
}

.manual-adjust summary {
  padding: 10px 2px 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 10px;
  cursor: pointer;
  list-style: none;
}

.manual-adjust summary::-webkit-details-marker {
  display: none;
}

.manual-adjust summary::before {
  content: "＋";
  color: var(--accent);
}

.manual-adjust[open] summary::before {
  content: "－";
}

.manual-adjust summary span {
  flex: 1;
}

.manual-adjust summary small {
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 8px;
}

.manual-adjust-body {
  padding: 6px 0 2px;
  display: grid;
  gap: 13px;
  opacity: 0.9;
}

.location-field,
.mode-field {
  position: relative;
  display: grid;
  gap: 7px;
  color: var(--muted);
  font-size: 11px;
}

.location-field label,
.mode-field > span {
  font-size: 11px;
}

.input-wrap {
  position: relative;
}

.input-wrap input {
  width: 100%;
  min-height: 45px;
  padding: 10px 38px 10px 13px;
  border: 1px solid rgba(80, 67, 48, 0.16);
  border-radius: 9px;
  background: rgba(247, 239, 223, 0.55);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  outline: none;
}

.input-wrap input:focus {
  border-color: rgba(228, 93, 49, 0.55);
  box-shadow: 0 0 0 3px rgba(228, 93, 49, 0.09);
}

.clear-input {
  position: absolute;
  top: 50%;
  right: 9px;
  width: 25px;
  height: 25px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  transform: translateY(-50%);
  cursor: pointer;
}

.selected-place {
  overflow: hidden;
  color: #536350;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candidate-box {
  max-height: 185px;
  padding: 5px;
  overflow: auto;
  border: 1px solid rgba(80, 67, 48, 0.13);
  border-radius: 9px;
  background: #fbf3e7;
  box-shadow: 0 9px 24px rgba(58, 40, 22, 0.08);
}

.candidate-box p {
  margin: 7px 8px;
  color: var(--muted);
  font-size: 11px;
}

.candidate-box button {
  width: 100%;
  padding: 8px;
  display: grid;
  gap: 3px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.candidate-box button:hover,
.candidate-box button:focus-visible {
  background: rgba(228, 93, 49, 0.07);
}

.candidate-box strong {
  font-size: 12px;
  font-weight: 500;
}

.candidate-box span {
  overflow: hidden;
  color: var(--muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.swap-button {
  justify-self: end;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-size: 10px;
  cursor: pointer;
}

.mode-field > div {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: rgba(247, 239, 223, 0.55);
}

.mode-field button {
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}

.mode-field button.is-active {
  background: var(--ink);
  color: var(--surface);
}

.planner-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.primary-action,
.secondary-action {
  min-height: 44px;
  padding: 10px 14px;
  border-radius: 9px;
  font-size: 13px;
  cursor: pointer;
}

.primary-action {
  flex: 1;
  border: 0;
  background: var(--accent);
  color: #fff9ef;
  font-weight: 500;
}

.primary-action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.secondary-action {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
}

.planner-error {
  margin: 14px 0 0;
  padding: 10px 12px;
  border: 1px solid rgba(163, 59, 39, 0.18);
  border-radius: 8px;
  background: rgba(163, 59, 39, 0.06);
  color: #8f3829;
  font-size: 12px;
  line-height: 1.5;
}

.planner-result {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

.route-summary {
  padding: 14px;
  border-radius: 11px;
  background: rgba(234, 223, 206, 0.52);
}

.route-summary > div:first-child span,
.route-metrics span {
  color: var(--muted);
  font-size: 10px;
}

.route-summary > div:first-child strong {
  display: block;
  margin-top: 5px;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.45;
}

.route-metrics {
  margin-top: 12px;
  padding-top: 10px;
  display: flex;
  align-items: baseline;
  gap: 9px;
  border-top: 1px solid var(--line);
}

.route-metrics strong {
  color: var(--accent);
  font-family: var(--font-serif);
  font-size: 25px;
  font-weight: 500;
}

.text-recommendation {
  margin-top: 11px;
  padding: 13px 14px;
  border: 1px solid rgba(80, 67, 48, 0.11);
  border-radius: 10px;
  background: rgba(255, 252, 246, 0.72);
}

.text-recommendation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.text-recommendation-head > span {
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: 13px;
  font-weight: 600;
}

.text-recommendation-head small {
  color: var(--accent);
  font-size: 8px;
}

.text-recommendation > p {
  margin: 8px 0 0;
  color: var(--ink);
  font-size: 11px;
  line-height: 1.65;
}

.text-recommendation ol {
  margin: 9px 0 0;
  padding-left: 20px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.65;
}

.text-recommendation li + li {
  margin-top: 7px;
}

.text-recommendation li strong {
  color: var(--ink);
  font-weight: 600;
}

.text-recommendation li span {
  display: block;
  margin-top: 2px;
}

.result-title {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 12px;
  margin-top: 18px;
}

.result-title h3 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 500;
}

.result-title p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 10px;
}

.result-title > span {
  color: var(--muted);
  font-size: 10px;
  white-space: nowrap;
}

.recommendation-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.recommendation-item {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(80, 67, 48, 0.09);
  border-radius: 9px;
  background: rgba(247, 239, 223, 0.52);
}

.recommendation-index {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--ink);
  color: var(--surface);
  font-family: var(--font-serif);
  font-size: 9px;
}

.recommendation-copy {
  min-width: 0;
}

.recommendation-copy strong {
  display: block;
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recommendation-copy span,
.recommendation-copy small {
  display: block;
  overflow: hidden;
  margin-top: 3px;
  color: var(--muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recommendation-copy .match-reason {
  color: var(--accent);
}

.recommendation-time {
  text-align: right;
}

.recommendation-time strong {
  display: block;
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.recommendation-time span {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 8px;
  white-space: nowrap;
}

.empty-result {
  margin-top: 12px;
  padding: 14px;
  border-radius: 9px;
  background: rgba(234, 223, 206, 0.52);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.method-note {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.55;
}

.planner-enter-active,
.planner-leave-active {
  transition: opacity 220ms ease;
}

.planner-enter-active .planner-panel,
.planner-leave-active .planner-panel {
  transition: transform 260ms ease;
}

.planner-enter-from,
.planner-leave-to {
  opacity: 0;
}

.planner-enter-from .planner-panel,
.planner-leave-to .planner-panel {
  transform: translateX(28px);
}

@media (max-width: 720px) {
  .planner-panel {
    inset: 8px;
    width: auto;
    border-radius: 14px;
  }
}
</style>
