<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import shanghaiGeoJson from "../assets/shanghai-districts.json";
import { urbanNames } from "../data/districts";
import { echarts } from "../lib/echarts";

const props = defineProps({
  districts: { type: Array, required: true },
  pois: { type: Array, required: true },
  totalCount: { type: Number, required: true },
  activeBand: { type: Number, required: true },
  selectedName: { type: String, required: true },
  loading: { type: Boolean, required: true },
  updatedAt: { type: String, required: true },
  dataModeLabel: { type: String, required: true },
  route: { type: Object, default: null },
});

const emit = defineEmits([
  "select",
  "change-band",
  "open-planner",
  "clear-route",
]);

echarts.registerMap("shanghai-osm", shanghaiGeoJson);

const mapElement = ref(null);
const mapError = ref("");
const zoomMode = ref("city");
let chart;
let resizeObserver;

const selectedDistrict = computed(
  () =>
    props.districts.find((district) => district.name === props.selectedName) ??
    props.districts[0]
);
const selectedCoverage = computed(
  () => selectedDistrict.value?.coverage?.[props.activeBand] ?? 0
);
const selectedDescription = computed(() =>
  urbanNames.has(selectedDistrict.value?.name)
    ? "中心城区 · OpenStreetMap 早餐候选"
    : "市域片区 · OpenStreetMap 早餐候选"
);

