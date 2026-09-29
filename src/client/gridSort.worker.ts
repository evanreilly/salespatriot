/// <reference lib="webworker" />

import {
  sortGridIndexes,
  sortRuleKey,
  type GridSortValue,
  type SortRule,
} from "./gridSort";

type SetDataMessage = {
  type: "set-data";
  generation: number;
  values: GridSortValue[][];
};

type SortMessage = {
  type: "sort";
  generation: number;
  requestId: number;
  viewId: number;
  indexes: Uint32Array;
  rules: SortRule[];
};

type IncomingMessage = SetDataMessage | SortMessage;

let generation = 0;
let values: GridSortValue[][] = [];
let cache = new Map<string, Uint32Array>();
let precomputeToken = 0;

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === "set-data") {
    generation = message.generation;
    values = message.values;
    cache = new Map();
    precomputeToken += 1;
    scheduleBasePrecomputation(precomputeToken, 0);
    return;
  }

  if (message.generation !== generation) return;
  const key = `${message.viewId}|${sortRuleKey(message.rules)}`;
  const cached = cache.get(key);
  const indexes = cached ?? sortGridIndexes(values, message.indexes, message.rules);
  if (!cached) remember(key, indexes);
  const result = indexes.slice();
  self.postMessage(
    { type: "sorted", generation, requestId: message.requestId, indexes: result },
    { transfer: [result.buffer] },
  );
};

function scheduleBasePrecomputation(token: number, step: number) {
  if (token !== precomputeToken || step >= 20 || values.length === 0) return;
  self.setTimeout(() => {
    if (token !== precomputeToken) return;
    const column = step % 10;
    const direction = step < 10 ? "descending" : "ascending";
    const rules: SortRule[] = [{ column, direction }];
    const key = `0|${sortRuleKey(rules)}`;
    if (!cache.has(key)) {
      const allIndexes = Uint32Array.from({ length: values.length }, (_, index) => index);
      remember(key, sortGridIndexes(values, allIndexes, rules));
    }
    scheduleBasePrecomputation(token, step + 1);
  }, 0);
}

function remember(key: string, indexes: Uint32Array) {
  if (cache.size >= 128) cache.delete(cache.keys().next().value as string);
  cache.set(key, indexes);
}

export {};
