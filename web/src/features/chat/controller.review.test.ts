import { describe, expect, it } from "vitest";

import { ChatController } from "./controller";
import { FakeGateway } from "./test-support";

const created = { session_id: "rt-old", stored_session_id: "stored-old", messages: [], info: {} };

describe("controller independent race regressions", () => {
  it("does not reopen a previous profile's pending session on first connection", async () => {
    const transport = new FakeGateway();
    transport.connectionState = "connecting";
    const controller = new ChatController({ transport, profile: "old-profile" });
    transport.responses.set("session.resume", () => created);
    controller.setScope("old-profile", "stored-old");
    controller.setScope("new-profile", null);
    transport.emitState("open");
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.callsFor("session.resume")).toHaveLength(0);
    expect(controller.getSnapshot().profile).toBe("new-profile");
    expect(controller.getSnapshot().storedSessionId).toBeNull();
    controller.dispose();
  });

  it("does not submit a late created session after switching profile", async () => {
    const transport = new FakeGateway();
    const controller = new ChatController({ transport, profile: "old-profile" });
    let release!: (value: typeof created) => void;
    transport.responses.set("session.create", () => new Promise((resolve) => { release = resolve; }));
    const sending = controller.send("old draft");
    controller.setScope("new-profile", null);
    release(created);
    await sending;
    expect(transport.callsFor("prompt.submit")).toHaveLength(0);
    expect(controller.getSnapshot().storedSessionId).toBeNull();
    expect(controller.getSnapshot().items).toHaveLength(0);
    controller.dispose();
  });

  it("does not restart a turn when submit acceptance arrives after completion", async () => {
    const transport = new FakeGateway();
    const controller = new ChatController({ transport, profile: "default" });
    transport.responses.set("session.create", () => created);
    transport.responses.set("session.history", () => ({ messages: [] }));
    transport.responses.set("prompt.submit", () => {
      transport.emit("message.complete", { text: "done", status: "complete" }, { session_id: "rt-old" });
      return { status: "streaming" };
    });
    await controller.send("question");
    expect(controller.getSnapshot().running).toBe(false);
    expect(controller.getSnapshot().items.some((item) => item.text === "done")).toBe(true);
    controller.dispose();
  });
});
