async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || "智能早餐助手暂时不可用。");
  }
  return data;
}

export async function parseBreakfastChat(message) {
  const data = await postJson("/api/chat-intent", { message });
  if (!data?.intent) {
    throw new Error("未能理解这条早餐需求，请换一种说法。");
  }
  return data.intent;
}

export async function selectBreakfastRecommendations({
  message,
  intent,
  candidates,
}) {
  const data = await postJson("/api/chat-recommendation", {
    message,
    intent,
    candidates,
  });
  if (!Array.isArray(data?.recommendations)) {
    throw new Error("没有生成有效的早餐推荐。");
  }
  return data;
}
