import shanghaiGeoJson from "../assets/shanghai-districts.json";
import {
  PUBLIC_MAP_CACHE_KEY,
  breakfastCategories,
  districtByName,
  districtMeta,
} from "../data/districts";

const WALKING_METERS_PER_MINUTE = 75;

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
      pointInRing(point, polygon[0]) &&
      !polygon.slice(1).some((ring) => pointInRing(point, ring))
  );
}

function isInsideShanghai(point) {
  return shanghaiGeoJson.features.some((feature) =>
    featureContains(feature, [Number(point.lng), Number(point.lat)])
  );
}

export class AmbiguousLocationError extends Error {
  constructor(keyword, candidates) {
    super(`“${keyword}”有多个地点，请选择一个准确的候选地点。`);
    this.name = "AmbiguousLocationError";
    this.candidates = candidates;
  }
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
  const longitude = Number(value?.[0] ?? value?.lng);
  const latitude = Number(value?.[1] ?? value?.lat);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
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
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)
        );
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

function preferenceMatches(poi, preference) {
  const text = `${poi.name || ""} ${poi.category || ""} ${poi.type || ""}`;
  const aliases = {
    包子: /(包子|馒头|生煎|小笼)/,
    生煎: /(生煎|锅贴)/,
    小笼: /(小笼|汤包)/,
    面: /(面馆|面条|拉面|馄饨|饺子)/,
    粥: /(粥|稀饭)/,
    豆浆: /(豆浆|豆花)/,
    油条: /(油条|粢饭|饭团)/,
    煎饼: /(煎饼|手抓饼|鸡蛋饼)/,
    咖啡: /(咖啡|星巴克|瑞幸|Manner|Costa|Tims|coffee|cafe)/i,
    面包: /(面包|烘焙|吐司|bakery|pastry)/i,
    烘焙: /(烘焙|面包|吐司|bakery|pastry)/i,
    清淡: /(粥|豆浆|包子|馒头|面)/,
    热食: /(包子|馒头|面|粥|馄饨|生煎)/,
    热乎: /(包子|馒头|面|粥|馄饨|生煎)/,
  };
  return aliases[preference]?.test(text) || text.includes(preference);
}

function scoreBreakfastCandidate(
  poi,
  routeDistance,
  durationMinutes,
  preferences
) {
  const detourMinutes = rounded(
    (routeDistance.distance * 2) / WALKING_METERS_PER_MINUTE,
    1
  );
  const budgetYuan =
    Number.isFinite(Number(preferences.budgetYuan)) &&
    Number(preferences.budgetYuan) > 0
      ? Number(preferences.budgetYuan)
      : null;
  const maxDetourMinutes =
    Number.isFinite(Number(preferences.maxDetourMinutes)) &&
    Number(preferences.maxDetourMinutes) > 0
      ? Number(preferences.maxDetourMinutes)
      : null;
  const maxWalkMinutes =
    Number.isFinite(Number(preferences.maxWalkMinutes)) &&
    Number(preferences.maxWalkMinutes) > 0
      ? Number(preferences.maxWalkMinutes)
      : null;
  const timeBudgetMinutes =
    Number.isFinite(Number(preferences.timeBudgetMinutes)) &&
    Number(preferences.timeBudgetMinutes) > 0
      ? Number(preferences.timeBudgetMinutes)
      : null;
  if (maxDetourMinutes && detourMinutes > maxDetourMinutes) return null;
  if (maxWalkMinutes && detourMinutes / 2 > maxWalkMinutes) return null;

  const cost = Number(poi.cost);
  const fitsBudget =
    budgetYuan !== null && Number.isFinite(cost) && cost > 0
      ? cost <= budgetYuan
      : null;
  if (fitsBudget === false) return null;

  const text = `${poi.name || ""} ${poi.category || ""} ${poi.type || ""}`;
  const preferenceHits = (preferences.preferences || []).filter((preference) =>
    preferenceMatches(poi, preference)
  );
  const avoidHits = (preferences.avoid || []).filter((term) =>
    text.includes(term)
  );
  if (avoidHits.length > 0) return null;

  const quickRequest = (preferences.preferences || []).some((preference) =>
    /(快速|少排队|方便带走)/.test(preference)
  );
  const totalMinutes = rounded((durationMinutes ?? 0) + detourMinutes);
  if (timeBudgetMinutes && totalMinutes > timeBudgetMinutes) return null;
  const rating = Number(poi.rating) || 4;
  const detourWeight = quickRequest ? 1.45 : 1.15;
  const score =
    detourMinutes * detourWeight +
    Math.max(0, 5 - rating) * 1.4 -
    preferenceHits.length * 1.8;
  const matchReasons = [...preferenceHits];
  if (fitsBudget === true) matchReasons.push(`预算内约 ¥${cost}`);
  if (detourMinutes <= 6) matchReasons.push("绕行较短");
  if (rating >= 4.5) matchReasons.push("评分较高");
  if (timeBudgetMinutes) matchReasons.push("满足到达时间");

  return {
    ...poi,
    routeDistance: rounded(routeDistance.distance),
    nearestRoutePoint: routeDistance.nearest,
    detourMinutes,
    totalMinutes,
    recommendationScore: rounded(score, 2),
    matchReasons: matchReasons.slice(0, 4),
    fitsBudget,
  };
}

function clockToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export async function searchPlaceCandidates(keyword, pageSize = 8) {
  const response = await fetch(
    `/api/place-search?${new URLSearchParams({
      keywords: keyword,
      pageSize: String(pageSize),
    })}`
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `未找到地点：${keyword}`);
  }
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [];
  if (!candidates.length) throw new Error(`未找到地点：${keyword}`);
  return candidates;
}

export async function planCommuteRoute({
  originText,
  destinationText,
  origin,
  destination,
  mode = "transit",
  breakfastPois,
  preferences = {},
}) {
  if (!originText.trim() || !destinationText.trim()) {
    throw new Error("请填写起点和终点。");
  }
  const resolvedOrigin = origin?.location
    ? origin
    : (await searchPlaceCandidates(originText, 8))[0];
  const resolvedDestination = destination?.location
    ? destination
    : (await searchPlaceCandidates(destinationText, 8))[0];
  if (!resolvedOrigin?.location || !resolvedDestination?.location) {
    throw new Error("起点或终点坐标无效。");
  }

  const response = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: resolvedOrigin.location,
      destination: resolvedDestination.location,
      mode,
    }),
  });
  const route = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(route.message || "免费路径规划失败。");
  }
  const path = (route.path || [])
    .map(toCoordinate)
    .filter(Boolean);
  const durationMinutes = Number(route.durationMinutes) || null;
  const departureMinutes = clockToMinutes(preferences.departureTime);
  const arrivalMinutes = clockToMinutes(preferences.arrivalTime);
  const timeBudgetMinutes =
    departureMinutes !== null &&
    arrivalMinutes !== null &&
    arrivalMinutes > departureMinutes
      ? arrivalMinutes - departureMinutes
      : null;
  const rankingPreferences =
    timeBudgetMinutes === null
      ? preferences
      : { ...preferences, timeBudgetMinutes };
  const requestedWalkLimit =
    Number.isFinite(Number(preferences.maxWalkMinutes)) &&
    Number(preferences.maxWalkMinutes) > 0
      ? Number(preferences.maxWalkMinutes) * WALKING_METERS_PER_MINUTE * 2
      : null;
  const offsetLimit =
    requestedWalkLimit ??
    (mode === "walking" ? 250 : mode === "driving" ? 380 : 500);

  const recommendations = breakfastPois
    .map((poi) => {
      const routeDistance = distanceToRoute(poi, path);
      if (!routeDistance || routeDistance.distance > offsetLimit) return null;
      return scoreBreakfastCandidate(
        poi,
        routeDistance,
        durationMinutes,
        rankingPreferences
      );
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.recommendationScore - b.recommendationScore ||
        a.detourMinutes - b.detourMinutes
    )
    .slice(0, 20);

  return {
    origin: resolvedOrigin,
    destination: resolvedDestination,
    mode,
    modeLabel: route.modeLabel,
    path,
    durationMinutes,
    distanceKm: rounded(Number(route.distanceKm) || 0, 1),
    estimated: Boolean(route.estimated),
    routeSource: route.source,
    recommendations: recommendations.slice(0, 6),
    recommendationCandidates: recommendations,
    intent: rankingPreferences,
    createdAt: new Date().toISOString(),
  };
}

