import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createLlmConfig,
  parseChatIntent,
  parseChatIntentLocally,
  selectChatRecommendations,
} from "./llm-service.mjs";
import { selectUnambiguousPlace } from "../src/services/place-match.js";

test("local parser extracts route and breakfast constraints", () => {
  const intent = parseChatIntentLocally(
    "我早上 8:30 前到静安寺上班，从上海大学宝山校区出发，想在地铁沿线买包子，预算 15 元，绕行不超过 8 分钟"
  );
  assert.equal(intent.originQuery, "上海大学宝山校区");
  assert.equal(intent.destinationQuery, "静安寺");
  assert.equal(intent.mode, "transit");
  assert.equal(intent.arrivalTime, "08:30");
  assert.equal(intent.budgetYuan, 15);
  assert.equal(intent.maxDetourMinutes, 8);
  assert.deepEqual(intent.preferences, ["包子"]);
  assert.deepEqual(intent.missingFields, []);
});

test("Zhipu configuration uses GLM-4.7-Flash by default", () => {
  const config = createLlmConfig({
    ZHIPU_API_KEY: "test-zhipu-key",
  });
  assert.equal(config.provider, "zhipu");
  assert.equal(config.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(config.model, "glm-4.7-flash");
  assert.equal(config.fallbackModel, "glm-4.5-flash");
  assert.equal(config.apiKey, "test-zhipu-key");
});

test("explicit transit wins over a walking-to-shop preference", () => {
  const intent = parseChatIntentLocally(
    "从人民广场到张江高科，坐地铁，早餐想清淡一点，步行取餐不超过 5 分钟"
  );
  assert.equal(intent.destinationQuery, "张江高科");
  assert.equal(intent.mode, "transit");
  assert.equal(intent.maxWalkMinutes, 5);
  assert.deepEqual(intent.preferences, ["清淡"]);
});

test("departure time is extracted when it appears before the route", () => {
  const intent = parseChatIntentLocally(
    "7:50 从上海大学宝山校区出发，8:30 前到静安寺，想买豆浆"
  );
  assert.equal(intent.departureTime, "07:50");
  assert.equal(intent.arrivalTime, "08:30");
  assert.equal(intent.originQuery, "上海大学宝山校区");
  assert.equal(intent.destinationQuery, "静安寺");
});

test("colloquial route, Chinese time and oily-food avoidance are understood", () => {
  const intent = parseChatIntentLocally(
    "我要六点半从梅陇中学去上海大学宝山，不想吃油的"
  );
  assert.equal(intent.originQuery, "梅陇中学");
  assert.equal(intent.destinationQuery, "上海大学宝山");
  assert.equal(intent.departureTime, "06:30");
  assert.deepEqual(intent.preferences, ["清淡"]);
  assert.deepEqual(intent.avoid, ["油炸", "油条", "炸鸡", "煎饼"]);
  assert.deepEqual(intent.missingFields, []);
});

test("an incomplete campus name selects the uniquely matching campus", () => {
  const selected = selectUnambiguousPlace("上海大学宝山", [
    {
      id: "baoshan",
      name: "上海大学（宝山校区）",
      location: [121.388, 31.316],
    },
    {
      id: "yanchang",
      name: "上海大学（延长校区）",
      location: [121.45, 31.27],
    },
  ]);
  assert.equal(selected?.id, "baoshan");
});

test("multiple same-name schools still require user confirmation", () => {
  const selected = selectUnambiguousPlace("梅陇中学", [
    { id: "putuo", name: "梅陇中学", location: [121.384, 31.245] },
    { id: "minhang", name: "梅陇中学", location: [121.405, 31.134] },
  ]);
  assert.equal(selected, null);
});

test("general place matching supports aliases, partial suffixes and typos", () => {
  const campus = selectUnambiguousPlace("复旦邯郸", [
    { id: "handan", name: "复旦大学（邯郸校区）" },
    { id: "jiangwan", name: "复旦大学（江湾校区）" },
  ]);
  assert.equal(campus?.id, "handan");

  const station = selectUnambiguousPlace("张江高科地铁", [
    { id: "station", name: "张江高科地铁站", type: "railway / station" },
    { id: "road", name: "张江高科技园区", type: "place / quarter" },
  ]);
  assert.equal(station?.id, "station");

  const typo = selectUnambiguousPlace("上海大雪宝山", [
    { id: "target", name: "上海大学（宝山校区）" },
    { id: "other", name: "上海外国语大学" },
  ]);
  assert.equal(typo?.id, "target");
});

test("general matching still rejects close ties", () => {
  const selected = selectUnambiguousPlace("徐家汇", [
    { id: "area", name: "徐家汇", type: "place / quarter" },
    { id: "station", name: "徐家汇", type: "railway / station" },
  ]);
  assert.equal(selected, null);
});

test("recommendation falls back safely when the local model is unavailable", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => ({
    id: `poi-${index + 1}`,
    name: `测试早餐 ${index + 1}`,
    category: index === 0 ? "中式面点" : "早餐服务",
    cost: 8 + index,
    rating: 4.2,
    routeDistance: 40 + index * 10,
    detourMinutes: 1 + index * 0.2,
    totalMinutes: 20 + index,
    matchReasons: index === 0 ? ["包子"] : [],
  }));
  const result = await selectChatRecommendations(
    {
      message: "想买包子",
      intent: { preferences: ["包子"] },
      candidates,
    },
    createLlmConfig({
      ZHIPU_API_KEY: "test-key",
      ZHIPU_BASE_URL: "http://127.0.0.1:1/v4",
      ZHIPU_TIMEOUT_MS: "800",
    })
  );
  assert.equal(result.recommendations.length, 6);
  assert.equal(result.selector, "local-ranking");
  assert.ok(result.recommendations.every((item) => candidates.some((candidate) => candidate.id === item.id)));
});

