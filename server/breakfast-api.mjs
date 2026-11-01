import { fetchAllShanghaiBreakfastPois } from "./breakfast-service.mjs";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

export async function handleBreakfastRequest(
  request,
  response,
  { webServiceKey }
) {
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
      const sendEvent = (payload) => {
        response.write(`${JSON.stringify(payload)}\n`);
      };
      try {
        const data = await fetchAllShanghaiBreakfastPois(webServiceKey, {
          refresh,
          onProgress: (progress) => {
            sendEvent({
              type: "progress",
              completedTiles: progress.completedTiles,
              totalTiles: progress.totalTiles,
              collected: progress.collected,
              requests: progress.requests,
              currentDistrict: progress.currentDistrict,
              percent:
                progress.totalTiles > 0
                  ? Math.min(
                      99,
                      Math.round(
                        Math.max(
                          progress.completedTiles / progress.totalTiles,
                          progress.requests / (progress.totalTiles * 4)
                        ) * 100
                      )
                    )
                  : 0,
            });
          },
        });
        sendEvent({ type: "result", payload: data });
      } catch (error) {
        sendEvent({
          type: "error",
          message:
            error instanceof Error ? error.message : "高德全量数据汇总失败。",
        });
      }
      response.end();
      return;
    }

    const payload = await fetchAllShanghaiBreakfastPois(webServiceKey, {
      refresh,
    });
    sendJson(response, 200, payload);
  } catch (error) {
    const missingKey = error?.code === "MISSING_WEB_SERVICE_KEY";
    sendJson(response, missingKey ? 503 : 500, {
      error: missingKey ? "MISSING_WEB_SERVICE_KEY" : "AMAP_FULL_DATA_FAILED",
      message:
        error instanceof Error ? error.message : "高德全量数据汇总失败。",
    });
  }
}

export async function handlePlaceSearchRequest(
  request,
  response,
  { webServiceKey }
) {
  if (!webServiceKey) {
    sendJson(response, 503, {
      error: "MISSING_WEB_SERVICE_KEY",
      message: "服务器尚未配置 AMAP_WEB_SERVICE_KEY。",
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

    const parameters = new URLSearchParams({
      key: webServiceKey,
      keywords,
      region: "310000",
      city_limit: "true",
      page_size: String(pageSize),
      page_num: "1",
      show_fields: "business",
    });
    const upstream = await fetch(
      `https://restapi.amap.com/v5/place/text?${parameters.toString()}`
    );
    if (!upstream.ok) throw new Error(`高德地点搜索 HTTP ${upstream.status}`);
    const result = await upstream.json();
    if (String(result.status) !== "1") {
      throw new Error(result.info || "高德地点搜索失败");
    }

    const candidates = (result.pois || [])
      .map((poi) => {
        const [longitude, latitude] = String(poi.location || "")
          .split(",")
          .map(Number);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          return null;
        }
        return {
          id: String(poi.id || `${poi.name},${poi.location}`),
          name: poi.name || keywords,
          district: poi.adname || "",
          address:
            typeof poi.address === "string" ? poi.address : "",
          type: typeof poi.type === "string" ? poi.type : "",
          location: [longitude, latitude],
        };
      })
      .filter(Boolean);

    sendJson(response, 200, { candidates });
  } catch (error) {
    sendJson(response, 500, {
      error: "PLACE_SEARCH_FAILED",
      message:
        error instanceof Error ? error.message : "高德地点搜索失败。",
    });
  }
}
