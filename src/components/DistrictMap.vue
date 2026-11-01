<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import shanghaiGeoJson from "../assets/shanghai-districts.json";
import { urbanNames } from "../data/districts";
import { loadAmap } from "../services/amap";

const props = defineProps({
  districts: {
    type: Array,
    required: true,
  },
  pois: {
    type: Array,
    required: true,
  },
  totalCount: {
    type: Number,
    required: true,
  },
  activeBand: {
    type: Number,
    required: true,
  },
  selectedName: {
    type: String,
    required: true,
  },
  loading: {
    type: Boolean,
    required: true,
  },
  updatedAt: {
    type: String,
    required: true,
  },
  dataModeLabel: {
    type: String,
    required: true,
  },
  route: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits([
  "select",
  "change-band",
  "open-planner",
  "clear-route",
]);

const mapElement = ref(null);
const mapError = ref("");
let map;
let infoWindow;
let resizeObserver;
let poiMarkers = [];
let poiMassMarks;
let routePolyline;
let routeMarkers = [];
const districtPolygons = new Map();
const districtLabels = [];

const outerLabelNames = new Set([
  "崇明区",
  "嘉定区",
  "宝山区",
  "浦东新区",
  "闵行区",
  "青浦区",
  "松江区",
  "金山区",
  "奉贤区",
]);

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
    ? "中心城区 · 高德早餐 POI 服务节点"
    : "市域片区 · 高德早餐 POI 服务节点"
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

function coverageColor(value, minimum, maximum) {
  return interpolateColor((value - minimum) / (maximum - minimum || 1));
}

function polygonRings(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon);
  }
  return [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createDistrictPolygons(AMap) {
  const coverageValues = props.districts.map(
    (district) => district.coverage[props.activeBand]
  );
  const minimum = Math.min(...coverageValues);
  const maximum = Math.max(...coverageValues);

  shanghaiGeoJson.features.forEach((feature) => {
    const name = feature.properties.name;
    const district = props.districts.find((item) => item.name === name);
    if (!district) return;

    const pathsForFeature = [];
    polygonRings(feature.geometry).forEach((ring) => {
      const polygon = new AMap.Polygon({
        path: ring,
        strokeColor: "#fff9ef",
        strokeWeight: 1.2,
        fillColor: coverageColor(
          district.coverage[props.activeBand],
          minimum,
          maximum
        ),
        fillOpacity: 0.34,
        bubble: true,
        cursor: "pointer",
        zIndex: 2,
      });
      polygon.on("click", () => emit("select", name));
      polygon.setMap(map);
      pathsForFeature.push(polygon);
    });
    districtPolygons.set(name, pathsForFeature);
  });

  props.districts
    .filter((district) => outerLabelNames.has(district.name))
    .forEach((district) => {
      const label = new AMap.Text({
        text: district.shortName,
        position: district.center,
        anchor: "center",
        zIndex: 5,
        style: {
          border: "none",
          background: "transparent",
          color: "rgba(31,48,48,.74)",
          fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
          fontSize: "12px",
          fontWeight: "500",
          textShadow: "0 1px 2px rgba(255,249,239,.95)",
          padding: "1px 3px",
        },
      });
      label.setMap(map);
      districtLabels.push(label);
    });
}

function updateDistrictStyles() {
  if (districtPolygons.size === 0) return;
  const coverageValues = props.districts.map(
    (district) => district.coverage[props.activeBand]
  );
  const minimum = Math.min(...coverageValues);
  const maximum = Math.max(...coverageValues);

  props.districts.forEach((district) => {
    const polygons = districtPolygons.get(district.name) ?? [];
    const selected = district.name === props.selectedName;
    polygons.forEach((polygon) => {
      polygon.setOptions({
        fillColor: coverageColor(
          district.coverage[props.activeBand],
          minimum,
          maximum
        ),
        fillOpacity: selected ? 0.56 : 0.34,
        strokeColor: selected ? "#1f3030" : "#fff9ef",
        strokeWeight: selected ? 2.2 : 1.2,
        zIndex: selected ? 4 : 2,
      });
    });
  });
}

function createPoiOverlay(AMap) {
  infoWindow = new AMap.InfoWindow({
    isCustom: false,
    autoMove: true,
    offset: new AMap.Pixel(0, -8),
  });
  updatePoiOverlay();
}

function updatePoiOverlay() {
  if (!map || !window.AMap || !infoWindow) return;
  poiMarkers.forEach((marker) => marker.setMap(null));
  poiMarkers = [];
  poiMassMarks?.setMap(null);
  poiMassMarks = undefined;

  const showPoiDetails = (poi) => {
    infoWindow.setContent(`
      <div style="min-width:220px;padding:3px 2px;color:#1f3030;font-family:'Microsoft YaHei UI','PingFang SC',sans-serif">
        <strong style="font-size:15px">${escapeHtml(poi.name)}</strong>
        <div style="margin-top:7px;color:#7d766a;font-size:12px;line-height:1.6">
          <div>${escapeHtml(poi.category)} · ${escapeHtml(poi.district)}</div>
          <div>${escapeHtml(poi.address || "地址未提供")}</div>
          <div>高德 POI ID：${escapeHtml(poi.id)}</div>
        </div>
      </div>
    `);
    infoWindow.open(map, [poi.lng, poi.lat]);
  };

  if (props.pois.length > 1200 && window.AMap.MassMarks) {
    poiMassMarks = new window.AMap.MassMarks(
      props.pois.map((poi) => ({
        lnglat: [poi.lng, poi.lat],
        style: 0,
        poi,
      })),
      {
        style: {
          url: "https://webapi.amap.com/images/mass/mass0.png",
          anchor: new window.AMap.Pixel(5, 5),
          size: new window.AMap.Size(10, 10),
        },
        zooms: [8, 20],
        cursor: "pointer",
        zIndex: 12,
      }
    );
    poiMassMarks.setMap(map);
    poiMassMarks.on("click", (event) => {
      if (event.data?.poi) showPoiDetails(event.data.poi);
    });
    return;
  }

  const categoryColors = {
    早餐服务: "#e45d31",
    中式面点: "#d99d32",
    咖啡烘焙: "#70806d",
  };

  poiMarkers = props.pois.map((poi) => {
    const marker = new window.AMap.CircleMarker({
      center: [poi.lng, poi.lat],
      radius: 4,
      strokeColor: "#fff9ef",
      strokeWeight: 1.4,
      fillColor: categoryColors[poi.category] ?? "#e45d31",
      fillOpacity: 0.88,
      zIndex: 12,
      cursor: "pointer",
    });
    marker.on("click", () => showPoiDetails(poi));
    marker.setMap(map);
    return marker;
  });
}

function fitWholeCity() {
  if (!map) return;
  const overlays = [...districtPolygons.values()].flat();
  if (overlays.length > 0) {
    map.setFitView(overlays, false, [42, 42, 42, 42], 12);
  } else {
    map.setZoomAndCenter(10, [121.47, 31.27]);
  }
}

function focusCentralCity() {
  map?.setZoomAndCenter(12.2, [121.465, 31.23]);
}

function clearRouteOverlay() {
  routePolyline?.setMap(null);
  routePolyline = undefined;
  routeMarkers.forEach((marker) => marker.setMap(null));
  routeMarkers = [];
}

function drawRouteOverlay() {
  if (!map || !window.AMap || !props.route) {
    clearRouteOverlay();
    return;
  }

  clearRouteOverlay();
  const AMap = window.AMap;
  routePolyline = new AMap.Polyline({
    path: props.route.path,
    strokeColor: "#e45d31",
    strokeWeight: 6,
    strokeOpacity: 0.95,
    isOutline: true,
    outlineColor: "#fff9ef",
    borderWeight: 2,
    zIndex: 20,
  });
  routePolyline.setMap(map);

  const startMarker = new AMap.CircleMarker({
    center: props.route.origin.location,
    radius: 9,
    strokeColor: "#fff9ef",
    strokeWeight: 3,
    fillColor: "#526b59",
    fillOpacity: 1,
    zIndex: 24,
  });
  const endMarker = new AMap.CircleMarker({
    center: props.route.destination.location,
    radius: 9,
    strokeColor: "#fff9ef",
    strokeWeight: 3,
    fillColor: "#e45d31",
    fillOpacity: 1,
    zIndex: 24,
  });
  startMarker.setMap(map);
  endMarker.setMap(map);
  routeMarkers.push(startMarker, endMarker);

  const originLabel = new AMap.Text({
    text: "起点",
    position: props.route.origin.location,
    anchor: "bottom-center",
    offset: new AMap.Pixel(0, -8),
    zIndex: 25,
    style: {
      border: "none",
      background: "rgba(255,249,239,.92)",
      color: "#526b59",
      padding: "2px 5px",
      fontSize: "11px",
    },
  });
  const destinationLabel = new AMap.Text({
    text: "终点",
    position: props.route.destination.location,
    anchor: "bottom-center",
    offset: new AMap.Pixel(0, -8),
    zIndex: 25,
    style: {
      border: "none",
      background: "rgba(255,249,239,.92)",
      color: "#a33b27",
      padding: "2px 5px",
      fontSize: "11px",
    },
  });
  originLabel.setMap(map);
  destinationLabel.setMap(map);
  routeMarkers.push(originLabel, destinationLabel);

  props.route.recommendations.forEach((poi, index) => {
    const recommendationMarker = new AMap.CircleMarker({
      center: [poi.lng, poi.lat],
      radius: 10,
      strokeColor: "#fff9ef",
      strokeWeight: 3,
      fillColor: "#f0a43a",
      fillOpacity: 1,
      zIndex: 26,
      cursor: "pointer",
    });
    recommendationMarker.on("click", () => {
      infoWindow?.setContent(`
        <div style="min-width:210px;padding:2px;color:#1f3030;font-family:'Microsoft YaHei UI','PingFang SC',sans-serif">
          <strong style="font-size:14px">${escapeHtml(poi.name)}</strong>
          <div style="margin-top:6px;color:#7d766a;font-size:11px;line-height:1.6">
            <div>距通勤路线约 ${poi.routeDistance} 米</div>
            <div>早餐绕行约 ${poi.detourMinutes} 分钟</div>
            <div>${escapeHtml(poi.address || poi.district)}</div>
          </div>
        </div>
      `);
      infoWindow?.open(map, [poi.lng, poi.lat]);
    });
    recommendationMarker.setMap(map);
    routeMarkers.push(recommendationMarker);

    const numberLabel = new AMap.Text({
      text: String(index + 1),
      position: [poi.lng, poi.lat],
      anchor: "center",
      zIndex: 27,
      style: {
        border: "none",
        background: "transparent",
        color: "#1f3030",
        fontSize: "9px",
        fontWeight: "700",
        padding: "0",
        pointerEvents: "none",
      },
    });
    numberLabel.setMap(map);
    routeMarkers.push(numberLabel);
  });

  const routePath = props.route.path;
  const longitudes = routePath.map((point) => point[0]);
  const latitudes = routePath.map((point) => point[1]);
  const bounds = new AMap.Bounds(
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)]
  );
  map.setBounds(bounds, false, [110, 110, 110, 110], 16);
}

