function positiveInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorText(error) {
  return String(error?.message || error || "").toLowerCase();
}

export function parseServerDelayMs(value, now = Date.now) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now()) : 0;
}

export function concurrencyPressureSignal(error = null, result = null) {
  const status = Number(error?.status || result?.status || 0);
  const text = `${errorText(error)} ${errorText(result?.reason || result?.error)}`;
  const retryAfterMs = Math.max(0, Number(error?.retryAfterMs || result?.retryAfterMs || 0));
  const backoffMs = Math.max(0, Number(error?.backoffMs || result?.backoffMs || 0));
  const rateLimited = status === 429 || /rate.?limit|http[_ -]?429|\b429\b/.test(text);
  const timeout = /timeout|timed out|abort/.test(text);
  const transient = status >= 500 || /econnreset|econnrefused|network|fetch failed/.test(text);
  return {
    pressure: rateLimited || retryAfterMs > 0 || backoffMs > 0 || timeout || transient,
    immediate: rateLimited || retryAfterMs > 0 || backoffMs > 0,
    status,
    retryAfterMs,
    backoffMs,
    reason: rateLimited ? "rate_limit" : backoffMs > 0 ? "backoff" : retryAfterMs > 0 ? "retry_after" : timeout ? "timeout" : transient ? "transient_failure" : "",
  };
}

export class AdaptiveConcurrencyController {
  constructor({
    service,
    minConcurrency = 1,
    initialConcurrency = 1,
    maxConcurrency = initialConcurrency,
    successWindow = 8,
    failureWindow = 3,
    latencyMultiplier = 2.5,
    latencyWindow = 3,
    now = Date.now,
    setTimer = setTimeout,
  } = {}) {
    this.service = String(service || "unknown");
    this.minConcurrency = positiveInteger(minConcurrency, 1);
    this.maxConcurrency = Math.max(this.minConcurrency, positiveInteger(maxConcurrency, this.minConcurrency));
    this.currentConcurrency = Math.min(this.maxConcurrency, Math.max(this.minConcurrency, positiveInteger(initialConcurrency, this.minConcurrency)));
    this._initialConcurrency = this.currentConcurrency;
    this.successWindow = positiveInteger(successWindow, 8);
    this.failureWindow = positiveInteger(failureWindow, 3);
    this.latencyMultiplier = Math.max(1.1, Number(latencyMultiplier) || 2.5);
    this.latencyWindow = positiveInteger(latencyWindow, 3);
    this._now = now;
    this._setTimer = setTimer;
    this._queue = [];
    this._active = 0;
    this._peak = 0;
    this._blockedUntil = 0;
    this._wakeTimer = null;
    this._successStreak = 0;
    this._failureStreak = 0;
    this._slowStreak = 0;
    this._latencyEwma = 0;
    this._stats = { increases: 0, decreases: 0, pressureSignals: 0, retryAfterSignals: 0, backoffSignals: 0, failureSignals: 0, latencySignals: 0 };
  }

  blockFor(delayMs) {
    const duration = Math.max(0, Number(delayMs) || 0);
    if (!duration) return;
    this._blockedUntil = Math.max(this._blockedUntil, this._now() + duration);
    this._scheduleWake();
  }

  recordSuccess(durationMs = 0) {
    const duration = Math.max(0, Number(durationMs) || 0);
    this._failureStreak = 0;
    const latencyDegraded = duration > 0 && this._latencyEwma > 0 && duration > this._latencyEwma * this.latencyMultiplier;
    if (latencyDegraded) {
      this._slowStreak += 1;
      if (this._slowStreak >= this.latencyWindow) {
        this._stats.latencySignals += 1;
        this._decrease("latency");
      }
    } else {
      this._slowStreak = 0;
    }
    if (duration > 0 && !latencyDegraded) this._latencyEwma = this._latencyEwma > 0 ? (this._latencyEwma * 0.8) + (duration * 0.2) : duration;
    this._successStreak += 1;
    if (this._successStreak >= this.successWindow && this.currentConcurrency < this.maxConcurrency) {
      this.currentConcurrency += 1;
      this._stats.increases += 1;
      this._successStreak = 0;
      this._drain();
    }
  }

