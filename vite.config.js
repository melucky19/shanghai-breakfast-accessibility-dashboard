import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import {
  handleBreakfastRequest,
  handlePlaceSearchRequest,
} from "./server/breakfast-api.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      vue(),
      {
        name: "shanghai-breakfast-api",
        configureServer(server) {
          server.middlewares.use("/api/breakfast-pois", (request, response) => {
            handleBreakfastRequest(request, response, {
              webServiceKey: env.AMAP_WEB_SERVICE_KEY,
            });
          });
          server.middlewares.use("/api/place-search", (request, response) => {
            handlePlaceSearchRequest(request, response, {
              webServiceKey: env.AMAP_WEB_SERVICE_KEY,
            });
          });
        },
      },
    ],
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes("node_modules/echarts") ||
              id.includes("node_modules/zrender")
            ) {
              return "echarts";
            }
            if (id.includes("node_modules/vue")) {
              return "vue";
            }
            return undefined;
          },
        },
      },
    },
  };
});
