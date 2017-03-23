import {ProfileData, LatencyData, LatencyPoint, ThroughputData, ThroughputPoint, Speedup,
        RawExperimentLine, RawLatencyPointLine, RawLine, RawThroughputPointLine, MessageFromWorker,
        ProgressMessage, MessageToWorker, FilesMessage} from '../shared/interfaces';
import * as TPako from 'pako';
declare var pako: typeof TPako;
importScripts('/lib/pako/pako_inflate.min.js');

const SAMPLES = 512;

/**
 * Resample of data.length data points from data with replacement.
 */
function resample<T>(data: T[]): T[] {
  const len = data.length;
  const sample = new Array<T>(len);
  for (let i = 0; i < len; i++) {
    sample[i] = data[(Math.random() * len) | 0];
  }
  return sample;
}

/**
 * Draw m samples from the distribution formed by applying f to data1 and data2 resampled with replacement.
 */
function getSampleDistribution<T, U, V>(m: number, data1: T[], data2: U[], f: (data1: T[], data2: U[]) => V): V[] {
  const rv = new Array<V>(m);
  for (let i = 0; i < m; i++) {
    rv[i] = f(resample(data1), resample(data2));
  }
  return rv;
}

function calculateThroughput(data: ThroughputPoint[]): number {
  let duration = 0;
  let delta = 0;
  const len = data.length;
  for (let i = 0; i < len; i++) {
    const p = data[i];
    duration += p.duration;
    delta += p.delta;
  }
  return duration / delta;
}

function calculateLatency(data: LatencyPoint[]): number {
  let arrivals = 0;
  let departures = 0;
  let duration = 0;
  let difference = 0;
  const len = data.length;
  for (let i = 0; i < len; i++) {
    const p = data[i];
    arrivals += p.arrivals;
    departures += p.departures;
    if (duration === 0) {
      difference = p.difference;
    } else {
      // Compute the new total duration of all experiments combined (including the new one)
      const total_duration = p.duration + duration;
      // Scale the difference down by the ratio of the prior and total durations. This scale factor will be closer to 1 than 0, so divide first for better numerical stability
      difference *= duration / total_duration;
      // Add the contribution to average difference from the current experiment. The scale factor will be close to zero, so multiply first for better numerical stability.
      difference += (p.difference * duration) / total_duration;
    }
    // Update the total duration
    duration += p.duration;
  }
  const arrivalRate = arrivals / duration;
  // Average latency, according to Little's Law.
  return difference / arrivalRate;
}

function getSpeedupValue(baseline: number, comparison: number): number {
  return (baseline - comparison) / baseline;
}

function calculateThroughputSpeedup(baseline: ThroughputPoint[], comparison: ThroughputPoint[]): number {
  return getSpeedupValue(calculateThroughput(baseline), calculateThroughput(comparison));
}

function calculateLatencySpeedup(baseline: LatencyPoint[], comparison: LatencyPoint[]): number {
  return getSpeedupValue(calculateLatency(baseline), calculateLatency(comparison));
}

function sorter(a: number, b: number): number {
  return a - b;
}

function calculateSpeedupInternal<T>(baseline: T[], comparison: T[], calculateSpeedup: (baseline: T[], comparison: T[]) => number): Speedup {
  const rawSpeedup = calculateSpeedup(baseline, comparison);
  if (baseline.length === 1 && comparison.length === 1) {
    return {
      value: rawSpeedup,
      conf_left: rawSpeedup,
      conf_right: rawSpeedup
    };
  }
  const sampleDist = getSampleDistribution(SAMPLES, baseline, comparison, calculateSpeedup)
                      .sort(sorter);
  // Calculate 95% confidence interval.
  const left = sampleDist[(0.025 * SAMPLES) | 0];
  const right = sampleDist[(0.97 * SAMPLES) | 0];
  return {
    value: rawSpeedup,
    conf_left: left,
    conf_right: right
  };
}

function calculateSpeedup(type: 'latency' | 'throughput', baseline: ThroughputPoint[] | LatencyPoint[], comparison: ThroughputPoint[] | LatencyPoint[]): Speedup {
  switch (type) {
    case 'throughput':
      return calculateSpeedupInternal(baseline as ThroughputPoint[], comparison as ThroughputPoint[], calculateThroughputSpeedup);
    case 'latency':
      return calculateSpeedupInternal(baseline as LatencyPoint[], comparison as LatencyPoint[], calculateLatencySpeedup);
  }
}

function parseLine(s: string): RawLine {
  let parts = s.split('\t');
  let obj: {
    type: string;
    [key: string]: string | number
  } = { type: parts[0] };
  for (let i = 0; i < parts.length; i++) {
    const equals_index = parts[i].indexOf('=');
    if (equals_index === -1) continue;
    let key = parts[i].substring(0, equals_index);
    let value: string | number = parts[i].substring(equals_index + 1);

    switch (key) {
      case 'type':
        if (obj.type === 'progress-point') {
          key = 'point-type';
        }
        break;
      case 'delta':
      case 'time':
      case 'duration':
      case 'arrivals':
      case 'departures':
      case 'difference':
        value = parseInt(value, 10);
        break;
      case 'speedup':
        value = parseFloat(value);
        break;
    }

    obj[key] = value;
  }
  return <any> obj;
}

function getInitialLatencyData(): LatencyData {
  return {
    type: 'latency',
    speedup: null,
    points: new Array<LatencyPoint>()
  };
}

function getInitialThroughputData(): ThroughputData {
  return {
    type: 'throughput',
    speedup: null,
    points: new Array<ThroughputPoint>()
  };
}

