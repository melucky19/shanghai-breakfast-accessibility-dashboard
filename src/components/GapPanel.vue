<script setup>
defineProps({
  gaps: {
    type: Array,
    required: true,
  },
  selectedName: {
    type: String,
    required: true,
  },
  lastUpdated: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(["select"]);
</script>

<template>
  <section class="panel gap-panel" aria-labelledby="gap-title">
    <div class="panel-head">
      <h2 id="gap-title">可达性短板分析</h2>
      <span>覆盖与供给综合指数</span>
    </div>

    <div class="gap-summary">
      <strong>{{ gaps.length }}</strong>
      <span>个行政区进入当前关注列表</span>
    </div>

    <div v-if="gaps.length" class="gap-list">
      <button
        v-for="gap in gaps"
        :key="gap.district"
        class="gap-item"
        :class="{ 'is-active': gap.district === selectedName }"
        type="button"
        :aria-pressed="gap.district === selectedName"
        @click="emit('select', gap.district)"
      >
        <span class="gap-rank">{{ String(gap.rank).padStart(2, "0") }}</span>
        <span class="gap-copy">
          <strong>{{ gap.name }}</strong>
          <span>{{ gap.reason }}</span>
        </span>
        <span class="gap-score">{{ gap.score.toFixed(1) }}</span>
      </button>
    </div>
    <p v-else class="gap-empty">正在等待 OpenStreetMap 办公地点与早餐候选数据。</p>

    <div class="gap-footnote">
      <span>真实 POI 定位 · 距离代理计算</span>
      <span>同步于 {{ lastUpdated }}</span>
    </div>
  </section>
</template>

<style scoped>
.gap-panel {
  flex: 1 1 auto;
  min-height: 265px;
  padding: clamp(15px, 1.1vw, 20px);
  display: flex;
  flex-direction: column;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.panel-head h2 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(15px, 1.02vw, 19px);
  font-weight: 500;
  letter-spacing: 0.04em;
}

.panel-head span {
  color: var(--muted);
  font-size: clamp(9px, 0.62vw, 12px);
  white-space: nowrap;
}

.gap-summary {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin-top: clamp(11px, 1.1vh, 17px);
}

.gap-summary strong {
  color: var(--accent);
  font-family: var(--font-serif);
  font-size: clamp(26px, 2vw, 38px);
  font-weight: 500;
  line-height: 1;
}

.gap-summary span {
  color: var(--muted);
  font-size: clamp(9px, 0.64vw, 12px);
}

.gap-list {
  flex: 1;
  display: grid;
  align-content: center;
  gap: clamp(7px, 0.8vh, 11px);
  margin-top: clamp(10px, 1vh, 15px);
}

.gap-item {
  width: 100%;
  padding: clamp(8px, 0.85vh, 12px) 10px;
  display: grid;
  grid-template-columns: 25px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: rgba(234, 223, 206, 0.54);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease;
}

.gap-item:hover,
.gap-item:focus-visible {
  border-color: rgba(228, 93, 49, 0.24);
  background: rgba(228, 93, 49, 0.07);
}

.gap-item.is-active {
  border-color: rgba(228, 93, 49, 0.28);
  background: rgba(228, 93, 49, 0.085);
}

.gap-rank {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--ink);
  color: var(--surface);
  font-family: var(--font-serif);
  font-size: clamp(9px, 0.62vw, 12px);
}

.gap-copy {
  min-width: 0;
}

.gap-copy strong {
  display: block;
  overflow: hidden;
  font-size: clamp(10px, 0.72vw, 14px);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gap-copy span {
  display: block;
  overflow: hidden;
  margin-top: 3px;
  color: var(--muted);
  font-size: clamp(8px, 0.58vw, 11px);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gap-score {
  color: var(--accent);
  font-size: clamp(11px, 0.76vw, 15px);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.gap-empty {
  flex: 1;
  margin: 12px 0 0;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: clamp(10px, 0.7vw, 13px);
  text-align: center;
}

.gap-footnote {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: clamp(9px, 0.9vh, 14px);
  color: var(--muted);
  font-size: clamp(8px, 0.54vw, 10px);
}
</style>
