import type { Participant, RunNarrative, RunStatus } from '@interop/shared';
import { CREDENTIAL_FORMAT_PLAIN, type CredentialFormat } from '@interop/shared';
import { Panel } from './primitives.js';

/**
 * What happened, for somebody who does not work on identity protocols.
 *
 * Deliberately not a simplified developer view — a different set of facts. Not
 * which clause was satisfied, but: what was handed over, what was held back,
 * and could the recipient tell it was genuine. Those are the questions a person
 * asked to trust a digital ID actually has, and none of them is answered by a
 * page of JSON.
 */
export function Story({
  narrative,
  participants,
  format,
  status,
}: {
  narrative: RunNarrative;
  participants: { issuer: Participant; wallet: Participant; verifier: Participant };
  format: CredentialFormat;
  status: RunStatus;
}) {
  const withheld = narrative.withheldClaims.length;
  const disclosed = Object.entries(narrative.disclosedClaims);

  return (
    <div className="space-y-3">
      <Panel title="What happened" subtitle="In plain terms">
        <ol className="divide-y divide-line/60">
          <Beat
            index={1}
            title={`${participants.issuer.label} issued a digital credential`}
            body={
              <>
                It is {CREDENTIAL_FORMAT_PLAIN[format]}, signed so anyone can later check it genuinely came
                from {participants.issuer.label} and has not been altered since.
                {Object.keys(narrative.issuedClaims).length > 0 && (
                  <> It contains {Object.keys(narrative.issuedClaims).length} pieces of information.</>
                )}
              </>
            }
            detail={<ClaimList claims={narrative.issuedClaims} tone="neutral" />}
          />

          <Beat
            index={2}
            title={`${participants.wallet.label} stored it`}
            body={
              narrative.holderBound ? (
                <>
                  The credential is locked to a key only this wallet holds. Someone who copied the credential
                  could not use it, because they could not prove they hold that key.
                </>
              ) : (
                <>
                  The credential was <span className="text-warn">not locked to this wallet’s key</span>, so anyone
                  who obtained a copy could present it as their own.
                </>
              )
            }
          />

          <Beat
            index={3}
            title={`${participants.verifier.label} asked to see something`}
            body={
              narrative.requestedClaims.length > 0 ? (
                <>
                  It asked for {narrative.requestedClaims.length === 1 ? 'one thing' : `${narrative.requestedClaims.length} things`}
                  {': '}
                  <span className="text-ink">{narrative.requestedClaims.join(', ')}</span>. It did not ask for
                  anything else the credential contains.
                </>
              ) : (
                <>
                  It asked for the credential without naming particular details, so the wallet had nothing to
                  narrow the response down to.
                </>
              )
            }
          />

          <Beat
            index={4}
            title={withheld > 0 ? `The wallet shared only part of it` : 'The wallet shared the credential'}
            body={
              withheld > 0 ? (
                <>
                  {disclosed.length} shared, <span className="text-pass">{withheld} held back</span>. The verifier
                  can still tell the hidden details were not tampered with — without learning what they are.
                </>
              ) : (
                <>
                  Everything in the credential was shared. Nothing was held back
                  {narrative.requestedClaims.length === 0
                    ? ', because the request did not narrow it down.'
                    : '.'}
                </>
              )
            }
            detail={
              <div className="space-y-2">
                <ClaimList claims={narrative.disclosedClaims} tone="shared" />
                {withheld > 0 && (
                  <div>
                    <div className="mb-1 text-2xs uppercase tracking-wider text-muted">Held back</div>
                    <div className="flex flex-wrap gap-1">
                      {narrative.withheldClaims.map((name) => (
                        <span
                          key={name}
                          className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-muted"
                        >
                          {name} <span className="text-2xs">hidden</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            }
          />

          <Beat
            index={5}
            title="The verifier decided whether to trust it"
            body={
              narrative.boundToRequest ? (
                <>
                  The response was tied to this one request, so it could not be captured and reused somewhere
                  else.
                </>
              ) : (
                <>
                  The response was <span className="text-warn">not tied to this specific request</span>, so a copy
                  of it could be replayed to another verifier.
                </>
              )
            }
            detail={
              <ul className="space-y-1.5">
                {narrative.verifierEstablished.map((entry) => (
                  <li key={entry.claim} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={`mt-px text-base leading-none ${entry.ok ? 'text-pass' : 'text-warn'}`}
                    >
                      {entry.ok ? '✓' : '✕'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm text-ink">{entry.claim}</span>
                      {entry.note && <span className="block text-xs leading-snug text-muted">{entry.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            }
          />
        </ol>
      </Panel>

      <Verdict narrative={narrative} status={status} />
    </div>
  );
}

function Beat({
  index,
  title,
  body,
  detail,
}: {
  index: number;
  title: string;
  body: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-2xs tabular-nums text-muted">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{body}</p>
        {detail && <div className="mt-2">{detail}</div>}
      </div>
    </li>
  );
}

function ClaimList({ claims, tone }: { claims: Record<string, unknown>; tone: 'neutral' | 'shared' }) {
  const entries = Object.entries(claims);
  if (entries.length === 0) return null;

  return (
    <div>
      {tone === 'shared' && (
        <div className="mb-1 text-2xs uppercase tracking-wider text-muted">Shared with the verifier</div>
      )}
      <div className="flex flex-wrap gap-1">
        {entries.map(([name, value]) => (
          <span
            key={name}
            className={`rounded border px-1.5 py-0.5 text-xs ${
              tone === 'shared' ? 'border-pass/40 bg-pass/10 text-ink' : 'border-line bg-surface-2 text-ink'
            }`}
          >
            <span className="text-muted">{name}:</span> {formatValue(value)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The bottom line.
 *
 * "Valid but expired" gets its own wording because it is genuinely a different
 * answer — the credential is real, and it is out of date — and collapsing it
 * into "rejected" would lose the only part a holder can act on.
 */
function Verdict({ narrative, status }: { narrative: RunNarrative; status: RunStatus }) {
  const wording: Record<string, { headline: string; body: string; tone: string }> = {
    valid: {
      headline: 'Accepted',
      body: 'The verifier established the credential was genuine, current, and presented by the person it was issued to.',
      tone: 'border-pass/40 bg-pass/5 text-pass',
    },
    'valid-but-expired': {
      headline: 'Genuine, but out of date',
      body: 'The credential really was issued by who it says, and has not been altered — but its validity period has passed. The holder needs a fresh one.',
      tone: 'border-warn/40 bg-warn/5 text-warn',
    },
    invalid: {
      headline: 'Rejected',
      body: 'The verifier could not establish that the credential was genuine and presentable by this holder. The reasons are listed above.',
      tone: 'border-fail/40 bg-fail/5 text-fail',
    },
    error: {
      headline: 'Could not be checked',
      body: 'The verifier could not complete its checks, so no conclusion can be drawn either way.',
      tone: 'border-warn/40 bg-warn/5 text-warn',
    },
  };

  const verdict = narrative.verdict ?? (status === 'passed' ? 'valid' : 'error');
  const copy = wording[verdict] ?? wording.error;

  return (
    <div className={`rounded-lg border px-4 py-3 ${copy?.tone}`}>
      <div className="text-md font-semibold">{copy?.headline}</div>
      <p className="mt-0.5 text-sm leading-relaxed text-muted">{copy?.body}</p>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
