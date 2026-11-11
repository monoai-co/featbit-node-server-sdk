import { IEventSerializer } from "./EventSerializer";
import { EvalEvent, IdentifyEvent, IEvent, MetricEvent } from "./event";

export class DefaultEventSerializer implements IEventSerializer {
  serialize(events: IEvent[]): string {
    const payload = events
      .map(event => event instanceof EvalEvent || event instanceof MetricEvent || event instanceof IdentifyEvent
        ? event.toPayload()
        : null)
      .filter(event => event !== null);

    return JSON.stringify(payload);
  }
}