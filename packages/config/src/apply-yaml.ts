// Applying a value onto a config file's YAML (decision 0055). A save by
// value used to stringify the object, which dropped comments and rewrote
// every line. The value is applied onto the parsed document instead:
// unchanged nodes keep their source, and list items are matched by `id` or
// `key` so a step or an option keeps its text when it moves.
import {
  Document,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
} from "yaml";
import type { Node, Pair, YAMLMap, YAMLSeq } from "yaml";

/** One replacement in the original source, in original offsets. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

interface KeyedPair {
  key: string;
  pair: Pair;
}

const freshOptions = { lineWidth: 0 } as const;

/** A plain object, as a YAML map's value is. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNode = (value: unknown): value is Node =>
  isScalar(value) || isMap(value) || isSeq(value);

/** Same contents: object key order doesn't count, array order does. */
const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && sameValue(left[key], right[key]))
    );
  }
  return false;
};

/** `id` wins over `key`, which is how steps and choice options are told apart. */
const identityOf = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id === "string" && value.id.length > 0) {
    return `id:${value.id}`;
  }
  if (typeof value.key === "string" && value.key.length > 0) {
    return `key:${value.key}`;
  }
  return null;
};

const scalarKey = (key: Pair["key"]): string | null => {
  if (!isScalar(key) || key.range === undefined || key.range === null) {
    return null;
  }
  return typeof key.value === "string" || typeof key.value === "number"
    ? String(key.value)
    : null;
};

/** The spaces between the start of the line and `index`. */
const indentAt = (source: string, index: number): string => {
  let start = index;
  while (start > 0 && source[start - 1] !== "\n") {
    start -= 1;
  }
  return source.slice(start, index);
};

const flowOf = (node: Node | null): boolean =>
  node !== null && (isMap(node) || isSeq(node)) && node.flow === true;

/** YAML for a value that isn't already in the file. */
const formatFresh = (value: unknown, flow: boolean): string => {
  const doc = new Document(value);
  if (flow && doc.contents && (isMap(doc.contents) || isSeq(doc.contents))) {
    doc.contents.flow = true;
  }
  const text = doc.toString(freshOptions);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
};

const pairText = (key: string, value: unknown, keyIndent: string): string => {
  const fresh = formatFresh(value, false);
  if (!fresh.includes("\n")) {
    return `${key}: ${fresh}`;
  }
  const child = `${keyIndent}  `;
  const lines = fresh
    .split("\n")
    .map((line) => (line.length > 0 ? `${child}${line}` : line));
  return `${key}:\n${lines.join("\n")}`;
};

const keyedPairs = (map: YAMLMap): KeyedPair[] | null => {
  const pairs: KeyedPair[] = [];
  for (const pair of map.items) {
    const key = scalarKey(pair.key);
    if (key === null || !isNode(pair.value) || !pair.value.range) {
      return null;
    }
    pairs.push({ key, pair });
  }
  return pairs;
};

const replaceMap = (
  map: YAMLMap,
  value: Record<string, unknown>,
  range: [number, number, number]
): Edit[] => [
  {
    start: range[0],
    end: range[1],
    text: formatFresh(value, map.flow === true),
  },
];

/** `{ a: 1, b: 2 }`, keeping the file's padding and any pair whose value is unchanged. */
const renderFlowMap = (
  source: string,
  pairs: readonly KeyedPair[],
  value: Record<string, unknown>,
  range: [number, number, number]
): string => {
  const original = source.slice(range[0], range[1]);
  const padded = original.startsWith("{ ");
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const { key } of pairs) {
    if (key in value) {
      ordered.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(value)) {
    if (!seen.has(key)) {
      ordered.push(key);
    }
  }
  const byKey = new Map(pairs.map((each) => [each.key, each.pair]));
  const parts = ordered.map((key) => {
    const pair = byKey.get(key);
    const node = pair && isNode(pair.value) ? pair.value : null;
    const keyNode = pair && isScalar(pair.key) ? pair.key : null;
    if (node?.range && keyNode?.range && sameValue(node.toJSON(), value[key])) {
      return source.slice(keyNode.range[0], node.range[1]);
    }
    const keyText = keyNode?.range
      ? source.slice(keyNode.range[0], keyNode.range[1])
      : key;
    return `${keyText}: ${formatFresh(value[key], flowOf(node))}`;
  });
  const gap = padded ? " " : "";
  return `{${gap}${parts.join(", ")}${gap}}`;
};

