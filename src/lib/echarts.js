import * as echarts from "echarts/core";
import { BarChart, LineChart, MapChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  GeoComponent,
  GridComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  MapChart,
  ScatterChart,
  AriaComponent,
  GeoComponent,
  GridComponent,
  MarkPointComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export { echarts };
