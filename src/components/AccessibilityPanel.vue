<script setup>
defineProps({
  activeBand: {
    type: Number,
    required: true,
  },
  coverage: {
    type: Number,
    required: true,
  },
  coveredPlaces: {
    type: Number,
    required: true,
  },
  sampleCount: {
    type: Number,
    required: true,
  },
  distribution: {
    type: Array,
    required: true,
  },
});
</script>

<template>
  <section class="panel accessibility-panel" aria-labelledby="access-title">
    <div class="panel-head">
      <h2 id="access-title">上班族早餐可达性分析</h2>
      <span>{{ activeBand }} 分钟步行</span>
    </div>

    <div class="coverage-main">
      <p class="coverage-value">
        {{ coverage.toFixed(1) }}<span>%</span>
      </p>
      <span class="coverage-delta">真实定位估算</span>
    </div>

    <p class="coverage-caption">
      {{ coveredPlaces }} / {{ sampleCount }} 个办公地点样本可在步行圈内到达早餐 POI
    </p>

    <div class="distribution-track" aria-hidden="true">
      <i
        v-for="item in distribution"
        :key="item.key"
        :style="{ width: `${item.value}%`, background: item.color }"
      />
    </div>

    <div class="distribution-labels">
      <div v-for="item in distribution" :key="item.key">
        <span>{{ item.label }}</span>
        <strong>{{ item.value.toFixed(1) }}%</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.accessibility-panel {
  flex: 0 0 clamp(238px, 25vh, 310px);
  padding: clamp(15px, 1.15vw, 21px);
  background:
    radial-gradient(
      circle at 92% 10%,
      rgba(228, 93, 49, 0.16),
      transparent 34%
    ),
    rgba(255, 249, 239, 0.92);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-head h2 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(16px, 1.08vw, 20px);
  font-weight: 500;
  letter-spacing: 0.035em;
}

.panel-head span {
  color: var(--muted);
  font-size: clamp(9px, 0.64vw, 12px);
  white-space: nowrap;
}

.coverage-main {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: clamp(12px, 1.3vh, 20px);
}

.coverage-value {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(45px, 3.9vw, 74px);
  font-weight: 500;
  line-height: 0.88;
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
}

.coverage-value span {
  margin-left: 3px;
  color: var(--accent);
  font-family: var(--font-sans);
  font-size: 0.34em;
  vertical-align: top;
}

.coverage-delta {
  padding: 5px 9px;
  border-radius: 999px;
  color: #536350;
  background: rgba(112, 128, 109, 0.12);
  font-size: clamp(9px, 0.63vw, 12px);
  white-space: nowrap;
}

.coverage-caption {
  margin: clamp(11px, 1.2vh, 17px) 0 0;
  color: var(--muted);
  font-size: clamp(10px, 0.7vw, 13px);
  line-height: 1.5;
}

.distribution-track {
  display: flex;
  height: clamp(8px, 0.7vh, 11px);
  margin-top: clamp(16px, 1.6vh, 24px);
  overflow: hidden;
  border-radius: 3px;
}

.distribution-track i {
  height: 100%;
}

.distribution-labels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(8px, 1vh, 13px) 13px;
  margin-top: clamp(12px, 1.2vh, 18px);
  color: var(--muted);
  font-size: clamp(9px, 0.62vw, 12px);
}

.distribution-labels div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  white-space: nowrap;
}

.distribution-labels strong {
  color: var(--ink);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
</style>
