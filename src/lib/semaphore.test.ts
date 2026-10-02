import { describe, expect, it } from "vitest";
import { Semaphore } from "@/lib/semaphore";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Semaphore", () => {
  it("rejects a non-positive or non-integer limit", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(2.5)).toThrow(RangeError);
  });

  it("never runs more than `limit` tasks at once", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      sem.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(5);
        active -= 1;
        return "ok";
      });
    const results = await Promise.all(Array.from({ length: 7 }, task));
    expect(results).toHaveLength(7);
    expect(peak).toBe(2);
    expect(sem.inFlight).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it("releases the slot when a task throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(sem.inFlight).toBe(0);
    await expect(sem.run(async () => 1)).resolves.toBe(1);
  });

  it("grants waiting tasks in FIFO order", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const first = sem.run(async () => {
      await tick(5);
      order.push(1);
    });
    const second = sem.run(async () => {
      order.push(2);
    });
    const third = sem.run(async () => {
      order.push(3);
    });
    expect(sem.waiting).toBe(2);
    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("ignores a double release", async () => {
    const sem = new Semaphore(1);
    const release = await sem.acquire();
    release();
    release();
    expect(sem.inFlight).toBe(0);
  });
});
