import { FbClientBuilder, IFbClient, IFlag, IUser, integrations } from "../../../src";
import { DefaultEventSender } from "../../../src/events/DefaultEventSender";
import { DeliveryStatus } from "../../../src/events/IEventSender";

function flag(key: string, value: string): IFlag {
  return {
    id: `${key}-id`, key, version: 1, variationType: "string", isEnabled: true,
    variations: [{ id: "selected", value }, { id: "off", value: "false" }],
    targetUsers: [], rules: [], disabledVariationId: "off", updatedAt: "2026-10-20T00:00:00Z",
    fallthrough: { dispatchKey: "", includedInExpt: true, variations: [{ id: "selected", rollout: [0, 1], exptRollout: 1 }] },
    exptIncludeAllTargets: true
  };
}

interface IdentifyPayload {
  user: { keyId: string; name?: string; customizedProperties?: { name: string; value: string }[] };
  variations?: unknown[];
  metrics?: unknown[];
}

describe("identify", () => {
  const clients: IFbClient[] = [];
  const user: IUser = { key: "user-1", name: "Original", customizedProperties: [{ name: "org", value: "org-1" }] };
  let sender: jest.SpiedFunction<DefaultEventSender["send"]>;

  beforeEach(() => {
    jest.useFakeTimers();
    sender = jest.spyOn(DefaultEventSender.prototype, "send").mockResolvedValue({ status: DeliveryStatus.Succeeded });
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      const closing = client.close();
      await jest.advanceTimersByTimeAsync(1000);
      await closing;
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function builder(options: { disabled?: boolean; maxEventsInQueue?: number } = {}) {
    const data = new integrations.TestData();
    return {
      data,
      builder: new FbClientBuilder({ dataSynchronizer: data.getFactory(), maxEventsInQueue: options.maxEventsInQueue ?? 10000 })
        .sdkKey("test-sdk-key")
        .streamingUri("ws://localhost.invalid")
        .eventsUri("http://localhost.invalid")
        .logger(new integrations.TestLogger())
        .disableEvents(options.disabled ?? false)
    };
  }

  async function create(options: { disabled?: boolean; maxEventsInQueue?: number } = {}) {
    const { data, builder: clientBuilder } = builder(options);
    const client = clientBuilder.build();
    clients.push(client);
    await client.waitForInitialization();
    return { client, data };
  }

  async function flush(client: IFbClient) {
    const flushing = client.flush();
    await jest.advanceTimersByTimeAsync(1000);
    expect(await flushing).toBe(true);
  }

  async function close(client: IFbClient) {
    const closing = client.close();
    await jest.advanceTimersByTimeAsync(1000);
    await closing;
  }

  function sentPayloads(): IdentifyPayload[] {
    return sender.mock.calls.flatMap(call => JSON.parse(call[0]));
  }

  it("queues one event with the user and empty variations and metrics", async () => {
    const { client } = await create();
    expect(client.identify(user)).toBe(true);
    await flush(client);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][1]).toBe(true);
    expect(JSON.parse(sender.mock.calls[0][0])).toEqual([{
      user: { keyId: "user-1", name: "Original", customizedProperties: [{ name: "org", value: "org-1" }] },
      variations: [],
      metrics: []
    }]);
  });

  it("reports a user that has only a key", async () => {
    const { client } = await create();
    expect(client.identify({ key: "only-key" })).toBe(true);
    await flush(client);
    expect(sentPayloads()).toEqual([{ user: { keyId: "only-key" }, variations: [], metrics: [] }]);
  });

  it("does not need a flag, an evaluation or a metric event", async () => {
    const { client } = await create();
    expect(client.identify({ key: "unseen-user" })).toBe(true);
    await flush(client);
    const [payload] = sentPayloads();
    expect(payload.variations).toEqual([]);
    expect(payload.metrics).toEqual([]);
  });

  it("queues before initialization completes", async () => {
    const client = new FbClientBuilder().sdkKey("test-sdk-key")
      .streamingUri("ws://localhost.invalid").eventsUri("http://localhost.invalid")
      .logger(new integrations.TestLogger())
      .dataSynchronizer({ start() {}, close() {}, stop() {} }).build();
    clients.push(client);
    expect(client.initialized()).toBe(false);
    expect(client.identify(user)).toBe(true);
    await flush(client);
    expect(sentPayloads().map(payload => payload.user.keyId)).toEqual(["user-1"]);
  });

  it("copies the user when called", async () => {
    const { client } = await create();
    const mutable: IUser = { key: "before", name: "Original", customizedProperties: [{ name: "org", value: "org-before" }] };
    expect(client.identify(mutable)).toBe(true);
    mutable.key = "after";
    mutable.name = "Changed";
    if (mutable.customizedProperties) mutable.customizedProperties[0].value = "org-after";
    await flush(client);
    expect(sentPayloads()).toEqual([{
      user: { keyId: "before", name: "Original", customizedProperties: [{ name: "org", value: "org-before" }] },
      variations: [],
      metrics: []
    }]);
  });

  it("deduplicates identical users within a flush and keeps distinct users in order", async () => {
    const { client } = await create();
    expect(client.identify(user)).toBe(true);
    await jest.advanceTimersByTimeAsync(500);
    expect(client.identify({ ...user })).toBe(true);
    expect(client.identify({ key: "user-2" })).toBe(true);
    expect(client.identify({ ...user, name: "Renamed" })).toBe(true);
    expect(client.identify({ ...user, customizedProperties: [{ name: "org", value: "org-2" }] })).toBe(true);
    await flush(client);

    expect(sender).toHaveBeenCalledTimes(1);
    const payloads = sentPayloads();
    expect(payloads.map(payload => payload.user.keyId)).toEqual(["user-1", "user-2", "user-1", "user-1"]);
    expect(payloads.map(payload => payload.user.name)).toEqual(["Original", undefined, "Renamed", "Original"]);
    expect(payloads[3].user.customizedProperties).toEqual([{ name: "org", value: "org-2" }]);
  });

  it("sends the same user again in a later flush", async () => {
    const { client } = await create();
    expect(client.identify(user)).toBe(true);
    await flush(client);
    expect(client.identify(user)).toBe(true);
    await flush(client);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sentPayloads()).toHaveLength(2);
  });

  it("is not merged with evaluation or metric events for the same user", async () => {
    const { client, data } = await create();
    await data.update(flag("bool", "true"));
    expect(await client.boolVariation("bool", user, false)).toBe(true);
    client.track(user, "purchase", 5);
    expect(client.identify(user)).toBe(true);
    await flush(client);

    const payloads = sentPayloads();
    expect(payloads).toHaveLength(3);
    expect(payloads.filter(payload => payload.variations?.length === 0 && payload.metrics?.length === 0)).toHaveLength(1);
    expect(payloads.filter(payload => payload.variations?.length === 1 && payload.metrics === undefined)).toHaveLength(1);
    expect(payloads.filter(payload => payload.metrics?.length === 1 && payload.variations === undefined)).toHaveLength(1);
  });

  it("delivers queued identify events when the client closes", async () => {
    const { client } = await create();
    expect(client.identify(user)).toBe(true);
    await close(client);
    expect(sentPayloads().map(payload => payload.user.keyId)).toEqual(["user-1"]);
  });

  it("returns false after the client is closed", async () => {
    const { client } = await create();
    await close(client);
    expect(() => client.identify(user)).not.toThrow();
    expect(client.identify(user)).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it("returns false when the client is offline", async () => {
    const client = new FbClientBuilder().sdkKey("test-sdk-key").offline(true)
      .logger(new integrations.TestLogger()).build();
    clients.push(client);
    await client.waitForInitialization();
    expect(() => client.identify(user)).not.toThrow();
    expect(client.identify(user)).toBe(false);
    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("returns false when events are disabled", async () => {
    const { client } = await create({ disabled: true });
    expect(() => client.identify(user)).not.toThrow();
    expect(client.identify(user)).toBe(false);
    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("returns false when the event queue is full", async () => {
    const { client } = await create({ maxEventsInQueue: 1 });
    expect(client.identify(user)).toBe(true);
    expect(client.identify({ key: "user-2" })).toBe(false);
    await jest.advanceTimersByTimeAsync(1000);
    await flush(client);
    expect(sentPayloads().map(payload => payload.user.keyId)).toEqual(["user-1"]);
  });

  it("returns false without throwing for a user with no key", async () => {
    const { client } = await create();
    const errors: Error[] = [];
    client.on("error", (error: Error) => errors.push(error));

    const invalid: IUser[] = [{ key: "" }, { key: "   " }, { key: " ", name: "Named" }];
    for (const candidate of invalid) {
      expect(() => client.identify(candidate)).not.toThrow();
      expect(client.identify(candidate)).toBe(false);
    }
    expect(errors).toHaveLength(invalid.length * 2);
    expect(errors[0].message).toContain("key is mandatory");

    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("returns false without throwing when no user is passed", async () => {
    const { client } = await create();
    for (const missing of [undefined, null]) {
      expect(() => Reflect.apply(client.identify, client, [missing])).not.toThrow();
      expect(Reflect.apply(client.identify, client, [missing])).toBe(false);
    }
    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("returns false for an invalid user when no error listener is registered", async () => {
    const { client } = await create();
    expect(client.listenerCount("error")).toBe(0);
    expect(client.identify({ key: "" })).toBe(false);
  });
});
