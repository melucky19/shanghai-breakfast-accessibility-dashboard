const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const ZHIPU_MODEL = "glm-4.7-flash";
const ZHIPU_FALLBACK_MODEL = "glm-4.5-flash";
const ZHIPU_PRIMARY_TIMEOUT_MS = 20000;
const DEFAULT_TIMEOUT_MS = 60000;
const ALLOWED_MODES = new Set(["transit", "driving", "walking"]);
const PREFERENCE_KEYWORDS = [
  "包子",
  "生煎",
  "小笼",
  "面",
  "粥",
  "豆浆",
  "油条",
  "煎饼",
  "馄饨",
  "饺子",
  "咖啡",
  "面包",
  "烘焙",
  "清淡",
  "热食",
  "热乎",
  "快速",
  "方便带走",
  "少排队",
];
const CHINESE_DIGITS = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function cleanText(value, maximumLength = 200) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function uniqueStrings(values, maximumItems = 8) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) => cleanText(value, 30))
        .filter(Boolean)
    ),
  ].slice(0, maximumItems);
}

function canonicalPreferences(values) {
  return uniqueStrings(values)
    .map((value) => {
      const matched = PREFERENCE_KEYWORDS.find(
        (keyword) => value.includes(keyword) || keyword.includes(value)
      );
      return matched || value;
    })
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function boundedNumber(value, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeMode(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (ALLOWED_MODES.has(text)) return text;
  if (/(公交|地铁|公共交通|转车)/.test(text)) return "transit";
  if (/(驾车|开车|打车|汽车)/.test(text)) return "driving";
  if (/(步行|走路|徒步)/.test(text)) return "walking";
  return "transit";
}

function parseChineseInteger(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  if (!text.includes("十")) {
    return [...text].reduce(
      (total, character) => total * 10 + (CHINESE_DIGITS[character] || 0),
      0
    );
  }
  const [tensText, unitsText = ""] = text.split("十");
  const tens = tensText ? CHINESE_DIGITS[tensText] || 0 : 1;
  const units = unitsText ? CHINESE_DIGITS[unitsText] || 0 : 0;
  return tens * 10 + units;
}

function normalizeClock(value) {
  const text = cleanText(value, 20);
  const arabicMatch = text.match(
    /^(\d{1,2})(?:[:：点时])(半|一刻|三刻|\d{1,2})?/
  );
  const chineseMatch = text.match(
    /^([零〇一二两三四五六七八九十百]+)点(?:(半|一刻|三刻)|([零〇一二两三四五六七八九十百]+|\d{1,2})分?)?/
  );
  if (!arabicMatch && !chineseMatch) return null;
  const hour = Math.min(
    23,
    Math.max(
      0,
      arabicMatch
        ? Number(arabicMatch[1])
        : parseChineseInteger(chineseMatch[1])
    )
  );
  const minuteToken = arabicMatch
    ? arabicMatch[2]
    : chineseMatch[2] || chineseMatch[3];
  const minute =
    minuteToken === "半"
      ? 30
      : minuteToken === "一刻"
        ? 15
        : minuteToken === "三刻"
          ? 45
          : /^\d+$/.test(minuteToken || "")
            ? Number(minuteToken)
            : parseChineseInteger(minuteToken || "");
  return `${String(hour).padStart(2, "0")}:${String(
    Math.min(59, Math.max(0, minute))
  ).padStart(2, "0")}`;
}

function extractClock(message, target) {
  const matches = [
    ...message.matchAll(
      /(?:\d{1,2}(?:[:：点时])(?:半|一刻|三刻|\d{1,2})?(?:分)?|[零〇一二两三四五六七八九十]+点(?:(?:半|一刻|三刻)|(?:[零〇一二两三四五六七八九十]+|\d{1,2})分?)?)/g
    ),
  ];
  for (const match of matches) {
    const start = match.index + match[0].length;
    const before = message.slice(Math.max(0, match.index - 12), match.index);
    const after = message.slice(start, Math.min(message.length, start + 12));
    const isDeparture =
      /(出发|出门|启程)/.test(before) ||
      /^\s*(?:从|出门|启程|去|前往)/.test(after);
    const isArrival =
      /(前到|之前到|以前到|到达|抵达|到公司|到单位)/.test(after) ||
      /^\s*到(?:静安|徐汇|黄浦|上海大学|学校|公司|单位|那里|这儿)/.test(
        after
      );
    if (target === "departure" && isDeparture) {
      return normalizeClock(match[0]);
    }
    if (target === "arrival" && isArrival) {
      return normalizeClock(match[0]);
    }
  }
  return null;
}

function extractOrigin(message) {
  const labeled = message.match(
    /(?:起点|出发地|从)\s*[:：]?\s*([^，,。；;\n]{2,40}?)(?=出发|启程|到|去|前往|上班|$)/ 
  );
  return cleanText(labeled?.[1], 50) || null;
}

function extractDestination(message) {
  const labeled = message.match(
    /(?:终点|目的地|到|去|前往)\s*[:：]?\s*([^，,。；;\n]{2,40}?)(?=上班|工作|公司|单位|吃饭|买早餐|[，,。；;\n]|$)/
  );
  return cleanText(labeled?.[1], 50) || null;
}

function extractNumberBeforeUnit(message, words, unit) {
  const match = message.match(
    new RegExp(`(?:${words})[^\\d]{0,8}(\\d{1,3})(?:\\.\\d+)?\\s*${unit}`)
  );
  return match ? Number(match[1]) : null;
}

export function parseChatIntentLocally(message) {
  const text = cleanText(message, 1200);
  const mode = /(开车|驾车|打车)/.test(text)
    ? "driving"
    : /(地铁|公交|公共交通|换乘)/.test(text)
      ? "transit"
      : /(步行|走路|徒步)/.test(text)
        ? "walking"
        : "transit";
  const preferences = new Set(
    PREFERENCE_KEYWORDS.filter((keyword) => text.includes(keyword))
  );
  const avoid = [];
  if (/(不要辣|不吃辣|忌辣|少辣)/.test(text)) avoid.push("辣");
  if (/(不要咖啡|不喝咖啡|咖啡因)/.test(text)) avoid.push("咖啡");
  if (/(不吃甜|不要甜|控糖)/.test(text)) avoid.push("甜");
  if (/(不想吃油|不要油|不吃油|油腻|少油|清淡一点|清淡些)/.test(text)) {
    preferences.add("清淡");
    avoid.push("油炸", "油条", "炸鸡", "煎饼");
  }

  const originQuery = extractOrigin(text);
  const destinationQuery = extractDestination(text);
  const departureTime = extractClock(text, "departure");
  const arrivalTime =
    extractClock(text, "arrival") ||
    (!departureTime
      ? normalizeClock(
          text.match(
            /(\d{1,2})(?:[:：点时])(\d{1,2})?\s*(?:前|之前|以前)/
          )?.[0]
        )
      : null);

  return {
    originQuery,
    destinationQuery,
    mode,
    departureTime,
    arrivalTime,
    budgetYuan: boundedNumber(
      extractNumberBeforeUnit(text, "预算|不超过|控制在|价格", "元"),
      1,
      500
    ),
    maxDetourMinutes: boundedNumber(
      extractNumberBeforeUnit(
        text,
        "绕行|绕路|多走|取餐|早餐时间",
        "分钟"
      ),
      1,
      120
    ),
    maxWalkMinutes: boundedNumber(
      extractNumberBeforeUnit(text, "步行|走路", "分钟"),
      1,
      60
    ),
    preferences: uniqueStrings([...preferences]),
    avoid: uniqueStrings(avoid),
    assistantMessage: "",
    missingFields: [
      !originQuery ? "origin" : null,
      !destinationQuery ? "destination" : null,
    ].filter(Boolean),
    parser: "local-rules",
  };
}

function normalizeIntent(raw, fallback) {
  const source = raw && typeof raw === "object" ? raw : {};
  const merged = {
    ...fallback,
    originQuery:
      cleanText(source.originQuery, 50) || fallback.originQuery || null,
    destinationQuery:
      cleanText(source.destinationQuery, 50) ||
      fallback.destinationQuery ||
      null,
    mode: normalizeMode(source.mode || fallback.mode),
    departureTime:
      normalizeClock(source.departureTime) || fallback.departureTime || null,
    arrivalTime:
      normalizeClock(source.arrivalTime) || fallback.arrivalTime || null,
    budgetYuan: boundedNumber(
      source.budgetYuan ?? fallback.budgetYuan,
      1,
      500
    ),
    maxDetourMinutes: boundedNumber(
      source.maxDetourMinutes ?? fallback.maxDetourMinutes,
      1,
      120
    ),
    maxWalkMinutes: boundedNumber(
      source.maxWalkMinutes ?? fallback.maxWalkMinutes,
      1,
      60
    ),
    preferences: canonicalPreferences(
      Array.isArray(source.preferences)
        ? source.preferences
        : fallback.preferences
    ),
    avoid: canonicalPreferences(
      Array.isArray(source.avoid) ? source.avoid : fallback.avoid
    ),
    assistantMessage: cleanText(source.assistantMessage, 300),
  };

  merged.missingFields = [
    !merged.originQuery ? "origin" : null,
    !merged.destinationQuery ? "destination" : null,
  ].filter(Boolean);
  return merged;
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("模型没有返回 JSON 对象。");
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

export function createLlmConfig(env = {}) {
  return {
    provider: "zhipu",
    baseUrl: cleanText(
      env.ZHIPU_BASE_URL ||
        process.env.ZHIPU_BASE_URL ||
        env.GLM_BASE_URL ||
        process.env.GLM_BASE_URL ||
        ZHIPU_BASE_URL,
      300
    ).replace(/\/+$/, ""),
    model: cleanText(
      env.ZHIPU_MODEL ||
        process.env.ZHIPU_MODEL ||
        env.GLM_MODEL ||
        process.env.GLM_MODEL ||
        ZHIPU_MODEL,
      100
    ),
    fallbackModel: cleanText(
      env.ZHIPU_FALLBACK_MODEL ||
        process.env.ZHIPU_FALLBACK_MODEL ||
        ZHIPU_FALLBACK_MODEL,
      100
    ),
    apiKey: cleanText(
      env.ZHIPU_API_KEY ||
        process.env.ZHIPU_API_KEY ||
        env.ZHIPUAI_API_KEY ||
        process.env.ZHIPUAI_API_KEY ||
        env.GLM_API_KEY ||
        process.env.GLM_API_KEY ||
        "",
      500
    ),
    timeoutMs: boundedNumber(
      env.ZHIPU_TIMEOUT_MS ||
        process.env.ZHIPU_TIMEOUT_MS ||
        env.LLM_TIMEOUT_MS ||
        process.env.LLM_TIMEOUT_MS,
      1000,
      120000
    ),
    primaryTimeoutMs: boundedNumber(
      env.ZHIPU_PRIMARY_TIMEOUT_MS ||
        process.env.ZHIPU_PRIMARY_TIMEOUT_MS ||
        ZHIPU_PRIMARY_TIMEOUT_MS,
      1000,
      120000
    ),
  };
}

export function getLlmStatus(config) {
  return {
    provider: "zhipu",
    mode: "remote",
    model: config.model,
    fallbackModel: config.fallbackModel,
    primaryTimeoutMs: config.primaryTimeoutMs,
    baseUrl: config.baseUrl,
    usesRemoteApiKey: Boolean(config.apiKey),
    configured: Boolean(config.apiKey),
    fallback: "local-rules-and-ranking",
  };
}

async function callChatCompletion(config, messages, jsonMode = false) {
  if (!config.apiKey) {
    throw new Error("智谱 GLM API Key 尚未配置。");
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
  const body = {
    messages,
    temperature: 0.15,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const attemptModel =
      attempt === 1 || !config.fallbackModel
        ? config.model
        : config.fallbackModel;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      attempt === 1
        ? Math.min(
            config.primaryTimeoutMs || ZHIPU_PRIMARY_TIMEOUT_MS,
            config.timeoutMs || DEFAULT_TIMEOUT_MS
          )
        : config.timeoutMs || DEFAULT_TIMEOUT_MS
    );
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, model: attemptModel }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = cleanText(await response.text(), 240);
        const error = new Error(
          `模型接口 HTTP ${response.status}${detail ? `：${detail}` : ""}`
        );
        error.status = response.status;
        error.retryable = [429, 500, 502, 503, 504].includes(
          response.status
        );
        throw error;
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return { content, model: attemptModel };
      }
      if (Array.isArray(content)) {
        return {
          content: content.map((item) => item?.text || "").join(""),
          model: attemptModel,
        };
      }
      throw new Error("模型返回内容为空。");
    } catch (error) {
      lastError = error;
      const retryable =
        error?.retryable ||
        (error?.name === "AbortError" &&
          attempt === 1 &&
          Boolean(config.fallbackModel)) ||
        error instanceof TypeError;
      if (!retryable || attempt === 3) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
  }
  throw lastError;
}

export async function parseChatIntent(message, config) {
  const text = cleanText(message, 1200);
  if (!text) throw new Error("请输入通勤和早餐需求。");
  const fallback = parseChatIntentLocally(text);

  try {
    const completion = await callChatCompletion(
      config,
      [
        {
          role: "system",
          content:
            "你是上海通勤早餐助手的意图抽取器。只输出 JSON，不要输出解释或 Markdown。不得编造地点、价格或约束。字段：originQuery、destinationQuery、mode（transit/driving/walking）、departureTime、arrivalTime、budgetYuan、maxDetourMinutes、maxWalkMinutes、preferences、avoid、assistantMessage。地点名可以是不完整口语，例如“上海大学宝山”，保留原片段交给地点搜索，不要要求用户写全称。中文时间要转为 HH:mm，例如“六点半”是 06:30，“七点一刻”是 07:15。“不想吃油的/油腻/少油”应放入 preferences 的“清淡”，并在 avoid 中加入“油炸、油条、炸鸡、煎饼”。未提及的标量字段用 null，数组用 []。",
        },
        { role: "user", content: text },
      ],
      true
    );
    const intent = normalizeIntent(
      parseJsonContent(completion.content),
      fallback
    );
    return {
      ...intent,
      parser: "free-llm",
      model: completion.model,
    };
  } catch (error) {
    return {
      ...fallback,
      fallbackReason:
        error instanceof Error ? error.message : "免费模型暂不可用。",
    };
  }
}

function sanitizeCandidate(candidate) {
  return {
    id: String(candidate.id || ""),
    name: cleanText(candidate.name, 80),
    category: cleanText(candidate.category, 40),
    district: cleanText(candidate.district, 30),
    type: cleanText(candidate.type, 80),
    address: cleanText(candidate.address || candidate.district, 120),
    lng: boundedNumber(candidate.lng, 120, 122.5),
    lat: boundedNumber(candidate.lat, 30.5, 32),
    nearestRoutePoint: Array.isArray(candidate.nearestRoutePoint)
      ? [
          boundedNumber(candidate.nearestRoutePoint[0], 120, 122.5),
          boundedNumber(candidate.nearestRoutePoint[1], 30.5, 32),
        ]
      : null,
    cost: boundedNumber(candidate.cost, 0, 500),
    rating: boundedNumber(candidate.rating, 0, 5),
    routeDistance: boundedNumber(candidate.routeDistance, 0, 5000),
    detourMinutes: boundedNumber(candidate.detourMinutes, 0, 120),
    totalMinutes: boundedNumber(candidate.totalMinutes, 0, 360),
    matchReasons: uniqueStrings(candidate.matchReasons, 5),
    fitsBudget:
      typeof candidate.fitsBudget === "boolean" ? candidate.fitsBudget : null,
  };
}

function fallbackRecommendation(message, intent, candidates) {
  const count = Math.min(6, candidates.length);
  const preferenceText = intent.preferences?.length
    ? `，优先考虑${intent.preferences.join("、")}`
    : "";
  return {
    recommendations: candidates.slice(0, count),
    assistantMessage:
      count > 0
        ? `已按绕行时间、预算和口味匹配选出 ${count} 个早餐点${preferenceText}。`
        : "当前路线附近没有满足条件的早餐点，可以放宽预算或绕行时间。",
    selector: "local-ranking",
  };
}

export async function selectChatRecommendations(
  { message, intent, candidates },
  config
) {
  const safeCandidates = candidates
    .map(sanitizeCandidate)
    .filter((candidate) => candidate.id && candidate.name)
    .slice(0, 20);
  if (safeCandidates.length === 0) {
    return fallbackRecommendation(message, intent || {}, safeCandidates);
  }

  try {
    const completion = await callChatCompletion(
      config,
      [
        {
          role: "system",
          content:
            "你是上海通勤早餐推荐器。只能从用户给出的 candidates 中选择，严禁编造地点。综合预算、口味、绕行时间、步行距离、评分和餐品类型排序，最多选 6 个。只输出 JSON：{\"selectedIds\":[\"候选id\"],\"reasons\":{\"候选id\":\"一句不超过30字的具体理由\"},\"assistantMessage\":\"不超过120字，说明为什么这样选，并指出数据限制\"}。没有满足条件的候选时 selectedIds 返回空数组。",
        },
        {
          role: "user",
          content: JSON.stringify({
            message: cleanText(message, 1200),
            intent: normalizeIntent(intent, {}),
            candidates: safeCandidates,
          }),
        },
      ],
      true
    );
    const parsed = parseJsonContent(completion.content);
    const selectedIds = uniqueStrings(parsed.selectedIds, 6);
    const byId = new Map(safeCandidates.map((candidate) => [candidate.id, candidate]));
    const selected = selectedIds
      .map((id) => byId.get(id))
      .filter(Boolean);
    const ordered = selected.slice(0, 6).map((candidate) => ({
      ...candidate,
      aiReason: cleanText(parsed.reasons?.[candidate.id], 80) || "",
    }));
    if (ordered.length === 0) {
      return fallbackRecommendation(message, intent || {}, safeCandidates);
    }
    return {
      recommendations: ordered,
      assistantMessage:
        cleanText(parsed.assistantMessage, 240) ||
        "已按你的通勤路线和早餐偏好完成排序。",
      selector: "free-llm",
      model: completion.model,
    };
  } catch (error) {
    return {
      ...fallbackRecommendation(message, intent || {}, safeCandidates),
      fallbackReason:
        error instanceof Error ? error.message : "免费模型暂不可用。",
    };
  }
}