async function initializeMap() {
  try {
    const AMap = await loadAmap();
    map = new AMap.Map(mapElement.value, {
      viewMode: "2D",
      zoom: 10,
      center: [121.47, 31.27],
      mapStyle: "amap://styles/whitesmoke",
      showLabel: true,
    });
    map.addControl(new AMap.Scale());
    map.addControl(new AMap.ToolBar({ position: { top: "58px", right: "12px" } }));
    createDistrictPolygons(AMap);
    createPoiOverlay(AMap);
    fitWholeCity();
    drawRouteOverlay();
    resizeObserver = new ResizeObserver(() => map?.resize());
    resizeObserver.observe(mapElement.value);
  } catch (error) {
    mapError.value =
      error instanceof Error ? error.message : "高德地图初始化失败。";
  }
}

watch(
  () => [props.activeBand, props.selectedName],
  () => {
    updateDistrictStyles();
  }
);

watch(
  () => props.districts,
  () => {
    if (districtPolygons.size > 0) updateDistrictStyles();
  },
  { deep: true }
);

watch(
  () => props.pois,
  () => {
    updatePoiOverlay();
  },
  { deep: true }
);

watch(
  () => props.route,
  () => {
    drawRouteOverlay();
  },
  { deep: true }
);

onMounted(initializeMap);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  infoWindow?.close();
  districtLabels.forEach((label) => label.setMap(null));
  poiMarkers.forEach((marker) => marker.setMap(null));
  poiMassMarks?.setMap(null);
  clearRouteOverlay();
  districtPolygons.forEach((polygons) =>
    polygons.forEach((polygon) => polygon.setMap(null))
  );
  map?.destroy();
});
</script>

