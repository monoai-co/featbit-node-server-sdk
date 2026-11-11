import { IEvalDetail } from "./IEvalDetail";
import { IContextProperty } from "../IContextProperty";
import { IVariation } from "./data/IVariation";

/** A serializable snapshot of a successful evaluation, without an SDK key. */
export interface IPreparedExposure {
  readonly version: 1;
  readonly flagKey: string;
  readonly user: {
    readonly key: string;
    readonly name?: string;
    readonly customizedProperties?: ReadonlyArray<Readonly<IContextProperty>>;
  };
  readonly variation: Readonly<IVariation>;
  readonly sendToExperiment: boolean;
}

/** Evaluation detail that has not recorded an exposure event. */
export interface IPreparedEvalDetail<TValue> extends IEvalDetail<TValue> {
  readonly exposure?: IPreparedExposure;
}
