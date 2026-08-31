import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunRecord } from '@interop/shared';

/**
 * Persistence for completed runs.
 *
 * Written to plain JSON files rather than a database: the history exists to be
 * diffed across Inji releases and attached to bug reports, and a directory of
 * readable files serves that better than a schema nobody else can open.
 */
export class RunStore {
  private readonly cache = new Map<string, RunRecord>();

  constructor(private readonly directory = resolve(process.cwd(), 'runs')) {}

  async load(): Promise<void> {
    try {
      const files = await readdir(this.directory);
      for (const file of files.filter((f) => f.endsWith('.json'))) {
        try {
          const record = JSON.parse(await readFile(resolve(this.directory, file), 'utf8')) as RunRecord;
          this.cache.set(record.id, record);
        } catch {
          // A truncated file from an interrupted write should not stop startup.
        }
      }
    } catch {
      // No history yet.
    }
  }

  async save(record: RunRecord): Promise<void> {
    this.cache.set(record.id, record);
    await mkdir(this.directory, { recursive: true });
    await writeFile(resolve(this.directory, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
  }

  get(id: string): RunRecord | undefined {
    return this.cache.get(id);
  }

  list(): RunRecord[] {
    return [...this.cache.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
