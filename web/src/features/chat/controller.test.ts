import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatController } from "./controller";
import { FakeGateway, fakeServerRequest } from "./test-support";

function createdSession(runtime = "rt-1", stored = "st-1") {
  return {
    session_id: runtime,
    stored_session_id: stored,
    message_count: 0,
    messages: [],
    info: { title: "New chat", model: "test/model" },
  };
}

function makeController(
  options: Partial<ConstructorParameters<typeof ChatController>[0]> = {},
) {
  const transport = new FakeGateway();
  const controller = new ChatController({
    transport,
    profile: "work",
    now: () => 1_700_000_000,
    ...options,
  });
  return { transport, controller };
}

describe("ChatController session lifecycle", () => {
  it("does not create a session on construction or scope binding", () => {
    const { transport, controller } = makeController();
    controller.setScope("work", null);
    expect(transport.methods()).not.toContain("session.create");
    controller.dispose();
  });

  it("creates a session lazily on first send and submits the runtime id", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));

    const ok = await controller.send("hello");
    expect(ok).toBe(true);
    expect(transport.methods().filter((m) => m === "session.create")).toHaveLength(1);
    const submits = transport.callsFor("prompt.submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ session_id: "rt-1", text: "hello", profile: "work" });
    expect(controller.getSnapshot().storedSessionId).toBe("st-1");
    expect(controller.getSnapshot().items.some((item) => item.text === "hello")).toBe(true);
    controller.dispose();
  });

  it("shares one in-flight create between concurrent sends (no double session)", async () => {
    const { transport, controller } = makeController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.responses.set("session.create", async () => {
      await gate;
      return createdSession();
    });
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));

    const first = controller.createSessionIfNeeded();
    const second = controller.createSessionIfNeeded();
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a?.runtime).toBe("rt-1");
    expect(b?.runtime).toBe("rt-1");
    expect(transport.methods().filter((m) => m === "session.create")).toHaveLength(1);
    controller.dispose();
  });

  it("creates a fresh session in the picked workspace", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    controller.setWorkspaceCwd("  /tmp/project  ");
    await controller.send("hi");
    expect(transport.callsFor("session.create")[0]).toMatchObject({
      cwd: "/tmp/project",
      cwd_explicit: true,
    });
    controller.dispose();
  });

  it("includes the pending model on a fresh session", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    controller.setPendingModel({ model: "gpt-5", provider: "openai" });
    await controller.send("hi");
    expect(transport.callsFor("session.create")[0]).toMatchObject({
      model: "gpt-5",
      provider: "openai",
      source: "dashboard",
    });
    controller.dispose();
  });

  it("opens a stored session with resume and never mints a new one", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.resume", () => ({
      ...createdSession("rt-9", "st-9"),
      messages: [{ role: "user", text: "previous", row_id: 4 }],
      running: false,
    }));
    controller.setScope("work", "st-9");
    await vi.waitFor(() => {
      expect(controller.getSnapshot().items).toHaveLength(1);
    });
    expect(transport.callsFor("session.resume")[0]).toMatchObject({
      session_id: "st-9",
      profile: "work",
    });
    expect(transport.methods()).not.toContain("session.create");
    controller.dispose();
  });
});

