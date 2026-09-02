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

Open <http://localhost:5173> and pick a scenario from **Start here**.

Nothing else needs installing. The playground hosts its own reference issuer, wallet and verifier, so
there is a complete working cycle to look at before wiring up anything real.

Eleven scenarios, each phrased as a question the run answers — *Does the verifier catch a forged
credential?*, *Is a revoked credential still accepted?*, *What happens against real Inji Certify?* —
with what to expect stated up front, including the two that are supposed to fail.

**Run all** executes every unattended scenario in sequence and reports how many outcomes differed
from what the scenario predicted. Not how many passed: two of them are supposed to fail, and a batch
where everything passes would mean the runs that find real defects had stopped finding them.

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
| **Issuer** | Reference Issuer (built in) · Inji Certify · any external OpenID4VCI issuer |
| **Wallet** | Reference Wallet (built in, headless) · Inji Wallet (mobile, via QR) · Inji Web |
| **Verifier** | Reference Verifier (built in) · Inji Verify · any external OpenID4VP verifier |

The **external** participants are how cross-ecosystem testing works. Paste a credential offer from
any third-party issuer's demo page and the playground redeems it through exactly the same
standards-only path it uses for Inji Certify; paste an authorization request from any relying party
and the wallet answers it for real. No adapter code is needed for a new implementation that speaks
the protocols.

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

| Format | Issued by | Notes |
| --- | --- | --- |
| `ldp_vc` | Reference, Certify | W3C VC **1.1 and 2.0** JSON-LD, with any of three Data Integrity proof suites |
| `vc+sd-jwt` | Reference, Certify | IETF SD-JWT VC, draft media type, with holder key binding |
| `dc+sd-jwt` | Reference | IETF SD-JWT VC, registered media type |
| `mso_mdoc` | Reference, Certify | ISO/IEC 18013-5 mdoc: COSE_Sign1 issuer authentication over a MobileSecurityObject, selective disclosure by digest, and device binding over an OpenID4VP session transcript |

All four are implemented against the specifications rather than wrapped from a library, so the
playground can emit deliberately malformed variants — a library that refuses to produce a bad
credential cannot exercise a verifier's negative paths.

The format selector only offers formats that **all three** selected participants declare support for.
A combination with no format in common is itself an interoperability finding, and the UI says so
rather than letting you start a run that cannot work.

---

## What a run varies

Six independent dimensions, each of which changes what is actually on the wire:

| Dimension | Options |
| --- | --- |
| **Credential format** | `ldp_vc` · `vc+sd-jwt` · `dc+sd-jwt` · `mso_mdoc` |
| **Proof suite** (JSON-LD) | `Ed25519Signature2020` · `Ed25519Signature2018` · `RsaSignature2018` |
| **OpenID4VCI revision** | draft 11 · draft 12 · draft 13 · 1.0 |
| **Presentation flow** | cross-device (QR, polled) · same-device (redirect + one-time response code) |
| **W3C data model** | 1.1 (`issuanceDate`) · 2.0 (`validFrom`) |
| **Issuer key reference** | `kid` / DID · `x5c` certificate chain |
| **Holder binding** | JWT key-binding proof · none |
| **Fault injected** | see below |

The revisions and suites are dimensions rather than settings because they are where interoperability
actually breaks: draft 11–13 and 1.0 disagree about where the credential sits in the response and
whether `format` is echoed, and a verifier that advertises three proof suites may only implement one.
Each is asserted against the shape its own revision defines rather than the wallet accepting whatever
turns up.

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
| Revoke the credential after issuing it | rejected on status, with the signature still intact |
| Redeem the same-device response code twice | second redemption refused |

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

## Learning from a run

**Explain** (on by default, top right) annotates every phase and every payload with what it is, why
the protocol has it, and what an experienced reader checks. The point is that someone who does not
already know OpenID4VCI should be able to read a run and come away understanding it — a wall of JSON
proves something to an expert and teaches nobody else.

**Compare** puts two runs side by side, shows only the configuration fields that differ, and diffs
their assertions: which resolved differently, and — usually more revealing — which only one side
ever got far enough to evaluate. Swapping the reference verifier for Inji Verify and comparing is how
finding 7 reduces to a single line.

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

**Export this run** — any finished run as a self-contained Markdown report: configuration, every
assertion with the clause it cites, and the exchanges that produced them. Written to be pasted into
a bug report by someone who was not watching.

