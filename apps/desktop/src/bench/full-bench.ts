import { computeRevisionAncestry, detectStacks, reorderForGraph } from "@/components/revision-graph-utils";
import { getFixture } from "./revision-graph-fixtures";

function bench(name: string, fn: () => void, samples: number) {
  for (let i = 0; i < 1; i++) fn(); // warmup
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`${name.padEnd(28)} avg=${avg.toFixed(3)}ms`);
}

for (const name of ["linear-1000", "many-branches-1000", "merge-heavy-1000", "linear-5000"]) {
  const fixture = getFixture(name);
  console.log(`\n${name} (${fixture.revisionCount} revs)`);
  console.log("─".repeat(50));
  bench("computeRevisionAncestry", () => computeRevisionAncestry(fixture.revisions), 5);
  bench("reorderForGraph",         () => reorderForGraph(fixture.revisions), 5);
  bench("detectStacks",            () => detectStacks(fixture.revisions), 5);
}
