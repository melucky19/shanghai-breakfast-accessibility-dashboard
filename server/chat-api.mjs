import {
  getLlmStatus,
  parseChatIntent,
  selectChatRecommendations,
} from "./llm-service.mjs";

const MAX_BODY_BYTES = 1024 * 1024;

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
      const error = new Error("请求内容过大。");
      error.statusCode = 413;
      throw error;
    }
  }
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("请求内容不是有效的 JSON。");
    error.statusCode = 400;
    throw error;
  }
}

function methodNotAllowed(response) {
  response.setHeader("Allow", "POST");
  sendJson(response, 405, {
    error: "METHOD_NOT_ALLOWED",
    message: "该接口仅支持 POST 请求。",
  });
}

export async function handleChatIntentRequest(
  request,
  response,
  { llmConfig }
) {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }
  try {
    const body = await readJsonBody(request);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      sendJson(response, 400, {
        error: "MISSING_MESSAGE",
        message: "请输入通勤和早餐需求。",
      });
      return;
    }
    const intent = await parseChatIntent(message, llmConfig);
    sendJson(response, 200, { intent });
  } catch (error) {
    sendJson(response, error?.statusCode || 500, {
      error: "CHAT_INTENT_FAILED",
      message:
        error instanceof Error ? error.message : "聊天需求解析失败。",
    });
  }
}

export async function handleChatRecommendationRequest(
  request,
  response,
  { llmConfig }
) {
  if (request.method !== "POST") {
    methodNotAllowed(response);
    return;
  }
  try {
    const body = await readJsonBody(request);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      sendJson(response, 400, {
        error: "MISSING_MESSAGE",
        message: "缺少原始早餐需求。",
      });
      return;
    }
    const candidates = Array.isArray(body.candidates)
      ? body.candidates.slice(0, 20)
      : [];
    const recommendation = await selectChatRecommendations(
      {
        message,
        intent:
          body.intent && typeof body.intent === "object" ? body.intent : {},
        candidates,
      },
      llmConfig
    );
    sendJson(response, 200, recommendation);
  } catch (error) {
    sendJson(response, error?.statusCode || 500, {
      error: "CHAT_RECOMMENDATION_FAILED",
      message:
        error instanceof Error ? error.message : "早餐推荐生成失败。",
    });
  }
}

export function handleLlmStatusRequest(request, response, { llmConfig }) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, {
      error: "METHOD_NOT_ALLOWED",
      message: "该接口仅支持 GET 请求。",
    });
    return;
  }
  sendJson(response, 200, getLlmStatus(llmConfig));
}
