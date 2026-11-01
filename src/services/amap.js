import shanghaiGeoJson from "../assets/shanghai-districts.json";
import {
  AMAP_CACHE_KEY,
  breakfastCategories,
  breakfastQuery,
  districtByName,
  districtMeta,
  officeQuery,
} from "../data/districts";

const AMAP_KEY = import.meta.env.VITE_AMAP_KEY;
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE;
const PAGE_SIZE = 50;
const WALKING_METERS_PER_MINUTE = 75;

let amapLoader;

export class AmapConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AmapConfigurationError";
  }
}

export class AmbiguousLocationError extends Error {
  constructor(keyword, candidates) {
    super(`“${keyword}”有多个地点，请选择一个准确的候选地点。`);
    this.name = "AmbiguousLocationError";
    this.candidates = candidates;
  }
}

export function getAmapConfigurationStatus() {
  return {
    hasKey: Boolean(AMAP_KEY),
    hasSecurityCode: Boolean(AMAP_SECURITY_CODE),
  };
}

export function loadAmap() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;

  if (!AMAP_KEY) {
    return Promise.reject(
      new AmapConfigurationError(
        "缺少 VITE_AMAP_KEY，请在 .env.local 中配置高德 JavaScript API Key。"
      )
    );
  }

  amapLoader = new Promise((resolve, reject) => {
    window._AMapSecurityConfig = {
      securityJsCode: AMAP_SECURITY_CODE || "",
    };

    const script = document.createElement("script");
    script.id = "amap-js-api";
    script.async = true;
    script.src =
      `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}` +
      "&plugin=AMap.PlaceSearch,AMap.Scale,AMap.ToolBar,AMap.Text,AMap.CircleMarker,AMap.MassMarks";

    const timeout = window.setTimeout(() => {
      reject(new Error("高德地图脚本加载超时，请检查网络或 API Key 配置。"));
    }, 20000);

    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.AMap) resolve(window.AMap);
      else reject(new Error("高德地图脚本已加载，但全局 AMap 对象不可用。"));
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("高德地图脚本加载失败，请检查网络、Key 和域名白名单。"));
    };

    document.head.appendChild(script);
  }).catch((error) => {
    amapLoader = undefined;
    throw error;
  });

  return amapLoader;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function flatten(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  return value || "";
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

function inferDistrict(poi, point) {
  if (districtByName[poi.adname]) return poi.adname;

  let nearest = districtMeta[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  districtMeta.forEach((district) => {
    const candidate = distanceInMeters(point, district.center);
    if (candidate < nearestDistance) {
      nearest = district;
      nearestDistance = candidate;
    }
  });
  return nearest.name;
}

function breakfastCategory(poi) {
  const text = `${poi.name || ""} ${flatten(poi.type)}`;
  if (/(咖啡|星巴克|瑞幸|Manner|Costa|Tims)/i.test(text)) {
    return "咖啡烘焙";
  }
  if (/(包子|馒头|生煎|小笼|馄饨|面馆|饼|粥|早点)/.test(text)) {
    return "中式面点";
  }
  return "早餐服务";
}

function normalizePoi(poi, type) {
  const longitude = Number(
    poi.location?.lng ?? poi.location?.getLng?.() ?? Number.NaN
  );
  const latitude = Number(
    poi.location?.lat ?? poi.location?.getLat?.() ?? Number.NaN
  );
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const point = [longitude, latitude];
  return {
    id: String(poi.id || `${longitude},${latitude},${poi.name}`),
    name: poi.name || "未命名地点",
    address: flatten(poi.address),
    type: flatten(poi.type),
    tel: flatten(poi.tel),
    rating: Number(poi.biz_ext?.rating ?? 0) || null,
    cost: Number(poi.biz_ext?.cost ?? 0) || null,
    district: inferDistrict(poi, point),
    lng: longitude,
    lat: latitude,
    category: type === "office" ? "办公地点" : breakfastCategory(poi),
  };
}

function districtFeature(name) {
  return shanghaiGeoJson.features.find(
    (feature) => feature.properties.name === name
  );
}

function ringsFor(feature) {
  if (feature.geometry.type === "Polygon") return feature.geometry.coordinates;
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.flatMap((polygon) => polygon);
  }
  return [];
}

function boundsForFeature(AMap, feature) {
  let minimumLongitude = Number.POSITIVE_INFINITY;
  let minimumLatitude = Number.POSITIVE_INFINITY;
  let maximumLongitude = Number.NEGATIVE_INFINITY;
  let maximumLatitude = Number.NEGATIVE_INFINITY;

  ringsFor(feature).forEach((ring) => {
    ring.forEach(([longitude, latitude]) => {
      minimumLongitude = Math.min(minimumLongitude, longitude);
      minimumLatitude = Math.min(minimumLatitude, latitude);
      maximumLongitude = Math.max(maximumLongitude, longitude);
      maximumLatitude = Math.max(maximumLatitude, latitude);
    });
  });

  return new AMap.Bounds(
    [minimumLongitude, minimumLatitude],
    [maximumLongitude, maximumLatitude]
  );
}

async function searchInDistrict(AMap, keyword, feature, type) {
  const bounds = boundsForFeature(AMap, feature);

  return new Promise((resolve, reject) => {
    const search = new AMap.PlaceSearch({
      city: "上海",
      citylimit: true,
      pageIndex: 1,
      pageSize: PAGE_SIZE,
      extensions: "all",
    });

    search.searchInBounds(keyword, bounds, (status, result) => {
      if (status === "no_data") {
        resolve({ points: [], total: 0 });
        return;
      }

      if (status !== "complete") {
        reject(
          new Error(
            `高德 POI 查询失败：${result?.info || result?.message || status}`
          )
        );
        return;
      }

      const pois = result?.poiList?.pois ?? [];
      const total = Number(result?.poiList?.count ?? pois.length);
      resolve({
        points: pois
          .map((poi) => normalizePoi(poi, type))
          .filter(Boolean),
        total: Number.isFinite(total) ? total : pois.length,
      });
    });
  });
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return results;
}

async function searchWithRetry(AMap, keyword, feature, type) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await searchInDistrict(AMap, keyword, feature, type);
    } catch (error) {
      lastError = error;
      await wait(600 * attempt);
    }
  }
  throw lastError;
}

