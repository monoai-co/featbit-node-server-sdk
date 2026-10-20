import { FbClientBuilder, IFbClient, IFlag, IUser, ReasonKinds, integrations } from "../../../src";
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

describe("prepared exposures", () => {
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

  async function create(flags: IFlag[] = [], disabled = false, maxEventsInQueue = 10000) {
    const data = new integrations.TestData();
    const client = new FbClientBuilder({ dataSynchronizer: data.getFactory(), maxEventsInQueue })
      .sdkKey("test-sdk-key")
      .streamingUri("ws://localhost.invalid")
      .eventsUri("http://localhost.invalid")
      .logger(new integrations.TestLogger())
      .disableEvents(disabled)
      .build();
    clients.push(client);
    await client.waitForInitialization();
    for (const item of flags) await data.update(item);
    return { client, data };
  }

  async function flush(client: IFbClient) {
    const flushing = client.flush();
    await jest.advanceTimersByTimeAsync(1000);
    expect(await flushing).toBe(true);
  }

  it("prepares every typed value without sending events when never consumed", async () => {
    const { client } = await create([flag("bool", "true"), flag("number", "42"), flag("string", "hello"), flag("json", '{"nested":[1,2]}')]);
    const details = [
      await client.prepareBoolVariationDetail("bool", user, false),
      await client.prepareNumberVariationDetail("number", user, 0),
      await client.prepareStringVariationDetail("string", user, "fallback"),
      await client.prepareJsonVariationDetail("json", user, null)
    ];
    expect(details.map(detail => detail.value)).toEqual([true, 42, "hello", { nested: [1, 2] }]);
    for (const detail of details) {
      expect(detail.kind).toBe(ReasonKinds.FallThrough);
      expect(detail.exposure?.variation.id).toBe("selected");
      expect(JSON.stringify(detail.exposure)).not.toContain("test-sdk-key");
    }
    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("records the immutable original snapshot with consumption time after config and user change", async () => {
    const original = flag("boolean", "true");
    const mutableUser = { key: "before", name: "Original", customizedProperties: [{ name: "org", value: "org-before" }] };
    const { client, data } = await create([original]);
    const detail = await client.prepareBoolVariationDetail("boolean", mutableUser, false);
    const receipt = detail.exposure;
    if (!receipt) throw new Error("Expected a successful prepared exposure");
    const preparedAt = Date.now();
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.user)).toBe(true);
    expect(Object.isFrozen(receipt.user.customizedProperties)).toBe(true);
    expect(Object.isFrozen(receipt.user.customizedProperties?.[0])).toBe(true);
    expect(Object.isFrozen(receipt.variation)).toBe(true);
    mutableUser.key = "after";
    mutableUser.name = "Changed";
    mutableUser.customizedProperties[0].value = "org-after";
    original.variations[0].value = "false";
    await data.update(flag("boolean", "false"));
    await jest.advanceTimersByTimeAsync(500);
    expect(client.recordPreparedExposure(receipt)).toBe(true);
    await flush(client);
    expect(sender).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sender.mock.calls[0][0]);
    expect(payload).toEqual([{
      user: { keyId: "before", name: "Original", customizedProperties: [{ name: "org", value: "org-before" }] },
      variations: [{ featureFlagKey: "boolean", sendToExperiment: true, timestamp: preparedAt + 500, variation: { id: "selected", value: "true" } }]
    }]);
    expect(detail.value).toBe(true);
  });

  it("accepts a serialized receipt and copies it before queueing", async () => {
    const { client } = await create([flag("bool", "true")]);
    const detail = await client.prepareBoolVariationDetail("bool", user, false);
    const receipt = JSON.parse(JSON.stringify(detail.exposure));
    expect(client.recordPreparedExposure(receipt)).toBe(true);
    receipt.user.key = "changed";
    receipt.variation.value = "changed";
    await flush(client);
    const payload = JSON.parse(sender.mock.calls[0][0]);
    expect(payload[0].user.keyId).toBe("user-1");
    expect(payload[0].variations[0].variation.value).toBe("true");
  });

  it("does not issue receipts or events for missing, invalid, malformed, or wrong-type evaluations", async () => {
    const malformed = flag("malformed", "true");
    malformed.fallthrough.variations = [];
    const { client } = await create([flag("wrong", "not-a-bool-or-number-or-json"), malformed]);
    const details = [
      await client.prepareBoolVariationDetail("missing", user, false),
      await client.prepareBoolVariationDetail("wrong", user, false),
      await client.prepareNumberVariationDetail("wrong", user, 7),
      await client.prepareJsonVariationDetail("wrong", user, { fallback: true }),
      await client.prepareStringVariationDetail("missing", user, "fallback"),
      await client.prepareBoolVariationDetail("malformed", user, false),
      await client.prepareBoolVariationDetail("wrong", { key: " " }, false)
    ];
    expect(details.map(detail => detail.kind)).toEqual([ReasonKinds.FlagNotFound, ReasonKinds.WrongType, ReasonKinds.WrongType, ReasonKinds.WrongType, ReasonKinds.FlagNotFound, ReasonKinds.Error, ReasonKinds.Error]);
    expect(details.map(detail => detail.value)).toEqual([false, false, 7, { fallback: true }, "fallback", false, false]);
    for (const detail of details) expect(detail.exposure).toBeUndefined();
    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("has no receipt before initialization and does not send an exposure", async () => {
    const client = new FbClientBuilder().sdkKey("test-sdk-key")
      .streamingUri("ws://localhost.invalid").eventsUri("http://localhost.invalid")
      .logger(new integrations.TestLogger())
      .dataSynchronizer({ start() {}, close() {}, stop() {} }).build();
    clients.push(client);
    const details = [
      await client.prepareBoolVariationDetail("flag", user, false),
      await client.prepareNumberVariationDetail("flag", user, 3),
      await client.prepareStringVariationDetail("flag", user, "fallback"),
      await client.prepareJsonVariationDetail("flag", user, null)
    ];
    for (const detail of details) {
      expect(detail.kind).toBe(ReasonKinds.ClientNotReady);
      expect(detail.exposure).toBeUndefined();
    }
    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("queues typed receipts through native batching and rejects consumption after close", async () => {
    const { client } = await create([flag("bool", "true"), flag("number", "2"), flag("string", "value"), flag("json", '{}')]);
    const details = [
      await client.prepareBoolVariationDetail("bool", user, false),
      await client.prepareNumberVariationDetail("number", user, 0),
      await client.prepareStringVariationDetail("string", user, ""),
      await client.prepareJsonVariationDetail("json", user, null)
    ];
    for (const detail of details) {
      if (!detail.exposure) throw new Error("Expected prepared receipt");
      expect(client.recordPreparedExposure(detail.exposure)).toBe(true);
    }
    const closing = client.close();
    await jest.advanceTimersByTimeAsync(1000);
    await closing;
    expect(sender).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sender.mock.calls[0][0]).map((event: { variations: { featureFlagKey: string }[] }) => event.variations[0].featureFlagKey)).toEqual(["bool", "number", "string", "json"]);
    const receipt = details[0].exposure;
    if (!receipt) throw new Error("Expected prepared receipt");
    expect(client.recordPreparedExposure(receipt)).toBe(false);
  });

  it("respects disabled events without removing the prepared value or receipt", async () => {
    const { client } = await create([flag("bool", "true")], true);
    const detail = await client.prepareBoolVariationDetail("bool", user, false);
    expect(detail.value).toBe(true);
    if (!detail.exposure) throw new Error("Expected prepared receipt");
    expect(client.recordPreparedExposure(detail.exposure)).toBe(false);
    await flush(client);
    expect(sender).not.toHaveBeenCalled();
  });

  it("reports native queue rejection instead of claiming a queued consumption", async () => {
    const { client } = await create([flag("bool", "true")], false, 1);
    const detail = await client.prepareBoolVariationDetail("bool", user, false);
    if (!detail.exposure) throw new Error("Expected prepared receipt");
    expect(client.recordPreparedExposure(detail.exposure)).toBe(true);
    expect(client.recordPreparedExposure(detail.exposure)).toBe(false);
    await jest.advanceTimersByTimeAsync(1000);
    const closing = client.close();
    await jest.advanceTimersByTimeAsync(1000);
    await closing;
    expect(sender).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sender.mock.calls[0][0])).toHaveLength(1);
  });

  it("preserves legacy numeric conversion including nonfinite values", async () => {
    const values = ["42.5", "Infinity", "-Infinity", "NaN", ""];
    const { client } = await create(values.map((value, index) => flag(`number-${index}`, value)), true);
    for (let index = 0; index < values.length; index++) {
      const key = `number-${index}`;
      const legacy = await client.numberVariationDetail(key, user, 7);
      const prepared = await client.prepareNumberVariationDetail(key, user, 7);
      expect(prepared.value).toBe(legacy.value);
      expect(prepared.kind).toBe(legacy.kind);
      expect(prepared.reason).toBe(legacy.reason);
      expect(Boolean(prepared.exposure)).toBe(legacy.kind !== ReasonKinds.WrongType);
    }
  });
});
