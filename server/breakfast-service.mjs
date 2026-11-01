import { promises as fs } from "node:fs";
import path from "node:path";

const CACHE_DIRECTORY = path.resolve("server/cache");
const CACHE_FILE = path.join(CACHE_DIRECTORY, "breakfast-pois.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 25;
const MAX_PAGES_PER_TILE = 8;
const MAX_SPLIT_DEPTH = 2;
const MIN_TILE_STEP = 0.025;
const MIN_REQUEST_INTERVAL_MS = 800;
const WEB_API_ENDPOINT = "https://restapi.amap.com/v5/place/around";
const BREAKFAST_KEYWORDS = "早餐|早点|包子|馒头|油条|豆浆|煎饼|粢饭|粥";
const URBAN_DISTRICTS = new Set([
  "黄浦区",
  "徐汇区",
  "长宁区",
  "静安区",
  "普陀区",
  "虹口区",
  "杨浦区",
]);

let memoryCache;
let geojsonCache;
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

async function loadShanghaiGeoJson() {
  if (geojsonCache) return geojsonCache;
  geojsonCache = JSON.parse(
    await fs.readFile(path.resolve("src/assets/shanghai-districts.json"), "utf8")
  );
  return geojsonCache;
}

async function readDiskCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function writeDiskCache(value) {
  await fs.mkdir(CACHE_DIRECTORY, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(value));
}

function breakfastCategory(poi) {
  const text = `${poi.name || ""} ${poi.type || ""}`;
  if (/(咖啡|星巴克|瑞幸|Manner|Costa|Tims)/i.test(text)) {
    return "咖啡烘焙";
  }
  if (/(包子|馒头|生煎|小笼|馄饨|面馆|饼|粥|早点)/.test(text)) {
    return "中式面点";
  }
  return "早餐服务";
}

function stringValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  return typeof value === "string" ? value : "";
}

function normalizePoi(poi, fallbackDistrict, districts) {
  const [longitude, latitude] = String(poi.location || "")
    .split(",")
    .map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const cityName = stringValue(poi.cityname).replace("市", "");
  if (cityName && cityName !== "上海") return null;
  const districtName = districts.has(poi.adname)
    ? poi.adname
    : fallbackDistrict.name;
  if (!districtName) return null;

  const business =
    typeof poi.biz_ext === "string"
      ? (() => {
          try {
            return JSON.parse(poi.biz_ext);
          } catch {
            return {};
          }
        })()
      : poi.biz_ext || {};

  return {
    id: String(poi.id || `${longitude},${latitude},${poi.name}`),
    name: poi.name || "未命名地点",
    address: stringValue(poi.address),
    type: stringValue(poi.type),
    tel: stringValue(poi.tel),
    district: districtName,
    lng: longitude,
    lat: latitude,
    category: breakfastCategory(poi),
    rating: Number(business.rating ?? 0) || null,
    cost: Number(business.cost ?? 0) || null,
  };
}

function polygonBounds(rings) {
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  rings.forEach((ring) => {
    ring.forEach(([longitude, latitude]) => {
      minLng = Math.min(minLng, longitude);
      maxLng = Math.max(maxLng, longitude);
      minLat = Math.min(minLat, latitude);
      maxLat = Math.max(maxLat, latitude);
    });
  });
  return { minLng, maxLng, minLat, maxLat };
}

function outerRings(feature) {
  if (feature.geometry.type === "Polygon") {
    return [feature.geometry.coordinates[0]];
  }
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.map((polygon) => polygon[0]);
  }
  return [];
}

function pointInRing([longitude, latitude], ring) {
  let inside = false;
  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current, current += 1
  ) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const intersects =
      currentLat > latitude !== previousLat > latitude &&
      longitude <
        ((previousLng - currentLng) * (latitude - currentLat)) /
          (previousLat - currentLat) +
          currentLng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function featureContains(feature, point) {
  return outerRings(feature).some((ring) => pointInRing(point, ring));
}

