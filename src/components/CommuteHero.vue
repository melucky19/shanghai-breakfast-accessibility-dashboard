<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  route: {
    type: Object,
    default: null,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["start", "open"]);

const message = ref("");
const examples = [
  "六点半从梅陇中学去上海大学宝山，不想吃油的",
  "8:30 前到静安寺，想买包子，预算 15 元",
  "从人民广场到张江高科，清淡早餐，步行不超过 5 分钟",
];

const canStart = computed(() => Boolean(message.value.trim()) && !props.loading);
const firstRecommendation = computed(() => props.route?.recommendations?.[0]);

function start() {
  if (!canStart.value) return;
  emit("start", message.value.trim());
}

function useExample(example) {
  message.value = example;
}
</script>

<template>
  <section class="panel commute-hero" aria-labelledby="commute-hero-title">
    <div class="hero-copy">
      <p class="hero-eyebrow">CORE FEATURE · COMMUTE BREAKFAST</p>
      <h2 id="commute-hero-title">先说你的通勤，再替你选早餐</h2>
      <p>
        支持口语地点、中文时间、预算、口味和绕行要求。输入一句话即可规划。
      </p>
    </div>

    <div class="hero-workbench">
      <div class="hero-input-row">
        <textarea
          v-model="message"
          rows="2"
          maxlength="1200"
          placeholder="例如：我要六点半从梅陇中学去上海大学宝山，不想吃油的"
          aria-label="描述通勤和早餐需求"
          @keydown.ctrl.enter.prevent="start"
        />
        <button
          class="hero-submit"
          type="button"
          :disabled="!canStart"
          @click="start"
        >
          <span>开始规划</span>
          <small>{{ loading ? "数据准备中" : "Ctrl + Enter" }}</small>
        </button>
      </div>

      <div class="hero-examples">
        <span>试试：</span>
        <button
          v-for="example in examples"
          :key="example"
          type="button"
          @click="useExample(example)"
        >
          {{ example }}
        </button>
      </div>

      <div v-if="route" class="latest-commute">
        <span>
          最近规划 · {{ route.origin.name }} → {{ route.destination.name }}
        </span>
        <strong>
          {{ route.durationMinutes ?? "—" }} 分钟 ·
          {{ route.recommendations?.length || 0 }} 个早餐
        </strong>
        <span v-if="firstRecommendation">
          首选 {{ firstRecommendation.name }}，绕行约
          {{ firstRecommendation.detourMinutes }} 分钟
        </span>
        <button type="button" @click="emit('open')">查看文字推荐</button>
      </div>
    </div>

    <div class="hero-steps" aria-label="推荐流程">
      <span><b>01</b> 自然语言识别</span>
      <span><b>02</b> 路线与口味匹配</span>
      <span><b>03</b> 文字推荐输出</span>
    </div>
  </section>
</template>

<style scoped>
.commute-hero {
  flex: 0 0 auto;
  min-height: 154px;
  padding: clamp(14px, 1.05vw, 20px);
  display: grid;
  grid-template-columns: minmax(180px, 0.82fr) minmax(360px, 1.9fr) auto;
  align-items: center;
  gap: clamp(14px, 1.2vw, 24px);
  background:
    linear-gradient(118deg, rgba(228, 93, 49, 0.11), transparent 46%),
    rgba(255, 249, 239, 0.94);
}

.commute-hero::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 2% 50%, rgba(228, 93, 49, 0.12), transparent 22%),
    linear-gradient(90deg, transparent 63%, rgba(112, 128, 109, 0.06));
  content: "";
}

.hero-copy,
.hero-workbench,
.hero-steps {
  position: relative;
  z-index: 1;
}

.hero-eyebrow {
  margin: 0 0 5px;
  color: var(--accent);
  font-family: var(--font-serif);
  font-size: 9px;
  letter-spacing: 0.14em;
}

.hero-copy h2 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(18px, 1.35vw, 25px);
  font-weight: 500;
  line-height: 1.35;
}

.hero-copy > p:last-child {
  margin: 7px 0 0;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.55;
}

.hero-workbench {
  display: grid;
  gap: 8px;
}

.hero-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 8px;
}

.hero-input-row textarea {
  width: 100%;
  min-height: 54px;
  padding: 10px 12px;
  resize: vertical;
  border: 1px solid rgba(80, 67, 48, 0.16);
  border-radius: 10px;
  background: rgba(255, 252, 246, 0.9);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  line-height: 1.55;
  outline: none;
}

.hero-input-row textarea:focus {
  border-color: rgba(228, 93, 49, 0.55);
  box-shadow: 0 0 0 3px rgba(228, 93, 49, 0.09);
}

.hero-submit {
  min-height: 54px;
  padding: 8px 11px;
  display: grid;
  place-content: center;
  gap: 3px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #fff9ef;
  cursor: pointer;
}

.hero-submit span {
  font-size: 12px;
  font-weight: 600;
}

.hero-submit small {
  font-size: 7px;
  opacity: 0.72;
}

.hero-submit:disabled {
  cursor: wait;
  opacity: 0.55;
}

.hero-examples {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--muted);
  font-size: 8px;
}

.hero-examples > span {
  flex: 0 0 auto;
}

.hero-examples button {
  max-width: 30%;
  padding: 4px 7px;
  overflow: hidden;
  border: 1px solid rgba(80, 67, 48, 0.1);
  border-radius: 999px;
  background: rgba(247, 239, 223, 0.68);
  color: var(--muted);
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.latest-commute {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  color: var(--muted);
  font-size: 8px;
  white-space: nowrap;
}

.latest-commute strong {
  color: var(--accent);
  font-weight: 600;
}

.latest-commute span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.latest-commute button {
  padding: 3px 7px;
  border: 1px solid rgba(228, 93, 49, 0.2);
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  font-size: 8px;
  cursor: pointer;
}

.hero-steps {
  display: grid;
  gap: 7px;
  align-self: stretch;
  padding-left: 13px;
  border-left: 1px solid var(--line);
}

.hero-steps span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 8px;
  white-space: nowrap;
}

.hero-steps b {
  color: var(--accent);
  font-family: var(--font-serif);
  font-size: 10px;
  font-weight: 500;
}

@media (max-width: 1300px) {
  .commute-hero {
    grid-template-columns: minmax(160px, 0.7fr) minmax(330px, 1.65fr);
  }

  .hero-steps {
    display: none;
  }
}

@media (max-width: 760px) {
  .commute-hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .hero-input-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .hero-submit {
    min-height: 42px;
  }

  .hero-examples {
    flex-wrap: wrap;
  }

  .hero-examples button {
    max-width: 100%;
  }
}
</style>
