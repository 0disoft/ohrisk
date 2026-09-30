import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type InspectionPhase = "collect" | "decompress" | "normalize" | "render";
export type InspectionMetrics = { milliseconds: Record<InspectionPhase, number>; calls: Record<InspectionPhase, number>; peakSampledRssBytes: number };
const active = new AsyncLocalStorage<InspectionMetrics>();

export async function profileInspection<T>(work: () => Promise<T>): Promise<{ value: T; metrics: InspectionMetrics }> {
  const metrics: InspectionMetrics = { milliseconds: { collect: 0, decompress: 0, normalize: 0, render: 0 },
    calls: { collect: 0, decompress: 0, normalize: 0, render: 0 }, peakSampledRssBytes: process.memoryUsage().rss };
  const value = await active.run(metrics, work);
  return { value, metrics };
}
export function measureInspectionPhase<T>(phase: InspectionPhase, work: () => T): T {
  const metrics = active.getStore();
  if (!metrics) return work();
  const start = performance.now();
  try { return work(); } finally { record(metrics, phase, start); }
}
export async function measureAsyncInspectionPhase<T>(phase: InspectionPhase, work: () => Promise<T>): Promise<T> {
  const metrics = active.getStore();
  if (!metrics) return work();
  const start = performance.now();
  try { return await work(); } finally { record(metrics, phase, start); }
}
function record(metrics: InspectionMetrics, phase: InspectionPhase, start: number): void {
  metrics.milliseconds[phase] += performance.now() - start;
  metrics.calls[phase] += 1;
  metrics.peakSampledRssBytes = Math.max(metrics.peakSampledRssBytes, process.memoryUsage().rss);
}
