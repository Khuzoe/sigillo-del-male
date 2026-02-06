const INDENT_RE = /^ */;

function parseScalar(rawValue) {
  const value = String(rawValue).trim();

  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function nextNonEmpty(lines, fromIndex) {
  for (let i = fromIndex + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return {
      indent: raw.match(INDENT_RE)[0].length,
      trimmed,
    };
  }
  return null;
}

function parseYamlLite(yamlText) {
  const source = String(yamlText || "").replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/);

  const firstNonEmpty = lines.find((line) => {
    const t = line.trim();
    return t !== "" && !t.startsWith("#");
  });
  const isArrayRoot = firstNonEmpty ? firstNonEmpty.trim().startsWith("- ") : true;

  const root = isArrayRoot ? [] : {};
  const stack = [{ type: isArrayRoot ? "array" : "object", value: root, indent: -1 }];

  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const indent = raw.match(INDENT_RE)[0].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (trimmed.startsWith("- ")) {
      if (parent.type !== "array") {
        throw new Error(`YAML non valido: lista fuori contesto (linea ${idx + 1})`);
      }

      const entryText = trimmed.slice(2).trim();
      let item;
      let shouldPushStack = false;

      if (entryText === "") {
        item = {};
        shouldPushStack = true;
      } else {
        const keyMatch = entryText.match(/^([^:]+):\s*(.*)$/);
        if (keyMatch) {
          const key = keyMatch[1].trim();
          const valueStr = keyMatch[2];
          item = {};

          if (valueStr === "") {
            const next = nextNonEmpty(lines, idx);
            const container =
              next && next.indent > indent && next.trimmed.startsWith("-") ? [] : {};
            item[key] = container;
            shouldPushStack = true;
            stack.push({
              type: Array.isArray(container) ? "array" : "object",
              value: container,
              indent,
            });
          } else {
            item[key] = parseScalar(valueStr);
            shouldPushStack = true;
          }
        } else {
          item = parseScalar(entryText);
        }
      }

      parent.value.push(item);
      if (
        shouldPushStack &&
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item)
      ) {
        stack.push({ type: "object", value: item, indent });
      }
      return;
    }

    if (parent.type !== "object") {
      throw new Error(`YAML non valido: chiave fuori contesto (linea ${idx + 1})`);
    }

    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`YAML non valido: riga non valida (linea ${idx + 1})`);
    }

    const key = match[1].trim();
    const valueStr = match[2];

    if (valueStr === "") {
      const next = nextNonEmpty(lines, idx);
      const container = next && next.indent > indent && next.trimmed.startsWith("-") ? [] : {};
      parent.value[key] = container;
      stack.push({
        type: Array.isArray(container) ? "array" : "object",
        value: container,
        indent,
      });
      return;
    }

    const value = parseScalar(valueStr);
    parent.value[key] = value;
    if (typeof value === "object" && value !== null) {
      stack.push({ type: Array.isArray(value) ? "array" : "object", value, indent });
    }
  });

  return root;
}

module.exports = {
  parseYamlLite,
};