function deduplicate(points) {
  return [...new Map(points.map((point) => [point.id, point])).values()];
}

function nearestDistance(point, candidates) {
  let minimum = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const distance = distanceInMeters(
      [point.lng, point.lat],
      [candidate.lng, candidate.lat]
    );
    if (distance < minimum) minimum = distance;
  });
  return minimum;
}

function rounded(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function toCoordinate(value) {
  const longitude = Number(value?.lng ?? value?.getLng?.() ?? value?.[0]);
  const latitude = Number(value?.lat ?? value?.getLat?.() ?? value?.[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
}

function collectRoutePath(route) {
  const points = [];

  function visit(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      if (node.length > 0 && toCoordinate(node[0])) {
        node.forEach((point) => {
          const coordinate = toCoordinate(point);
          if (coordinate) points.push(coordinate);
        });
        return;
      }
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    Object.values(node).forEach(visit);
  }

  visit(route);
  return points;
}

function pointToSegmentMeters(point, start, end) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;
  const averageLatitude = toRadians((start[1] + end[1] + point[1]) / 3);
  const x = (coordinate) =>
    toRadians(coordinate[0]) * Math.cos(averageLatitude) * earthRadius;
  const y = (coordinate) => toRadians(coordinate[1]) * earthRadius;
  const px = x(point);
  const py = y(point);
  const ax = x(start);
  const ay = y(start);
  const bx = x(end);
  const by = y(end);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const nearestPoint = [ax + projection * dx, ay + projection * dy];
  return {
    distance: Math.hypot(px - nearestPoint[0], py - nearestPoint[1]),
    nearest: [
      start[0] + (end[0] - start[0]) * projection,
      start[1] + (end[1] - start[1]) * projection,
    ],
  };
}

function distanceToRoute(poi, routePath) {
  if (routePath.length === 0) return Number.POSITIVE_INFINITY;
  if (routePath.length === 1) {
    return {
      distance: distanceInMeters(
        [poi.lng, poi.lat],
        [routePath[0][0], routePath[0][1]]
      ),
      nearest: routePath[0],
    };
  }

  let minimum = {
    distance: Number.POSITIVE_INFINITY,
    nearest: routePath[0],
  };
  for (let index = 1; index < routePath.length; index += 1) {
    const candidate = pointToSegmentMeters(
      [poi.lng, poi.lat],
      routePath[index - 1],
      routePath[index]
    );
    if (candidate.distance < minimum.distance) minimum = candidate;
  }
  return minimum;
}

function searchLocationCandidates(AMap, keyword, pageSize = 8) {
  return new Promise((resolve, reject) => {
    const search = new AMap.PlaceSearch({
      city: "上海",
      citylimit: true,
      pageIndex: 1,
      pageSize,
      extensions: "all",
    });
    search.search(keyword, (status, result) => {
      if (status !== "complete" || !result?.poiList?.pois?.length) {
        reject(new Error(`未找到地点：${keyword}`));
        return;
      }
      const candidates = result.poiList.pois
        .map((poi) => {
          const location = toCoordinate(poi.location);
          return location
            ? {
                id: String(poi.id || `${poi.name},${location.join(",")}`),
                name: poi.name || keyword,
                district: poi.adname || "",
                address: flatten(poi.address),
                type: flatten(poi.type),
                location,
              }
            : null;
        })
        .filter(Boolean);
      if (candidates.length === 0) {
        reject(new Error(`未找到地点：${keyword}`));
        return;
      }
      resolve(candidates);
    });
  });
}

export async function searchPlaceCandidates(keyword, pageSize = 8) {
  try {
    const response = await fetch(
      `/api/place-search?${new URLSearchParams({
        keywords: keyword,
        pageSize: String(pageSize),
      })}`
    );
    const payload = await response.json();
    if (response.ok && payload?.candidates?.length) {
      return payload.candidates;
    }
  } catch {
    // Fall back to the browser SDK when the server endpoint is unavailable.
  }

  const AMap = await loadAmap();
  return searchLocationCandidates(AMap, keyword, pageSize);
}

async function searchLocation(AMap, keyword) {
  const coordinate = keyword
    .split(",")
    .map((value) => Number(value.trim()));
  if (
    coordinate.length === 2 &&
    Number.isFinite(coordinate[0]) &&
    Number.isFinite(coordinate[1])
  ) {
    return {
      name: keyword,
      location: coordinate,
    };
  }

  const candidates = await searchLocationCandidates(AMap, keyword, 8);
  if (candidates.length > 1) {
    throw new AmbiguousLocationError(keyword, candidates);
  }
  return {
    name: candidates[0].name,
    district: candidates[0].district,
    address: candidates[0].address,
    location: candidates[0].location,
  };
}

function planWithPlugin(AMap, mode, origin, destination) {
  return new Promise((resolve, reject) => {
    let planner;
    if (mode === "walking") {
      planner = new AMap.Walking({ hideMarkers: true });
    } else if (mode === "driving") {
      planner = new AMap.Driving({ hideMarkers: true });
    } else {
      planner = new AMap.Transfer({
        city: "上海",
        cityd: "上海",
        hideMarkers: true,
      });
    }

    planner.search(origin, destination, (status, result) => {
      const route =
        mode === "transit"
          ? result?.plans?.[0] ?? result?.routes?.[0]
          : result?.routes?.[0];
      if (status !== "complete" || !route) {
        reject(
          new Error(
            `未找到可用通勤路径：${result?.info || result?.message || status}`
          )
        );
        return;
      }
      resolve(route);
    });
  });
}

function loadRoutePlugins(AMap) {
  return new Promise((resolve, reject) => {
    AMap.plugin(["AMap.Driving", "AMap.Walking", "AMap.Transfer"], () => {
      if (AMap.Driving && AMap.Walking && AMap.Transfer) resolve();
      else reject(new Error("高德路径规划插件加载失败。"));
    });
  });
}

export async function planCommuteRoute({
  originText,
  destinationText,
  origin,
  destination,
  mode = "transit",
  breakfastPois,
}) {
  const trimmedOrigin = originText.trim();
  const trimmedDestination = destinationText.trim();
  if (!trimmedOrigin || !trimmedDestination) {
    throw new Error("请填写起点和终点。");
  }

  const AMap = await loadAmap();
  await loadRoutePlugins(AMap);
  const [resolvedOrigin, resolvedDestination] = await Promise.all([
    origin?.location
      ? Promise.resolve(origin)
      : searchLocation(AMap, trimmedOrigin),
    destination?.location
      ? Promise.resolve(destination)
      : searchLocation(AMap, trimmedDestination),
  ]);
  const route = await planWithPlugin(
    AMap,
    mode,
    resolvedOrigin.location,
    resolvedDestination.location
  );
  const directPath = Array.isArray(route.path)
    ? route.path.map(toCoordinate).filter(Boolean)
    : [];
  const routePath =
    directPath.length >= 2 ? directPath : collectRoutePath(route);
  const path =
    routePath.length >= 2
      ? routePath
      : [resolvedOrigin.location, resolvedDestination.location];
  const offsetLimit = mode === "walking" ? 250 : mode === "driving" ? 380 : 500;
  const durationSeconds = Number(route.duration ?? route.time ?? 0);
  const durationMinutes =
    durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : null;
  const distanceKm = rounded(Number(route.distance) / 1000, 1);

  const recommendations = breakfastPois
    .map((poi) => {
      const routeDistance = distanceToRoute(poi, path);
      if (!routeDistance || routeDistance.distance > offsetLimit) return null;
      const detourMinutes = rounded(
        (routeDistance.distance * 2) / WALKING_METERS_PER_MINUTE,
        1
      );
      const rating = poi.rating || 4;
      const score =
        detourMinutes * 1.15 + Math.max(0, 5 - rating) * 1.4;
      return {
        ...poi,
        routeDistance: rounded(routeDistance.distance),
        nearestRoutePoint: routeDistance.nearest,
        detourMinutes,
        totalMinutes: rounded((durationMinutes ?? 0) + detourMinutes),
        recommendationScore: rounded(score, 2),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.recommendationScore - b.recommendationScore ||
        a.detourMinutes - b.detourMinutes
    )
    .slice(0, 6);

  return {
    origin: resolvedOrigin,
    destination: resolvedDestination,
    mode,
    modeLabel:
      mode === "walking" ? "步行" : mode === "driving" ? "驾车" : "公共交通",
    path,
    durationMinutes,
    distanceKm,
    recommendations,
    createdAt: new Date().toISOString(),
  };
}

export function buildRealtimeDataset(
  breakfastPois,
  officePois,
  lastUpdated,
  totals = {}
) {
  const supplyCounts = totals.supplyCounts ?? {};
  const officeCounts = totals.officeCounts ?? {};
  const officeSamples = officePois.map((office) => ({
    ...office,
    nearestDistanceMeters:
      breakfastPois.length > 0
        ? nearestDistance(office, breakfastPois)
        : Number.POSITIVE_INFINITY,
  }));

  const breakfastSampleByDistrict = Object.fromEntries(
    districtMeta.map((district) => [
      district.name,
      breakfastPois.filter((poi) => poi.district === district.name).length,
    ])
  );
  const officeSampleByDistrict = Object.fromEntries(
    districtMeta.map((district) => [
      district.name,
      officeSamples.filter((office) => office.district === district.name).length,
    ])
  );

  const effectiveSupplyCounts = Object.fromEntries(
    districtMeta.map((district) => [
      district.name,
      supplyCounts[district.name] ?? breakfastSampleByDistrict[district.name],
    ])
  );
  const effectiveOfficeCounts = Object.fromEntries(
    districtMeta.map((district) => [
      district.name,
      officeCounts[district.name] ?? officeSampleByDistrict[district.name],
    ])
  );

  const maxSupplyCount = Math.max(1, ...Object.values(effectiveSupplyCounts));
  const maxOfficeCount = Math.max(1, ...Object.values(effectiveOfficeCounts));

  const normalizedDistricts = districtMeta.map((meta) => {
    const districtOffices = officeSamples.filter(
      (office) => office.district === meta.name
    );
    const districtDistances = districtOffices.map(
      (office) => office.nearestDistanceMeters
    );

    const coverageFor = (minutes) => {
      if (districtOffices.length === 0) return 0;
      const limit = minutes * WALKING_METERS_PER_MINUTE;
      return rounded(
        (districtDistances.filter((distance) => distance <= limit).length /
          districtOffices.length) *
          100
      );
    };

    const supplyCount = effectiveSupplyCounts[meta.name];
    const officeCount = effectiveOfficeCounts[meta.name];
    const officePressure = officeCount / maxOfficeCount;
    const supplyScarcity = 1 - supplyCount / maxSupplyCount;
    const lowCoverage = 1 - coverageFor(15) / 100;
    const gap =
      officeCount === 0
        ? 0
        : rounded(
            (lowCoverage * 0.58 +
              officePressure * 0.24 +
              supplyScarcity * 0.18) *
              100
          );
    const finiteDistances = districtDistances.filter(Number.isFinite);
    const averageDistance =
      finiteDistances.length > 0
        ? finiteDistances.reduce((total, distance) => total + distance, 0) /
          finiteDistances.length
        : Number.POSITIVE_INFINITY;

    return {
      ...meta,
      stalls: supplyCount,
      commuters: officeCount,
      coverage: {
        15: coverageFor(15),
        20: coverageFor(20),
        30: coverageFor(30),
      },
      arrival: Number.isFinite(averageDistance)
        ? rounded(averageDistance / WALKING_METERS_PER_MINUTE)
        : null,
      gap,
      poiSamples: breakfastSampleByDistrict[meta.name],
      officeSamples: officeSampleByDistrict[meta.name],
    };
  });

  const categoryCounts = breakfastCategories.map((category) => ({
    label: category.category,
    value: breakfastPois.filter((poi) => poi.category === category.category)
      .length,
    color: category.color,
  }));
  const categorizedCount = categoryCounts.reduce(
    (total, category) => total + category.value,
    0
  );
  categoryCounts.push({
    label: "其他",
    value: Math.max(0, breakfastPois.length - categorizedCount),
    color: "#a89078",
  });

  const distanceSamples = officeSamples
    .map((office) => ({
      ...office,
      walkingMinutes: Number.isFinite(office.nearestDistanceMeters)
        ? rounded(office.nearestDistanceMeters / WALKING_METERS_PER_MINUTE)
        : 999,
    }))
    .filter((office) => office.walkingMinutes < 998);

  return {
    breakfastPois,
    officePois: officeSamples,
    districts: normalizedDistricts,
    distanceSamples,
    mix: categoryCounts,
    lastUpdated,
    walkingSpeed: WALKING_METERS_PER_MINUTE,
    supplyCounts: effectiveSupplyCounts,
    officeCounts: effectiveOfficeCounts,
    totalBreakfast: Object.values(effectiveSupplyCounts).reduce(
      (total, value) => total + value,
      0
    ),
    totalOfficeSamples: Object.values(effectiveOfficeCounts).reduce(
      (total, value) => total + value,
      0
    ),
    dataMode: totals.dataMode ?? "sample",
    complete: Boolean(totals.complete),
    serverMessage:
      totals.serverMessage || "当前为浏览器端区级均衡采样数据。",
  };
}

async function requestFullBreakfastPois(refresh = false, onProgress) {
  const useStream = typeof onProgress === "function";
  const parameters = new URLSearchParams();
  if (refresh) parameters.set("refresh", "1");
  if (useStream) parameters.set("progress", "1");
  const response = await fetch(
    `/api/breakfast-pois${parameters.size ? `?${parameters}` : ""}`,
    {
      headers: {
        Accept: useStream
          ? "application/x-ndjson, application/json"
          : "application/json",
      },
    }
  );

  if (
    useStream &&
    response.ok &&
    response.headers.get("content-type")?.includes("application/x-ndjson")
  ) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "progress") {
          onProgress(message);
        } else if (message.type === "result") {
          return message.payload;
        } else if (message.type === "error") {
          throw new Error(message.message || "高德全量数据汇总失败。");
        }
      }
      if (done) break;
    }
    throw new Error("高德全量数据流提前结束。");
  }

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(
      payload?.message || "服务端尚未返回完整早餐 POI 数据。"
    );
    error.code = payload?.error;
    throw error;
  }
  return payload;
}

