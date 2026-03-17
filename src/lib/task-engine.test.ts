import { describe, expect, it } from "vitest";
import {
  createTask,
  deleteTask,
  deserialize,
  filterByStatus,
  flattenVisible,
  getAncestors,
  getChildren,
  getDescendantIds,
  indentTask,
  moveTask,
  outdentTask,
  serialize,
  toggleCollapsed,
  updateTask,
  validate,
} from "./task-engine";
import type { TaskNode } from "./task-types";

function seed(): TaskNode[] {
  return [
    { id: "t_root1", title: "Root 1", description: "", notes: "", status: "todo", parentId: null, order: 1, collapsed: false, sessionKey: null, repo: null, branch: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null, history: [] },
    { id: "t_root2", title: "Root 2", description: "", notes: "", status: "active", parentId: null, order: 2, collapsed: false, sessionKey: null, repo: null, branch: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null, history: [] },
    { id: "t_child1", title: "Child 1", description: "", notes: "", status: "todo", parentId: "t_root1", order: 1, collapsed: false, sessionKey: null, repo: null, branch: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null, history: [] },
    { id: "t_child2", title: "Child 2", description: "", notes: "", status: "review", parentId: "t_root1", order: 2, collapsed: false, sessionKey: null, repo: null, branch: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null, history: [] },
    { id: "t_grand1", title: "Grandchild 1", description: "", notes: "", status: "blocked", parentId: "t_child1", order: 1, collapsed: false, sessionKey: "session:abc", repo: "swap.win", branch: "feat/test", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null, history: [] },
  ];
}

describe("tree operations", () => {
  it("getChildren returns sorted direct children", () => {
    const tasks = seed();
    const children = getChildren(tasks, "t_root1");
    expect(children.map((t) => t.id)).toEqual(["t_child1", "t_child2"]);
  });

  it("getChildren of root returns root-level tasks", () => {
    const tasks = seed();
    expect(getChildren(tasks, null).map((t) => t.id)).toEqual(["t_root1", "t_root2"]);
  });

  it("getDescendantIds returns all nested descendants", () => {
    const tasks = seed();
    const ids = getDescendantIds(tasks, "t_root1");
    expect(ids.sort()).toEqual(["t_child1", "t_child2", "t_grand1"].sort());
  });

  it("getAncestors returns bottom-up chain", () => {
    const tasks = seed();
    const ancestors = getAncestors(tasks, "t_grand1");
    expect(ancestors.map((t) => t.id)).toEqual(["t_child1", "t_root1"]);
  });
});

describe("CRUD", () => {
  it("createTask adds a task at the correct level", () => {
    const tasks = seed();
    const { tasks: next, created } = createTask(tasks, "New task", "t_root1");
    expect(next.length).toBe(tasks.length + 1);
    expect(created.parentId).toBe("t_root1");
    expect(created.status).toBe("todo");
    expect(created.order).toBe(3); // After child2 (order 2)
  });

  it("createTask at root level", () => {
    const tasks = seed();
    const { created } = createTask(tasks, "Root 3");
    expect(created.parentId).toBeNull();
    expect(created.order).toBe(3);
  });

  it("updateTask sets completedAt when marking done", () => {
    const tasks = seed();
    const updated = updateTask(tasks, "t_child1", { status: "done" });
    const task = updated.find((t) => t.id === "t_child1")!;
    expect(task.status).toBe("done");
    expect(task.completedAt).toBeTruthy();
  });

  it("updateTask clears completedAt when un-done", () => {
    let tasks = seed();
    tasks = updateTask(tasks, "t_child1", { status: "done" });
    tasks = updateTask(tasks, "t_child1", { status: "todo" });
    const task = tasks.find((t) => t.id === "t_child1")!;
    expect(task.completedAt).toBeNull();
  });

  it("deleteTask removes task and all descendants", () => {
    const tasks = seed();
    const result = deleteTask(tasks, "t_root1");
    expect(result.length).toBe(1); // Only t_root2 remains
    expect(result[0].id).toBe("t_root2");
  });
});

