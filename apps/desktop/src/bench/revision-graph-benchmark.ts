/**
 * Benchmark harness for Tatami revision graph performance.
 * Inspired by Pierre Trees benchmark.ts (packages/trees/scripts/benchmark.ts)
 */

import { buildGraph } from "@/components/revision-graph";
import {
  computeRevisionAncestry,
  detectStacks,
  reorderForGraph,
} from "@/components/revision-graph-utils";
import {
  ALL_FIXTURE_NAMES,
  getFixture,
  type GraphFixture,
} from "./revision-graph-fixtures";

const DEFAULT_SAMPLE_COUNT = 8;
const DEFAULT_WARMUP_COUNT = 1;

interface BenchmarkCliOptions {
  fixture?: string;
  json: boolean;
  sampleCount: number;
  includeSamples: boolean;
}

interface BenchmarkStats {
  avg: number;
  max: number;
  min: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  ticks: number;
  samples?: readonly number[];
}

interface PerformanceMemory {
  usedJSHeapSize?: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

interface BenchmarkManifest {
  fixtureName: string;
  description: string;
  revisionCount: number;
}

interface BenchmarkPhase {
  name: string;
  stats: BenchmarkStats;
}

interface BenchmarkResult {
  manifest: BenchmarkManifest;
  phases: BenchmarkPhase[];
  memoryDeltaBytes: number | null;
  totalTimeMs: number;
}

interface BenchmarkRunOutput {
  generatedAt: string;
  kind: "revision-graph-benchmark-run";
  results: BenchmarkResult[];
}

function parseArgs(argv: readonly string[]): BenchmarkCliOptions {
  let fixture: string | undefined;
  let json = false;
  let sampleCount = DEFAULT_SAMPLE_COUNT;
  let includeSamples = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") {
      fixture = argv[++i];
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--sample-count") {
      const v = Number.parseInt(argv[++i], 10);
      if (!Number.isNaN(v) && v > 0) sampleCount = v;
    } else if (arg === "--samples") {
      includeSamples = true;
    } else if (arg === "--help") {
      console.log("Usage: bun run bench:revision-graph -- [options]");
      console.log("");
      console.log("Options:");
      console.log("  --fixture <name>      Run single fixture");
      console.log("  --sample-count <n>    Number of timed samples (default 8)");
      console.log("  --samples             Include raw samples in JSON output");
      console.log("  --json                Emit machine-readable JSON");
      console.log("");
      console.log("Fixtures:");
      for (const name of ALL_FIXTURE_NAMES) {
        console.log(`  ${name}`);
      }
      process.exit(0);
    }
  }

  return { fixture, json, sampleCount, includeSamples };
}

function computeStats(samples: readonly number[], includeRaw: boolean): BenchmarkStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const min = sorted[0];
  const max = sorted[n - 1];
  const p50 = sorted[Math.floor(n * 0.5)] ?? sorted[n - 1];
  const p75 = sorted[Math.floor(n * 0.75)] ?? sorted[n - 1];
  const p95 = sorted[Math.floor(n * 0.95)] ?? sorted[n - 1];
  const p99 = sorted[Math.floor(n * 0.99)] ?? sorted[n - 1];

  const stats: BenchmarkStats = { avg, max, min, p50, p75, p95, p99, ticks: n };
  if (includeRaw) {
    stats.samples = sorted;
  }
  return stats;
}

function runPhase(
  name: string,
  fn: () => void,
  sampleCount: number,
  warmupCount: number,
  includeSamples: boolean,
): BenchmarkPhase {
  // Warmup
  for (let i = 0; i < warmupCount; i++) {
    fn();
  }

  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    samples.push(end - start);
  }

  return { name, stats: computeStats(samples, includeSamples) };
}

function benchmarkFixture(
  fixture: GraphFixture,
  sampleCount: number,
  includeSamples: boolean,
): BenchmarkResult {
  const revisions = fixture.revisions;

  const heapBefore =
    typeof (globalThis as unknown as Record<string, unknown>).gc === "function"
      ? (performance as PerformanceWithMemory).memory?.usedJSHeapSize ?? null
      : null;

  const totalStart = performance.now();

  const phases: BenchmarkPhase[] = [];

  phases.push(
    runPhase(
      "computeRevisionAncestry",
      () => computeRevisionAncestry(revisions),
      sampleCount,
      DEFAULT_WARMUP_COUNT,
      includeSamples,
    ),
  );

  phases.push(
    runPhase(
      "reorderForGraph",
      () => reorderForGraph(revisions),
      sampleCount,
      DEFAULT_WARMUP_COUNT,
      includeSamples,
    ),
  );

  phases.push(
    runPhase(
      "detectStacks",
      () => detectStacks(revisions),
      sampleCount,
      DEFAULT_WARMUP_COUNT,
      includeSamples,
    ),
  );

  phases.push(
    runPhase(
      "buildGraph",
      () => buildGraph(revisions),
      sampleCount,
      DEFAULT_WARMUP_COUNT,
      includeSamples,
    ),
  );

  const totalTimeMs = performance.now() - totalStart;

  const heapAfter =
    typeof (globalThis as unknown as Record<string, unknown>).gc === "function"
      ? (performance as PerformanceWithMemory).memory?.usedJSHeapSize ?? null
      : null;

  const memoryDeltaBytes =
    heapBefore != null && heapAfter != null ? heapAfter - heapBefore : null;

  return {
    manifest: {
      fixtureName: fixture.name,
      description: fixture.description,
      revisionCount: fixture.revisionCount,
    },
    phases,
    memoryDeltaBytes,
    totalTimeMs,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log("");
  console.log(`─`.repeat(60));
  console.log(`${result.manifest.fixtureName}  (${result.manifest.revisionCount} revisions)`);
  console.log(`  ${result.manifest.description}`);
  console.log(`─`.repeat(60));

  for (const phase of result.phases) {
    const { stats } = phase;
    console.log(
      `${phase.name.padEnd(28)} avg=${stats.avg.toFixed(3)}ms  ` +
        `p50=${stats.p50.toFixed(3)}ms  p95=${stats.p95.toFixed(3)}ms  ` +
        `max=${stats.max.toFixed(3)}ms`,
    );
  }

  console.log(
    `${"TOTAL".padEnd(28)} ${result.totalTimeMs.toFixed(3)}ms`,
  );

  if (result.memoryDeltaBytes != null) {
    console.log(
      `${"memory delta".padEnd(28)} ${(result.memoryDeltaBytes / 1024 / 1024).toFixed(2)}MB`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const fixtureNames = options.fixture
    ? [options.fixture]
    : [...ALL_FIXTURE_NAMES];

  const results: BenchmarkResult[] = [];

  for (const name of fixtureNames) {
    const fixture = getFixture(name);
    const result = benchmarkFixture(
      fixture,
      options.sampleCount,
      options.includeSamples,
    );
    results.push(result);

    if (!options.json) {
      printResult(result);
    }
  }

  if (options.json) {
    const output: BenchmarkRunOutput = {
      generatedAt: new Date().toISOString(),
      kind: "revision-graph-benchmark-run",
      results,
    };
    console.log(JSON.stringify(output, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