describe("ChatController send failures", () => {
  it("removes the optimistic bubble and reports a definite failure", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.failures.set("prompt.submit", new Error("backend refused"));

    const ok = await controller.send("will fail");
    expect(ok).toBe(false);
    expect(controller.getSnapshot().items.some((item) => item.text === "will fail")).toBe(false);
    expect(controller.getSnapshot().error).toContain("backend refused");
    expect(controller.getSnapshot().sendPhase).toBe("idle");
    controller.dispose();
  });

  it("treats a request timeout as ambiguous and recovers the real live state", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.failures.set(
      "prompt.submit",
      new Error("request timed out after 120s: prompt.submit"),
    );
    transport.responses.set("session.resume", () => ({
      ...createdSession(),
      running: true,
      inflight: { assistant: "partial", streaming: true },
    }));
    transport.responses.set("session.history", () => ({
      count: 1,
      messages: [{ role: "user", text: "ambiguous", row_id: 1 }],
    }));

    const ok = await controller.send("ambiguous");
    expect(ok).toBe(false);
    await vi.waitFor(() => {
      const snapshot = controller.getSnapshot();
      expect(snapshot.items.some((item) => item.text === "ambiguous")).toBe(true);
      expect(snapshot.running).toBe(true);
    });
    controller.dispose();
  });

  it("never infers running from matching history text on an ambiguous timeout", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.failures.set(
      "prompt.submit",
      new Error("request timed out after 120s: prompt.submit"),
    );
    // The identical text exists in an old, already-completed turn.
    transport.responses.set("session.resume", () => ({
      ...createdSession(),
      running: false,
    }));
    transport.responses.set("session.history", () => ({
      count: 1,
      messages: [{ role: "user", text: "lost", row_id: 1 }],
    }));
    await controller.send("lost");
    await vi.waitFor(() => {
      expect(transport.methods()).toContain("session.resume");
    });
    expect(controller.getSnapshot().running).toBe(false);
    controller.dispose();
  });

  it("never auto-resends after an ambiguous timeout", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.failures.set(
      "prompt.submit",
      new Error("request timed out after 120s: prompt.submit"),
    );
    transport.responses.set("session.resume", () => createdSession());
    transport.responses.set("session.history", () => ({ count: 0, messages: [] }));
    await controller.send("lost");
    await Promise.resolve();
    expect(transport.methods().filter((m) => m === "prompt.submit")).toHaveLength(1);
    controller.dispose();
  });

  it("reuses the create idempotency key after an ambiguous create", async () => {
    const { transport, controller } = makeController();
    transport.failures.set(
      "session.create",
      new Error("request timed out after 120s: session.create"),
    );
    await controller.send("first");
    const firstKey = transport.callsFor("session.create")[0]?.idempotency_key;
    await controller.send("second");
    const secondKey = transport.callsFor("session.create")[1]?.idempotency_key;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
    controller.dispose();
  });
});

describe("ChatController event scoping", () => {
  async function linkedController() {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    await controller.send("hi");
    return { transport, controller };
  }

  it("ignores events for other sessions and profiles", async () => {
    const { transport, controller } = await linkedController();
    transport.emit("message.delta", { text: "other" }, { session_id: "rt-other" });
    transport.emit(
      "message.delta",
      { text: "wrong profile" },
      { session_id: "rt-1", profile: "someone-else" },
    );
    transport.emit("message.delta", { text: " mine" }, { session_id: "rt-1" });
    const assistant = controller
      .getSnapshot()
      .items.filter((item) => item.kind === "assistant")
      .map((item) => item.text)
      .join("");
    expect(assistant).toBe(" mine");
    controller.dispose();
  });

  it("drops late events after the scope changed", async () => {
    const { transport, controller } = await linkedController();
    transport.responses.set("session.resume", () => ({
      ...createdSession("rt-2", "st-2"),
      messages: [],
    }));
    controller.setScope("work", "st-2");
    await vi.waitFor(() => {
      expect(controller.getSnapshot().runtimeSessionId).toBe("rt-2");
    });
    transport.emit("message.delta", { text: " late" }, { session_id: "rt-1" });
    expect(controller.getSnapshot().items).toHaveLength(0);
    controller.dispose();
  });
});

describe("ChatController stop and completion", () => {
  it("interrupts the running session and settles from the completion event", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    transport.responses.set("session.interrupt", () => ({ status: "interrupted" }));
    await controller.send("long task");
    transport.emit("message.start", undefined, { session_id: "rt-1" });
    expect(controller.getSnapshot().running).toBe(true);

    await controller.interrupt();
    expect(transport.callsFor("session.interrupt")[0]).toMatchObject({
      session_id: "rt-1",
      profile: "work",
    });
    transport.emit(
      "message.complete",
      { status: "interrupted" },
      { session_id: "rt-1" },
    );
    expect(controller.getSnapshot().running).toBe(false);
    controller.dispose();
  });

  it("settles a stuck turn when the completion event never arrives", async () => {
    vi.useFakeTimers();
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    transport.responses.set("session.interrupt", () => ({ status: "interrupted" }));
    await controller.send("task");
    transport.emit("message.start", undefined, { session_id: "rt-1" });
    await controller.interrupt();
    vi.advanceTimersByTime(8_000);
    expect(controller.getSnapshot().running).toBe(false);
    controller.dispose();
    vi.useRealTimers();
  });

  it("reconciles durable history when a turn completes", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    transport.responses.set("session.history", () => ({ count: 0, messages: [] }));
    await controller.send("hi");
    transport.emit(
      "message.complete",
      { text: "done", status: "complete" },
      { session_id: "rt-1" },
    );
    await vi.waitFor(() => {
      expect(transport.methods()).toContain("session.history");
    });
    controller.dispose();
  });
});

