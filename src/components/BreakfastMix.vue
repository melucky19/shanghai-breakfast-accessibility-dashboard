<script setup>
import { computed } from "vue";

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  total: {
    type: Number,
    required: true,
  },
});

const normalizedItems = computed(() => {
  const total = Math.max(1, props.total);
  return props.items.map((item) => ({
    ...item,
    percentage: (item.value / total) * 100,
  }));
});

const dominantCategory = computed(() =>
  [...normalizedItems.value].sort((a, b) => b.value - a.value)[0]
);
</script>

<template>
  <section class="panel mix-panel" aria-labelledby="mix-title">
    <div class="panel-head">
      <h2 id="mix-title">早餐类型分布</h2>
      <span>按检索分类统计</span>
    </div>
    <p class="mix-summary">
      <strong>{{ total.toLocaleString("zh-CN") }}</strong>
      <span>已加载早餐 POI</span>
    </p>
    <div class="mix-track" aria-hidden="true">
      <span
        v-for="item in normalizedItems"
        :key="item.label"
        :style="{ width: `${item.percentage}%`, background: item.color }"
      />
    </div>

    <div class="type-list">
      <div
        v-for="item in normalizedItems"
        :key="item.label"
        class="type-row"
      >
        <i :style="{ background: item.color }" aria-hidden="true" />
        <span class="type-label">{{ item.label }}</span>
        <span class="type-bar" aria-hidden="true">
          <b
            :style="{
              width: `${item.percentage}%`,
              background: item.color,
            }"
          />
        </span>
        <strong>{{ item.value.toLocaleString("zh-CN") }}</strong>
        <small>{{ item.percentage.toFixed(1) }}%</small>
      </div>
    </div>

    <p v-if="dominantCategory" class="mix-insight">
      当前已加载样本以“{{ dominantCategory.label }}”为主，共
      {{ dominantCategory.value.toLocaleString("zh-CN") }} 个，占
      {{ dominantCategory.percentage.toFixed(1) }}%。
    </p>
  </section>
</template>

<style scoped>
.mix-panel {
  flex: 1 1 auto;
  min-height: 250px;
  padding: clamp(14px, 1.05vw, 20px);
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
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
  font-size: clamp(15px, 1vw, 18px);
  font-weight: 500;
}

.panel-head span {
  color: var(--muted);
  font-size: clamp(9px, 0.61vw, 12px);
  white-space: nowrap;
}

.mix-summary {
  margin: clamp(24px, 3.5vh, 48px) 0 0;
}

.mix-summary strong {
  display: block;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(36px, 2.8vw, 56px);
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.mix-summary span {
  display: block;
  margin-top: 6px;
  color: var(--muted);
  font-size: clamp(10px, 0.7vw, 13px);
}

.mix-track {
  height: clamp(11px, 0.9vh, 14px);
  margin-top: clamp(24px, 3vh, 40px);
  display: flex;
  gap: 4px;
  overflow: hidden;
  border-radius: 4px;
}

.mix-track span {
  height: 100%;
}

.type-list {
  display: grid;
  gap: clamp(12px, 1.7vh, 21px);
  margin-top: clamp(24px, 3vh, 38px);
}

.type-row {
  display: grid;
  grid-template-columns: 8px minmax(72px, 0.9fr) minmax(54px, 1.2fr) 44px 42px;
  align-items: center;
  gap: clamp(7px, 0.65vw, 11px);
  color: var(--ink);
}

.type-row > i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.type-label {
  overflow: hidden;
  color: var(--ink);
  font-size: clamp(11px, 0.74vw, 14px);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-bar {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(112, 128, 109, 0.12);
}

.type-bar b {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.type-row > strong {
  color: var(--ink);
  font-size: clamp(12px, 0.82vw, 16px);
  font-weight: 500;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.type-row > small {
  color: var(--muted);
  font-size: clamp(9px, 0.61vw, 11px);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mix-insight {
  margin: auto 0 0;
  padding-top: clamp(16px, 2vh, 24px);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: clamp(10px, 0.68vw, 13px);
  line-height: 1.65;
}
</style>
