const PLACE_ALIASES = [
  [/^上大(?!学)/, "上海大学"],
  [/^华理(?!工)/, "华东理工大学"],
  [/^上外(?!国)/, "上海外国语大学"],
  [/^上财(?!经)/, "上海财经大学"],
  [/^(?:华师|华师大)(?!范)/, "华东师范大学"],
  [/^复旦(?!大学)/, "复旦大学"],
  [/^同济(?!大学)/, "同济大学"],
  [/^交大(?!学)/, "上海交通大学"],
];

export function normalizePlaceName(value) {
  let text = String(value || "").toLowerCase();
  text = text.replace(/附近(?:的)?|旁边|一带/g, "");
  text = text.replace(/[（）()【】\[\]\s·,，。._-]/g, "");
  for (const [pattern, replacement] of PLACE_ALIASES) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/(?:校区|分校)$/g, "");
}

function editDistance(left, right) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function bigramSimilarity(left, right) {
  if (left.length < 2 || right.length < 2) return 0;
  const grams = (text) =>
    new Set(
      Array.from({ length: text.length - 1 }, (_, index) =>
        text.slice(index, index + 2)
      )
    );
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  const intersection = [...leftGrams].filter((gram) => rightGrams.has(gram));
  const union = new Set([...leftGrams, ...rightGrams]);
  return intersection.length / union.size;
}

export function scorePlaceCandidate(keyword, candidate) {
  const query = normalizePlaceName(keyword);
  const name = normalizePlaceName(candidate?.name);
  if (!query || !name) return 0;
  if (name === query) return 1;

  let score;
  if (name.includes(query)) {
    score = 0.82 + (query.length / name.length) * 0.14;
  } else if (query.includes(name)) {
    score = 0.76 + (name.length / query.length) * 0.14;
  } else {
    const maximumLength = Math.max(query.length, name.length);
    const editScore =
      1 - editDistance(query, name) / Math.max(1, maximumLength);
    score = Math.max(editScore * 0.9, bigramSimilarity(query, name) * 0.82);
  }

  const address = normalizePlaceName(candidate?.address);
  if (address.includes(query)) score += 0.03;
  const type = String(candidate?.type || "").toLowerCase();
  if (/(place|square|university|school|station)/.test(type)) score += 0.01;
  return Math.min(1, score);
}

export function selectUnambiguousPlace(keyword, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scorePlaceCandidate(keyword, candidate),
    }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 0.74) return null;
  if (second && best.score - second.score < 0.1) return null;
  return best.candidate;
}