<template>
  <section class="panel map-panel" aria-labelledby="map-title">
    <div class="map-head">
      <div class="map-heading">
        <h2 id="map-title">城市早餐可达圈</h2>
        <p>
          {{ dataModeLabel }} · 高德真实底图与早餐 POI · {{ totalCount.toLocaleString("zh-CN") }} 个检索结果 ·
          地图展示 {{ pois.length }} 个采样点、覆盖 {{ districts.length }} 区 · {{ updatedAt }}
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
        class="amap-canvas"
        role="img"
        aria-label="高德地图上的上海早餐 POI 与行政区可达性分布"
      />
      <div class="map-topline">
        <span>上海市域 · 高德实时 POI</span>
        <div class="map-view-actions">
          <button class="planner-trigger" type="button" @click="emit('open-planner')">
            通勤早餐
          </button>
          <button type="button" @click="fitWholeCity">全市</button>
          <button type="button" @click="focusCentralCity">中心城区</button>
        </div>
      </div>
      <div v-if="route" class="route-status">
        <span>{{ route.modeLabel }} · {{ route.durationMinutes ?? "—" }} 分钟 · {{ route.distanceKm }} 公里</span>
        <button type="button" @click="emit('clear-route')">清除路线</button>
      </div>
      <div v-if="loading" class="map-loading">
        <span aria-hidden="true" />
        正在加载高德早餐 POI
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
      <div class="poi-legend" aria-label="早餐 POI 类型">
        <template v-if="pois.length > 1200">
          <span><i class="dot all" />全部早餐 POI</span>
        </template>
        <template v-else>
          <span><i class="dot breakfast" />早餐</span>
          <span><i class="dot dimsum" />面点</span>
          <span><i class="dot coffee" />咖啡</span>
        </template>
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
        <span>早餐 POI</span>
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
  transition: color 180ms ease, background 180ms ease;
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
  background: #f4efe4;
}

.amap-canvas {
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
  animation: amap-loading 800ms linear infinite;
}

@keyframes amap-loading {
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
  background: #e45d31;
}

.dot.dimsum {
  background: #d99d32;
}

.dot.coffee {
  background: #70806d;
}

.dot.all {
  background: #2c8db8;
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
  .amap-canvas {
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
  .amap-canvas {
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