test("OpenAI-compatible free model can parse and rank", async (context) => {
  const modelServer = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const system = payload.messages?.[0]?.content || "";
    const content = system.includes("意图抽取器")
      ? JSON.stringify({
          originQuery: "上海大学（宝山）",
          destinationQuery: "静安寺",
          mode: "transit",
          arrivalTime: "08:30",
          budgetYuan: 15,
          maxDetourMinutes: 8,
          preferences: ["买包子"],
          avoid: [],
          assistantMessage: "已理解通勤和早餐需求。",
        })
      : JSON.stringify({
          selectedIds: ["poi-2", "poi-1"],
          reasons: {
            "poi-1": "包子和预算都匹配",
            "poi-2": "绕行更短",
          },
          assistantMessage: "优先选择了绕行短且符合包子偏好的早餐。",
        });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content } }],
      })
    );
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  context.after(
    () => new Promise((resolve) => modelServer.close(resolve))
  );
  const address = modelServer.address();
  const config = createLlmConfig({
    ZHIPU_API_KEY: "test-key",
    ZHIPU_BASE_URL: `http://127.0.0.1:${address.port}/v4`,
    ZHIPU_MODEL: "glm-4.7-flash-test",
    ZHIPU_TIMEOUT_MS: "2000",
  });

  const intent = await parseChatIntent(
    "从上海大学宝山到静安寺，想买包子",
    config
  );
  assert.equal(intent.parser, "free-llm");
  assert.equal(intent.model, "glm-4.7-flash-test");
  assert.equal(intent.destinationQuery, "静安寺");
  assert.deepEqual(intent.preferences, ["包子"]);

  const result = await selectChatRecommendations(
    {
      message: "想买包子",
      intent,
      candidates: [
        {
          id: "poi-1",
          name: "鲜肉包子铺",
          category: "中式面点",
          cost: 10,
          rating: 4.6,
          lng: 121.45,
          lat: 31.23,
          routeDistance: 60,
          detourMinutes: 1.6,
          totalMinutes: 28,
        },
        {
          id: "poi-2",
          name: "早餐店",
          category: "早餐服务",
          cost: 12,
          rating: 4.4,
          lng: 121.46,
          lat: 31.24,
          routeDistance: 30,
          detourMinutes: 0.8,
          totalMinutes: 27,
        },
      ],
    },
    config
  );
  assert.equal(result.selector, "free-llm");
  assert.deepEqual(
    result.recommendations.map((item) => item.id),
    ["poi-2", "poi-1"]
  );
  assert.equal(result.recommendations[0].lng, 121.46);
  assert.equal(result.recommendations[1].aiReason, "包子和预算都匹配");
});

test("temporary GLM overload is retried before falling back", async (context) => {
  let requestCount = 0;
  const modelServer = createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Consume the request body before responding.
    }
    requestCount += 1;
    if (requestCount === 1) {
      response.statusCode = 429;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          error: { code: "1305", message: "该模型当前访问量过大" },
        })
      );
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                originQuery: "上海大学（宝山）",
                destinationQuery: "静安寺",
                mode: "transit",
                preferences: ["买包子"],
                avoid: [],
              }),
            },
          },
        ],
      })
    );
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  context.after(
    () => new Promise((resolve) => modelServer.close(resolve))
  );
  const address = modelServer.address();
  const intent = await parseChatIntent(
    "从上海大学宝山到静安寺买包子",
    createLlmConfig({
      ZHIPU_API_KEY: "test-key",
      ZHIPU_BASE_URL: `http://127.0.0.1:${address.port}/v4`,
      ZHIPU_MODEL: "glm-4.7-flash-test",
      ZHIPU_TIMEOUT_MS: "2000",
    })
  );
  assert.equal(requestCount, 2);
  assert.equal(intent.parser, "free-llm");
  assert.equal(intent.model, "glm-4.5-flash");
  assert.deepEqual(intent.preferences, ["包子"]);
});
