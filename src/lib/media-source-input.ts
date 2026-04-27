export function normalizeMediaSourceInput(value: unknown) {
  let normalized = String(value ?? "").trim();

  for (let index = 0; index < 3; index += 1) {
    if (normalized.length < 2) {
      break;
    }

    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (
      (first === "'" && last === "'") ||
      (first === "\"" && last === "\"") ||
      (first === "`" && last === "`")
    ) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return normalized;
}

export function normalizeNullableMediaSourceInput(value: unknown) {
  return normalizeMediaSourceInput(value) || null;
}