const colorStops = [
  [0, [166, 173, 146]],
  [0.38, [211, 181, 110]],
  [0.72, [232, 139, 91]],
  [1, [217, 81, 42]],
];
function interpolateColor(position) {
  const t = Math.max(0, Math.min(1, position));
  let upperIndex = colorStops.findIndex(([stop]) => stop >= t);
  if (upperIndex < 1) upperIndex = 1;
  const upper = colorStops[upperIndex];
  const lower = colorStops[upperIndex - 1];
  const local =
    upper[0] === lower[0] ? 0 : (t - lower[0]) / (upper[0] - lower[0]);
  const channel = (index) =>
    Math.round(lower[1][index] + (upper[1][index] - lower[1][index]) * local);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function districtRegions() {
  const values = props.districts.map(
    (district) => district.coverage[props.activeBand]
  );
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return props.districts.map((district) => ({
    name: district.name,
    itemStyle: {
      areaColor: interpolateColor(
        (district.coverage[props.activeBand] - minimum) /
          (maximum - minimum || 1)
      ),
      borderColor: district.name === props.selectedName ? "#1f3030" : "#fff9ef",
      borderWidth: district.name === props.selectedName ? 2.4 : 1.1,
      opacity: 0.88,
    },
    emphasis: {
      itemStyle: {
        areaColor: "#f3c5a9",
        borderColor: "#1f3030",
        borderWidth: 2,
      },
    },
  }));
}

function clusterPoiData() {
  const groups = new Map();
  props.pois
    .filter(
      (poi) =>
        Number.isFinite(Number(poi.lng)) && Number.isFinite(Number(poi.lat))
    )
    .forEach((poi) => {
      const latitudeStep = 1500 / 111000;
      const longitudeStep =
        1500 / (111000 * Math.cos((Number(poi.lat) * Math.PI) / 180));
      const key = `${Math.floor(poi.lng / longitudeStep)}:${Math.floor(
        poi.lat / latitudeStep
      )}`;
      const group = groups.get(key) || {
        count: 0,
        longitudeTotal: 0,
        latitudeTotal: 0,
        names: new Set(),
        districts: new Map(),
      };
      group.count += 1;
      group.longitudeTotal += Number(poi.lng);
      group.latitudeTotal += Number(poi.lat);
      if (poi.name && poi.name !== "未命名地点") group.names.add(poi.name);
      if (poi.district) {
        group.districts.set(
          poi.district,
          (group.districts.get(poi.district) || 0) + 1
        );
      }
      groups.set(key, group);
    });

  return [...groups.values()].map((group) => {
    const dominantDistrict =
      [...group.districts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "";
    const categoryColor =
      group.count >= 28
        ? "#d9653b"
        : group.count >= 10
          ? "#d59b43"
          : "#78866f";
    return {
      name: `${dominantDistrict}早餐候选`,
      value: [
        group.longitudeTotal / group.count,
        group.latitudeTotal / group.count,
      ],
      cluster: {
        count: group.count,
        district: dominantDistrict,
        names: [...group.names].slice(0, 4),
      },
      symbolSize: Math.min(26, 6 + Math.sqrt(group.count) * 2.8),
      itemStyle: {
        color: categoryColor,
        opacity: 0.78,
      },
    };
  });
}

function routeSeries() {
  if (!props.route?.path?.length) return [];
  const routePoints = props.route.path.map((point, index) => ({
    name: index === 0 ? "起点" : "终点",
    value: point,
    itemStyle: {
      color: index === 0 ? "#2f6954" : "#a33b27",
    },
    symbol: index === 0 ? "circle" : "pin",
    symbolSize: index === 0 ? 12 : 20,
    label: {
      show: true,
      position: index === 0 ? "bottom" : "top",
      formatter: index === 0 ? "起点" : "终点",
      color: "#1f3030",
      fontSize: 10,
    },
  }));
  const recommendations = (props.route.recommendations || []).map(
    (poi, index) => ({
      name: poi.name,
      value: [poi.lng, poi.lat],
      poi,
      itemStyle: { color: "#e45d31" },
      symbolSize: 18,
      label: {
        show: true,
        formatter: String(index + 1).padStart(2, "0"),
        color: "#fff9ef",
        fontSize: 8,
        fontWeight: 700,
      },
    })
  );
  return [
    {
      name: "通勤路线",
      type: "lines",
      coordinateSystem: "geo",
      zlevel: 5,
      data: [{ coords: props.route.path }],
      lineStyle: {
        color: "#e45d31",
        width: 3.5,
        opacity: 0.9,
        type: props.route.estimated ? "dashed" : "solid",
      },
      silent: true,
    },
    {
      name: "起点终点",
      type: "scatter",
      coordinateSystem: "geo",
      zlevel: 6,
      data: routePoints.length >= 2 ? [routePoints[0], routePoints.at(-1)] : [],
    },
    {
      name: "推荐早餐",
      type: "scatter",
      coordinateSystem: "geo",
      zlevel: 7,
      data: recommendations,
      symbol: "circle",
      itemStyle: {
        borderColor: "#fff9ef",
        borderWidth: 2,
      },
    },
  ];
}

function chartOption() {
  return {
    animationDurationUpdate: 350,
    backgroundColor: "transparent",
    aria: { enabled: true, description: "上海市早餐候选地点分布图。" },
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: "rgba(255, 249, 239, 0.97)",
      borderColor: "rgba(80, 67, 48, 0.16)",
      textStyle: { color: "#263433", fontSize: 12 },
      extraCssText: "box-shadow:0 9px 26px rgba(48,37,23,.12);",
      formatter(params) {
        const poi = params.data?.poi;
        if (poi) {
          return `<strong>${escapeHtml(poi.name)}</strong><br/>${escapeHtml(
            poi.category || "早餐候选"
          )}<br/>${escapeHtml(poi.address || poi.district || "")}`;
        }
        const cluster = params.data?.cluster;
        if (cluster) {
          const names = cluster.names.length
            ? `<br/>${cluster.names.map(escapeHtml).join("、")}`
            : "";
          return `<strong>${escapeHtml(cluster.district)}</strong><br/>早餐候选约 ${
            cluster.count
          } 个${names}`;
        }
        const district = props.districts.find(
          (item) => item.name === params.name
        );
        if (!district) return escapeHtml(params.name || "");
        return `<strong>${escapeHtml(district.name)}</strong><br/>早餐候选 ${
          district.stalls
        } · ${props.activeBand} 分覆盖 ${district.coverage[
          props.activeBand
        ].toFixed(1)}%`;
      },
    },
    geo: {
      map: "shanghai-osm",
      roam: true,
      zoom: zoomMode.value === "central" ? 2.15 : 1.05,
      center: zoomMode.value === "central" ? [121.47, 31.235] : [121.47, 31.23],
      layoutCenter: ["50%", "49%"],
      layoutSize: zoomMode.value === "central" ? "110%" : "96%",
      scaleLimit: { min: 0.8, max: 8 },
      itemStyle: {
        areaColor: "#ded6c7",
        borderColor: "#fff9ef",
        borderWidth: 1,
        shadowBlur: 18,
        shadowColor: "rgba(63, 51, 34, 0.08)",
        shadowOffsetY: 6,
      },
      label: {
        show: true,
        color: "rgba(31, 48, 48, 0.68)",
        fontFamily: "Microsoft YaHei",
        fontSize: 9,
        formatter: (params) => params.name.replace("区", ""),
      },
      emphasis: {
        label: { color: "#1f3030", fontWeight: 600 },
        itemStyle: { areaColor: "#f3c5a9" },
      },
      regions: districtRegions(),
    },
    series: [
      {
        name: "早餐候选",
        type: "scatter",
        coordinateSystem: "geo",
        zlevel: 3,
        symbolSize: 9,
        data: clusterPoiData(),
        itemStyle: {
          borderColor: "rgba(255, 249, 239, 0.92)",
          borderWidth: 1.2,
          shadowBlur: 7,
          shadowColor: "rgba(80, 54, 27, 0.14)",
        },
        emphasis: { scale: 1.8, label: { show: false } },
      },
      ...routeSeries(),
    ],
  };
}

function renderChart() {
  if (!chart) return;
  try {
    chart.setOption(chartOption(), true);
    mapError.value = "";
  } catch (error) {
    mapError.value =
      error instanceof Error ? error.message : "地图渲染失败。";
  }
}

function initializeMap() {
  if (!mapElement.value) return;
  chart = echarts.init(mapElement.value, null, { renderer: "canvas" });
  chart.on("click", (params) => {
    if (params.componentType === "geo" && params.name) {
      emit("select", params.name);
      return;
    }
    const poi = params.data?.poi;
    if (poi?.district) emit("select", poi.district);
    else if (params.data?.cluster?.district) {
      emit("select", params.data.cluster.district);
    }
  });
  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(mapElement.value);
  renderChart();
}

function fitWholeCity() {
  zoomMode.value = "city";
  renderChart();
}

function focusCentralCity() {
  zoomMode.value = "central";
  renderChart();
}

watch(
  () => [props.activeBand, props.selectedName, props.pois, props.districts],
  () => nextTick(renderChart),
  { deep: true }
);
watch(
  () => props.route,
  () => nextTick(renderChart),
  { deep: true }
);

onMounted(initializeMap);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <section class="panel map-panel" aria-labelledby="map-title">
    <div class="map-head">
      <div class="map-heading">
        <h2 id="map-title">城市早餐可达圈</h2>
        <p>
          {{ dataModeLabel }} · OpenStreetMap 早餐候选 ·
          {{ totalCount.toLocaleString("zh-CN") }} 个结果 · 地图展示
          {{ pois.length }} 个点、覆盖 {{ districts.length }} 区 ·
          {{ updatedAt }}
        </p>
      </div>
      <div class="band-switch" aria-label="步行可达时间切换">
        <button
          v-for="band in [15, 20, 30]"
          :key="band"
          type="button"
          :class="{ 'is-active': band === activeBand }"
          :aria-pressed="band === activeBand"
          @click="emit('change-band', band)"
        >
          {{ band }} 分
        </button>
      </div>
    </div>

    <div class="map-stage">
      <div
        ref="mapElement"
        class="map-canvas"
        role="img"
        aria-label="基于本地上海区界和 OpenStreetMap 早餐候选地点的地图"
      />
      <div class="map-topline">
        <span>上海市域 · 本地区界 · OpenStreetMap</span>
        <div class="map-view-actions">
          <button
            class="planner-trigger"
            type="button"
            @click="emit('open-planner')"
          >
            通勤早餐
          </button>
          <button type="button" @click="fitWholeCity">全市</button>
          <button type="button" @click="focusCentralCity">中心城区</button>
        </div>
      </div>
      <div v-if="route" class="route-status">
        <span>
          {{ route.modeLabel }} · {{ route.durationMinutes ?? "—" }} 分钟 ·
          {{ route.distanceKm }} 公里
        </span>
        <button type="button" @click="emit('clear-route')">清除路线</button>
      </div>
      <div v-if="loading" class="map-loading">
        <span aria-hidden="true" />
        正在加载 OpenStreetMap 数据
      </div>
      <div v-if="mapError" class="map-error" role="alert">
        {{ mapError }}
      </div>
    </div>

    <div class="map-legend" aria-label="地图图例">
      <div class="legend-scale">
        <span>{{ activeBand }} 分办公地点覆盖</span>
        <span>低</span>
        <i aria-hidden="true" />
        <span>高</span>
      </div>
      <div class="poi-legend" aria-label="早餐候选密度">
        <span><i class="dot breakfast" />低密度</span>
        <span><i class="dot dimsum" />中密度</span>
        <span><i class="dot coffee" />高密度</span>
      </div>
    </div>

    <div class="selected-strip" aria-live="polite">
      <div class="selected-title">
        <i aria-hidden="true" />
        <div>
          <strong>{{ selectedDistrict?.name }}</strong>
          <span>{{ selectedDescription }}</span>
        </div>
      </div>
      <div class="selected-metric">
        <strong>{{ selectedDistrict?.stalls?.toLocaleString("zh-CN") ?? 0 }}</strong>
        <span>早餐候选</span>
      </div>
      <div class="selected-metric">
        <strong>{{ selectedCoverage.toFixed(1) }}%</strong>
        <span>{{ activeBand }} 分覆盖</span>
      </div>
      <div class="selected-metric">
        <strong>{{ selectedDistrict?.arrival ?? "—" }} 分</strong>
        <span>平均步行估算</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-panel {
  min-width: 0;
  min-height: 620px;
  padding: clamp(16px, 1.2vw, 23px) clamp(16px, 1.25vw, 24px)
    clamp(13px, 1vw, 18px);
  display: flex;
  flex-direction: column;
}

.map-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
}

