import type {
  CredentialFormat,
  Participant,
  Role,
  RunConfig,
  TamperMode,
} from '@interop/shared';
import type { FlowMode, IssuerKeyReference, ProofType, VciDraft, VcVersion } from '@interop/shared';
import {
  CREDENTIAL_FORMAT_LABELS,
  FLOW_MODE_LABELS,
  ISSUABLE_PROOF_TYPES,
  PROOF_TYPE_LABELS,
  TAMPER_MODE_LABELS,
  VCI_DRAFT_LABELS,
  VC_VERSION_LABELS,
  ISSUER_KEY_REFERENCE_LABELS,
} from '@interop/shared';
import { Badge, kindTone, TraceabilityBadge } from './primitives.js';

const ROLE_TITLES: Record<Role, string> = {
  issuer: 'Issuer',
  wallet: 'Wallet',
  verifier: 'Verifier',
};

const ROLE_SUBTITLES: Record<Role, string> = {
  issuer: 'Mints and signs the credential over OpenID4VCI',
  wallet: 'Holds the credential and presents it over OpenID4VP',
  verifier: 'Requests a presentation and decides whether to trust it',
};

export interface RunBuilderProps {
  participants: Participant[];
  config: RunConfig;
  onChange: (config: RunConfig) => void;
  disabled: boolean;
}

