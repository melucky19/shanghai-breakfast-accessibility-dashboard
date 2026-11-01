<script setup>
defineProps({
  totalStalls: {
    type: Number,
    required: true,
  },
  officeSamples: {
    type: Number,
    required: true,
  },
  lastUpdated: {
    type: String,
    required: true,
  },
  loading: {
    type: Boolean,
    required: true,
  },
  dataModeLabel: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <section class="panel supply-overview" aria-labelledby="supply-title">
    <p id="supply-title" class="section-kicker">
      高德实时供给
      <small>{{ dataModeLabel }}</small>
    </p>
    <p class="hero-number">
      {{ loading ? "—" : totalStalls.toLocaleString("zh-CN") }}
      <small>个早餐 POI</small>
    </p>
    <div class="metric-line">
      <div>
        <span>数据来源</span>
        <strong>高德地图</strong>
      </div>
      <div>
        <span>办公地点样本</span>
        <strong>{{ loading ? "—" : officeSamples.toLocaleString("zh-CN") }}</strong>
      </div>
      <div>
        <span>最近同步</span>
        <strong>{{ lastUpdated }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.supply-overview {
  flex: 0 0 clamp(210px, 26vh, 320px);
  padding: clamp(16px, 1.15vw, 22px);
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.section-kicker {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--accent);
  font-size: clamp(10px, 0.7vw, 13px);
  font-weight: 500;
  letter-spacing: 0.16em;
}

.section-kicker::before {
  content: "";
  width: 22px;
  height: 2px;
  background: var(--accent);
}

.section-kicker small {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: clamp(8px, 0.56vw, 10px);
  font-weight: 400;
  letter-spacing: 0;
  white-space: nowrap;
}

.hero-number {
  margin: clamp(10px, 1vh, 16px) 0 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(38px, 3vw, 58px);
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
}

.hero-number small {
  margin-left: 7px;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: clamp(10px, 0.68vw, 13px);
  font-weight: 400;
  letter-spacing: 0;
}

.metric-line {
  display: grid;
  grid-template-columns: 0.8fr 0.8fr 1.35fr;
  gap: 10px;
  margin-top: clamp(15px, 1.4vh, 22px);
  padding-top: clamp(12px, 1vh, 17px);
  border-top: 1px solid var(--line);
}

.metric-line span {
  display: block;
  color: var(--muted);
  font-size: clamp(9px, 0.62vw, 12px);
  line-height: 1.25;
  white-space: nowrap;
}

.metric-line strong {
  display: block;
  margin-top: 4px;
  color: var(--ink);
  font-size: clamp(13px, 0.9vw, 17px);
  font-weight: 500;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
