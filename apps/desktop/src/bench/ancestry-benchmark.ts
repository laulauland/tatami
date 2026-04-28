import { computeRevisionAncestry } from "@/components/revision-graph-utils";
import { getFixture } from "./revision-graph-fixtures";

function bench(name: string, fn: () => void, samples: number) {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`${name.padEnd(30)} avg=${avg.toFixed(3)}ms  min=${min.toFixed(3)}ms  max=${max.toFixed(3)}ms`);
}

const fixtures = ["linear-1000", "many-branches-1000", "merge-heavy-1000"];

for (const name of fixtures) {
  const fixture = getFixture(name);
  console.log(`\n${name} (${fixture.revisionCount} revisions)`);
  console.log("─".repeat(50));
  bench("computeRevisionAncestry", () => computeRevisionAncestry(fixture.revisions), 5);
}