.map-heading {
  min-width: 0;
}

.map-heading h2 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(21px, 1.55vw, 30px);
  font-weight: 500;
  letter-spacing: 0.055em;
}

.map-heading p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: clamp(10px, 0.68vw, 13px);
  line-height: 1.4;
}

.band-switch {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-2);
}

.band-switch button {
  min-width: clamp(52px, 4vw, 76px);
  padding: 7px 11px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: clamp(10px, 0.7vw, 13px);
  cursor: pointer;
}

.band-switch button.is-active {
  background: var(--ink);
  color: var(--surface);
}

.map-stage {
  position: relative;
  flex: 1;
  min-height: 390px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 12px;
  background:
    radial-gradient(circle at 70% 20%, rgba(255, 255, 255, 0.62), transparent 34%),
    #f1eadc;
}

.map-canvas {
  width: 100%;
  height: 100%;
  min-height: 390px;
}

.map-topline {
  position: absolute;
  z-index: 10;
  top: 12px;
  left: 14px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}

.map-topline > span {
  padding: 5px 9px;
  border-radius: 6px;
  color: rgba(31, 48, 48, 0.68);
  background: rgba(255, 249, 239, 0.88);
  font-family: var(--font-serif);
  font-size: clamp(10px, 0.68vw, 13px);
  letter-spacing: 0.08em;
}