/**
 * A block map with keys added or removed. Kept keys stay in file order, in
 * their own text when their value is unchanged; new keys are appended.
 */
const renderBlockMap = (
  source: string,
  pairs: readonly KeyedPair[],
  value: Record<string, unknown>,
  range: [number, number, number]
): string => {
  const kept = pairs.filter((each) => each.key in value);
  if (kept.length === 0 && Object.keys(value).length === 0) {
    return "{}";
  }
  const ordered = [
    ...kept.map((each) => each.key),
    ...Object.keys(value).filter(
      (key) => !kept.some((each) => each.key === key)
    ),
  ];
  const byKey = new Map(kept.map((each) => [each.key, each.pair]));
  const sample = pairs[0]?.pair.key;
  const indent =
    isScalar(sample) && sample.range ? indentAt(source, sample.range[0]) : "";
  const lines = ordered.map((key) => {
    const pair = byKey.get(key);
    const node = pair && isNode(pair.value) ? pair.value : null;
    const keyNode = pair && isScalar(pair.key) ? pair.key : null;
    if (node?.range && keyNode?.range && sameValue(node.toJSON(), value[key])) {
      const text = source.slice(keyNode.range[0], node.range[2]);
      return text.endsWith("\n") ? text.slice(0, -1) : text;
    }
    if (
      keyNode?.range &&
      node?.range &&
      !formatFresh(value[key], false).includes("\n")
    ) {
      const between = source.slice(keyNode.range[1], node.range[0]);
      const fresh = formatFresh(value[key], flowOf(node));
      const trail = source
        .slice(node.range[1], node.range[2])
        .replace(/\n$/u, "");
      if (!between.includes("\n") && !fresh.includes("\n")) {
        const keyText = source.slice(keyNode.range[0], keyNode.range[1]);
        return `${keyText}${between}${fresh}${trail}`;
      }
    }
    return pairText(key, value[key], indent);
  });
  const body = lines
    .map((line, index) => {
      if (index === 0) {
        return line;
      }
      const breakAt = line.indexOf("\n");
      if (breakAt === -1) {
        return indent + line;
      }
      // Continuation lines of an unchanged pair already carry their indent.
      return indent + line.slice(0, breakAt) + line.slice(breakAt);
    })
    .join("\n");
  const original = source.slice(range[0], range[1]);
  return original.endsWith("\n") || original.length === 0 ? `${body}\n` : body;
};

interface Matched {
  item: Node | null;
  value: unknown;
}

/** List items line up by `id` or `key`; the rest, by equal value then by shape. */
const matchItems = (
  items: readonly Node[],
  values: readonly unknown[]
): Matched[] => {
  const used = new Set<number>();
  const take = (wanted: (item: Node) => boolean): Node | null => {
    const index = items.findIndex(
      (item, position) => !used.has(position) && wanted(item)
    );
    if (index === -1) {
      return null;
    }
    used.add(index);
    return items[index] ?? null;
  };
  return values.map((value) => {
    const identity = identityOf(value);
    if (identity !== null) {
      const found = take((item) => identityOf(item.toJSON()) === identity);
      if (found) {
        return { item: found, value };
      }
    }
    const equal = take(
      (item) =>
        identityOf(item.toJSON()) === null && sameValue(item.toJSON(), value)
    );
    if (equal) {
      return { item: equal, value };
    }
    const sameShape = take((item) => {
      if (identityOf(item.toJSON()) !== null) {
        return false;
      }
      if (Array.isArray(value)) {
        return isSeq(item);
      }
      if (isRecord(value)) {
        return isMap(item);
      }
      return isScalar(item);
    });
    return { item: sameShape, value };
  });
};

/** The `- ` line of a block sequence item, without a trailing newline. */
const blockItemText = (source: string, item: Node): string | null => {
  const range = item.range ?? null;
  if (!range) {
    return null;
  }
  let [start] = range;
  while (start > 0 && source[start - 1] === " ") {
    start -= 1;
  }
  if (start > 0 && source[start - 1] === "-") {
    start -= 1;
  }
  const text = source.slice(start, range[2]);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
};