function buildTiles(feature) {
  const rings = outerRings(feature);
  const bounds = polygonBounds(rings);
  const step = URBAN_DISTRICTS.has(feature.properties.name) ? 0.12 : 0.2;
  const tiles = [];

  for (let longitude = bounds.minLng; longitude < bounds.maxLng; longitude += step) {
    for (let latitude = bounds.minLat; latitude < bounds.maxLat; latitude += step) {
      const center = [longitude + step / 2, latitude + step / 2];
      if (!featureContains(feature, center)) continue;
      const radius =
        Math.round((step * 111000 * Math.SQRT2) / 2 + 350);
      tiles.push({
        district: {
          name: feature.properties.name,
          adcode: feature.properties.adcode,
        },
        center,
        step,
        radius,
        depth: 0,
      });
    }
  }

  if (tiles.length === 0) {
    tiles.push({
      district: {
        name: feature.properties.name,
        adcode: feature.properties.adcode,
      },
      center: feature.properties.center,
      step,
      radius: Math.round((step * 111000 * Math.SQRT2) / 2 + 350),
      depth: 0,
    });
  }
  return tiles;
}

function splitTile(tile) {
  const offset = tile.step / 4;
  return [
    [-offset, -offset],
    [offset, -offset],
    [-offset, offset],
    [offset, offset],
  ].map(([longitudeOffset, latitudeOffset]) => ({
    ...tile,
    center: [
      tile.center[0] + longitudeOffset,
      tile.center[1] + latitudeOffset,
    ],
    step: tile.step / 2,
    radius: Math.max(900, Math.round(tile.radius / 2)),
    depth: tile.depth + 1,
  }));
}

async function requestPage(webServiceKey, tile, pageNumber, progress) {
  const parameters = new URLSearchParams({
    key: webServiceKey,
    location: `${tile.center[0]},${tile.center[1]}`,
    radius: String(tile.radius),
    keywords: BREAKFAST_KEYWORDS,
    types: "050000",
    region: "310000",
    city_limit: "true",
    page_size: String(PAGE_SIZE),
    page_num: String(pageNumber),
    show_fields: "business",
  });

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const requestTask = async () => {
        const waitTime = Math.max(
          0,
          MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt)
        );
        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
        lastRequestAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(
          `${WEB_API_ENDPOINT}?${parameters.toString()}`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (String(result.status) !== "1") {
          throw new Error(result.info || "高德 Web 服务返回失败");
        }
        progress.requests += 1;
        progress.onProgress?.({ ...progress });
        return result;
      };

      const resultPromise = requestQueue.then(requestTask);
      requestQueue = resultPromise.catch(() => {});
      return await resultPromise;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, 1200 * attempt)
      );
    }
  }
  throw lastError;
}

async function fetchTile(webServiceKey, tile, districts, progress) {
  const pointsById = new Map();
  let capped = false;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES_PER_TILE; pageNumber += 1) {
    const page = await requestPage(
      webServiceKey,
      tile,
      pageNumber,
      progress
    );
    const pageItems = page.pois || [];
    pageItems.forEach((poi) => {
      const normalized = normalizePoi(poi, tile.district, districts);
      if (
        normalized &&
        normalized.district === tile.district.name
      ) {
        pointsById.set(normalized.id, normalized);
      }
    });
    if (pageItems.length < PAGE_SIZE) {
      return { points: [...pointsById.values()], capped: false };
    }
    capped = pageNumber === MAX_PAGES_PER_TILE;
  }

  return { points: [...pointsById.values()], capped };
}

async function fetchDistrict(
  webServiceKey,
  feature,
  initialTiles,
  districts,
  progress
) {
  const queue = [...initialTiles];
  const pointsById = new Map();
  let complete = true;

  while (queue.length > 0) {
    const tile = queue.shift();
    progress.currentDistrict = feature.properties.name;
    const result = await fetchTile(
      webServiceKey,
      tile,
      districts,
      progress
    );
    result.points.forEach((poi) => pointsById.set(poi.id, poi));

    if (result.capped) {
      if (
        tile.depth < MAX_SPLIT_DEPTH &&
        tile.step / 2 >= MIN_TILE_STEP
      ) {
        const children = splitTile(tile);
        queue.unshift(...children);
        progress.totalTiles += children.length;
      } else {
        complete = false;
      }
    }
    progress.completedTiles += 1;
    progress.collected += result.points.length;
    progress.onProgress?.({ ...progress });
  }

  return {
    district: feature.properties.name,
    complete,
    total: pointsById.size,
    points: [...pointsById.values()],
  };
}

