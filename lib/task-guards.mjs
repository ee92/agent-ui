export const TASK_TRANSITIONS = {
  todo: ["active", "plan", "done"],
  plan: ["active", "todo"],
  active: ["review", "blocked", "done"],
  review: ["active", "done"],
  blocked: ["active", "todo"],
  done: ["todo", "active"],
};

const DEFAULT_ELIGIBLE_STATUSES = ["todo"];

function byId(tasks) {
  return new Map(tasks.map((task) => [task.id, task]));
}

export function validateTransition(task, newStatus, transitions = TASK_TRANSITIONS) {
  if (!task || typeof task !== "object") {
    return { valid: false, error: "Task is required" };
  }

  if (typeof newStatus !== "string" || !newStatus.trim()) {
    return { valid: false, error: "New status is required" };
  }

  const fromStatus = task.status;
  if (fromStatus === newStatus) {
    return { valid: true, error: null };
  }

  const allowed = transitions?.[fromStatus];
  if (!Array.isArray(allowed)) {
    return { valid: false, error: `Unknown current status: ${String(fromStatus)}` };
  }

  if (!allowed.includes(newStatus)) {
    return {
      valid: false,
      error: `Invalid transition: ${String(fromStatus)} -> ${String(newStatus)}. Allowed: ${allowed.join(", ")}`,
    };
  }

  return { valid: true, error: null };
}

export function checkBlockedBy(task, allTasks) {
  const tasks = Array.isArray(allTasks) ? allTasks : [];
  const index = byId(tasks);
  const deps = Array.isArray(task?.blockedBy) ? task.blockedBy : [];
  const unresolvedIds = deps.filter((depId) => index.get(depId)?.status !== "done");
  return { blocked: unresolvedIds.length > 0, unresolvedIds };
}

export function checkMaxConcurrent(allTasks, maxConcurrent) {
  const tasks = Array.isArray(allTasks) ? allTasks : [];
  const activeCount = tasks.filter((task) => task?.status === "active").length;
  const limit = Number.isFinite(Number(maxConcurrent)) ? Math.max(1, Number(maxConcurrent)) : 1;
  return { allowed: activeCount < limit, activeCount };
}

export function checkParentReady(task, allTasks) {
  const tasks = Array.isArray(allTasks) ? allTasks : [];
  const index = byId(tasks);

  let cursor = task;
  while (cursor?.parentId) {
    const parent = index.get(cursor.parentId);
    if (!parent) {
      break;
    }

    if (parent.status === "todo") {
      return { ready: false, blockingAncestor: parent };
    }

    cursor = parent;
  }

  return { ready: true, blockingAncestor: null };
}

export function findEligible(allTasks, config = {}) {
  const tasks = Array.isArray(allTasks) ? allTasks : [];
  const statuses = Array.isArray(config?.statuses) && config.statuses.length > 0
    ? config.statuses
    : DEFAULT_ELIGIBLE_STATUSES;

  return tasks
    .filter((task) => statuses.includes(task?.status))
    .filter((task) => checkParentReady(task, tasks).ready)
    .filter((task) => !checkBlockedBy(task, tasks).blocked)
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
}
