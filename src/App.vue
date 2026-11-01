<script setup>
import { computed, onMounted, ref } from "vue";
import DashboardHeader from "./components/DashboardHeader.vue";
import SupplyOverview from "./components/SupplyOverview.vue";
import BreakfastMix from "./components/BreakfastMix.vue";
import SupplyCoverage from "./components/SupplyCoverage.vue";
import DistrictMap from "./components/DistrictMap.vue";
import AccessibilityPanel from "./components/AccessibilityPanel.vue";
import ArrivalProfile from "./components/PeakRhythm.vue";
import GapPanel from "./components/GapPanel.vue";
import CommutePlanner from "./components/CommutePlanner.vue";
import {
  districtMeta,
  districtByName,
  breakfastCategories,
} from "./data/districts";
import {
  buildRealtimeDataset,
  fetchRealtimeDataset,
  loadDatasetCache,
} from "./services/amap";

const CACHE_MAX_AGE_MINUTES = 15;
const offlineMode =
  new URLSearchParams(window.location.search).get("offline") === "1";
const activeBand = ref(15);
const selectedName = ref("黄浦区");
const plannerOpen = ref(false);
const commuteRoute = ref(null);
const now = new Date();
now.setHours(7, 42, 0, 0);

const emptyDistricts = districtMeta.map((district) => ({
  ...district,
  stalls: 0,
  commuters: 0,
  coverage: { 15: 0, 20: 0, 30: 0 },
  arrival: null,
  gap: 0,
}));

const dataset = ref(
  buildRealtimeDataset([], [], null) ?? {
    breakfastPois: [],
    officePois: [],
    districts: emptyDistricts,
    distanceSamples: [],
    mix: breakfastCategories.map((query) => ({
      label: query.category,
      value: 0,
      color: query.color,
    })),
    lastUpdated: null,
    walkingSpeed: 75,
  }
);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref("");
const syncProgress = ref({
  active: false,
  percent: 0,
  completedTiles: 0,
  totalTiles: 0,
  collected: 0,
  requests: 0,
  currentDistrict: "",
});

const districts = computed(() => dataset.value.districts);
const breakfastPois = computed(() => dataset.value.breakfastPois);
const totalBreakfast = computed(() => dataset.value.totalBreakfast ?? 0);
const officeSamples = computed(() => dataset.value.officePois);
const totalOfficeSamples = computed(
  () => dataset.value.totalOfficeSamples ?? officeSamples.value.length
);
const selectedDistrict = computed(
  () =>
    districts.value.find((district) => district.name === selectedName.value) ??
    districts.value[0]
);

const distanceSamples = computed(() => dataset.value.distanceSamples);
const weightedDistanceSamples = computed(() => {
  const samplesPerDistrict = Object.fromEntries(
    districts.value.map((district) => [
      district.name,
      Math.max(
        1,
        distanceSamples.value.filter(
          (sample) => sample.district === district.name
        ).length
      ),
    ])
  );
  return distanceSamples.value.map((sample) => ({
    ...sample,
    weight:
      (districtByName[sample.district]?.commuters ??
        districts.value.find((district) => district.name === sample.district)
          ?.commuters ??
        samplesPerDistrict[sample.district]) /
      samplesPerDistrict[sample.district],
  }));
});

const coverage = computed(() => {
  const totalOffices = districts.value.reduce(
    (total, district) => total + district.commuters,
    0
  );
  if (totalOffices === 0) return 0;
  const covered = districts.value.reduce(
    (total, district) =>
      total + (district.coverage[activeBand.value] / 100) * district.commuters,
    0
  );
  return Number(((covered / totalOffices) * 100).toFixed(1));
});

const coveredPlaces = computed(() =>
  Math.round((totalOfficeSamples.value * coverage.value) / 100)
);

