import { beforeEach, describe, expect, it } from "vitest";
import { useGatewayStore } from "./gateway-store";
import { useTasksStore } from "./tasks-store";

describe("tasks store", () => {
  beforeEach(() => {
    localStorage.clear();
    useGatewayStore.setState({
      connectionState: "disconnected",
      connectionDetail: "",
      gatewayUrl: "ws://localhost",
      gatewayToken: "token",
      gatewayClient: null,
      lastGatewayEvent: null,
      gatewayEventVersion: 0
    });
    useTasksStore.setState({
      tasks: [],
      tasksReady: true,
      tasksFallback: true,
      activeTaskId: null
    });
  });

  it("supports add, update, and move", async () => {
    await useTasksStore.getState().addTask("Write tests");
    const created = useTasksStore.getState().tasks[0];
    expect(created?.title).toBe("Write tests");

    await useTasksStore.getState().updateTask(created.id, { description: "Cover stores" });
    expect(useTasksStore.getState().tasks[0]?.description).toBe("Cover stores");

    await useTasksStore.getState().moveTask(created.id, "done", 0);
    expect(useTasksStore.getState().tasks[0]?.status).toBe("done");
  });
});
