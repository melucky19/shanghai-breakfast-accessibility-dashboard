<script setup>
import { computed } from "vue";

const props = defineProps({
  pois: {
    type: Array,
    required: true,
  },
  districts: {
    type: Array,
    required: true,
  },
  totalCount: {
    type: Number,
    required: true,
  },
  dataModeLabel: {
    type: String,
    required: true,
  },
  lastUpdated: {
    type: String,
    required: true,
  },
  complete: {
    type: Boolean,
    required: true,
  },
});

const coveredDistricts = computed(
  () => new Set(props.pois.map((poi) => poi.district)).size
);

const categoryCount = computed(
  () => new Set(props.pois.map((poi) => poi.category)).size
);

const validCoordinates = computed(() => {
  if (props.pois.length === 0) return 0;
  const valid = props.pois.filter(
    (poi) =>
      Number.isFinite(Number(poi.lng)) &&
      Number.isFinite(Number(poi.lat))
  ).length;
  return Number(((valid / props.pois.length) * 100).toFixed(1));
});

const averagePoints = computed(() =>
  coveredDistricts.value > 0
    ? Math.round(props.pois.length / coveredDistricts.value)
    : 0
);

const loadedRatio = computed(() => {
  if (props.totalCount === 0) return 0;
  return Math.min(
    100,
    Number(((props.pois.length / props.totalCount) * 100).toFixed(1))
  );
});
</script>

<template>
  <section class="panel coverage-quality" aria-labelledby="coverage-quality-title">
    <div class="panel-head">
      <h2 id="coverage-quality-title">供给覆盖质量</h2>
      <span>{{ dataModeLabel }}</span>
    </div>

    <div class="quality-grid">
      <div>
        <span>行政区覆盖</span>
        <strong>{{ coveredDistricts }}<small>/ {{ districts.length }}</small></strong>
      </div>
      <div>
        <span>早餐类型</span>
        <strong>{{ categoryCount }}<small>类</small></strong>
      </div>
      <div>
        <span>有效坐标</span>
        <strong>{{ validCoordinates }}<small>%</small></strong>
      </div>
      <div>
        <span>每区已加载</span>
        <strong>{{ averagePoints.toLocaleString("zh-CN") }}<small>点</small></strong>
      </div>
    </div>

    <div class="quality-progress">
      <div>
        <span>{{ complete ? "点位加载完整度" : "缓存数据载入" }}</span>
        <strong>{{ complete ? `${loadedRatio.toFixed(1)}%` : "完成" }}</strong>
      </div>
      <div
        class="quality-track"
        role="progressbar"
        aria-label="早餐 POI 点位加载完整度"
        :aria-valuenow="complete ? loadedRatio : 100"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i :style="{ width: `${complete ? loadedRatio : 100}%` }" />
      </div>
    </div>

    <p class="quality-note">
      数据来自 OpenStreetMap 公共地图数据，最近同步于 {{ lastUpdated }}。
    </p>
  </section>
</template>

<style scoped>
.coverage-quality {
  flex: 0 0 clamp(190px, 21vh, 250px);
  padding: clamp(14px, 1.05vw, 20px);
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
}

.panel-head span {
  color: var(--muted);
  font-size: clamp(9px, 0.61vw, 11px);
  white-space: nowrap;
}

.quality-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(12px, 1.6vh, 19px) 18px;
  margin-top: clamp(18px, 2.3vh, 28px);
}

.quality-grid span {
  display: block;
  color: var(--muted);
  font-size: clamp(9px, 0.62vw, 12px);
}

.quality-grid strong {
  display: block;
  margin-top: 5px;
  color: var(--ink);
  font-size: clamp(19px, 1.35vw, 25px);
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.quality-grid small {
  margin-left: 3px;
  color: var(--muted);
  font-size: 0.5em;
  font-weight: 400;
}

.quality-progress {
  margin-top: auto;
  padding-top: clamp(12px, 1.6vh, 18px);
}

.quality-progress > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--muted);
  font-size: clamp(9px, 0.62vw, 11px);
}

.quality-progress strong {
  color: var(--ink);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.quality-track {
  height: 7px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(112, 128, 109, 0.13);
}

.quality-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--olive), var(--mustard), var(--accent));
}

.quality-note {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: clamp(8px, 0.56vw, 10px);
  line-height: 1.45;
}
</style>