const timeDistribution = computed(() => {
  const offices = weightedDistanceSamples.value;
  const total = Math.max(
    1,
    offices.reduce((sum, office) => sum + office.weight, 0)
  );
  const countBetween = (minimum, maximum) =>
    offices.filter(
      (office) =>
        office.walkingMinutes > minimum && office.walkingMinutes <= maximum
    ).reduce((sum, office) => sum + office.weight, 0);

  const underFive =
    offices
      .filter((office) => office.walkingMinutes <= 5)
      .reduce((sum, office) => sum + office.weight, 0);
  const fiveToTen = countBetween(5, 10);
  const tenToBand = countBetween(10, activeBand.value);
  const overBand = offices
    .filter((office) => office.walkingMinutes > activeBand.value)
    .reduce((sum, office) => sum + office.weight, 0);

  return [
    {
      key: "under-five",
      label: "≤5 分",
      value: (underFive / total) * 100,
      count: Math.round(underFive),
      color: "#526b59",
    },
    {
      key: "five-ten",
      label: "5—10 分",
      value: (fiveToTen / total) * 100,
      count: Math.round(fiveToTen),
      color: "#8b9b78",
    },
    {
      key: "ten-band",
      label: `10—${activeBand.value} 分`,
      value: (tenToBand / total) * 100,
      count: Math.round(tenToBand),
      color: "#d9a750",
    },
    {
      key: "over-band",
      label: `>${activeBand.value} 分`,
      value: (overBand / total) * 100,
      count: Math.round(overBand),
      color: "#e67850",
    },
  ];
});

const arrivalBins = computed(() => {
  const ranges = [
    { label: "≤5", minimum: 0, maximum: 5 },
    { label: "5—10", minimum: 5, maximum: 10 },
    { label: "10—15", minimum: 10, maximum: 15 },
    { label: "15—20", minimum: 15, maximum: 20 },
    { label: "20—30", minimum: 20, maximum: 30 },
    { label: ">30", minimum: 30, maximum: Number.POSITIVE_INFINITY },
  ];
  return ranges.map((range) => ({
    label: range.label,
    value: Math.round(
      weightedDistanceSamples.value
        .filter(
          (sample) =>
            sample.walkingMinutes > range.minimum &&
            sample.walkingMinutes <= range.maximum
        )
        .reduce((sum, sample) => sum + sample.weight, 0)
    ),
  }));
});

const priorityGaps = computed(() =>
  [...districts.value]
    .filter((district) => district.commuters > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .map((district, index) => ({
      rank: index + 1,
      district: district.name,
      name: district.name,
      score: district.gap,
      reason: `${district.commuters} 个办公地点样本 · ${district.coverage[15].toFixed(1)}% 可在 15 分钟内到达`,
    }))
);

const lastUpdatedText = computed(() => {
  if (!dataset.value.lastUpdated) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(dataset.value.lastUpdated));
});

const dataModeLabel = computed(() => {
  if (dataset.value.dataMode === "complete") return "服务端全量汇总";
  if (dataset.value.dataMode === "server-partial") return "服务端分页汇总";
  return "区级均衡采样";
});

function selectDistrict(name) {
  if (districtByName[name]) {
    selectedName.value = name;
  }
}

function handleRoutePlanned(route) {
  commuteRoute.value = route;
}

function clearCommuteRoute() {
  commuteRoute.value = null;
}