**Dashboard** — pass rate and latency by format, fault, issuer and verifier; median time per phase;
and the checks that fail or warn most often, with deliberately provoked failures excluded so real
problems are not buried under tests that are working.

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

## What the live runs found

Running against real Certify 0.14.0 and verify-service 0.18.2 produced sixteen findings, recorded in
[`docs/FINDINGS.md`](docs/FINDINGS.md) with the evidence for each and a note on whether it was
observed or read from source. The most consequential:

- **Inji Certify cannot complete a pre-authorized-code issuance with the configuration it ships.**
  Three separate blockers, each hiding the next.
- **Inji Verify cannot resolve a `did:web` that carries a port** — it does not percent-decode the
  host — which rules out every development and CI deployment. Small fix, large effect.
- **Inji Verify cannot load an issuer-hosted JSON-LD context**, which affects any credential with
  custom claims, since such claims must be defined in a context of their own.
- **Inji Verify resolves an SD-JWT issuer key only from an embedded `x5c` chain**, not from a DID —
  confirmed by sending the same credential twice, differing only in that. With `x5c` it verifies
  **end to end**, which is the one fully green path against a real Inji service and was invisible
  until the comparison was run.
- **Inji Verify does not check revocation for SD-JWT at all**, and reports an empty status list that
  is indistinguishable from a clean one. A revoked SD-JWT VC is accepted.
- **inji-verify ships a database schema that does not match its own image**, so every presentation
  submission returns HTTP 500 until the authoritative DDL is used instead.

Five of the nineteen are defects in *this* project that only a real counterparty exposed. One is
worth singling out: our Inji Verify adapter read its verdict from a field the response does not
carry, so **every successful verification was reported as a failure** — and the reports said so. It
surfaced only because the `x5c` comparison produced a result that should have been green. An
interoperability tool has no external signal when it misreads a counterparty, which is why the same
credential is now also verified through a second, independent endpoint.

One finding changed what got built: **Inji Web cannot be paired with an arbitrary issuer.** Its
Mimoto backend takes a pre-registered `issuer_id` rather than a credential offer, and requires an
authorization code — so it is a wallet for a curated set of issuers, not a general OpenID4VCI wallet.
No Mimoto adapter was written, because one could only exercise the pre-registered path behind an
interactive login. The constraint is declared on the participant and shown before a run instead.

Generated matrices: [reference baseline](docs/INTEROPERABILITY.md) ·
[suites × revisions](docs/INTEROPERABILITY-suites-revisions.md) ·
[flow modes](docs/INTEROPERABILITY-flow-modes.md) ·
[data model 1.1 vs 2.0](docs/INTEROPERABILITY-data-model.md) ·
[issuer key reference](docs/INTEROPERABILITY-issuer-key-reference.md) ·
[Inji Certify](docs/INTEROPERABILITY-inji-certify.md) ·
[Inji Verify](docs/INTEROPERABILITY-inji-verify.md).

Four of the findings are drafted as ready-to-file upstream issues in
[`docs/upstream-issues/`](docs/upstream-issues/). **None has been filed** — they should be checked
against the latest release first, since all were found on pinned versions.

## If you are changing one of these services

The question when you have just modified `inji-verify` is not "does the playground pass" — it never
passed against real Inji, and it should not start. The question is whether *your change* broke
something that used to work.

```bash
# Point the playground at your build
VERIFY_BASE_URL=http://localhost:8010/v1/verify npm run dev:bff

# Record what it does today
node scripts/run-matrix.mjs --verifier inji-verify --save-baseline my-baseline.json

# ... make your change, rebuild, restart ...

# Ask what moved
node scripts/run-matrix.mjs --verifier inji-verify \
  --baseline my-baseline.json --fail-on-regression
```

Regressions exit non-zero; everything else exits zero. The comparison reports **fixes as prominently
as regressions**, because someone verifying a change needs to see the assertions that started
passing, not only the ones that stopped.

It also treats an assertion that **stopped running at all** as a regression. That case is easy to
miss and worth catching: a verifier that quietly stops checking revocation still reports every run as
passing, and no comparison of the surviving checks would ever reveal it. Reproduced deliberately
while building this — two runs still said `PASS`, and only the baseline caught it.

`docs/baseline-reference.json` is the reference implementations' current behaviour, committed, so a
change to the playground's own engine can be checked the same way.

Every participant's endpoint can also be overridden per run from the UI, so you can point one run at
your local build and the next at the Collab sandbox without restarting anything.

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
