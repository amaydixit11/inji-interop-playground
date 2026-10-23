# Architecture

## Components

```mermaid
flowchart LR
  subgraph Browser
    UI["Web UI<br/>apps/web<br/>React + Tailwind<br/>RunBuilder · Timeline · ProtocolInspector<br/>SequenceDiagram · HistoryMatrix · Compare"]
  end

  subgraph BFF["Playground server · apps/bff · Node + Express + ws · :8787"]
    API["/api<br/>control API"]
    WS["/ws<br/>live events"]
    ENG["Run engine<br/>core/engine.ts<br/>discover → offer → issue → present → verify"]
    CTX["RunContext<br/>core/context.ts<br/>traces every HTTP call"]
    ADP["Adapters<br/>adapters/*.ts<br/>one per implementation"]
    REFI["Reference issuer<br/>/mock-issuer"]
    REFV["Reference verifier<br/>/mock-verifier"]
    PROXY["/proxy/verify"]
    STORE[("runs/*.json<br/>run history")]
    KEYS[(".keys/<br/>issuer + wallet keys")]
  end

  subgraph Inji["Inji stack · docker-compose.inji.yml"]
    CERT["Inji Certify 0.14.0<br/>+ Postgres"]
    VER["Inji Verify service 0.18.2<br/>+ Postgres"]
    MIM["Mimoto 0.21.0"]
    WEB["Inji Web 0.16.0"]
  end

  PHONE["Phone wallet<br/>Inji Wallet app"]
  EXT["External OpenID4VCI / VP<br/>issuers and verifiers"]

  UI -- "REST" --> API
  WS -- "run events" --> UI
  API --> ENG
  ENG --> ADP
  ADP --> CTX
  CTX -- "OpenID4VCI" --> REFI
  CTX -- "OpenID4VP" --> REFV
  CTX -- "OpenID4VCI" --> CERT
  CTX -- "OpenID4VP" --> VER
  CTX -- "OpenID4VCI / VP" --> EXT
  CTX -. "every exchange" .-> WS
  ENG --> STORE
  REFI --- KEYS
  UI -- "MOSIP verify SDK" --> PROXY --> VER
  WEB --> MIM --> CERT
  PHONE -- "scans QR" --> REFI
  PHONE -- "scans QR" --> CERT
  PHONE -- "presents" --> REFV
```

## One run, end to end

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant UI as Web UI
  participant E as Run engine
  participant I as Issuer
  participant W as Wallet
  participant V as Verifier

  U->>UI: choose issuer, wallet, verifier, format, fault
  UI->>E: POST /api/runs
  E-->>UI: 202 { runId }, then events over /ws

  rect rgba(120,120,120,0.08)
  note over E,I: 1 · discover
  W->>I: GET /.well-known/openid-credential-issuer
  W->>I: GET /.well-known/oauth-authorization-server
  end

  rect rgba(120,120,120,0.08)
  note over E,I: 2 · offer
  E->>I: create credential offer
  I-->>W: credential_offer (QR / deep link)
  end

  rect rgba(120,120,120,0.08)
  note over W,I: 3 · issue
  W->>I: POST /token (pre-authorized code or auth code + PKCE)
  W->>I: POST /credential (Bearer token + holder proof)
  I-->>W: signed credential (ldp_vc · SD-JWT · mDoc)
  end

  rect rgba(120,120,120,0.08)
  note over W,V: 4 · present
  E->>V: open session
  V-->>W: authorization request (PE or DCQL)
  W->>V: POST /response (vp_token)
  end

  rect rgba(120,120,120,0.08)
  note over E,V: 5 · verify
  E->>V: GET /result/:transactionId
  V-->>E: verdict + checks
  end

  E-->>UI: run.finished (status, checks, timings)
  E->>E: save to runs/<runId>.json
```

## Why it is built this way

- **Adapters never touch the network directly.** Every request goes through `RunContext`, so the
  protocol inspector is complete by construction, not because each adapter remembers to log.
- **The reference wallet knows only the specifications.** It drives Inji Certify and the reference
  issuer through the same code path, so it works as a control: if it fails against one and passes
  against the other, the difference is in the issuer.
- **One process.** The server also serves the built UI, so a deployment is one container.

Data model and wire types: `packages/shared/src/domain.ts`, `packages/shared/src/protocol.ts`.
Endpoints: [API.md](API.md).
