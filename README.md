# Inji Interoperability Playground

A sandbox for proving that Verifiable Credential implementations actually interoperate — not just that
each one works on its own.

Pick an **issuer**, a **wallet** and a **verifier**, choose a credential format, and run a live
`issue → hold → present → verify` cycle. Every protocol exchange is captured and shown, every
assertion made along the way is named and attributed, and the result is recorded in a matrix you can
diff across releases.

Built for the [Inji stack](https://docs.inji.io) (Certify, Wallet, Web, Verify) and for testing it
against OpenID4VCI / OpenID4VP implementations outside the MOSIP ecosystem.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173> and press **Run interoperability test**.

That first run works with no other services installed. The playground hosts its own reference issuer,
wallet and verifier, so there is a complete working cycle to look at before you wire up anything real.

Or with Docker:

```bash
docker compose up --build   # then open http://localhost:8787
```

---

## What problem this solves

Every module in this ecosystem already claims to speak OpenID4VCI and OpenID4VP. The interesting
question is not whether each one works, but what happens when you put two of them together — and
that question is normally answered by reading logs from three services at once.

The playground answers it directly:

- **Cross-implementation, not just internal.** Any issuer can be paired with any wallet and any
  verifier. Pair Inji Certify with the reference verifier to test Certify in isolation; pair the
  reference issuer with Inji Verify to test Verify in isolation. When a run fails with a reference
  implementation on one side, the fault is on the other.
- **Findings, not just a verdict.** Each run produces named conformance checks that cite the clause
  they assert and say which participant is answerable. `Metadata uses the draft-13+
  credential_configurations_supported shape — fail, attributed to the issuer` is something you can
  file as a bug; "verification failed" is not.
- **Honest about what it saw.** A run driven by a phone wallet cannot be traced end to end, because
  the phone talks to the issuer directly. Those runs are marked `endpoint-only` and the uncaptured
  hops are shown as gaps rather than quietly omitted.
- **Negative paths are first-class.** Corrupt a signature, backdate an expiry, present the wrong
  credential type — and a run **passes** when the verifier correctly rejects it.

---

## The three roles

| Role | Implementations available |
| --- | --- |
| **Issuer** | Reference Issuer (built in) · Inji Certify |
| **Wallet** | Reference Wallet (built in, headless) · Inji Wallet (mobile, via QR) · Inji Web |
| **Verifier** | Reference Verifier (built in) · Inji Verify |

The three **reference** implementations are written against the specifications alone, with no
knowledge of any vendor. They are the controls: they exist so that when something fails, you can
substitute one in and find out which side is actually at fault.

They are real HTTP services, not in-process fakes — the reference issuer is a working OpenID4VCI
endpoint that an external wallet can be pointed at, and the reference verifier is a working
OpenID4VP relying party. Credentials are signed with real Ed25519 keys and verified with the
DigitalBazaar reference libraries.

### Traceability

Each participant declares how much of its traffic the playground can observe:

- **fully traced** — the orchestrator performs the exchanges itself, so every payload is captured.
- **endpoint only** — the participant talks to the other endpoints directly (a phone scanning a QR),
  so only what the endpoints report is visible.

A run inherits the weakest traceability of its three participants, and the matrix marks it. This
matters because a green `endpoint-only` run is a weaker claim than a green fully-traced one, and
reporting them identically would be misleading.

---

## Credential formats

| Format | Issuer support | Notes |
| --- | --- | --- |
| `ldp_vc` | Reference, Certify | W3C VC 1.1 JSON-LD with an `Ed25519Signature2020` Data Integrity proof |
| `vc+sd-jwt` | Reference, Certify | IETF SD-JWT VC, draft media type |
| `dc+sd-jwt` | Reference | IETF SD-JWT VC, registered media type |
| `mso_mdoc` | Certify only | ISO/IEC 18013-5, via Certify's mock mDoc plugin |

The format selector only offers formats that **all three** selected participants declare support for.
A combination with no format in common is itself an interoperability finding, and the UI says so
rather than letting you start a run that cannot work.

---

## Fault injection

Fault injection turns the playground from a demo into a test. Select a fault and the run **passes**
only if the verifier responds correctly:

| Fault | Expected outcome |
| --- | --- |
| Corrupt credential signature | rejected as invalid |
| Issue an already-expired credential | reported as expired, or rejected |
| Present a credential of the wrong type | rejected — fails the presentation definition |
| Strip the holder binding proof | rejected, or flagged as unbound |
| Replay a stale nonce | rejected |

A verifier that *accepts* a deliberately corrupted credential is the one failure a tampered run
reports, and it is attributed to the verifier.

---

## Connecting real Inji modules

The playground talks to real modules over their published APIs. Nothing needs to be modified on
their side.

### Inji Certify

Stand up Certify (see the [Inji Certify local setup](https://docs.inji.io/inji-certify)), then set:

```bash
CERTIFY_BASE_URL=http://localhost:8090/v1/certify
```

Certify is driven through its **pre-authorized code** flow — `POST /pre-authorized-data` to mint an
offer, then the standard OpenID4VCI token and credential endpoints. That grant is used deliberately:
it is the only one that needs no interactive login, which is what makes an unattended end-to-end run
possible.

### Inji Verify

Stand up `verify-service`, then set:

```bash
VERIFY_BASE_URL=http://localhost:8000/v1/verify
```

The adapter creates a VP request via `POST /vp-request`, translates the response into a standards-
shaped authorization request, polls `/vp-request/{requestId}/status`, and fetches the result from
`POST /v2/vp-results/{transactionId}`.

### Testing with a real phone wallet

QR codes contain absolute URLs. A phone cannot reach `localhost`, so `PUBLIC_URL` **must** be set to
an address the phone can resolve:

```bash
ngrok http 8787
PUBLIC_URL=https://<your-subdomain>.ngrok-free.app npm run dev:bff
```

`PUBLIC_URL` also determines the issuer's `did:web` identifier and the `credential_issuer` in every
offer, so changing it changes the issuer's identity. The playground warns at startup when it is left
as `localhost`.

---

## Reading a run

**Timeline** — the five phases: discover, offer, issue, present, verify.

**Protocol inspector** — every request and response in order, with headers and decoded bodies.
SD-JWTs are shown with their disclosures expanded. The *Artifacts* tab holds the durable outputs:
the credential offer, the issued credential, the `vp_token`, the verification result.

**Protocol sequence** — the same exchanges as a Mermaid sequence diagram, drawn from what was
actually observed. Uncaptured hops appear as dashed arrows marked `not captured`.

**Conformance checks** — the findings. Each cites its clause and, on failure, the participant
answerable for it. Failures that were deliberately provoked are labelled `expected` and do not fail
the run.

**Interoperability matrix** — every recorded run, filterable, exportable as Markdown for a report or
a GitHub issue.

---

## Architecture

```
apps/web     React + TypeScript + Tailwind. Selector, timeline, inspector, matrix.
apps/bff     Node + Express + ws. Run engine, adapters, and the hosted reference modules.
packages/shared   Domain model and protocol wire types, shared by both.
```

The design rests on two decisions:

**Adapters never touch the network directly.** They go through a `RunContext` that wraps every
request, which is what makes the protocol inspector complete by construction rather than by each
adapter remembering to log. Adding a new implementation means writing an adapter against
`IssuerAdapter`, `WalletAdapter` or `VerifierAdapter` — tracing, conformance recording and the
sequence diagram all come for free.

**The reference wallet knows only the specifications.** It drives Certify and the reference issuer
through exactly the same code path. That is what makes it usable as a control.

```
packages/shared/src/domain.ts       Run, Participant, ConformanceCheck, traceability
packages/shared/src/protocol.ts     OpenID4VCI / OpenID4VP / W3C VC wire types
apps/bff/src/core/context.ts        Tracing HTTP client and event emission
apps/bff/src/core/engine.ts         Five-phase run execution and outcome evaluation
apps/bff/src/core/credentials.ts    Credential minting and fault injection
apps/bff/src/core/presentation.ts   Format-agnostic vp_token verification
apps/bff/src/core/constraints.ts    Presentation Exchange constraint evaluation
apps/bff/src/adapters/              One file per implementation
apps/bff/src/services/              The hosted reference issuer and verifier
```

---

## Running the matrix from CI

```bash
npm run dev            # in one terminal
npm run matrix         # in another
```

`scripts/run-matrix.mjs` drives every format against every fault, writes
`docs/INTEROPERABILITY.md`, and exits non-zero if any run fails — so a nightly job against the Collab
environment becomes a pass/fail signal plus an artefact rather than something a human has to read.

```bash
node scripts/run-matrix.mjs \
  --base https://playground.example \
  --issuer inji-certify \
  --verifier inji-verify \
  --formats ldp_vc,vc+sd-jwt \
  --out reports/nightly.md
```

Formats that the chosen trio does not all support are skipped and noted, rather than run and reported
as failures — a configuration mismatch is not a defect. Interactive wallets are rejected outright,
since a matrix run cannot wait for someone to scan a QR code.

## Configuration

All settings are environment variables; see `.env.example`. Every participant's base URL can also be
overridden per run from the UI, so you can point at the Collab sandbox for one run and a local stack
for the next without restarting.

## Development

```bash
npm run dev         # BFF on :8787, UI on :5173 with proxying
npm run dev:bff     # BFF only
npm run build       # Production build of both
npm run typecheck   # Typecheck every workspace
```

Run history is written to `runs/` as plain JSON — one readable file per run, so a result can be
attached to a bug report without exporting anything.

## Licence

Apache-2.0, matching the MOSIP projects this is built to test.
