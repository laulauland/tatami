import { computeRevisionAncestry } from "@/components/revision-graph-utils";
import { getFixture } from "./revision-graph-fixtures";

const fixture = getFixture("linear-5000");
const start = performance.now();
computeRevisionAncestry(fixture.revisions);
console.log(`linear-5000: ${(performance.now() - start).toFixed(2)}ms`);