describe("ChatController reconnect", () => {
  it("resumes the live session on reconnect without creating a new one", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    transport.responses.set("session.resume", () => ({
      ...createdSession("rt-1", "st-1"),
      running: true,
      inflight: { assistant: "partial", streaming: true },
    }));
    transport.responses.set("session.history", () => ({ count: 0, messages: [] }));
    await controller.send("hi");

    transport.emitState("closed");
    expect(controller.getSnapshot().retrying).toBe(true);
    transport.emitState("open");

    await vi.waitFor(() => {
      expect(transport.callsFor("session.resume")).toHaveLength(1);
    });
    expect(transport.callsFor("session.resume")[0]).toMatchObject({
      session_id: "rt-1",
      omit_messages: true,
    });
    expect(transport.methods().filter((m) => m === "session.create")).toHaveLength(1);
    controller.dispose();
  });

  it("falls back to the stored id when the runtime session was reclaimed", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    transport.responses.set("session.history", () => ({ count: 0, messages: [] }));
    await controller.send("hi");

    transport.responses.set("session.resume", (params) => {
      if (params.session_id === "rt-1") throw new Error("session not found");
      return { ...createdSession("rt-2", "st-1"), running: false, messages: [] };
    });
    transport.emitState("closed");
    transport.emitState("open");

    await vi.waitFor(() => {
      expect(transport.callsFor("session.resume")).toHaveLength(2);
    });
    expect(transport.callsFor("session.resume").map((call) => call.session_id)).toEqual([
      "rt-1",
      "st-1",
    ]);
    expect(controller.getSnapshot().runtimeSessionId).toBe("rt-2");
    expect(controller.getSnapshot().sessionEnded).toBe(false);
    controller.dispose();
  });

  it("waits for the shared replay barrier before resuming on reconnect", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    transport.responses.set("session.resume", () => ({
      ...createdSession(),
      running: true,
    }));
    transport.responses.set("session.history", () => ({ count: 0, messages: [] }));
    await controller.send("hi");

    transport.emitState("closed");
    transport.emitState("open");
    await vi.waitFor(() => {
      expect(transport.callsFor("session.resume")).toHaveLength(1);
    });
    const barrierIndex = transport.order.indexOf("barrier:rt-1");
    const resumeIndex = transport.order.indexOf("session.resume");
    expect(barrierIndex).toBeGreaterThanOrEqual(0);
    expect(barrierIndex).toBeLessThan(resumeIndex);
    controller.dispose();
  });

  it("schedules a redial with bounded backoff after a drop", () => {
    vi.useFakeTimers();
    const { transport, controller } = makeController();
    transport.emitState("closed");
    expect(controller.getSnapshot().retrying).toBe(true);
    expect(transport.connectCalls).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(transport.connectCalls).toBe(1);
    controller.dispose();
    vi.useRealTimers();
  });
});