const renderBlockItem = (value: unknown, seqIndent: string): string => {
  const fresh = formatFresh(value, false);
  const [first = "", ...rest] = fresh.split("\n");
  const continuation = `${seqIndent}  `;
  return [
    `- ${first}`,
    ...rest.map((line) => (line.length > 0 ? `${continuation}${line}` : line)),
  ].join("\n");
};

const renderBlockSeq = (
  source: string,
  seq: YAMLSeq,
  values: readonly unknown[],
  range: [number, number, number]
): string => {
  if (values.length === 0) {
    return "[]";
  }
  const indent = indentAt(source, range[0]);
  const matched = matchItems(seq.items.filter(isNode), values);
  const chunks = matched.map(({ item, value }) => {
    if (item && sameValue(item.toJSON(), value)) {
      return blockItemText(source, item) ?? renderBlockItem(value, indent);
    }
    return renderBlockItem(value, indent);
  });
  const original = source.slice(range[0], range[1]);
  const body = chunks.join(`\n${indent}`);
  return original.endsWith("\n") ? `${body}\n` : body;
};

const renderFlowSeq = (
  source: string,
  seq: YAMLSeq,
  values: readonly unknown[]
): string => {
  const range = seq.range ?? null;
  const original = range ? source.slice(range[0], range[1]) : "[]";
  const padded = original.startsWith("[ ");
  const matched = matchItems(seq.items.filter(isNode), values);
  const parts = matched.map(({ item, value }) => {
    const itemRange = item?.range ?? null;
    if (item && itemRange && sameValue(item.toJSON(), value)) {
      return source.slice(itemRange[0], itemRange[1]);
    }
    return formatFresh(value, flowOf(item));
  });
  const gap = padded ? " " : "";
  return `[${gap}${parts.join(", ")}${gap}]`;
};

const edits = {
  node(source: string, node: Node | null, value: unknown): Edit[] {
    if (node && sameValue(node.toJSON(), value)) {
      return [];
    }
    if (isMap(node) && isRecord(value)) {
      return edits.map(source, node, value);
    }
    if (isSeq(node) && Array.isArray(value)) {
      return edits.seq(source, node, value);
    }
    const range = node?.range ?? null;
    if (!range) {
      return [];
    }
    return [
      {
        start: range[0],
        end: range[1],
        text: formatFresh(value, flowOf(node)),
      },
    ];
  },
  map(source: string, map: YAMLMap, value: Record<string, unknown>): Edit[] {
    const range = map.range ?? null;
    if (!range) {
      return [];
    }
    const pairs = keyedPairs(map);
    if (!pairs) {
      return replaceMap(map, value, range);
    }
    const sameKeys =
      pairs.length === Object.keys(value).length &&
      pairs.every((each) => each.key in value);
    if (sameKeys) {
      return pairs.flatMap(({ key, pair }) =>
        edits.node(source, isNode(pair.value) ? pair.value : null, value[key])
      );
    }
    const text =
      map.flow === true
        ? renderFlowMap(source, pairs, value, range)
        : renderBlockMap(source, pairs, value, range);
    return [{ start: range[0], end: range[1], text }];
  },
  seq(source: string, seq: YAMLSeq, values: readonly unknown[]): Edit[] {
    const range = seq.range ?? null;
    if (!range) {
      return [];
    }
    const items = seq.items.filter(isNode);
    const matched = matchItems(items, values);
    const aligned =
      matched.length === items.length &&
      matched.every((entry, index) => entry.item === items[index]);
    if (aligned) {
      return matched.flatMap((entry) =>
        edits.node(source, entry.item, entry.value)
      );
    }
    const text =
      seq.flow === true
        ? renderFlowSeq(source, seq, values)
        : renderBlockSeq(source, seq, values, range);
    return [{ start: range[0], end: range[1], text }];
  },
};

const applyEdits = (source: string, changes: readonly Edit[]): string => {
  const ordered = [...changes].toSorted(
    (left, right) => right.start - left.start
  );
  let out = source;
  for (const edit of ordered) {
    out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
  }
  return out;
};

/**
 * The YAML `content` would have after saving `value` over it. Comments, key
 * order and the text of unchanged parts stay. Invalid YAML is written out
 * fresh, as a value save with no file to keep did.
 */
export const yamlWithValue = (
  content: string,
  value: Record<string, unknown>
): string => {
  const doc = parseDocument(content);
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return stringify(value, freshOptions);
  }
  return applyEdits(content, edits.node(content, doc.contents, value));
};
