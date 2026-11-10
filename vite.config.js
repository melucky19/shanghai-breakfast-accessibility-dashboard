import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  handleMapDatasetRequest,
  handlePublicPlaceSearchRequest,
  handlePublicRouteRequest,
} from "./server/public-map-api.mjs";
import {
  handleChatIntentRequest,
  handleChatRecommendationRequest,
  handleLlmStatusRequest,
} from "./server/chat-api.mjs";
import { createLlmConfig } from "./server/llm-service.mjs";

function parseOptionalEnv(filename) {
  try {
    return Object.fromEntries(
      readFileSync(resolve(filename), "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line && !line.startsWith("#") && line.includes("=")
        )
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        })
    );
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const llmConfig = createLlmConfig({
    ...env,
    ...parseOptionalEnv(".env.zhipu.local"),
  });

  return {
    plugins: [
      vue(),
      {
        name: "shanghai-breakfast-api",
        configureServer(server) {
          server.middlewares.use("/api/map-dataset", (request, response) => {
            handleMapDatasetRequest(request, response);
          });
          server.middlewares.use("/api/breakfast-pois", (request, response) => {
            handleMapDatasetRequest(request, response);
          });
          server.middlewares.use("/api/place-search", (request, response) => {
            handlePublicPlaceSearchRequest(request, response);
          });
          server.middlewares.use("/api/route", (request, response) => {
            handlePublicRouteRequest(request, response);
          });
          server.middlewares.use("/api/chat-intent", (request, response) => {
            handleChatIntentRequest(request, response, { llmConfig });
          });
          server.middlewares.use(
            "/api/chat-recommendation",
            (request, response) => {
              handleChatRecommendationRequest(request, response, { llmConfig });
            }
          );
          server.middlewares.use("/api/llm-status", (request, response) => {
            handleLlmStatusRequest(request, response, { llmConfig });
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