describe("ChatController server requests", () => {
  async function linkedController() {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    await controller.send("hi");
    return { transport, controller };
  }

  it("surfaces an approval for the visible session and answers explicitly", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("approval", {
      session_id: "rt-1",
      request_id: "ap-1",
      command: "rm -rf build",
      tool_name: "shell",
      choices: ["once", "deny"],
    });
    transport.serverRequest(request);
    expect(controller.getSnapshot().requests).toHaveLength(1);

    controller.respondApproval("req-1", "once");
    expect(request.responded).toEqual([{ choice: "once" }]);
    expect(controller.getSnapshot().requests).toHaveLength(0);
    controller.dispose();
  });

  it("retains an approval from another conversation until it is opened", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("approval", {
      session_id: "rt-other",
      request_id: "ap-2",
      choices: ["once", "deny"],
    });
    transport.serverRequest(request);
    // Not denied and not shown while another conversation is on screen.
    expect(request.responded).toEqual([]);
    expect(controller.getSnapshot().requests).toHaveLength(0);

    // Opening that session surfaces the retained card.
    transport.responses.set("session.resume", () => ({
      ...createdSession("rt-other", "st-other"),
      messages: [],
    }));
    controller.setScope("work", "st-other");
    await vi.waitFor(() => {
      expect(controller.getSnapshot().requests).toHaveLength(1);
    });
    controller.respondApproval("req-1", "deny");
    expect(request.responded).toEqual([{ choice: "deny" }]);
    controller.dispose();
  });

  it("retains clarify requests that are not in view", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("clarify", {
      session_id: "rt-other",
      questions: [{ qid: "q1", question: "Which env?" }],
    });
    transport.serverRequest(request);
    expect(request.responded).toEqual([]);
    controller.dispose();
  });

  it("answers clarify with the collected answers", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("clarify", {
      session_id: "rt-1",
      questions: [{ qid: "q1", question: "Which env?", choices: ["dev", "prod"] }],
    });
    transport.serverRequest(request);
    controller.respondClarify("req-1", { q1: "dev" });
    expect(request.responded).toEqual([{ answers: { q1: "dev" } }]);
    controller.dispose();
  });

  it("fails unsupported interactive prompts visibly instead of hanging", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("sudo", {
      session_id: "rt-1",
      command: "apt install x",
    });
    transport.serverRequest(request);
    expect(request.failed).toHaveLength(1);
    expect(request.failed[0].code).toBe(-32601);
    expect(
      controller.getSnapshot().items.some((item) => item.text.includes("sudo")),
    ).toBe(true);
    controller.dispose();
  });

  it("parks a pending approval across navigation and re-shows it on return", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("approval", {
      session_id: "rt-1",
      request_id: "ap-3",
      choices: ["once", "deny"],
    });
    transport.serverRequest(request);
    expect(controller.getSnapshot().requests).toHaveLength(1);

    controller.newSession();
    expect(request.responded).toEqual([]);
    expect(controller.getSnapshot().requests).toHaveLength(0);

    transport.responses.set("session.resume", () => ({
      ...createdSession("rt-1", "st-1"),
      messages: [],
    }));
    controller.setScope("work", "st-1");
    await vi.waitFor(() => {
      expect(controller.getSnapshot().requests).toHaveLength(1);
    });
    controller.dispose();
  });

  it("removes a withdrawn request on request.cancel", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("approval", {
      session_id: "rt-1",
      request_id: "ap-4",
      choices: ["once", "deny"],
    });
    transport.serverRequest(request);
    expect(controller.getSnapshot().requests).toHaveLength(1);
    transport.emit("request.cancel", { id: "req-1", method: "approval", reason: "resolved" });
    expect(controller.getSnapshot().requests).toHaveLength(0);
    expect(request.responded).toEqual([]);
    controller.dispose();
  });

  it("removes cancelled approvals on approval.cancelled", async () => {
    const { transport, controller } = await linkedController();
    const request = fakeServerRequest("approval", {
      session_id: "rt-1",
      request_id: "ap-5",
      choices: ["once", "deny"],
    });
    transport.serverRequest(request);
    transport.emit(
      "approval.cancelled",
      { request_ids: ["req-1"], stored_session_id: "st-1", reason: "interrupt", cancelled_count: 1 },
      { session_id: "rt-1" },
    );
    expect(controller.getSnapshot().requests).toHaveLength(0);
    controller.dispose();
  });
});

