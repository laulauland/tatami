import { claude, codex, pi, shell, task } from "@mill/core/program";

type RevisionSpec = {
  readonly id: string;
  readonly draftDescription: string;
  readonly goal: string;
  readonly acceptance: ReadonlyArray<string>;
  readonly defaultChecks: ReadonlyArray<ReadonlyArray<string>>;
  readonly derisk: boolean;
};

const ROOT = process.env.TATAMI_ROOT ?? process.cwd();
const MAX_REVIEW_ITERATIONS = Number(process.env.MAX_REVIEW_ITERATIONS ?? 4);
const START_AT = process.env.START_AT;
const STOP_AFTER = process.env.STOP_AFTER;
const DRY_RUN = process.env.DRY_RUN === "1";
const ORCHESTRATOR_MODEL = process.env.ORCHESTRATOR_MODEL ?? "default";
const PLANNER_MODEL = process.env.PLANNER_MODEL ?? "default";
const IMPLEMENTER_MODEL = process.env.IMPLEMENTER_MODEL ?? "default";
const REVIEWER_MODEL = process.env.REVIEWER_MODEL ?? "gpt-5.5";

const revisionStack: ReadonlyArray<RevisionSpec> = [
  {
    id: "electrobun-svelte-shell",
    draftDescription: "feat(desktop): add electrobun svelte shell",
    goal: "Add the minimal Electrobun app shell and Svelte 5 frontend that opens a window and renders basic app chrome. This is the first derisk revision because every later UI slice depends on Electrobun + Svelte working in this repo.",
    acceptance: [
      "Electrobun config and package scripts exist",
      "Svelte app renders in an Electrobun window",
      "a tiny Svelte 5 rune interaction works",
      "SvelteKit vs Vite-only decision is documented in code/docs if the spec changes",
      "existing Tauri app/scripts remain intact",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: true,
  },
  {
    id: "electrobun-rpc-stubs",
    draftDescription: "feat(desktop): add typed electrobun rpc stubs",
    goal: "Add shared typed Electrobun webview-to-Bun RPC with stub handlers and prove browser imports resolve inside the Svelte bundle.",
    acceptance: [
      "shared RPC schema exists",
      "Svelte frontend calls a stub getRevisions request through Electrobun RPC",
      "Bun backend returns fixture revision data through typed handlers",
      "a bun-to-webview message path is demonstrated or explicitly deferred",
      "type errors would surface if schema usage is violated",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: true,
  },
  {
    id: "native-addon-skeleton",
    draftDescription: "feat(native): add jj Node-API addon skeleton",
    goal: "Add a napi-rs native addon crate that can be loaded from Bun and exposes a minimal getRevisionsJson path backed by existing jj-lib log code.",
    acceptance: [
      "native addon crate exists under apps/desktop/native/tatami-jj-native or the planner-approved equivalent",
      "build.rs calls napi_build::setup()",
      "Bun can load the produced .node addon",
      "getRevisionsJson returns valid revision JSON for the current repo",
      "native dependency/linkage risk is checked with an appropriate platform command such as otool -L on macOS",
      "Tauri app remains intact; no broad frontend rewrite yet",
    ],
    defaultChecks: [
      ["cargo", "build", "--manifest-path", "apps/desktop/native/tatami-jj-native/Cargo.toml"],
    ],
    derisk: true,
  },
  {
    id: "rpc-native-integration",
    draftDescription: "feat(desktop): wire electrobun rpc to native addon",
    goal: "Connect the typed RPC path to the native addon and render real revision data in the Svelte/Electrobun app.",
    acceptance: [
      "Bun backend loads native addon through one boundary module",
      "Svelte frontend calls getRevisions through RPC, not direct native imports",
      "real revisions from a local jj repo render in the Svelte window",
      "repo path can be configured through a minimal UI or documented dev constant",
      "errors are surfaced visibly or logged clearly",
      "No React, no Tauri involvement in this data path",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: true,
  },
  {
    id: "tanstack-effect-spike",
    draftDescription: "feat(desktop): spike tanstack db and effect boundaries",
    goal: "Prove the Svelte 5 + @tanstack/svelte-db usage pattern and introduce the first Effect service boundaries around native/RPC operations.",
    acceptance: [
      "frontend NativeClient service exists or a spike module demonstrates the approved shape",
      "backend JjNativeAddon and RepoService service shape is established",
      "@tanstack/svelte-db useLiveQuery works from Svelte without unsafe destructuring",
      "Svelte reactive getters are wrapped with $derived where needed",
      "JSON parsing/validation is centralized at a boundary",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: true,
  },
  {
    id: "trees-file-ui",
    draftDescription: "feat(desktop): add pierre trees file tree integration",
    goal: "Introduce @pierre/trees for file tree UI through its vanilla runtime wrapped for Svelte lifecycle.",
    acceptance: [
      "@pierre/trees is used for file tree rendering; no custom tree component is invented",
      "Svelte wrapper/action creates and disposes FileTree correctly",
      "tree selection events integrate with app state",
      "fixture tree renders independently of repo/RPC data",
      "styling/theming hooks are documented near the wrapper",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: true,
  },
  {
    id: "diff-renderer-spike",
    draftDescription: "feat(desktop): spike svelte diff renderer",
    goal: "Prove the non-React @pierre/diffs strategy in Svelte/Electrobun before porting the full diff panel.",
    acceptance: [
      "text diffs render without importing @pierre/diffs/react",
      "worker/highlighter loading works in the Electrobun webview or the limitation is documented",
      "large static diff fixture does not freeze the UI",
      "unified/split or equivalent display choice is documented",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: true,
  },
  {
    id: "storage-project-picker",
    draftDescription: "feat(desktop): add project storage and picker",
    goal: "Add project/repository persistence, repository picker UI, and open repository dialog in the Electrobun/Svelte app.",
    acceptance: [
      "repositories can be added, selected, and removed",
      "active repository persists across restart",
      "storage location uses Electrobun/Bun-side app data path or a documented alternative",
      "existing Tauri storage remains untouched unless intentionally migrated",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: false,
  },
  {
    id: "revision-graph-readonly",
    draftDescription: "feat(desktop): port read-only revision graph to svelte",
    goal: "Port the read-only revision graph using Svelte 5, TanStack DB, and existing graph utilities where possible.",
    acceptance: [
      "revision collection is backed by TanStack DB / @tanstack/svelte-db",
      "graph renders and supports selection/navigation",
      "URL or route state owns selected revision where practical",
      "large repos remain responsive enough for daily use",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: false,
  },
  {
    id: "diff-panel-readonly",
    draftDescription: "feat(desktop): port read-only diff panel",
    goal: "Port changed-file list and read-only diff rendering using the proven @pierre/trees and diff-renderer approaches.",
    acceptance: [
      "getRevisionDiff/getRevisionChanges and batch reads are exposed through native/RPC/services",
      "selecting a revision shows changed files and diff content",
      "@pierre/trees drives the changed-file tree/list where appropriate",
      "image/binary diff limitations are documented if deferred",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: false,
  },
  {
    id: "jj-mutations",
    draftDescription: "feat(desktop): wire core jj mutations",
    goal: "Wire new/edit/describe/squash/rebase/abandon mutations with invalidation, user feedback, and safe error handling.",
    acceptance: [
      "core local jj mutations work from Svelte UI",
      "TanStack DB/query invalidation updates graph after mutations",
      "mutation errors are visible and typed at service boundaries",
      "optimistic behavior is either implemented or explicitly deferred",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: false,
  },
  {
    id: "operations-sync",
    draftDescription: "feat(desktop): add operations log and sync actions",
    goal: "Add operation log, undo, fetch, and push flows to the Svelte/Electrobun app.",
    acceptance: [
      "operations are visible for active repository",
      "undo operation works or fails clearly",
      "fetch/push commands are wired through native/RPC/services",
      "sync state and errors are visible",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: false,
  },
  {
    id: "watcher-desktop-integration",
    draftDescription: "feat(desktop): add repo watcher and desktop shell integrations",
    goal: "Add repo watcher events plus desktop integrations: menus, dialogs, paths, external opens, and supported deep links.",
    acceptance: [
      "external repo changes invalidate Svelte/TanStack state",
      "duplicate watchers are avoided",
      "menus/dialogs/path helpers use Electrobun boundaries",
      "deep-link support and platform gaps are documented",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: false,
  },
  {
    id: "parity-polish",
    draftDescription: "feat(desktop): port keyboard search and app polish",
    goal: "Port keyboard shortcuts, search/command palette, settings/repository screens, and layout polish needed for daily use.",
    acceptance: [
      "keyboard workflows match current app where practical",
      "search/command palette works",
      "settings/repositories screens are ported or explicitly deferred",
      "layout state behaves consistently",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "vite", "build", "--config", "vite.electrobun.config.ts"]],
    derisk: false,
  },
  {
    id: "packaging-cleanup",
    draftDescription: "chore(desktop): package electrobun app and remove old frontend shell",
    goal: "Verify dev and packaged Electrobun builds, update scripts/docs/CI, and remove old React/Tauri shell only after parity is proven.",
    acceptance: [
      "Electrobun dev and packaged builds work",
      "native addon loading works in packaged app",
      "scripts/docs/CI point at the new app",
      "React/Tauri dependencies and code are removed only intentionally",
    ],
    defaultChecks: [["bun", "--cwd", "apps/desktop", "run", "electrobun:build"]],
    derisk: false,
  },
];
const commonContext = (revision: RevisionSpec): string => `
Repository: ${ROOT}

Authoritative spec:
- docs/electrobun-svelte-rewrite-spec.md

Local source references:
- .references/electrobun
- .references/tanstack-db
- .references/svelte
- .references/effect-smol

Important decisions:
- Rewrite UI from React/Tauri to Svelte 5/Electrobun.
- Keep Rust jj-lib integration through a Rust Node-API addon loaded by Bun/Electrobun.
- Keep Effect for service/workflow boundaries.
- Keep TanStack DB, using @tanstack/svelte-db in Svelte components.
- Use @pierre/trees / https://trees.software for file tree UI, preferably via the vanilla @pierre/trees runtime wrapped in Svelte lifecycle.
- Do not remove Tauri/React until an explicit cleanup/parity revision.
- Use jj, not git.

Current revision:
- id: ${revision.id}
- draft description: ${revision.draftDescription}
- derisk/spike revision: ${revision.derisk ? "yes" : "no"}
- goal: ${revision.goal}
- acceptance criteria:\n${revision.acceptance.map((item) => `  - ${item}`).join("\n")}
`;

const runAgent = async (provider: "orchestrator" | "planner" | "implementer" | "reviewer", prompt: string): Promise<string> => {
  const handle =
    provider === "reviewer"
      ? task({ agent: codex(REVIEWER_MODEL) })
      : provider === "implementer"
        ? task({ agent: pi(IMPLEMENTER_MODEL) })
        : task({ agent: claude(provider === "planner" ? PLANNER_MODEL : ORCHESTRATOR_MODEL) });

  const output = await handle.run(prompt);
  if (output.kind !== "agent") {
    throw new Error(`Expected agent output from ${provider}`);
  }
  return output.text;
};

const runShell = async (args: ReadonlyArray<string>, failOnNonZeroExit = true): Promise<string> => {
  const output = await shell({ command: args[0]!, args: args.slice(1), cwd: ROOT, failOnNonZeroExit }).run();
  if (output.kind !== "shell") {
    throw new Error("Expected shell output");
  }
  return [output.stdout, output.stderr].filter(Boolean).join("\n");
};

const isApproved = (review: string): boolean => /\bAPPROVED\b/.test(review);

const selectedRevisions = (): ReadonlyArray<RevisionSpec> => {
  const start = START_AT === undefined ? 0 : revisionStack.findIndex((r) => r.id === START_AT);
  if (start < 0) throw new Error(`Unknown START_AT revision id: ${START_AT}`);
  const endInclusive = STOP_AFTER === undefined ? revisionStack.length - 1 : revisionStack.findIndex((r) => r.id === STOP_AFTER);
  if (endInclusive < 0) throw new Error(`Unknown STOP_AFTER revision id: ${STOP_AFTER}`);
  return revisionStack.slice(start, endInclusive + 1);
};

const buildOrchestratorStartPrompt = (revision: RevisionSpec): string => `${commonContext(revision)}

You are the stack orchestrator for the whole rewrite, but this turn is about selecting/confirming the next jj revision.

Responsibilities:
- Confirm this revision is the right next meaningful change.
- Tighten or narrow the scope if needed.
- Identify any prerequisite that should pause the workflow.
- Produce planner instructions.

Output sections:
1. GO / PAUSE verdict.
2. Final revision scope.
3. Planner instructions.
4. Shell checks the final gate should run.
`;

const buildPlannerPrompt = (revision: RevisionSpec, orchestratorDecision: string): string => `${commonContext(revision)}

Orchestrator decision:
${orchestratorDecision}

Plan this revision only. Do not modify files.

Output:
- exact scope and non-goals,
- likely files/modules to inspect or edit,
- implementation steps,
- acceptance checks,
- relevant commands,
- risks/unknowns,
- what must be deferred to later revisions.
`;

const buildImplementerPrompt = (
  revision: RevisionSpec,
  orchestratorDecision: string,
  plan: string,
  previousSummary?: string,
  previousReview?: string,
): string => `${commonContext(revision)}

Orchestrator decision:
${orchestratorDecision}

Revision-local plan:
${plan}

${previousSummary && previousReview ? `Previous implementation summary:\n${previousSummary}\n\nReviewer blocking feedback to address:\n${previousReview}\n` : ""}

Implement this revision only.

Rules:
- Keep changes focused on this revision's acceptance criteria.
- Do not remove Tauri/React unless this is the explicit cleanup revision.
- Preserve existing behavior outside this slice.
- Use local reference snapshots as needed.
- Run focused checks where practical.

Return:
- changed files,
- what was implemented,
- commands/checks run and results,
- known issues or follow-ups.
`;

const buildReviewerPrompt = (
  revision: RevisionSpec,
  orchestratorDecision: string,
  plan: string,
  implementation: string,
  iteration: number,
): string => `${commonContext(revision)}

Orchestrator decision:
${orchestratorDecision}

Revision-local plan:
${plan}

Implementation summary for review iteration ${iteration + 1}:
${implementation}

Review the actual repository diff and files. Focus only on this revision.

Verdict format:
- If acceptable, put APPROVED on its own line.
- Otherwise, do not include APPROVED on its own line. List blocking issues and exact fixes.

Review criteria:
- Meets acceptance criteria.
- Does not broaden scope.
- Keeps architecture aligned with docs/electrobun-svelte-rewrite-spec.md.
- Uses @pierre/trees for file tree work if this revision touches file trees.
- Has adequate checks or explains why not.
`;

const buildFinalizePrompt = (
  revision: RevisionSpec,
  orchestratorDecision: string,
  plan: string,
  implementation: string,
  review: string,
  gateOutput: string,
): string => `${commonContext(revision)}

You are the stack orchestrator finalizing this jj revision.

Inputs:

Initial orchestrator decision:
${orchestratorDecision}

Plan:
${plan}

Implementation summary:
${implementation}

Reviewer result:
${review}

Shell gate output:
${gateOutput}

Decide the final jj revision description. It should be concise and meaningful. Prefer the draft description unless the actual landed work differs.

Output exactly this shape:
FINAL_DESCRIPTION: <one-line jj description>
CONTINUE: yes|no
NOTES:
- <optional notes>

Use CONTINUE: yes unless there is a hard blocker requiring human input. Completion of the current revision is not a reason to stop the stack.
`;

const parseFinalDescription = (text: string, fallback: string): string => {
  const match = text.match(/^FINAL_DESCRIPTION:\s*(.+)$/m);
  return match?.[1]?.trim() || fallback;
};

const shouldContinue = (text: string): boolean => {
  if (process.env.STOP_ON_ORCHESTRATOR_NO !== "1") {
    return true;
  }

  const match = text.match(/^CONTINUE:\s*(yes|no)\s*$/im);
  return match === null || match[1]?.toLowerCase() === "yes";
};

const runChecks = async (revision: RevisionSpec): Promise<string> => {
  const results: string[] = [];
  for (const check of revision.defaultChecks) {
    if (DRY_RUN) {
      results.push(`[dry-run] ${check.join(" ")}`);
      continue;
    }
    try {
      const output = await runShell(check, true);
      results.push(`$ ${check.join(" ")}\n${output}`);
    } catch (error) {
      results.push(`$ ${check.join(" ")}\nFAILED: ${String(error)}`);
      throw new Error(results.join("\n\n"));
    }
  }
  return results.join("\n\n");
};

const completeRevision = async (
  description: string,
  nextRevision: RevisionSpec | undefined,
): Promise<void> => {
  if (DRY_RUN) {
    console.log(`[dry-run] jj describe -m ${JSON.stringify(description)}`);
    if (nextRevision !== undefined) {
      console.log(`[dry-run] jj edit existing child for ${nextRevision.id}, or jj new if absent`);
    }
    return;
  }

  await runShell(["jj", "describe", "-m", description]);

  if (nextRevision === undefined) {
    return;
  }

  const childOutput = await runShell(
    ["jj", "log", "-r", "children(@)", "--no-graph", "-T", "change_id.short() ++ \"\\n\""],
    false,
  );
  const childId = childOutput
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (childId !== undefined) {
    await runShell(["jj", "edit", childId]);
  } else {
    await runShell(["jj", "new"]);
  }
};

export default async function runTatamiSvelteRewriteWorkflow(): Promise<string> {
  const revisions = selectedRevisions();
  const completed: string[] = [];

  for (let index = 0; index < revisions.length; index++) {
    const revision = revisions[index]!;
    console.log(`\n=== ${revision.id}: ${revision.draftDescription} ===`);

    const orchestration = await runAgent("orchestrator", buildOrchestratorStartPrompt(revision));
    if (/^\s*PAUSE\b/im.test(orchestration) && !/^\s*GO\b/im.test(orchestration)) {
      throw new Error(`Orchestrator paused before ${revision.id}:\n${orchestration}`);
    }

    const plan = await runAgent("planner", buildPlannerPrompt(revision, orchestration));

    let implementation = await runAgent(
      "implementer",
      buildImplementerPrompt(revision, orchestration, plan),
    );
    let review = "";

    for (let iteration = 0; iteration < MAX_REVIEW_ITERATIONS; iteration++) {
      review = await runAgent(
        "reviewer",
        buildReviewerPrompt(revision, orchestration, plan, implementation, iteration),
      );

      if (isApproved(review)) break;

      if (iteration === MAX_REVIEW_ITERATIONS - 1) {
        throw new Error(
          `Reviewer did not approve ${revision.id} after ${MAX_REVIEW_ITERATIONS} iterations:\n${review}`,
        );
      }

      implementation = await runAgent(
        "implementer",
        buildImplementerPrompt(revision, orchestration, plan, implementation, review),
      );
    }

    const gateOutput = await runChecks(revision);
    const finalDecision = await runAgent(
      "orchestrator",
      buildFinalizePrompt(revision, orchestration, plan, implementation, review, gateOutput),
    );
    const finalDescription = parseFinalDescription(finalDecision, revision.draftDescription);

    await completeRevision(finalDescription, revisions[index + 1]);
    completed.push(`${revision.id}: ${finalDescription}`);

    if (!shouldContinue(finalDecision)) {
      break;
    }
  }

  const summary = `Completed revisions:\n${completed.map((item) => `- ${item}`).join("\n")}`;
  console.log(summary);
  return summary;
}
