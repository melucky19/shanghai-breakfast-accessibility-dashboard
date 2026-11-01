<script setup>
import { computed } from "vue";

const props = defineProps({
  now: {
    type: Date,
    required: true,
  },
  activeBand: {
    type: Number,
    required: true,
  },
  loading: {
    type: Boolean,
    required: true,
  },
  refreshing: {
    type: Boolean,
    required: true,
  },
  errorMessage: {
    type: String,
    default: "",
  },
  lastUpdated: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(["refresh"]);

const timeText = computed(() =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(props.now)
);

const dateText = computed(() =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(props.now)
);
</script>

<template>
  <header class="dashboard-header">
    <div class="brand">
      <div class="sun-mark" aria-hidden="true"><span /></div>
      <div class="brand-copy">
        <p class="eyebrow">SHANGHAI MORNING FOOD ATLAS</p>
        <h1>上海市早餐摊点分布与上班族早餐可达性分析平台</h1>
        <p class="subtitle">
          从街角早餐到 {{ activeBand }} 分钟通勤圈，读懂一座城市醒来的方式
        </p>
      </div>
    </div>

    <div class="header-meta">
      <div class="data-status">
        <span
          class="status-dot"
          :class="{ 'is-error': errorMessage, 'is-loading': loading || refreshing }"
          aria-hidden="true"
        />
        <span v-if="loading">正在同步高德数据</span>
        <span v-else-if="errorMessage">数据更新失败</span>
        <span v-else>高德 POI 已同步 · {{ lastUpdated }}</span>
        <button type="button" :disabled="refreshing" @click="emit('refresh')">
          {{ refreshing ? "同步中" : "刷新" }}
        </button>
      </div>
      <div class="clock">
        <strong>{{ timeText }}</strong>
        <span>{{ dateText }} · 早餐分析情景</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.dashboard-header {
  min-height: clamp(78px, 8.2vh, 102px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
}

.brand {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: clamp(14px, 1.2vw, 22px);
}

.sun-mark {
  position: relative;
  width: clamp(48px, 4vw, 70px);
  height: clamp(48px, 4vw, 70px);
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: inset -10px -8px 0 rgba(255, 244, 214, 0.23);
}

.sun-mark::before,
.sun-mark::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 142%;
  height: 1px;
  background: rgba(228, 93, 49, 0.5);
  transform: translate(-50%, -50%) rotate(-12deg);
}

.sun-mark::after {
  transform: translate(-50%, -50%) rotate(78deg);
}

.sun-mark span {
  position: absolute;
  inset: 13%;
  border: 1px solid rgba(255, 248, 230, 0.7);
  border-radius: 50%;
}

.brand-copy {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--accent);
  font-family: var(--font-serif);
  font-size: clamp(10px, 0.72vw, 13px);
  font-weight: 500;
  letter-spacing: 0.2em;
}

h1 {
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(19px, 1.55vw, 30px);
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: 0.035em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle {
  margin: 7px 0 0;
  color: var(--muted);
  font-size: clamp(11px, 0.72vw, 14px);
  line-height: 1.35;
}

.header-meta {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: clamp(22px, 2vw, 38px);
}

.data-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid rgba(228, 93, 49, 0.28);
  border-radius: 999px;
  color: #8d3c20;
  background: rgba(255, 249, 239, 0.62);
  font-size: clamp(11px, 0.72vw, 14px);
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px rgba(228, 93, 49, 0.12);
}

.status-dot.is-loading {
  background: var(--mustard);
  box-shadow: 0 0 0 4px rgba(217, 157, 50, 0.12);
}

.status-dot.is-error {
  background: #a33b27;
  box-shadow: 0 0 0 4px rgba(163, 59, 39, 0.12);
}

.data-status button {
  padding: 2px 0 2px 9px;
  border: 0;
  border-left: 1px solid rgba(228, 93, 49, 0.2);
  background: transparent;
  color: var(--accent);
  font-size: inherit;
  cursor: pointer;
}

.data-status button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.clock {
  min-width: 120px;
  text-align: right;
}

.clock strong {
  display: block;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(23px, 1.65vw, 32px);
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.clock span {
  display: block;
  margin-top: 7px;
  color: var(--muted);
  font-size: clamp(10px, 0.66vw, 13px);
}

@media (max-width: 1100px) {
  .dashboard-header {
    align-items: flex-start;
    flex-wrap: wrap;
    padding-block: 6px;
  }

  .header-meta {
    width: 100%;
    justify-content: space-between;
  }
}

@media (max-width: 720px) {
  .dashboard-header {
    gap: 16px;
  }

  h1 {
    white-space: normal;
  }

  .data-status {
    display: none;
  }
}
</style>
