import { promises as fs } from "node:fs";
import path from "node:path";
import { districtMeta } from "../src/data/districts.js";

const CACHE_DIRECTORY = path.resolve("server/cache");
const CACHE_FILE = path.join(CACHE_DIRECTORY, "public-map-pois.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_BBOX = "30.65,120.85,31.90,122.10";
const SHANGHAI_PHOTON_BBOX = "120.85,30.65,122.10,31.90";
const USER_AGENT =
  "ShanghaiBreakfastDashboard/1.0 (https://github.com/melucky19/shanghai-breakfast-accessibility-dashboard)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OSRM_ENDPOINTS = {
  driving: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  walking: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
};
const BREAKFAST_QUERY = `[out:json][timeout:120];
(
  nwr["amenity"="cafe"](${SHANGHAI_BBOX});
  nwr["amenity"="fast_food"](${SHANGHAI_BBOX});
  nwr["shop"="bakery"](${SHANGHAI_BBOX});
  nwr["shop"="pastry"](${SHANGHAI_BBOX});
);
out center tags;`;
const OFFICE_QUERY = `[out:json][timeout:120];
(
  nwr["office"](${SHANGHAI_BBOX});
  nwr["building"="office"](${SHANGHAI_BBOX});
);
out center tags;`;

let memoryCache;
let geoJsonCache;
const placeSearchCache = new Map();
let placeSearchQueue = Promise.resolve();
let lastPlaceSearchAt = 0;