async function runWithConcurrency(items, concurrency, handler) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await handler(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return output;
}

export async function fetchAllShanghaiBreakfastPois(
  webServiceKey,
  { refresh = false, onProgress } = {}
) {
  if (!webServiceKey) {
    const error = new Error(
      "服务器尚未配置 AMAP_WEB_SERVICE_KEY，无法执行全量分页汇总。"
    );
    error.code = "MISSING_WEB_SERVICE_KEY";
    throw error;
  }

  const existingCache = memoryCache || (await readDiskCache());
  if (!refresh && existingCache?.pois?.length) {
    const freshComplete =
      existingCache.dataVersion === 2 &&
      existingCache.complete === true &&
      Date.now() - new Date(existingCache.fetchedAt).getTime() < CACHE_TTL_MS;
    const cachedResult = {
      ...existingCache,
      complete: freshComplete,
      cacheHit: true,
      warning: freshComplete
        ? undefined
        : "当前展示上次真实 POI 缓存。点击“重试全量”可重新执行网格分页汇总。",
    };
    memoryCache = cachedResult;
    return cachedResult;
  }
  if (
    !refresh &&
    existingCache?.pois?.length &&
    Number(existingCache.retryAfter || 0) > Date.now()
  ) {
    memoryCache = existingCache;
    return { ...existingCache, complete: false, cacheHit: true };
  }
  if (
    !refresh &&
    existingCache?.fetchedAt &&
    existingCache?.dataVersion === 2 &&
    Date.now() - new Date(existingCache.fetchedAt).getTime() < CACHE_TTL_MS
  ) {
    memoryCache = existingCache;
    return { ...existingCache, cacheHit: true };
  }

  const geojson = await loadShanghaiGeoJson();
  const districts = new Set(
    geojson.features.map((feature) => feature.properties.name)
  );
  const districtTasks = geojson.features.map((feature) => ({
    feature,
    tiles: buildTiles(feature),
  }));
  const progress = {
    completedTiles: 0,
    totalTiles: districtTasks.reduce(
      (total, task) => total + task.tiles.length,
      0
    ),
    collected: 0,
    requests: 0,
    currentDistrict: "",
    onProgress,
  };
  progress.onProgress?.({ ...progress });
  let districtResults;
  try {
    districtResults = await runWithConcurrency(
      districtTasks,
      3,
      (task) =>
        fetchDistrict(
          webServiceKey,
          task.feature,
          task.tiles,
          districts,
          progress
        )
    );
  } catch (error) {
    if (existingCache?.pois?.length) {
      const stale = {
        ...existingCache,
        complete: false,
        cacheHit: true,
        retryAfter: Date.now() + 15 * 60 * 1000,
        warning:
          error instanceof Error
            ? `全量刷新失败，已使用上次缓存：${error.message}`
            : "全量刷新失败，已使用上次缓存。",
      };
      memoryCache = stale;
      await writeDiskCache(stale);
      return stale;
    }
    throw error;
  }

  const pointsById = new Map();
  districtResults.forEach((result) => {
    result.points.forEach((poi) => pointsById.set(poi.id, poi));
  });

  const payload = {
    dataVersion: 2,
    fetchedAt: new Date().toISOString(),
    complete: districtResults.every((result) => result.complete),
    pois: [...pointsById.values()],
    districtCounts: Object.fromEntries(
      districtResults.map((result) => [result.district, result.total])
    ),
    districtSamples: Object.fromEntries(
      districtResults.map((result) => [result.district, result.points.length])
    ),
    query: {
      keywords: BREAKFAST_KEYWORDS,
      types: "餐饮服务",
      mode: "行政区分区网格 + 近邻搜索分页",
      pageSize: PAGE_SIZE,
      maxPagesPerTile: MAX_PAGES_PER_TILE,
      maxSplitDepth: MAX_SPLIT_DEPTH,
    },
    cacheHit: false,
  };

  memoryCache = payload;
  await writeDiskCache(payload);
  return payload;
}
