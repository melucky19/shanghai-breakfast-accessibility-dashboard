import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  handleMapDatasetRequest,
  handlePublicPlaceSearchRequest,
  handlePublicRouteRequest,
} from "./public-map-api.mjs";
import {
  handleChatIntentRequest,
  handleChatRecommendationRequest,
  handleLlmStatusRequest,
} from "./chat-api.mjs";
import { createLlmConfig } from "./llm-service.mjs";

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

let env = {};
for (const filename of [".env.local", ".env.zhipu.local"]) {
  try {
    Object.assign(
      env,
      parseEnv(await fs.readFile(path.resolve(filename), "utf8"))
    );
  } catch {
    // Optional environment files are allowed to be absent.
  }
}

const llmConfig = createLlmConfig(env);
const port = Number(process.env.PORT || 8787);
const distDirectory = path.resolve("dist");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  if (
    requestUrl.pathname === "/api/map-dataset" ||
    requestUrl.pathname === "/api/breakfast-pois"
  ) {
    await handleMapDatasetRequest(request, response);
    return;
  }
  if (requestUrl.pathname === "/api/place-search") {
    await handlePublicPlaceSearchRequest(request, response);
    return;
  }
  if (requestUrl.pathname === "/api/route") {
    await handlePublicRouteRequest(request, response);
    return;
  }
  if (requestUrl.pathname === "/api/chat-intent") {
    await handleChatIntentRequest(request, response, { llmConfig });
    return;
  }
  if (requestUrl.pathname === "/api/chat-recommendation") {
    await handleChatRecommendationRequest(request, response, { llmConfig });
    return;
  }
  if (requestUrl.pathname === "/api/llm-status") {
    handleLlmStatusRequest(request, response, { llmConfig });
    return;
  }

  let relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  if (!relativePath || !path.extname(relativePath)) relativePath = "index.html";
  const filePath = path.resolve(distDirectory, relativePath);
  if (!filePath.startsWith(distDirectory)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      contentTypes[path.extname(filePath)] || "application/octet-stream"
    );
    response.end(content);
  } catch {
    const fallback = await fs.readFile(path.join(distDirectory, "index.html"));
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypes[".html"]);
    response.end(fallback);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Breakfast dashboard: http://localhost:${port}/`);
});
