export type CommandLane = 'scan' | 'run' | 'inject' | 'background';

interface QueuedCommand<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const queues = new Map<CommandLane, QueuedCommand<unknown>[]>();
const active = new Map<CommandLane, boolean>();

export function enqueueCommand<T>(lane: CommandLane, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const queue = queues.get(lane) ?? [];
    queue.push({ fn: fn as () => Promise<unknown>, resolve: resolve as (value: unknown) => void, reject });
    queues.set(lane, queue);
    void processLane(lane);
  });
}

export function getLaneStats(): Record<CommandLane, { queued: number; active: boolean }> {
  const lanes: CommandLane[] = ['scan', 'run', 'inject', 'background'];
  return Object.fromEntries(lanes.map((lane) => [
    lane,
    { queued: queues.get(lane)?.length ?? 0, active: active.get(lane) ?? false },
  ])) as Record<CommandLane, { queued: number; active: boolean }>;
}

async function processLane(lane: CommandLane): Promise<void> {
  if (active.get(lane)) return;
  active.set(lane, true);
  const queue = queues.get(lane);
  while (queue?.length) {
    const item = queue.shift();
    if (!item) continue;
    try {
      item.resolve(await item.fn());
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  active.set(lane, false);
}
