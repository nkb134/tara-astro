/**
 * Circuit Breaker — stops hammering dead APIs.
 *
 * States: CLOSED (normal) → OPEN (failing, reject all) → HALF_OPEN (test one request)
 *
 * Pattern from Ruflo: after N consecutive failures within a window,
 * open the circuit and return fallback for cooldown period.
 * Then allow one test request — if it succeeds, close circuit.
 */
import { logger } from './logger.js';

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownMs = options.cooldownMs || 60000;
    this.windowMs = options.windowMs || 120000;

    this.state = 'CLOSED';
    this.failures = [];
    this.lastFailure = 0;
    this.openedAt = 0;
  }

  async exec(fn, fallback) {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.cooldownMs) {
        logger.warn({ breaker: this.name, cooldownRemaining: this.cooldownMs - elapsed }, 'Circuit OPEN — using fallback');
        return fallback();
      }
      this.state = 'HALF_OPEN';
      logger.info({ breaker: this.name }, 'Circuit HALF_OPEN — testing one request');
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        logger.info({ breaker: this.name }, 'Circuit CLOSED — test request succeeded');
      }
      this.state = 'CLOSED';
      this.failures = [];
      return result;
    } catch (err) {
      this._recordFailure();

      if (this.state === 'HALF_OPEN') {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        logger.warn({ breaker: this.name, err: err.message }, 'Circuit reopened from HALF_OPEN');
        return fallback();
      }

      const recentFailures = this.failures.filter(t => Date.now() - t < this.windowMs);
      this.failures = recentFailures;

      if (recentFailures.length >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        logger.error({ breaker: this.name, failures: recentFailures.length }, 'Circuit OPENED — threshold breached');
        return fallback();
      }

      throw err;
    }
  }

  _recordFailure() {
    this.failures.push(Date.now());
    this.lastFailure = Date.now();
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      recentFailures: this.failures.filter(t => Date.now() - t < this.windowMs).length,
      threshold: this.failureThreshold,
    };
  }
}

export const geminiBreaker = new CircuitBreaker('gemini', {
  failureThreshold: 5,
  cooldownMs: 60000,
  windowMs: 120000,
});

export const geocodeBreaker = new CircuitBreaker('geocode', {
  failureThreshold: 3,
  cooldownMs: 30000,
  windowMs: 60000,
});

export const vedastroBreaker = new CircuitBreaker('vedastro', {
  failureThreshold: 3,
  cooldownMs: 45000,
  windowMs: 90000,
});

export function getAllBreakerStates() {
  return [geminiBreaker, geocodeBreaker, vedastroBreaker].map(b => b.getState());
}