export async function fetchRealtimeDataset({
  refreshFull = false,
  onProgress,
} = {}) {
  const AMap = await loadAmap();
  let fullDataset;
  let fullDataError;

  try {
    fullDataset = await requestFullBreakfastPois(refreshFull, onProgress);
  } catch (error) {
    fullDataError = error;
  }

  const officeSearches = await mapWithConcurrency(
    districtMeta,
    2,
    async (district) => {
      const feature = districtFeature(district.name);
      const office = await searchWithRetry(
        AMap,
        officeQuery,
        feature,
        "office"
      );
      return { district: district.name, office };
    }
  );

  let breakfastPois = fullDataset?.pois ?? [];
  let supplyCounts = fullDataset?.districtCounts ?? {};
  let dataMode = fullDataset
    ? fullDataset.complete
      ? "complete"
      : "server-partial"
    : "sample";
  let serverMessage = fullDataset
    ? fullDataset.warning || "服务端区级分页汇总已完成。"
    : fullDataError?.message || "服务端全量数据不可用，已切换为区级均衡采样。";

  if (breakfastPois.length === 0) {
    dataMode = "sample";
    const breakfastSearches = await mapWithConcurrency(
      districtMeta,
      2,
      async (district) => {
        const feature = districtFeature(district.name);
        const breakfast = await searchWithRetry(
          AMap,
          breakfastQuery,
          feature,
          "breakfast"
        );
        return { district: district.name, breakfast };
      }
    );
    breakfastPois = deduplicate(
      breakfastSearches.flatMap((result) => result.breakfast.points)
    );
    supplyCounts = Object.fromEntries(
      breakfastSearches.map((result) => [
        result.district,
        result.breakfast.total,
      ])
    );
  }

  const officePois = deduplicate(
    officeSearches.flatMap((result) => result.office.points)
  );
  const officeCounts = Object.fromEntries(
    officeSearches.map((result) => [result.district, result.office.total])
  );

  if (breakfastPois.length === 0) {
    throw new Error("高德地图未返回上海早餐 POI，请稍后重试。");
  }
  if (officePois.length === 0) {
    throw new Error("高德地图未返回上海办公地点 POI，无法计算可达性。");
  }

  const dataset = buildRealtimeDataset(
    breakfastPois,
    officePois,
    new Date().toISOString(),
    {
      supplyCounts,
      officeCounts,
      dataMode,
      serverMessage,
      complete: Boolean(fullDataset?.complete),
    }
  );
  saveDatasetCache(dataset);
  return dataset;
}

