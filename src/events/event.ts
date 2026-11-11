import { IUser } from "../options/IUser";
import { IVariation } from "../evaluation/data/IVariation";

export interface IEvent {
  hash: string;
}

export class AsyncEvent implements IEvent {
  private readonly isCompletedPromise?: Promise<AsyncEvent>;
  private resolveFn?: (value: AsyncEvent) => void;
  timestamp = (new Date()).getTime();

  get hash(): string {
    return this.timestamp.toString();
  }

  constructor() {
    this.isCompletedPromise = new Promise<AsyncEvent>((resolve) => {
      this.resolveFn = resolve;
    });
  }

  waitForCompletion(): Promise<AsyncEvent> {
    return this.isCompletedPromise!;
  }

  complete() {
    this.resolveFn?.(this);
  }
}

export class FlushEvent extends AsyncEvent {
}

export class ShutdownEvent extends AsyncEvent {
}

export class PayloadEvent implements IEvent {
  timestamp = (new Date()).getTime();

  get hash(): string {
    return this.timestamp.toString();
  }

  toPayload(): any {
  };
}

function userPayload(user: IUser) {
  return {
    keyId: user.key,
    name: user.name,
    customizedProperties: user.customizedProperties
  }
}

export class MetricEvent extends PayloadEvent {
  constructor(
    public user: IUser,
    public eventName: string,
    public appType: string,
    public metricValue: number
  ) {
    super();
    this.timestamp = new Date().getTime();
  }

  toPayload(): any {
    return {
      user: userPayload(this.user),
      metrics: [{
        route: 'index/metric',
        timestamp: this.timestamp,
        numericValue: this.metricValue,
        appType: this.appType,
        eventName: this.eventName,
        type: 'CustomEvent'
      }]
    }
  }

  get hash(): string {
    const payload = this.toPayload();
    const hasObject = {
      user: payload.user,
      metrics: payload.metrics.map((m: any) => ({...m, timestamp: undefined}))
    }
    return JSON.stringify(hasObject);
  }
}

export class EvalEvent extends PayloadEvent {
  constructor(
    public user: IUser,
    public flagKey: string,
    public variation: IVariation,
    public sendToExperiment: boolean
  ) {
    super();
    this.timestamp = new Date().getTime();
  }

  toPayload(): any {
    return {
      user: userPayload(this.user),
      variations: [{
        featureFlagKey: this.flagKey,
        sendToExperiment: this.sendToExperiment,
        timestamp: this.timestamp,
        variation: this.variation
      }]
    }
  }

  get hash(): string {
    const payload = this.toPayload();
    const hasObject = {
      user: payload.user,
      variations: payload.variations.map((m: any) => ({...m, timestamp: undefined}))
    }

    return JSON.stringify(hasObject);
  }
}

export class IdentifyEvent extends PayloadEvent {
  public readonly user: IUser;

  constructor(user: IUser) {
    super();
    this.user = {
      key: user.key,
      name: user.name,
      customizedProperties: user.customizedProperties?.map(property => ({...property}))
    };
  }

  toPayload(): any {
    return {
      user: userPayload(this.user),
      variations: [],
      metrics: []
    }
  }

  get hash(): string {
    return JSON.stringify(this.toPayload());
  }
}