function getDataForExperiment(data: ProfileData, location: string, progressPoint: string, speedup: number, getInitialData: () => LatencyData | ThroughputData): LatencyData | ThroughputData {
  let locData = data[location];
  if (!locData) {
    data[location] = locData = {};
  }
  let pointData = locData[progressPoint];
  if (!pointData) {
    locData[progressPoint] = pointData = {};
  }
  let speedupData = pointData[speedup];
  if (!speedupData) {
    pointData[speedup] = speedupData = getInitialData();
  }
  return speedupData;
}

const LINES_PER_UPDATE = 1000;
function parseFile(fileNum: number, totalFiles: number, f: string, profileData: ProfileData, startPercent: number, endPercent: number): void {
  // Note: f may be very large. We avoid calling split() on it.
  const len = f.length;
  let lineStart = 0;
  let experiment: RawExperimentLine = null;
  let counter = 0;
  let lastUpdate = performance.now();
  const valuePerChar = len / (endPercent - startPercent);
  // Note: Iterate to <= len; special case when i === len.
  for (let i = 0; i <= len; i++) {
    if (i === len || f[i] === '\n') {
      const line = parseLine(f.slice(lineStart, i));
      if (line && line.type) {
        switch (line.type) {
          case 'experiment':
            experiment = line;
            break;
          case 'throughput-point':
          case 'progress-point': {
            // Ignore data points of 0.
            if (line.delta > 0) {
              const d = getDataForExperiment(profileData, experiment.selected, line.name, experiment.speedup, getInitialThroughputData) as ThroughputData;
              d.points.push({
                delta: line.delta,
                duration: experiment.duration
              });
            }
            break;
          }
          case 'latency-point':
            if ((line.arrivals + line.departures + line.difference) > 0) {
              const d = getDataForExperiment(profileData, experiment.selected, line.name, experiment.speedup, getInitialThroughputData) as LatencyData;
              d.points.push({
                arrivals: line.arrivals,
                departures: line.departures,
                difference: line.difference,
                duration: experiment.duration
              });
            }
            break;
        }
      }
      lineStart = i + 1;
      counter--;
      if (counter <= 0) {
        counter = LINES_PER_UPDATE;
        const now = performance.now();
        if (now - lastUpdate > 10) {
          lastUpdate = now;
          sendProgressMessage(startPercent + (valuePerChar * i), `Profile ${fileNum}/${totalFiles}, processed byte ${i}/${len}...`);
        }
      }
    }
  }
}

function parseProfile(profiles: (File | Blob)[]): ProfileData {
  const numProfiles = profiles.length;
  const profileData: ProfileData = {};
  const reader = new FileReaderSync();
  const profileValue = 70 / numProfiles;
  const profile = profiles[0];
  let isCompressed = false;
  if (profile instanceof File) {
    isCompressed = profile.name.endsWith(".gz");
  }
  let profileString: string;
  if (isCompressed) {
    profileString = reader.readAsText(new Blob([pako.inflate(new Uint8Array(reader.readAsArrayBuffer(profiles[0]))).buffer]), "UTF-8");
  } else {
    profileString = reader.readAsText(profiles[0], "UTF-8");
  }

  for (let i = 0; i < numProfiles; i++) {
    parseFile(i + 1, numProfiles, profileString, profileData, profileValue * i, profileValue * (i + 1));
  }

  const locations = Object.keys(profileData);
  const numLocations = locations.length;
  let speedupsCalculated = 0;
  let lastUpdate = performance.now();
  const locationValue = 30 / numLocations;
  // Code region
  for (let i = 0; i < numLocations; i++) {
    const location = locations[i];
    const locationData = profileData[location];
    const progressPoints = Object.keys(locationData);
    // Progress Point
    for (const progressPoint of progressPoints) {
      const ppData = locationData[progressPoint];
      const baseline = ppData[0];
      // Ignore data that lacks a baseline.
      if (baseline) {
        const type = baseline.type;
        // Compare baseline with itself to form confidence bounds.
        baseline.speedup = calculateSpeedup(type, baseline.points, baseline.points);
        const speedups = Object.keys(ppData).map((k) => parseFloat(k));
        // speedups
        for (const speedup of speedups) {
          if (speedup !== 0) {
            const speedupData = ppData[speedup];
            speedupData.speedup = calculateSpeedup(type, baseline.points, speedupData.points);
            speedupsCalculated++;
          }
        }
      }
    }
    const now = performance.now();
    // Send updates every 5 ms.
    if ((now - lastUpdate) > 5) {
      sendProgressMessage(70 + (locationValue * (i + 1)), `Calculating speedups for ${location} (${i + 1}/${numLocations})...`);
      lastUpdate = now;
    }
  }
  return profileData;
}

/**
 * Listen for commands from UI.
 */
self.addEventListener('message', function(e) {
  const data: MessageToWorker = (<any> e).data;
  switch(data.type) {
    case 'files':
    console.profile('ParseProfile');
    try {
      const profileData = parseProfile(data.files);
      sendMessage({
        type: 'data',
        data: profileData
      });
    } catch (e) {
      sendMessage({
        type: 'error',
        msg: e.message,
        stack: e.stack
      });
    }
    console.profileEnd();
  }
}, false);

/**
 * Send a message to the UI.
 * (Note: We do not call postMessage directly for type checking purposes.)
 */
function sendMessage(msg: MessageFromWorker) {
  (<any> self).postMessage(msg);
}

function sendProgressMessage(percent: number, msg: string): void {
  //console.log(`[${percent}%]: ${msg}`);
  sendMessage({
    type: 'progress',
    percent: percent,
    msg: msg
  });
}
