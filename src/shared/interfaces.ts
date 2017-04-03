/**
 * All of the data associated with a throughput point for a
 * particular (code region, speedup) pair.
 */
export interface ThroughputData {
  type: 'throughput';
  speedup: Speedup;
  points: ThroughputPoint[];
}

/**
 * All of the data associated with a latency point for a
 * particular (code region, speedup) pair.
 */
export interface LatencyData {
  type: 'latency';
  speedup: Speedup;
  points: LatencyPoint[];
}

/**
 * An entire profile's data, in parsed form.
 *
 * Guarantees:
 * - Every (location, progressPoint) has a baseline measurement.
 */
export interface ProfileData {
  [location: string]: {
    [progressPoint: string]: {
      [speedupAmount: number]: ThroughputData | LatencyData;
    }
  }
}

/**
 * Represents a speedup value, along with its 95% confidence interval.
 */
export interface Speedup {
  value: number;
  // 95% confidence interval
  conf_left: number;
  conf_right: number;
}

/**
 * Represents data from a throughput point in a single experiment.
 */
export interface ThroughputPoint {
  delta: number;
  duration: number;
}

/**
 * Represents data from a latency point from a single experiment
 */
export interface LatencyPoint {
  arrivals: number;
  departures: number;
  difference: number;
  duration: number;
}

/**
 * Represents data from a single progress point in a single experiment.
 */
export type DataPoint = ThroughputPoint | LatencyPoint;

/**
 * A line from a profile read from disk in object form.
 */
export type RawLine = RawExperimentLine | RawThroughputPointLine | RawLatencyPointLine | RawCausalProfileLine;

/**
 * A line from the raw profile beginning with 'experiment' in object form.
 *
 * Example:
 *
 * ```
 * experiment      selected=parsec-2.1/pkgs/apps/fluidanimate/obj/amd64-linux.gcc/pthreads.cpp:849 speedup=0.55    duration=100088537      selected-samples=0
 * ```
 */
export interface RawExperimentLine {
  type: 'experiment';
  selected: string;
  speedup: number;
  duration: number;
  raw_duration?: number;
  samples?: number;
}

/**
 * A line from the raw profile beginning with 'throughput-point' or 'progress-point' in object form.
 *
 * Example:
 *
 * ```
 * progress-point  name=pthreads.cpp:784   type=source     delta=128
 * ```
 *
 * (Note: We ignore the 'type' field when parsing.)
 */
export interface RawThroughputPointLine {
  type: 'throughput-point' | 'progress-point';
  name: string;
  delta: number;
}

/**
 * A line from the raw profile beginning with 'latency-point' in object form.
 *
 * Example:
 *
 * ```
 * latency-point  name=pthreads.cpp:784   arrivals=4  departures=3  difference=2
 * ```
 */
export interface RawLatencyPointLine {
  type: 'latency-point';
  name: string;
  arrivals: number;
  departures: number;
  difference: number;
}

/**
 * causal_profile  profiler_script_id=54   sampling_rate=0.25      effective_sampling_rate=945769
 */
export interface RawCausalProfileLine {
  type: 'causal_profile';
  effective_sampling_rate: number;
}

/**
 * A message from the web worker.
 */
export type MessageFromWorker = ProgressMessage | DataMessage | ErrorMessage;

/**
 * A message sent to the web worker.
 */
export type MessageToWorker = FilesMessage;

/**
 * Indicates processing progress.
 */
export interface ProgressMessage {
  type: 'progress';
  // Percentage complete [0, 100].
  percent: number;
  // Friendly message to display in UI.
  msg: string;
}

/**
 * Data from a completely processed profile.
 */
export interface DataMessage {
  type: 'data';
  data: ProfileData;
}

/**
 * An error message.
 */
export interface ErrorMessage {
  type: 'error';
  msg: string;
  stack: string;
}

/**
 * Send profile files to the worker for processing.
 */
export interface FilesMessage {
  type: 'files';
  files: (File | Blob)[];
}