.map-view-actions {
  display: flex;
  gap: 5px;
  pointer-events: auto;
}

.map-view-actions button {
  padding: 6px 10px;
  border: 1px solid rgba(31, 48, 48, 0.14);
  border-radius: 6px;
  background: rgba(255, 249, 239, 0.94);
  color: var(--ink);
  font-size: clamp(9px, 0.62vw, 12px);
  box-shadow: 0 3px 10px rgba(48, 37, 23, 0.06);
  cursor: pointer;
}

.map-view-actions .planner-trigger {
  border-color: rgba(228, 93, 49, 0.26);
  background: var(--accent);
  color: #fff9ef;
}

.route-status {
  position: absolute;
  z-index: 12;
  top: 48px;
  left: 14px;
  padding: 7px 9px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(31, 48, 48, 0.14);
  border-radius: 7px;
  background: rgba(255, 249, 239, 0.94);
  color: var(--ink);
  font-size: clamp(9px, 0.64vw, 12px);
  box-shadow: 0 4px 14px rgba(48, 37, 23, 0.07);
}

.route-status button {
  padding: 2px 0 2px 9px;
  border: 0;
  border-left: 1px solid var(--line);
  background: transparent;
  color: var(--accent);
  font-size: inherit;
  cursor: pointer;
}

