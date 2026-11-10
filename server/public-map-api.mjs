import {
  fetchPublicMapDataset,
  planPublicRoute,
  searchMapPlaces,
} from "./public-map-service.mjs";

const MAX_BODY_BYTES = 256 * 1024;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error("请求内容过大。");
    }
  }
  return body.trim() ? JSON.parse(body) : {};
}

export async function handleMapDatasetRequest(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "该接口仅支持 GET 请求。",
    });
    return;
  }
  try {
    const requestUrl = new URL(request.url, "http://localhost");
    const refresh = requestUrl.searchParams.get("refresh") === "1";
    const streaming = requestUrl.searchParams.get("progress") === "1";
    if (streaming) {
      response.statusCode = 200;
      response.setHeader(
        "Content-Type",
        "application/x-ndjson; charset=utf-8"
      );
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Accel-Buffering", "no");
      const sendEvent = (payload) => response.write(`${JSON.stringify(payload)}\n`);
      try {
        const payload = await fetchPublicMapDataset({
          refresh,
          onProgress: (progress) =>
            sendEvent({ type: "progress", ...progress }),
        });
        sendEvent({ type: "result", payload });
      } catch (error) {
        sendEvent({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "OpenStreetMap 数据加载失败。",
        });
      }
      response.end();
      return;
    }
    sendJson(
      response,
      200,
      await fetchPublicMapDataset({ refresh })
    );
  } catch (error) {
    sendJson(response, 500, {
      error: "PUBLIC_MAP_DATASET_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "OpenStreetMap 数据加载失败。",
    });
  }
}

export async function handlePublicPlaceSearchRequest(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "该接口仅支持 GET 请求。",
    });
    return;
  }
  try {
    const requestUrl = new URL(request.url, "http://localhost");
    const keywords = (requestUrl.searchParams.get("keywords") || "").trim();
    const pageSize = Math.max(
      1,
      Math.min(20, Number(requestUrl.searchParams.get("pageSize")) || 8)
    );
    if (!keywords) {
      sendJson(response, 400, {
        error: "MISSING_KEYWORDS",
        message: "请输入地点名称。",
      });
      return;
    }
    const candidates = await searchMapPlaces(keywords, pageSize);
    sendJson(response, 200, { candidates, provider: "Photon / OpenStreetMap" });
  } catch (error) {
    sendJson(response, 500, {
      error: "PLACE_SEARCH_FAILED",
      message:
        error instanceof Error ? error.message : "免费地点搜索失败。",
    });
  }
}

export async function handlePublicRouteRequest(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "该接口仅支持 POST 请求。",
    });
    return;
  }
  try {
    const body = await readJsonBody(request);
    const route = await planPublicRoute({
      origin: body.origin,
      destination: body.destination,
      mode: body.mode,
    });
    sendJson(response, 200, route);
  } catch (error) {
    sendJson(response, 400, {
      error: "ROUTE_PLAN_FAILED",
      message:
        error instanceof Error ? error.message : "免费路径规划失败。",
    });
  }
}