describe("move operations", () => {
  it("moveTask to new parent", () => {
    const tasks = seed();
    const moved = moveTask(tasks, "t_child1", "t_root2");
    const task = moved.find((t) => t.id === "t_child1")!;
    expect(task.parentId).toBe("t_root2");
  });

  it("moveTask prevents moving into own subtree", () => {
    const tasks = seed();
    const result = moveTask(tasks, "t_root1", "t_grand1");
    const task = result.find((t) => t.id === "t_root1")!;
    expect(task.parentId).toBeNull(); // Unchanged
  });

  it("indentTask makes it a child of the sibling above", () => {
    const tasks = seed();
    const result = indentTask(tasks, "t_child2");
    const task = result.find((t) => t.id === "t_child2")!;
    expect(task.parentId).toBe("t_child1");
  });

  it("indentTask does nothing for first child", () => {
    const tasks = seed();
    const result = indentTask(tasks, "t_child1");
    const task = result.find((t) => t.id === "t_child1")!;
    expect(task.parentId).toBe("t_root1"); // Unchanged
  });

  it("outdentTask moves to grandparent level", () => {
    const tasks = seed();
    const result = outdentTask(tasks, "t_child1");
    const task = result.find((t) => t.id === "t_child1")!;
    expect(task.parentId).toBeNull(); // Now at root
  });

  it("outdentTask does nothing for root tasks", () => {
    const tasks = seed();
    const result = outdentTask(tasks, "t_root1");
    const task = result.find((t) => t.id === "t_root1")!;
    expect(task.parentId).toBeNull();
  });
});

describe("flattenVisible", () => {
  it("returns all tasks with depth when nothing is collapsed", () => {
    const tasks = seed();
    const flat = flattenVisible(tasks);
    expect(flat.length).toBe(5);
    expect(flat.map((t) => [t.id, t.depth])).toEqual([
      ["t_root1", 0],
      ["t_child1", 1],
      ["t_grand1", 2],
      ["t_child2", 1],
      ["t_root2", 0],
    ]);
  });

  it("hides descendants when collapsed", () => {
    let tasks = seed();
    tasks = toggleCollapsed(tasks, "t_root1");
    const flat = flattenVisible(tasks);
    expect(flat.length).toBe(2); // root1 (collapsed) + root2
    expect(flat.map((t) => t.id)).toEqual(["t_root1", "t_root2"]);
  });

  it("partially collapsed — only hides nested branch", () => {
    let tasks = seed();
    tasks = toggleCollapsed(tasks, "t_child1");
    const flat = flattenVisible(tasks);
    expect(flat.length).toBe(4); // root1, child1 (collapsed), child2, root2
    expect(flat.find((t) => t.id === "t_grand1")).toBeUndefined();
  });
});

describe("filterByStatus", () => {
  it("returns matching tasks and their ancestors", () => {
    const tasks = seed();
    const filtered = filterByStatus(tasks, ["review"]);
    // t_child2 (review) + t_root1 (ancestor)
    expect(filtered.map((t) => t.id).sort()).toEqual(["t_child2", "t_root1"].sort());
  });

  it("includes deep ancestors for nested matches", () => {
    const tasks = seed();
    const filtered = filterByStatus(tasks, ["blocked"]);
    // t_grand1 (blocked) + t_child1 + t_root1 (ancestors)
    expect(filtered.map((t) => t.id).sort()).toEqual(["t_child1", "t_grand1", "t_root1"].sort());
  });
});

describe("serialization", () => {
  it("round-trips through serialize/deserialize", () => {
    const tasks = seed();
    const json = serialize(tasks);
    const restored = deserialize(json);
    expect(restored).toEqual(tasks);
  });

  it("deserialize handles v1 format migration", () => {
    const v1 = JSON.stringify({
      version: 1,
      tasks: [
        { id: "t_old", title: "Old task", description: "some notes", status: "queue", priority: "high", tags: ["infra"], agentSession: "session:x", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null },
      ],
    });
    const migrated = deserialize(v1);
    expect(migrated.length).toBe(1);
    expect(migrated[0].status).toBe("todo"); // queue → todo
    expect(migrated[0].notes).toBe("some notes"); // description → notes
    expect(migrated[0].sessionKey).toBe("session:x"); // agentSession → sessionKey
    expect(migrated[0].parentId).toBeNull();
  });

  it("deserialize handles garbage gracefully", () => {
    expect(deserialize("not json")).toEqual([]);
    expect(deserialize("null")).toEqual([]);
    expect(deserialize("{}")).toEqual([]);
  });
});

describe("validation", () => {
  it("valid tree passes", () => {
    const { valid, errors } = validate(seed());
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it("detects orphaned parent references", () => {
    const tasks = seed();
    tasks.push({
      id: "t_orphan", title: "Orphan", description: "", notes: "", status: "todo",
      parentId: "t_nonexistent", order: 1, collapsed: false,
      sessionKey: null, repo: null, branch: null,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", completedAt: null, history: [],
    });
    const { valid, errors } = validate(tasks);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("missing parent");
  });
});