  recordFailure(error = null, result = null) {
    const signal = concurrencyPressureSignal(error, result);
    const serverDelay = Math.max(signal.retryAfterMs, signal.backoffMs);
    if (serverDelay > 0) this.blockFor(serverDelay);
    if (signal.retryAfterMs > 0) this._stats.retryAfterSignals += 1;
    if (signal.backoffMs > 0) this._stats.backoffSignals += 1;
    const countableFailure = signal.pressure || result?.ok === false || (Boolean(error) && (signal.status === 0 || signal.status >= 500));
    if (!countableFailure) return signal;
    if (signal.pressure) this._stats.pressureSignals += 1;
    this._stats.failureSignals += 1;
    this._failureStreak += 1;
    this._successStreak = 0;
    if (signal.immediate || this._failureStreak >= this.failureWindow) this._decrease(signal.reason || "failure_rate");
    return signal;
  }

  recordServerDirective({ retryAfterMs = 0, backoffMs = 0 } = {}) {
    const signal = { status: 0, retryAfterMs, backoffMs, reason: backoffMs > 0 ? "backoff" : "retry_after" };
    return this.recordFailure(null, signal);
  }

  run(task, { observe = true, classifyResult = null } = {}) {
    return new Promise((resolve, reject) => {
      this._queue.push({ task, observe, classifyResult, resolve, reject });
      this._drain();
    });
  }

  map(items, mapper, options = {}) {
    const source = Array.isArray(items) ? items : [];
    if (!source.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const results = new Array(source.length);
      let remaining = source.length;
      let rejected = false;
      source.forEach((item, index) => {
        this.run(() => mapper(item, index), options).then((value) => {
          results[index] = value;
          remaining -= 1;
          if (!remaining && !rejected) resolve(results);
        }, (error) => {
          if (!rejected) {
            rejected = true;
            reject(error);
          }
        });
      });
    });
  }

  snapshot() {
    return {
      service: this.service,
      min_concurrency: this.minConcurrency,
      initial_concurrency: this._initialConcurrency,
      current_concurrency: this.currentConcurrency,
      max_concurrency: this.maxConcurrency,
      active: this._active,
      pending: this._queue.length,
      peak_concurrency: this._peak,
      server_blocked: this._blockedUntil > this._now(),
      ...this._stats,
    };
  }

  _decrease() {
    const next = Math.max(this.minConcurrency, Math.floor(this.currentConcurrency / 2));
    if (next < this.currentConcurrency) {
      this.currentConcurrency = next;
      this._stats.decreases += 1;
    }
    this._successStreak = 0;
    this._failureStreak = 0;
    this._slowStreak = 0;
  }

  _scheduleWake() {
    if (this._wakeTimer || this._blockedUntil <= this._now()) return;
    this._wakeTimer = this._setTimer(() => {
      this._wakeTimer = null;
      this._drain();
    }, Math.max(0, this._blockedUntil - this._now()));
  }

  _drain() {
    if (this._blockedUntil > this._now()) {
      this._scheduleWake();
      return;
    }
    while (this._active < this.currentConcurrency && this._queue.length) {
      const entry = this._queue.shift();
      this._active += 1;
      this._peak = Math.max(this._peak, this._active);
      const startedAt = this._now();
      Promise.resolve().then(entry.task).then((value) => {
        if (entry.observe) {
          const classified = typeof entry.classifyResult === "function" ? entry.classifyResult(value) : null;
          if (classified?.ok === false || classified?.pressure) this.recordFailure(null, classified);
          else this.recordSuccess(this._now() - startedAt);
        }
        entry.resolve(value);
      }, (error) => {
        if (entry.observe) this.recordFailure(error);
        entry.reject(error);
      }).finally(() => {
        this._active -= 1;
        this._drain();
      });
    }
  }
}

export function createServiceConcurrencyController(service, options = {}) {
  return new AdaptiveConcurrencyController({ service, ...options });
}
