(function () {
'use strict';

importScripts('/lib/pako/pako_inflate.min.js');
var SAMPLES = 512;
/**
 * Resample of data.length data points from data with replacement.
 */
function resample(data) {
    var len = data.length;
    var sample = new Array(len);
    for (var i = 0; i < len; i++) {
        sample[i] = data[(Math.random() * len) | 0];
    }
    return sample;
}
/**
 * Draw m samples from the distribution formed by applying f to data1 and data2 resampled with replacement.
 */
function getSampleDistribution(m, data1, data2, f) {
    var rv = new Array(m);
    for (var i = 0; i < m; i++) {
        rv[i] = f(resample(data1), resample(data2));
    }
    return rv;
}
function calculateThroughput(data) {
    var duration = 0;
    var delta = 0;
    var len = data.length;
    for (var i = 0; i < len; i++) {
        var p = data[i];
        duration += p.duration;
        delta += p.delta;
    }
    return duration / delta;
}
function calculateLatency(data) {
    var arrivals = 0;
    var departures = 0;
    var duration = 0;
    var difference = 0;
    var len = data.length;
    for (var i = 0; i < len; i++) {
        var p = data[i];
        arrivals += p.arrivals;
        departures += p.departures;
        if (duration === 0) {
            difference = p.difference;
        }
        else {
            // Compute the new total duration of all experiments combined (including the new one)
            var total_duration = p.duration + duration;
            // Scale the difference down by the ratio of the prior and total durations. This scale factor will be closer to 1 than 0, so divide first for better numerical stability
            difference *= duration / total_duration;
            // Add the contribution to average difference from the current experiment. The scale factor will be close to zero, so multiply first for better numerical stability.
            difference += (p.difference * duration) / total_duration;
        }
        // Update the total duration
        duration += p.duration;
    }
    var arrivalRate = arrivals / duration;
    // Average latency, according to Little's Law.
    return difference / arrivalRate;
}
function getSpeedupValue(baseline, comparison) {
    return (baseline - comparison) / baseline;
}
function calculateThroughputSpeedup(baseline, comparison) {
    return getSpeedupValue(calculateThroughput(baseline), calculateThroughput(comparison));
}
function calculateLatencySpeedup(baseline, comparison) {
    return getSpeedupValue(calculateLatency(baseline), calculateLatency(comparison));
}
function sorter(a, b) {
    return a - b;
}
function calculateSpeedupInternal(baseline, comparison, calculateSpeedup) {
    var rawSpeedup = calculateSpeedup(baseline, comparison);
    if (baseline.length === 1 && comparison.length === 1) {
        return {
            value: rawSpeedup,
            conf_left: rawSpeedup,
            conf_right: rawSpeedup
        };
    }
    var sampleDist = getSampleDistribution(SAMPLES, baseline, comparison, calculateSpeedup)
        .sort(sorter);
    // Calculate 95% confidence interval.
    var left = sampleDist[(0.025 * SAMPLES) | 0];
    var right = sampleDist[(0.97 * SAMPLES) | 0];
    return {
        value: rawSpeedup,
        conf_left: left,
        conf_right: right
    };
}
function calculateSpeedup(type, baseline, comparison) {
    switch (type) {
        case 'throughput':
            return calculateSpeedupInternal(baseline, comparison, calculateThroughputSpeedup);
        case 'latency':
            return calculateSpeedupInternal(baseline, comparison, calculateLatencySpeedup);
    }
}
function parseLine(s) {
    var parts = s.split('\t');
    var obj = { type: parts[0] };
    for (var i = 0; i < parts.length; i++) {
        var equals_index = parts[i].indexOf('=');
        if (equals_index === -1)
            { continue; }
        var key = parts[i].substring(0, equals_index);
        var value = parts[i].substring(equals_index + 1);
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
    return obj;
}
function getInitialThroughputData() {
    return {
        type: 'throughput',
        speedup: null,
        points: new Array()
    };
}
function getDataForExperiment(data, location, progressPoint, speedup, getInitialData) {
    var locData = data[location];
    if (!locData) {
        data[location] = locData = {};
    }
    var pointData = locData[progressPoint];
    if (!pointData) {
        locData[progressPoint] = pointData = {};
    }
    var speedupData = pointData[speedup];
    if (!speedupData) {
        pointData[speedup] = speedupData = getInitialData();
    }
    return speedupData;
}
var LINES_PER_UPDATE = 1000;
function parseFile(fileNum, totalFiles, f, profileData, startPercent, endPercent) {
    // Note: f may be very large. We avoid calling split() on it.
    var len = f.length;
    var lineStart = 0;
    var experiment = null;
    var counter = 0;
    var lastUpdate = performance.now();
    var valuePerChar = len / (endPercent - startPercent);
    // Note: Iterate to <= len; special case when i === len.
    for (var i = 0; i <= len; i++) {
        if (i === len || f[i] === '\n') {
            var line = parseLine(f.slice(lineStart, i));
            if (line && line.type) {
                switch (line.type) {
                    case 'experiment':
                        experiment = line;
                        break;
                    case 'throughput-point':
                    case 'progress-point': {
                        // Ignore data points of 0.
                        if (line.delta > 0) {
                            var d = getDataForExperiment(profileData, experiment.selected, line.name, experiment.speedup, getInitialThroughputData);
                            d.points.push({
                                delta: line.delta,
                                duration: experiment.duration
                            });
                        }
                        break;
                    }
                    case 'latency-point':
                        if ((line.arrivals + line.departures + line.difference) > 0) {
                            var d = getDataForExperiment(profileData, experiment.selected, line.name, experiment.speedup, getInitialThroughputData);
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
                var now = performance.now();
                if (now - lastUpdate > 10) {
                    lastUpdate = now;
                    sendProgressMessage(startPercent + (valuePerChar * i), "Profile " + fileNum + "/" + totalFiles + ", processed byte " + i + "/" + len + "...");
                }
            }
        }
    }
}
function parseProfile(profiles) {
    var numProfiles = profiles.length;
    var profileData = {};
    var reader = new FileReaderSync();
    var profileValue = 70 / numProfiles;
    var profile = profiles[0];
    var isCompressed = false;
    if (profile instanceof File) {
        isCompressed = profile.name.endsWith(".gz");
    }
    var profileString;
    if (isCompressed) {
        profileString = reader.readAsText(new Blob([pako.inflate(new Uint8Array(reader.readAsArrayBuffer(profiles[0]))).buffer]), "UTF-8");
    }
    else {
        profileString = reader.readAsText(profiles[0], "UTF-8");
    }
    for (var i = 0; i < numProfiles; i++) {
        parseFile(i + 1, numProfiles, profileString, profileData, profileValue * i, profileValue * (i + 1));
    }
    var locations = Object.keys(profileData);
    var numLocations = locations.length;
    var speedupsCalculated = 0;
    var lastUpdate = performance.now();
    var locationValue = 30 / numLocations;
    // Code region
    for (var i = 0; i < numLocations; i++) {
        var location_1 = locations[i];
        var locationData = profileData[location_1];
        var progressPoints = Object.keys(locationData);
        // Progress Point
        for (var _i = 0, progressPoints_1 = progressPoints; _i < progressPoints_1.length; _i++) {
            var progressPoint = progressPoints_1[_i];
            var ppData = locationData[progressPoint];
            var baseline = ppData[0];
            // Ignore data that lacks a baseline.
            if (baseline) {
                var type = baseline.type;
                // Compare baseline with itself to form confidence bounds.
                baseline.speedup = calculateSpeedup(type, baseline.points, baseline.points);
                var speedups = Object.keys(ppData).map(function (k) { return parseFloat(k); });
                // speedups
                for (var _a = 0, speedups_1 = speedups; _a < speedups_1.length; _a++) {
                    var speedup = speedups_1[_a];
                    if (speedup !== 0) {
                        var speedupData = ppData[speedup];
                        speedupData.speedup = calculateSpeedup(type, baseline.points, speedupData.points);
                        speedupsCalculated++;
                    }
                }
            }
        }
        var now = performance.now();
        // Send updates every 5 ms.
        if ((now - lastUpdate) > 5) {
            sendProgressMessage(70 + (locationValue * (i + 1)), "Calculating speedups for " + location_1 + " (" + (i + 1) + "/" + numLocations + ")...");
            lastUpdate = now;
        }
    }
    return profileData;
}
/**
 * Listen for commands from UI.
 */
self.addEventListener('message', function (e) {
    var data = e.data;
    switch (data.type) {
        case 'files':
            console.profile('ParseProfile');
            try {
                var profileData = parseProfile(data.files);
                sendMessage({
                    type: 'data',
                    data: profileData
                });
            }
            catch (e) {
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
function sendMessage(msg) {
    self.postMessage(msg);
}
function sendProgressMessage(percent, msg) {
    //console.log(`[${percent}%]: ${msg}`);
    sendMessage({
        type: 'progress',
        percent: percent,
        msg: msg
    });
}

}());
//# sourceMappingURL=worker.js.map
