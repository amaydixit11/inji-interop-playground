import type { ParticipantVersion, Role } from '@interop/shared';
import type { RunContext } from './context.js';
import type { VersionAware } from '../adapters/types.js';
import type { Participant } from '@interop/shared';

/** Kept in step with the root package manifest. */
const PLAYGROUND_VERSION = '0.1.0';

/**
 * Establishes which build of each participant a run exercised.
 *
 * Three sources, in order of trustworthiness: what the service reports about
 * itself, what the operator labelled it, and nothing. The order matters and so
 * does recording which one applied — a run history exists to tell you whether a
 * result changed because the software changed, and a version that was guessed
 * is worse than no version at all if it is not marked as a guess.
 */
export async function resolveVersions(
  ctx: RunContext,
  participants: Array<{ role: Role; adapter: VersionAware & { manifest: Participant } }>,
): Promise<ParticipantVersion[]> {
  const resolved: ParticipantVersion[] = [];

  for (const { role, adapter } of participants) {
    const id = adapter.manifest.id;
    const declared = ctx.config.overrides?.[id]?.version?.trim();

    let discovered: { value?: string; detail: string } | undefined;
    if (adapter.discoverVersion) {
      try {
        discovered = await adapter.discoverVersion(ctx);
      } catch (error) {
        discovered = { detail: error instanceof Error ? error.message : String(error) };
      }
    }

    if (discovered?.value) {
      resolved.push({ role, participantId: id, source: 'discovered', value: discovered.value, detail: discovered.detail });
      continue;
    }
    if (declared) {
      resolved.push({
        role,
        participantId: id,
        source: 'declared',
        value: declared,
        detail: 'Supplied by the operator; not reported by the service itself.',
      });
      continue;
    }
    resolved.push({
      role,
      participantId: id,
      source: 'unknown',
      detail: discovered?.detail ?? 'This participant exposes no version endpoint.',
    });
  }

  reportVersions(ctx, resolved);
  return resolved;
}

/**
 * Records whether the run can be attributed to a build.
 *
 * A warning rather than a failure: an undiscoverable version does not make a
 * result wrong, it makes the result untraceable — which only matters once you
 * are comparing across releases, and is exactly the point at which nobody can
 * reconstruct it.
 */
function reportVersions(ctx: RunContext, versions: ParticipantVersion[]): void {
  const relevant = versions.filter((version) => version.role !== 'wallet');
  const unknown = relevant.filter((version) => version.source === 'unknown');

  ctx.check({
    id: 'run.version-attribution',
    title: 'This run can be attributed to specific participant builds',
    status: unknown.length === 0 ? 'pass' : 'warn',
    spec: 'Playground provenance',
    detail:
      unknown.length === 0
        ? relevant.map((v) => `${v.participantId}: ${v.value} (${v.source})`).join(' · ')
        : `No version available for ${unknown
            .map((v) => v.participantId)
            .join(', ')}. ${unknown[0]?.detail ?? ''} Without it a result cannot be tied to a release, so a regression cannot be attributed to a change. Set a "version" override on the participant to label the run by hand.`,
  });

  ctx.artifact({ label: 'Participant versions', kind: 'json', value: versions });
}

/**
 * The playground's own version, for the participants it hosts itself.
 *
 * Those three are part of this repository, so "unknown" would be a worse answer
 * than the truth: a change to the reference implementations is exactly the kind
 * of thing a regression comparison needs to be able to attribute.
 */
export function playgroundVersion(): { value: string; detail: string } {
  return {
    value: PLAYGROUND_VERSION,
    detail: 'Hosted by the playground; version taken from its own package manifest.',
  };
}

/**
 * Reads a Spring Boot Actuator `info` document.
 *
 * Shared because every Java service in this stack either exposes one or looks
 * like it should, and the shapes vary: some report a build version, some only a
 * git commit, and at least one returns an error envelope under HTTP 200.
 */
export async function discoverFromActuator(
  ctx: RunContext,
  url: string,
  label: string,
): Promise<{ value?: string; detail: string }> {
  const response = await ctx.http<{
    build?: { version?: string; name?: string; time?: string };
    git?: { commit?: { id?: string } };
    errors?: Array<{ errorCode?: string }>;
  }>({
    label: `Discover ${label} Version`,
    from: 'Playground',
    to: label,
    url,
    allowNonOk: true,
  });

  if (!response.ok) return { detail: `${url} returned HTTP ${response.status}.` };

  // An error envelope under 200 is not a version document, however it looks.
  if (Array.isArray(response.body?.errors) && response.body.errors.length > 0) {
    return {
      detail: `${url} returned HTTP 200 carrying an error envelope (${response.body.errors[0]?.errorCode ?? 'unknown'}) rather than build information.`,
    };
  }

  const build = response.body?.build;
  const commit = response.body?.git?.commit?.id;
  const value = build?.version ?? (commit ? `commit ${commit}` : undefined);

  return {
    value,
    detail: value
      ? `Reported by ${url}${build?.time ? `, built ${build.time}` : ''}.`
      : `${url} responded but carried neither a build version nor a git commit.`,
  };
}
