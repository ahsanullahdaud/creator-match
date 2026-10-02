/** Counting semaphore: at most `limit` tasks run at once, waiters are served in order. */
export class Semaphore {
  readonly limit: number;
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(
        `Semaphore limit must be a positive integer, got ${limit}`,
      );
    }
    this.limit = limit;
  }

  get inFlight(): number {
    return this.active;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /** Resolves with a release function once a slot is free. Releasing twice is a no-op. */
  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active -= 1;
          const next = this.waiters.shift();
          if (next) next();
        });
      };
      if (this.active < this.limit) grant();
      else this.waiters.push(grant);
    });
  }

  /** Runs `task` inside a slot and always releases it, even when the task throws. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }
}