export function buildRealtimeDataset(
  breakfastPois,
  officePois,
  lastUpdated,
  totals = {}
) {
  breakfastPois = breakfastPois.filter(isInsideShanghai);
  officePois = officePois.filter(isInsideShanghai);
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
  const effectiveSupplyCounts = breakfastSampleByDistrict;
  const effectiveOfficeCounts = officeSampleByDistrict;
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
    dataMode: totals.dataMode ?? "osm-live",
    complete: Boolean(totals.complete),
    serverMessage:
      totals.serverMessage || "数据来自 OpenStreetMap 公共地图服务。",
  };
}

async function requestPublicDataset(refresh = false, onProgress) {
  const useStream = typeof onProgress === "function";
  const parameters = new URLSearchParams();
  if (refresh) parameters.set("refresh", "1");
  if (useStream) parameters.set("progress", "1");
  const response = await fetch(
    `/api/map-dataset${parameters.size ? `?${parameters}` : ""}`,
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
        if (message.type === "progress") onProgress(message);
        if (message.type === "result") return message.payload;
        if (message.type === "error") {
          throw new Error(message.message || "OpenStreetMap 数据加载失败。");
        }
      }
      if (done) break;
    }
    throw new Error("OpenStreetMap 数据流提前结束。");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "OpenStreetMap 数据加载失败。");
  }
  return payload;
}

export async function fetchRealtimeDataset({
  refreshFull = false,
  onProgress,
} = {}) {
  const payload = await requestPublicDataset(refreshFull, onProgress);
  const dataset = buildRealtimeDataset(
    payload.pois || [],
    payload.officePois || [],
    payload.fetchedAt,
    {
      supplyCounts: payload.districtCounts,
      officeCounts: payload.officeCounts,
      dataMode: payload.cacheHit ? "osm-cache" : "osm-live",
      complete: payload.complete,
      serverMessage:
        payload.warning ||
        "数据来自 OpenStreetMap、Overpass、Photon 与 OSRM。",
    }
  );
  saveDatasetCache(dataset);
  return dataset;
}

export function loadDatasetCache() {
  try {
    const raw = window.localStorage.getItem(PUBLIC_MAP_CACHE_KEY);
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
        dataMode: "osm-cache",
        complete: cached.complete,
        serverMessage: cached.serverMessage,
      }
    );
  } catch {
    return null;
  }
}

export function saveDatasetCache(dataset) {
  try {
    window.localStorage.setItem(
      PUBLIC_MAP_CACHE_KEY,
      JSON.stringify({
        breakfastPois: dataset.breakfastPois,
        officePois: dataset.officePois.map(
          ({ nearestDistanceMeters, ...office }) => office
        ),
        supplyCounts: dataset.supplyCounts,
        officeCounts: dataset.officeCounts,
        complete: dataset.complete,
        serverMessage: dataset.serverMessage,
        lastUpdated: dataset.lastUpdated,
      })
    );
  } catch {
    // Local storage quota should not block rendering.
  }
}

export const publicMapAttribution = {
  boundaries: "DataV.GeoAtlas",
  places: "Photon / OpenStreetMap",
  routing: "OSRM / OpenStreetMap",
  pois: "OpenStreetMap contributors · ODbL",
};

export { shanghaiGeoJson };