.map-loading {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ink);
  background: rgba(244, 239, 228, 0.82);
  font-size: clamp(11px, 0.76vw, 14px);
  backdrop-filter: blur(3px);
}

.map-loading span {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(228, 93, 49, 0.18);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: map-loading 800ms linear infinite;
}

@keyframes map-loading {
  to {
    transform: rotate(360deg);
  }
}

.map-error {
  position: absolute;
  z-index: 21;
  left: 50%;
  top: 50%;
  width: min(420px, calc(100% - 36px));
  padding: 14px 16px;
  border: 1px solid rgba(163, 59, 39, 0.2);
  border-radius: 10px;
  color: #8f3829;
  background: rgba(255, 249, 239, 0.96);
  box-shadow: 0 12px 32px rgba(64, 39, 25, 0.12);
  text-align: center;
  font-size: 13px;
  transform: translate(-50%, -50%);
}

.map-legend {
  padding: 10px 2px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  color: var(--muted);
  font-size: clamp(9px, 0.62vw, 12px);
}

.legend-scale,
.poi-legend,
.poi-legend span {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.legend-scale i {
  width: clamp(72px, 6vw, 106px);
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, #a6ad92, #d3b56e 52%, #e45d31);
}

.poi-legend .dot {
  width: 8px;
  height: 8px;
  border: 1px solid #fff9ef;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(31, 48, 48, 0.22);
}

.dot.breakfast {
  background: #78866f;
}

.dot.dimsum {
  background: #d59b43;
}

.dot.coffee {
  background: #d9653b;
}

.selected-strip {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) repeat(3, minmax(0, 0.76fr));
  gap: clamp(10px, 0.9vw, 17px);
  margin-top: 9px;
  padding: clamp(12px, 1vw, 18px) clamp(12px, 1vw, 18px);
  border: 1px solid rgba(80, 67, 48, 0.09);
  border-radius: 10px;
  background: rgba(247, 239, 223, 0.64);
}

.selected-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.selected-title > i {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 5px rgba(228, 93, 49, 0.12);
}

.selected-title strong {
  display: block;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(15px, 1.06vw, 20px);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-title span,
.selected-metric span {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: clamp(9px, 0.61vw, 12px);
  white-space: nowrap;
}

.selected-metric strong {
  display: block;
  color: var(--ink);
  font-size: clamp(14px, 1vw, 19px);
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1100px) {
  .map-panel {
    min-height: 560px;
  }

  .map-stage,
  .map-canvas {
    min-height: 360px;
  }
}

@media (max-width: 720px) {
  .map-head {
    align-items: stretch;
    flex-direction: column;
  }

  .band-switch {
    align-self: flex-start;
  }

  .map-stage,
  .map-canvas {
    min-height: 430px;
  }

  .map-legend {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }

  .selected-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .selected-title {
    grid-column: 1 / -1;
  }
}
</style>