export function loadDatasetCache() {
  try {
    const raw = window.localStorage.getItem(AMAP_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (
      !cached?.breakfastPois?.length ||
      !cached?.officePois?.length ||
      !cached?.lastUpdated
    ) {
      return null;
    }
    return buildRealtimeDataset(
      cached.breakfastPois,
      cached.officePois,
      cached.lastUpdated,
      {
        supplyCounts: cached.supplyCounts,
        officeCounts: cached.officeCounts,
        dataMode: cached.dataMode,
        complete: cached.complete,
        serverMessage: cached.serverMessage,
      }
    );
  } catch {
    return null;
  }
}

function saveDatasetCache(dataset) {
  try {
    window.localStorage.setItem(
      AMAP_CACHE_KEY,
      JSON.stringify({
        breakfastPois: dataset.breakfastPois,
        officePois: dataset.officePois.map(
          ({ nearestDistanceMeters, ...office }) => office
        ),
        supplyCounts: dataset.supplyCounts,
        officeCounts: dataset.officeCounts,
        dataMode: dataset.dataMode,
        complete: dataset.complete,
        serverMessage: dataset.serverMessage,
        lastUpdated: dataset.lastUpdated,
      })
    );
  } catch {
    // A full localStorage should not block live data rendering.
  }
}
