const counters = {
  status_posted: 0,
  status_failed: 0,
  pipeline_error_posted: 0,
  pipeline_error_failed: 0
};

/**
 * @param {keyof typeof counters} name
 */
export function incrementTelemetryCounter(name) {
  if (Object.prototype.hasOwnProperty.call(counters, name)) {
    counters[name] += 1;
  }
}

/**
 * @returns {{ status_posted: number, status_failed: number, pipeline_error_posted: number, pipeline_error_failed: number }}
 */
export function getTelemetryMetrics() {
  return { ...counters };
}

export function _resetTelemetryMetricsForTests() {
  counters.status_posted = 0;
  counters.status_failed = 0;
  counters.pipeline_error_posted = 0;
  counters.pipeline_error_failed = 0;
}
