import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunListItem, RunRecord } from '@interop/shared';

/**
 * Persistence for completed runs.
 *
 * Written to plain JSON files rather than a database: the history exists to be
 * diffed across Inji releases and attached to bug reports, and a directory of
 * readable files serves that better than a schema nobody else can open.
 */
export class RunStore {
  private readonly cache = new Map<string, RunRecord>();

  constructor(
    private readonly directory = resolve(process.cwd(), 'runs'),
    /**
     * Committed runs shown alongside the local history but never written to:
     * imported captures of flows the playground cannot drive itself, such as
     * Inji Web to Inji Verify on the Collab sandbox.
     */
    private readonly evidenceDirectory?: string,
  ) {}

  async load(): Promise<void> {
    if (this.evidenceDirectory) await this.loadFrom(this.evidenceDirectory);
    await this.loadFrom(this.directory);
  }

  private async loadFrom(directory: string): Promise<void> {
    try {
      const files = await readdir(directory);
      for (const file of files.filter((f) => f.endsWith('.json'))) {
        try {
          const record = JSON.parse(await readFile(resolve(directory, file), 'utf8')) as RunRecord;
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

  /**
   * The history without its payloads.
   *
   * Everything the listing, dashboard and comparison view display comes from
   * the checks and configuration; the exchanges and artifacts are the bulk and
   * are only wanted when someone opens a single run.
   */
  listSummaries(): RunListItem[] {
    return this.list().map(({ exchanges, artifacts, ...rest }) => ({
      ...rest,
      exchangeCount: exchanges.length,
      artifactCount: artifacts.length,
    }));
  }
}