describe("ChatController slash commands", () => {
  async function linkedController() {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    await controller.send("hi");
    transport.calls.length = 0;
    return { transport, controller };
  }

  it("/new resets the pane without sending model text", async () => {
    const { transport, controller } = await linkedController();
    const ok = await controller.send("/new");
    expect(ok).toBe(true);
    expect(transport.methods()).not.toContain("prompt.submit");
    expect(controller.getSnapshot().storedSessionId).toBeNull();
    expect(controller.getSnapshot().items).toHaveLength(0);
    controller.dispose();
  });

  it("/stop interrupts instead of sending model text", async () => {
    const { transport, controller } = await linkedController();
    transport.responses.set("session.interrupt", () => ({ status: "interrupted" }));
    const ok = await controller.send("/stop");
    expect(ok).toBe(true);
    expect(transport.methods()).not.toContain("prompt.submit");
    expect(transport.methods()).toContain("session.interrupt");
    controller.dispose();
  });

  it("renders slash.exec output as a notice", async () => {
    const { transport, controller } = await linkedController();
    transport.responses.set("slash.exec", () => ({ output: "help text" }));
    await controller.send("/help");
    expect(controller.getSnapshot().items.some((item) => item.text === "help text")).toBe(true);
    controller.dispose();
  });

  it("falls back to command.dispatch and honors a prefill directive", async () => {
    const onPrefill = vi.fn();
    const { transport, controller } = makeController({ onPrefill });
    transport.responses.set("session.create", () => createdSession());
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));
    await controller.send("hi");
    transport.failures.set("slash.exec", new Error("not a quick/plugin/skill command"));
    transport.responses.set("command.dispatch", () => ({
      type: "prefill",
      message: "edited prompt",
    }));
    await controller.send("/undo");
    expect(onPrefill).toHaveBeenCalledWith("edited prompt");
    controller.dispose();
  });
});

describe("ChatController scope races", () => {
  it("starts a resume once the socket opens (no permanent not-connected)", async () => {
    // Simulate a page mounted before the first open.
    const transport = new FakeGateway();
    transport.connectionState = "connecting";
    const controller = new ChatController({
      transport,
      profile: "work",
      now: () => 1_700_000_000,
    });
    transport.responses.set("session.resume", () => ({
      ...createdSession("rt-9", "st-9"),
      messages: [{ role: "user", text: "previous" }],
    }));
    controller.setScope("work", "st-9");
    expect(transport.methods()).not.toContain("session.resume");

    transport.emitState("open");
    await vi.waitFor(() => {
      expect(transport.methods()).toContain("session.resume");
    });
    expect(transport.callsFor("session.resume")[0]).toMatchObject({
      session_id: "st-9",
      profile: "work",
    });
    controller.dispose();
  });

  it("abandons an in-flight create when the scope changed", async () => {
    const { transport, controller } = makeController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.responses.set("session.create", async () => {
      await gate;
      return createdSession();
    });
    transport.responses.set("prompt.submit", () => ({ status: "streaming" }));

    const pending = controller.send("for the old pane");
    controller.newSession();
    release();
    const ok = await pending;
    expect(ok).toBe(false);
    expect(transport.methods()).not.toContain("prompt.submit");
    expect(controller.getSnapshot().storedSessionId).toBeNull();
    controller.dispose();
  });

  it("does not restart running when the submit response lands after completion", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.responses.set("prompt.submit", async () => {
      await gate;
      return { status: "streaming" };
    });
    transport.responses.set("session.history", () => ({ count: 0, messages: [] }));

    const pending = controller.send("fast turn");
    await vi.waitFor(() => {
      expect(transport.methods()).toContain("prompt.submit");
    });
    transport.emit(
      "message.complete",
      { text: "done", status: "complete" },
      { session_id: "rt-1" },
    );
    release();
    await pending;
    expect(controller.getSnapshot().running).toBe(false);
    controller.dispose();
  });
});

describe("ChatController teardown", () => {
  it("closes the transport and stops handling events after dispose", async () => {
    const { transport, controller } = makeController();
    transport.responses.set("session.create", () => createdSession());
    await controller.send("hi");
    controller.dispose();
    expect(transport.closeCalls).toBe(1);
    transport.emit("message.delta", { text: " late" }, { session_id: "rt-1" });
    expect(controller.getSnapshot().error).toBeNull();
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});