export function RunBuilder({ participants, config, onChange, disabled }: RunBuilderProps) {
  const byRole = (role: Role) => participants.filter((p) => p.role === role);
  const selectedId = (role: Role) =>
    role === 'issuer' ? config.issuerId : role === 'wallet' ? config.walletId : config.verifierId;

  const select = (role: Role, id: string) => {
    onChange({
      ...config,
      ...(role === 'issuer' ? { issuerId: id } : role === 'wallet' ? { walletId: id } : { verifierId: id }),
    });
  };

  const selected = (['issuer', 'wallet', 'verifier'] as Role[]).map((role) =>
    participants.find((p) => p.id === selectedId(role)),
  );

  // A format is only offerable when all three chosen participants handle it;
  // showing the rest would just produce preflight failures.
  const commonFormats = (Object.keys(CREDENTIAL_FORMAT_LABELS) as CredentialFormat[]).filter((format) =>
    selected.every((participant) => participant?.formats.includes(format)),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {(['issuer', 'wallet', 'verifier'] as Role[]).map((role, index) => (
          <div key={role} className="relative">
            {index > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute -left-2.5 top-1/2 hidden -translate-y-1/2 text-muted lg:block"
              >
                →
              </span>
            )}
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-[13px] font-semibold text-ink">{ROLE_TITLES[role]}</h3>
                <span className="text-[10px] uppercase tracking-wider text-muted">{role}</span>
              </div>
              <p className="mb-3 text-[11px] leading-snug text-muted">{ROLE_SUBTITLES[role]}</p>

              <div className="space-y-2">
                {byRole(role).map((participant) => {
                  const isSelected = selectedId(role) === participant.id;
                  return (
                    <button
                      key={participant.id}
                      type="button"
                      disabled={disabled || Boolean(participant.unavailable)}
                      onClick={() => select(role, participant.id)}
                      className={`w-full rounded-md border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        isSelected
                          ? 'border-accent bg-accent/10'
                          : 'border-line bg-surface-2 hover:border-accent/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                          {participant.label}
                        </span>
                        <Badge tone={kindTone(participant.kind)}>{participant.kind}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-muted">{participant.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <TraceabilityBadge traceability={participant.traceability} />
                        {participant.interactive && <Badge tone="warn">needs a human</Badge>}
                        {participant.constraints && participant.constraints.length > 0 && (
                          <Badge tone="warn" title={participant.constraints.join('\n\n')}>
                            pairing limits
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Credential format" hint="Must be supported by all three participants">
          <select
            disabled={disabled}
            value={config.format}
            onChange={(event) => onChange({ ...config, format: event.target.value as CredentialFormat })}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {commonFormats.length === 0 && <option value="">No format is common to this combination</option>}
            {commonFormats.map((format) => (
              <option key={format} value={format}>
                {CREDENTIAL_FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fault injection" hint="A tampered run passes when the verifier rejects it">
          <select
            disabled={disabled}
            value={config.tamper}
            onChange={(event) => onChange({ ...config, tamper: event.target.value as TamperMode })}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {(Object.keys(TAMPER_MODE_LABELS) as TamperMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {TAMPER_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Proof suite"
          hint={
            config.format === 'ldp_vc'
              ? 'Data Integrity suite the issuer signs with'
              : 'JSON-LD only; ignored for this format'
          }
        >
          <select
            disabled={disabled || config.format !== 'ldp_vc'}
            value={config.proofType}
            onChange={(event) => onChange({ ...config, proofType: event.target.value as ProofType })}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {ISSUABLE_PROOF_TYPES.map((proofType) => (
              <option key={proofType} value={proofType}>
                {PROOF_TYPE_LABELS[proofType] ?? proofType}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Data model"
          hint={config.format === 'ldp_vc' ? 'W3C revision the credential uses' : 'JSON-LD only'}
        >
          <select
            disabled={disabled || config.format !== 'ldp_vc'}
            value={config.vcVersion ?? '1.1'}
            onChange={(event) => onChange({ ...config, vcVersion: event.target.value as VcVersion })}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {(Object.keys(VC_VERSION_LABELS) as VcVersion[]).map((version) => (
              <option key={version} value={version}>
                {VC_VERSION_LABELS[version]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="OpenID4VCI revision" hint="Which draft the wallet speaks on the wire">
          <select
            disabled={disabled}
            value={config.vciDraft ?? 'draft-13'}
            onChange={(event) => onChange({ ...config, vciDraft: event.target.value as VciDraft })}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {(Object.keys(VCI_DRAFT_LABELS) as VciDraft[]).map((draft) => (
              <option key={draft} value={draft}>
                {VCI_DRAFT_LABELS[draft]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Presentation flow" hint="How the wallet returns the presentation">
          <select
            disabled={disabled}
            value={config.flowMode ?? 'cross-device'}
            onChange={(event) => onChange({ ...config, flowMode: event.target.value as FlowMode })}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {(Object.keys(FLOW_MODE_LABELS) as FlowMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {FLOW_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Issuer key reference"
          hint={
            config.format === 'ldp_vc' ? 'SD-JWT only; ignored for JSON-LD' : 'How the issuer names its signing key'
          }
        >
          <select
            disabled={disabled || config.format === 'ldp_vc' || config.format === 'mso_mdoc'}
            value={config.issuerKeyReference ?? 'did'}
            onChange={(event) =>
              onChange({ ...config, issuerKeyReference: event.target.value as IssuerKeyReference })
            }
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            {(Object.keys(ISSUER_KEY_REFERENCE_LABELS) as IssuerKeyReference[]).map((reference) => (
              <option key={reference} value={reference}>
                {ISSUER_KEY_REFERENCE_LABELS[reference]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Holder binding" hint="Key binding proof sent with the presentation">
          <select
            disabled={disabled}
            value={config.walletProofType}
            onChange={(event) =>
              onChange({ ...config, walletProofType: event.target.value as RunConfig['walletProofType'] })
            }
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="jwt">JWT proof (recommended)</option>
            <option value="none">None — omit holder binding</option>
          </select>
        </Field>
      </div>

      {selected.some((participant) => (participant?.config.length ?? 0) > 0) && (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
          <h3 className="text-[12px] font-semibold text-ink">Endpoint configuration</h3>
          <p className="-mt-2 text-[11px] text-muted">
            Overrides apply to this run only, so you can point at a local stack for one run and a sandbox for the
            next without restarting.
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {selected.map(
              (participant) =>
                participant &&
                participant.config.length > 0 && (
                  <div key={participant.id} className="space-y-2">
                    <div className="text-[11px] font-medium text-accent">{participant.label}</div>
                    {participant.config.map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-1 block text-[10.5px] text-muted">
                          {field.label}
                          {field.required && <span className="text-fail"> *</span>}
                        </span>
                        <input
                          disabled={disabled}
                          type={field.secret ? 'password' : 'text'}
                          value={config.overrides?.[participant.id]?.[field.key] ?? field.value}
                          placeholder={field.placeholder}
                          onChange={(event) =>
                            onChange({
                              ...config,
                              overrides: {
                                ...config.overrides,
                                [participant.id]: {
                                  ...config.overrides?.[participant.id],
                                  [field.key]: event.target.value,
                                },
                              },
                            })
                          }
                          className="payload w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent disabled:opacity-50"
                        />
                      </label>
                    ))}
                  </div>
                ),
            )}
          </div>
        </div>
      )}

      {commonFormats.length === 0 && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          The selected issuer, wallet and verifier share no credential format. That mismatch is itself an
          interoperability finding — but the run cannot proceed until you pick a compatible combination.
        </p>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ink">{label}</span>
      {children}
      <span className="mt-1 block text-[10px] leading-snug text-muted">{hint}</span>
    </label>
  );
}