function rounded(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function distanceInMeters(pointA, pointB) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;
  const latitudeDelta = toRadians(pointB[1] - pointA[1]);
  const longitudeDelta = toRadians(pointB[0] - pointA[0]);
  const latitudeA = toRadians(pointA[1]);
  const latitudeB = toRadians(pointB[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(haversine));
}

function pointInRing([longitude, latitude], ring) {
  let inside = false;
  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current, current += 1
  ) {
    const [currentLongitude, currentLatitude] = ring[current];
    const [previousLongitude, previousLatitude] = ring[previous];
    const intersects =
      currentLatitude > latitude !== previousLatitude > latitude &&
      longitude <
        ((previousLongitude - currentLongitude) *
          (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude || Number.EPSILON) +
          currentLongitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

function featureContains(feature, point) {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polygons.some(
    (polygon) =>
      polygon.length > 0 &&
      pointInRing(point, polygon[0]) &&
      !polygon.slice(1).some((ring) => pointInRing(point, ring))
  );
}

async function loadGeoJson() {
  if (geoJsonCache) return geoJsonCache;
  geoJsonCache = JSON.parse(
    await fs.readFile(
      path.resolve("src/assets/shanghai-districts.json"),
      "utf8"
    )
  );
  return geoJsonCache;
}

function inferDistrictFromFeatures(lng, lat, features) {
  const match = features.find((feature) => featureContains(feature, [lng, lat]));
  return match?.properties?.name || null;
}

function normalizeElement(element, districtFeatures) {
  const tags = element.tags || {};
  const longitude = Number(element.lon ?? element.center?.lon);
  const latitude = Number(element.lat ?? element.center?.lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const name =
    tags.name ||
    tags["name:zh"] ||
    tags.brand ||
    tags.operator ||
    "未命名地点";
  const text = `${name} ${tags.cuisine || ""} ${tags.shop || ""}`;
  const category = /(咖啡|面包|烘焙|coffee|cafe|bakery|pastry)/i.test(text)
    ? "咖啡烘焙"
    : /(包子|馒头|生煎|小笼|馄饨|面|粥|饼)/.test(text)
      ? "中式面点"
      : "早餐服务";
  const address = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:subdistrict"],
  ]
    .filter(Boolean)
    .join("");
  const district = inferDistrictFromFeatures(
    longitude,
    latitude,
    districtFeatures
  );
  if (!district) return null;
  return {
    id: `osm:${element.type}/${element.id}`,
    name,
    address,
    type:
      [tags.amenity, tags.shop, tags.office, tags.building, tags.cuisine]
        .filter(Boolean)
        .join(" / ") || "OpenStreetMap",
    tel: tags.phone || tags["contact:phone"] || "",
    rating: null,
    cost: null,
    district,
    lng: rounded(longitude, 6),
    lat: rounded(latitude, 6),
    category,
    source: "OpenStreetMap",
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleOffices(points) {
  const groups = Object.fromEntries(
    districtMeta.map((district) => [district.name, []])
  );
  points.forEach((point) => groups[point.district]?.push(point));
  return Object.values(groups)
    .flatMap((districtPoints) =>
      districtPoints
        .sort(
          (a, b) => stableHash(a.id) - stableHash(b.id) || a.id.localeCompare(b.id)
        )
        .slice(0, 90)
    )
    .sort((a, b) => a.district.localeCompare(b.district) || a.id.localeCompare(b.id));
}

async function readDiskCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function writeDiskCache(payload) {
  await fs.mkdir(CACHE_DIRECTORY, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload));
}

function extractOverpassError(text) {
  const match = text.match(/<strong[^>]*>Error<\/strong>:\s*([^<]+)/i);
  return match?.[1]?.trim() || text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 240);
}

async function requestOverpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 130000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(extractOverpassError(text));
      }
      const payload = JSON.parse(text);
      return payload.elements || [];
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("OpenStreetMap 数据查询失败。");
}

function buildDataset(elementsByType, metadata, districtFeatures) {
  const breakfastPois = elementsByType.breakfast
    .map((element) => normalizeElement(element, districtFeatures))
    .filter(Boolean);
  const officePoisRaw = elementsByType.office
    .map((element) => normalizeElement(element, districtFeatures))
    .filter(Boolean);
  const officePois = sampleOffices(officePoisRaw);
  const districtCounts = Object.fromEntries(
    districtMeta.map((district) => [
      district.name,
      breakfastPois.filter((poi) => poi.district === district.name).length,
    ])
  );
  const officeCounts = Object.fromEntries(
    districtMeta.map((district) => [
      district.name,
      officePoisRaw.filter((poi) => poi.district === district.name).length,
    ])
  );
  return {
    dataVersion: 3,
    fetchedAt: metadata.fetchedAt,
    complete: true,
    source: "OpenStreetMap",
    pois: breakfastPois,
    officePois,
    districtCounts,
    officeCounts,
    districtSamples: Object.fromEntries(
      districtMeta.map((district) => [
        district.name,
        breakfastPois.filter((poi) => poi.district === district.name).length,
      ])
    ),
    officeSamples: Object.fromEntries(
      districtMeta.map((district) => [
        district.name,
        officePois.filter((poi) => poi.district === district.name).length,
      ])
    ),
    license: "OpenStreetMap contributors, ODbL",
  };
}

function fallbackOfficePois() {
  return districtMeta.map((district) => ({
    id: `district-center:${district.name}`,
    name: `${district.shortName}片区办公地点样本`,
    address: "行政区中心代理点",
    type: "行政区中心样本",
    tel: "",
    rating: null,
    cost: null,
    district: district.name,
    lng: district.center[0],
    lat: district.center[1],
    category: "办公地点",
    source: "district-center",
  }));
}

export async function fetchPublicMapDataset(
  { refresh = false, onProgress } = {}
) {
  const cached = memoryCache || (await readDiskCache());
  const cacheAge = cached?.fetchedAt
    ? Date.now() - new Date(cached.fetchedAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (!refresh && cached?.pois?.length && cacheAge < CACHE_TTL_MS) {
    memoryCache = { ...cached, cacheHit: true };
    return memoryCache;
  }

  try {
    onProgress?.({
      percent: 8,
      stage: "正在查询 OpenStreetMap 早餐候选地点",
    });
    const breakfast = await requestOverpass(BREAKFAST_QUERY);
    onProgress?.({
      percent: 55,
      stage: "正在查询 OpenStreetMap 办公地点",
      collected: breakfast.length,
    });
    let office = [];
    let warning = "";
    try {
      office = await requestOverpass(OFFICE_QUERY);
    } catch (error) {
      warning = `办公地点查询失败，已使用行政区中心代理点：${
        error instanceof Error ? error.message : "未知错误"
      }`;
    }
    onProgress?.({
      percent: 88,
      stage: "正在整理坐标、行政区和可达性样本",
      collected: breakfast.length + office.length,
    });
    const geoJson = await loadGeoJson();
    const dataset = buildDataset(
      { breakfast, office },
      { fetchedAt: new Date().toISOString() },
      geoJson.features
    );
    if (!office.length) {
      dataset.complete = false;
      dataset.warning = warning;
      dataset.officePois = fallbackOfficePois();
      dataset.officeCounts = Object.fromEntries(
        districtMeta.map((district) => [district.name, 1])
      );
      dataset.officeSamples = Object.fromEntries(
        districtMeta.map((district) => [district.name, 1])
      );
    }
    memoryCache = dataset;
    await writeDiskCache(dataset);
    onProgress?.({ percent: 100, stage: "OpenStreetMap 数据准备完成" });
    return { ...dataset, cacheHit: false };
  } catch (error) {
    if (cached?.pois?.length) {
      memoryCache = {
        ...cached,
        complete: false,
        cacheHit: true,
        warning: `在线更新失败，已使用上次 OpenStreetMap 缓存：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      };
      return memoryCache;
    }
    throw error;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function searchMapPlaces(keyword, pageSize = 8) {
  const query = String(keyword || "").trim();
  if (!query) return [];
  const cacheKey = `${query}:${pageSize}`;
  const cached = placeSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 10 * 60 * 1000) {
    return cached.items;
  }

  placeSearchQueue = placeSearchQueue.then(async () => {
    const waitTime = Math.max(0, 1100 - (Date.now() - lastPlaceSearchAt));
    if (waitTime) await wait(waitTime);
    lastPlaceSearchAt = Date.now();
  });
  await placeSearchQueue;

  const parameters = new URLSearchParams({
    q: query,
    limit: String(Math.max(1, Math.min(20, pageSize))),
    bbox: SHANGHAI_PHOTON_BBOX,
  });
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`https://photon.komoot.io/api/?${parameters}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) break;
      lastError = new Error(`地点搜索 HTTP ${response.status}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await wait(800 * attempt);
  }
  if (!response?.ok) {
    throw lastError || new Error("免费地点搜索暂时不可用。");
  }
  const payload = await response.json();
  const items = (payload.features || [])
    .map((feature) => {
      const properties = feature.properties || {};
      const [longitude, latitude] = feature.geometry?.coordinates || [];
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return {
        id: `photon:${properties.osm_type || "x"}${properties.osm_id || `${longitude},${latitude}`}`,
        name: properties.name || query,
        district: properties.district || properties.city || "",
        address:
          [properties.street, properties.housenumber].filter(Boolean).join("") ||
          properties.city ||
          "",
        type: [properties.osm_key, properties.osm_value].filter(Boolean).join(" / "),
        location: [longitude, latitude],
      };
    })
    .filter(Boolean)
    .filter(
      (item, index, list) =>
        list.findIndex(
          (candidate) =>
            candidate.name === item.name &&
            distanceInMeters(candidate.location, item.location) < 120
        ) === index
    );
  placeSearchCache.set(cacheKey, { createdAt: Date.now(), items });
  return items;
}

function approximateRoute(origin, destination, mode) {
  const directDistance = distanceInMeters(origin, destination);
  const distance = directDistance * (mode === "transit" ? 1.35 : 1.2);
  const speedKmh = mode === "walking" ? 4.5 : mode === "driving" ? 28 : 18;
  const baseMinutes = (distance / 1000 / speedKmh) * 60;
  const durationMinutes = Math.max(
    1,
    Math.round(baseMinutes + (mode === "transit" ? 8 : 0))
  );
  const middle = [
    (origin[0] + destination[0]) / 2,
    (origin[1] + destination[1]) / 2,
  ];
  return {
    path: [origin, middle, destination],
    durationMinutes,
    distanceKm: rounded(distance / 1000, 1),
    estimated: true,
    source: "距离估算",
  };
}

async function osrmRoute(origin, destination, mode) {
  const endpoint = OSRM_ENDPOINTS[mode];
  if (!endpoint) return approximateRoute(origin, destination, mode);
  const coordinates = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const parameters = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "false",
  });
  const response = await fetch(`${endpoint}/${coordinates}?${parameters}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`OSRM 路径服务 HTTP ${response.status}`);
  const payload = await response.json();
  const route = payload.routes?.[0];
  if (payload.code !== "Ok" || !route?.geometry?.coordinates?.length) {
    throw new Error("OSRM 未返回可用路线。");
  }
  return {
    path: route.geometry.coordinates,
    durationMinutes: Math.max(1, Math.round(Number(route.duration) / 60)),
    distanceKm: rounded(Number(route.distance) / 1000, 1),
    estimated: false,
    source: "OSRM / OpenStreetMap",
  };
}

export async function planPublicRoute({ origin, destination, mode }) {
  if (!Array.isArray(origin) || !Array.isArray(destination)) {
    throw new Error("起点或终点坐标无效。");
  }
  const normalizedMode = ["transit", "driving", "walking"].includes(mode)
    ? mode
    : "transit";
  if (normalizedMode === "transit") {
    return {
      ...approximateRoute(origin, destination, normalizedMode),
      modeLabel: "公共交通（估算）",
    };
  }
  try {
    return {
      ...(await osrmRoute(origin, destination, normalizedMode)),
      modeLabel: normalizedMode === "walking" ? "步行" : "驾车",
    };
  } catch {
    return {
      ...approximateRoute(origin, destination, normalizedMode),
      modeLabel: normalizedMode === "walking" ? "步行（估算）" : "驾车（估算）",
    };
  }
}
