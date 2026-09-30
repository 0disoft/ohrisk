import { expect, test } from "bun:test";
import { collectDependencyEdges } from "../src/graph/dependency-edges";

test("edge collection rejects excess relationships and preserves cycles below the limit", () => {
  const input = {
    refs: ["a", "b"], rootRefs: ["a"], idForRef: (ref: string) => ref,
    childRefs: (ref: string) => ref === "a" ? ["b"] : ["a"],
    dependencyTypeForRef: () => "production" as const
  };
  const limited = collectDependencyEdges({ ...input, maxEdges: 2 });
  expect(limited.ok).toBe(false);
  if (!limited.ok) expect(limited.error.code).toBe("DEPENDENCY_GRAPH_LIMIT_EXCEEDED");
  const accepted = collectDependencyEdges({ ...input, maxEdges: 3 });
  expect(accepted.ok).toBe(true);
  if (accepted.ok) expect(accepted.value.edges).toHaveLength(3);
});

test("missing reference targets keep their known parent explicitly unknown", () => {
  const result = collectDependencyEdges({
    refs: ["a"], rootRefs: ["a"], idForRef: (ref) => ref === "a" ? "a@1" : undefined,
    childRefs: () => ["missing"], dependencyTypeForRef: () => "production"
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value.unknownDependencyNodeIds).toEqual(["a@1"]);
  expect(result.value.edges).toEqual([{ to: "a@1", dependencyType: "production" }]);
});
