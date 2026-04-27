function isValidJsonObject(candidate: string) {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function collectJsonObjectCandidatesFromSource(source: string) {
  const candidates: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (startIndex < 0) {
      if (character === "{") {
        startIndex = index;
        depth = 1;
        inString = false;
        isEscaped = false;
      }
      continue;
    }

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === "\\") {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;
    if (depth > 0) {
      continue;
    }

    if (depth === 0) {
      const candidate = source.slice(startIndex, index + 1).trim();
      if (isValidJsonObject(candidate)) {
        candidates.push(candidate);
      }
    }

    startIndex = -1;
    depth = 0;
    inString = false;
    isEscaped = false;
  }

  return candidates;
}

function listJsonSearchSources(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const sources = [normalized];
  for (const match of normalized.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fencedContent = match[1]?.trim();
    if (fencedContent) {
      sources.push(fencedContent);
    }
  }

  return sources;
}

function scoreJsonObjectCandidate(candidate: string, requiredTopLevelFields: readonly string[]) {
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const matchedRequiredFieldCount = requiredTopLevelFields.filter((field) => field in parsed).length;
    return {
      matchedRequiredFieldCount,
      length: candidate.length,
    };
  } catch {
    return {
      matchedRequiredFieldCount: -1,
      length: candidate.length,
    };
  }
}

export function extractBestJsonObject(text: string, requiredTopLevelFields: readonly string[] = []) {
  const dedupedCandidates = Array.from(
    new Set(listJsonSearchSources(text).flatMap((source) => collectJsonObjectCandidatesFromSource(source))),
  );

  if (dedupedCandidates.length === 0) {
    return null;
  }

  return [...dedupedCandidates].sort((left, right) => {
    const leftScore = scoreJsonObjectCandidate(left, requiredTopLevelFields);
    const rightScore = scoreJsonObjectCandidate(right, requiredTopLevelFields);

    if (leftScore.matchedRequiredFieldCount !== rightScore.matchedRequiredFieldCount) {
      return rightScore.matchedRequiredFieldCount - leftScore.matchedRequiredFieldCount;
    }

    return rightScore.length - leftScore.length;
  })[0]!;
}