async function refreshData({ silent = false, refreshFull = false } = {}) {
  if (refreshing.value) return;
  if (offlineMode) {
    errorMessage.value = "当前为离线调试模式，不会请求高德 POI。";
    loading.value = false;
    return;
  }
  refreshing.value = true;
  if (!silent) loading.value = breakfastPois.value.length === 0;
  errorMessage.value = "";
  syncProgress.value = {
    active: true,
    percent: 0,
    completedTiles: 0,
    totalTiles: 0,
    collected: 0,
    requests: 0,
    currentDistrict: "",
  };

  try {
    dataset.value = await fetchRealtimeDataset({
      refreshFull,
      onProgress: (progress) => {
        syncProgress.value = {
          active: true,
          percent: progress.percent || 0,
          completedTiles: progress.completedTiles || 0,
          totalTiles: progress.totalTiles || 0,
          collected: progress.collected || 0,
          requests: progress.requests || 0,
          currentDistrict: progress.currentDistrict || "",
        };
      },
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "高德数据同步失败。";
  } finally {
    refreshing.value = false;
    loading.value = false;
    syncProgress.value = {
      ...syncProgress.value,
      active: false,
      percent: 100,
    };
  }
}

function manualRefresh() {
  refreshData({ refreshFull: true });
}

onMounted(() => {
  const cached = loadDatasetCache();
  if (cached) {
    dataset.value = cached;
    loading.value = false;
    if (offlineMode) return;
    const ageInMinutes =
      (Date.now() - new Date(cached.lastUpdated).getTime()) / 60000;
    if (ageInMinutes < CACHE_MAX_AGE_MINUTES) return;
  }
  if (offlineMode) {
    loading.value = false;
    errorMessage.value =
      "离线调试模式下未找到本地数据缓存，请先正常打开一次大屏。";
    return;
  }
  refreshData({ silent: Boolean(cached), refreshFull: false });
});
</script>

<template>
  <div class="dashboard">
    <DashboardHeader
      :now="now"
      :active-band="activeBand"
      :loading="loading"
      :refreshing="refreshing"
      :error-message="errorMessage"
      :last-updated="lastUpdatedText"
      @refresh="manualRefresh"
    />

    <div v-if="errorMessage" class="data-alert" role="alert">
      <span>高德实时数据未能更新：{{ errorMessage }}</span>
      <button type="button" @click="manualRefresh">重新同步</button>
    </div>
    <div
      v-if="refreshing"
      class="sync-progress"
      role="status"
      aria-live="polite"
    >
      <div class="sync-progress-head">
        <span>
          正在同步高德早餐 POI
          <template v-if="syncProgress.currentDistrict">
            · 当前 {{ syncProgress.currentDistrict }}
          </template>
        </span>
        <strong>{{ syncProgress.percent }}%</strong>
      </div>
      <div
        class="sync-progress-track"
        role="progressbar"
        aria-label="高德早餐 POI 同步进度"
        :aria-valuenow="syncProgress.percent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i :style="{ width: `${syncProgress.percent}%` }" />
      </div>
      <p>
        已完成 {{ syncProgress.completedTiles }} / {{ syncProgress.totalTiles }} 个网格
        · 已发起 {{ syncProgress.requests }} 个请求
        · 已获取 {{ syncProgress.collected.toLocaleString("zh-CN") }} 条
      </p>
    </div>
    <div
      v-else-if="dataset.dataMode !== 'complete'"
      class="data-alert data-alert--warning"
      role="status"
    >
      <span v-if="dataset.dataMode === 'sample'">
        当前为{{ dataModeLabel }}：{{ dataset.serverMessage }}
        配置 Web 服务 Key 后会自动切换到服务端分页全量汇总。
      </span>
      <span v-else>
        当前为{{ dataModeLabel }}：{{ dataset.serverMessage }}
        请在高德当日调用额度恢复后点击“重试全量”。
      </span>
      <button type="button" @click="manualRefresh">重试全量</button>
    </div>

    <main class="dashboard-grid">
      <aside class="dashboard-column left-column" aria-label="早餐供给概览">
        <SupplyOverview
          :total-stalls="totalBreakfast"
          :office-samples="totalOfficeSamples"
          :last-updated="lastUpdatedText"
          :loading="loading"
          :data-mode-label="dataModeLabel"
        />
        <BreakfastMix :items="dataset.mix" :total="totalBreakfast" />
        <SupplyCoverage
          :pois="breakfastPois"
          :districts="districts"
          :total-count="totalBreakfast"
          :data-mode-label="dataModeLabel"
          :last-updated="lastUpdatedText"
          :complete="dataset.complete"
        />
      </aside>

      <DistrictMap
        :districts="districts"
        :pois="breakfastPois"
        :total-count="totalBreakfast"
        :active-band="activeBand"
        :selected-name="selectedName"
        :loading="loading"
        :updated-at="lastUpdatedText"
        :data-mode-label="dataModeLabel"
        :route="commuteRoute"
        @select="selectDistrict"
        @change-band="activeBand = $event"
        @open-planner="plannerOpen = true"
        @clear-route="clearCommuteRoute"
      />

      <aside class="dashboard-column right-column" aria-label="早餐可达性分析">
        <AccessibilityPanel
          :active-band="activeBand"
          :coverage="coverage"
          :covered-places="coveredPlaces"
          :sample-count="totalOfficeSamples"
          :distribution="timeDistribution"
        />
        <ArrivalProfile :bins="arrivalBins" />
        <GapPanel
          :gaps="priorityGaps"
          :selected-name="selectedName"
          :last-updated="lastUpdatedText"
          @select="selectDistrict"
        />
      </aside>
    </main>

    <CommutePlanner
      :open="plannerOpen"
      :breakfast-pois="breakfastPois"
      :route="commuteRoute"
      @close="plannerOpen = false"
      @planned="handleRoutePlanned"
      @clear="clearCommuteRoute"
    />

    <footer class="dashboard-footnote">
      <span>地图与 POI：高德地图 · 可达性按 75 米/分钟步行速度估算</span>
      <span>行政区边界：DataV.GeoAtlas · 高德坐标</span>
    </footer>
  </div>
</template>
