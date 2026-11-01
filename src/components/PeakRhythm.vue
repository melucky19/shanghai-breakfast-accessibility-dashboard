<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { echarts } from "../lib/echarts";

const props = defineProps({
  bins: {
    type: Array,
    required: true,
  },
});

const chartElement = ref(null);
let chart;
let observer;

function buildOption() {
  return {
    animationDuration: 420,
    animationEasing: "cubicOut",
    grid: {
      left: 34,
      right: 12,
      top: 30,
      bottom: 25,
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "#fff9ef",
      borderColor: "rgba(66, 66, 50, 0.15)",
      borderWidth: 1,
      padding: [8, 10],
      textStyle: {
        color: "#1f3030",
        fontSize: 12,
        fontFamily: '"Microsoft YaHei UI", "PingFang SC", sans-serif',
      },
      formatter: (params) => {
        const point = params[0];
        return `${point.axisValue} 分钟<br/><strong>${point.value}</strong> 个办公地点样本`;
      },
    },
    xAxis: {
      type: "category",
      data: props.bins.map((bin) => bin.label),
      axisLine: {
        lineStyle: {
          color: "rgba(69, 66, 51, 0.18)",
        },
      },
      axisTick: { show: false },
      axisLabel: {
        color: "#868075",
        fontSize: 11,
        margin: 11,
      },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: {
        color: "#9a9487",
        fontSize: 9,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: "rgba(69, 66, 51, 0.08)",
        },
      },
    },
    series: [
      {
        name: "办公地点样本",
        type: "bar",
        barMaxWidth: 26,
        data: props.bins.map((bin) => bin.value),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#e45d31" },
            { offset: 1, color: "rgba(228, 93, 49, 0.48)" },
          ]),
        },
        label: {
          show: true,
          position: "top",
          color: "#1f3030",
          fontSize: 10,
          formatter: ({ value }) => (value > 0 ? value : ""),
        },
      },
    ],
  };
}

function render() {
  chart?.setOption(buildOption(), true);
}

onMounted(() => {
  chart = echarts.init(chartElement.value);
  render();
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(chartElement.value);
});

watch(() => props.bins, render, { deep: true });

onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <section class="panel peak-panel" aria-labelledby="arrival-title">
    <div class="panel-head">
      <h2 id="arrival-title">办公地点到达时间</h2>
      <span>最近早餐 POI / 分钟</span>
    </div>
    <div
      ref="chartElement"
      class="peak-chart"
      role="img"
      aria-label="办公地点到最近早餐 POI 的步行时间分布"
    />
  </section>
</template>

<style scoped>
.peak-panel {
  flex: 0 0 clamp(218px, 23vh, 284px);
  display: flex;
  flex-direction: column;
  padding-top: clamp(14px, 1.05vw, 20px);
}

.panel-head {
  padding: 0 clamp(15px, 1.1vw, 20px);
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
  font-size: clamp(9px, 0.62vw, 12px);
  white-space: nowrap;
}

.peak-chart {
  flex: 1;
  min-height: 140px;
  margin: 4px 7px 4px 2px;
}
</style>
