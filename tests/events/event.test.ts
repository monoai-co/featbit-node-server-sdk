import { DefaultEventSerializer, EvalEvent, FlushEvent, IdentifyEvent, MetricEvent } from "../../src/events";
import { IUser } from "../../src";

const user: IUser = { key: "user-1", name: "Original", customizedProperties: [{ name: "org", value: "org-1" }] };

describe("IdentifyEvent", () => {
  it("serializes the user with empty variations and metrics", () => {
    expect(new IdentifyEvent(user).toPayload()).toEqual({
      user: { keyId: "user-1", name: "Original", customizedProperties: [{ name: "org", value: "org-1" }] },
      variations: [],
      metrics: []
    });
  });

  it("omits optional user fields that are not set", () => {
    const payload = new IdentifyEvent({ key: "user-1" }).toPayload();
    expect(JSON.parse(JSON.stringify(payload))).toEqual({ user: { keyId: "user-1" }, variations: [], metrics: [] });
  });

  it("copies the user so later changes do not alter the payload", () => {
    const mutable: IUser = { key: "before", name: "Original", customizedProperties: [{ name: "org", value: "org-before" }] };
    const event = new IdentifyEvent(mutable);
    mutable.key = "after";
    mutable.name = "Changed";
    mutable.customizedProperties?.push({ name: "extra", value: "1" });
    if (mutable.customizedProperties) mutable.customizedProperties[0].value = "org-after";
    expect(event.toPayload().user).toEqual({
      keyId: "before", name: "Original", customizedProperties: [{ name: "org", value: "org-before" }]
    });
  });

  it("has a hash that ignores the timestamp", () => {
    const first = new IdentifyEvent(user);
    const second = new IdentifyEvent({ ...user });
    second.timestamp = first.timestamp + 60000;
    expect(second.hash).toBe(first.hash);
  });

  it("has a hash that differs by user content and from other event kinds for the same user", () => {
    const hashes = [
      new IdentifyEvent(user).hash,
      new IdentifyEvent({ ...user, key: "user-2" }).hash,
      new IdentifyEvent({ ...user, name: "Renamed" }).hash,
      new IdentifyEvent({ ...user, customizedProperties: [{ name: "org", value: "org-2" }] }).hash,
      new IdentifyEvent({ key: user.key }).hash,
      new MetricEvent(user, "event", "node", 1).hash,
      new EvalEvent(user, "flag", { id: "v1", value: "true" }, true).hash
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("DefaultEventSerializer", () => {
  const serializer = new DefaultEventSerializer();

  it("serializes identify events alongside evaluation and metric events and skips control events", () => {
    const evalEvent = new EvalEvent(user, "flag", { id: "v1", value: "true" }, true);
    const metricEvent = new MetricEvent(user, "purchase", "node", 3);
    const payload = JSON.parse(serializer.serialize([
      new IdentifyEvent(user), evalEvent, new FlushEvent(), metricEvent
    ]));

    expect(payload).toEqual([
      { user: { keyId: "user-1", name: "Original", customizedProperties: [{ name: "org", value: "org-1" }] }, variations: [], metrics: [] },
      JSON.parse(JSON.stringify(evalEvent.toPayload())),
      JSON.parse(JSON.stringify(metricEvent.toPayload()))
    ]);
  });

  it("keeps the evaluation and metric payload shapes", () => {
    const evalEvent = new EvalEvent(user, "flag", { id: "v1", value: "true" }, true);
    const metricEvent = new MetricEvent(user, "purchase", "node", 3);
    const expectedUser = { keyId: "user-1", name: "Original", customizedProperties: [{ name: "org", value: "org-1" }] };

    expect(JSON.parse(serializer.serialize([evalEvent]))).toEqual([{
      user: expectedUser,
      variations: [{ featureFlagKey: "flag", sendToExperiment: true, timestamp: evalEvent.timestamp, variation: { id: "v1", value: "true" } }]
    }]);
    expect(JSON.parse(serializer.serialize([metricEvent]))).toEqual([{
      user: expectedUser,
      metrics: [{ route: "index/metric", timestamp: metricEvent.timestamp, numericValue: 3, appType: "node", eventName: "purchase", type: "CustomEvent" }]
    }]);
  });
});
