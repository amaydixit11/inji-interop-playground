# Running the phone-wallet leg

The one part of the playground that cannot be automated: mandatory tasks 3 and 4 call for issuing to
and presenting from **Inji Wallet on a phone**, and that needs a person holding a phone.

Everything up to the scan is verified. What follows takes about five minutes.

## Why a tunnel is needed

A QR code carries absolute URLs. `PUBLIC_URL` becomes:

- the `credential_issuer` in every offer,
- the `credential_endpoint` and `response_uri` the wallet posts to,
- the issuer's `did:web` identifier — so it determines whether the credential is verifiable **by
  anyone**, not just by this machine,
- the host inside every QR payload.

A phone cannot reach `localhost`, so a run with a handheld wallet needs a public URL. The playground
warns at startup when `PUBLIC_URL` is left as localhost.

## Verified without a phone

Over a public tunnel, with `PUBLIC_URL` set to it:

| | |
| --- | --- |
| Issuer DID | `did:web:<tunnel-host>:issuer` — **resolvable over public HTTPS**, 5 verification methods |
| `/mock-issuer/.well-known/openid-credential-issuer` | 200, `application/json`, from the public internet |
| `/issuer/did.json`, `/contexts/interop/v1` | 200 |
| `ldp_vc` end to end | **passed**, 32 checks — and 9.7s rather than 30ms, because `did:web` resolution now goes out to the real internet and back |
| `vc+sd-jwt` end to end | **passed**, 31 checks |
| `mso_mdoc` end to end | **passed**, 29 checks |
| QR payloads | 383 bytes (offer), 221 bytes (presentation request) — both comfortably scannable |

That last row matters: the QR a phone has to read is measured and small. The 9.7s JSON-LD run is
worth noting too — it is the credential being verified against an issuer DID fetched from the public
internet, which is the thing a third party would actually do.

So the endpoints, the DID, the contexts and the QR payloads are all confirmed to work from outside
this machine. What is unverified is the wallet's own behaviour once it scans.

## The five minutes

**1. Start a tunnel.** Any of these; the first needs no account:

```bash
npx --yes localtunnel --port 8787          # prints https://<name>.loca.lt
cloudflared tunnel --url http://localhost:8787
ngrok http 8787
```

A note on localtunnel: its root page shows a one-time reminder in a browser, but **API paths return
JSON directly** — checked with a phone user agent, so a wallet fetching the offer is unaffected. Its
tunnels are short-lived; cloudflared or ngrok are steadier for a recording.

**2. Start the playground on that URL.**

```bash
PUBLIC_URL=https://<your-tunnel-host> npm run dev
```

Check the startup banner shows the tunnel host, not localhost, and that the issuer DID reads
`did:web:<tunnel-host>:issuer`.

**3. Open the UI** at <http://localhost:5173> and pick **"Does it work with a real phone wallet?"**
from *Start here*.

**4. Scan.** The run pauses on a QR code. Scan it with Inji Wallet and accept the credential. The
playground is waiting on you, not polling — it will sit there.

**5. Confirm, then present.** Press *I have completed this step*. A second QR appears for the
presentation; scan that one and approve sharing. The verifier reports the result automatically.

## What the result means, and does not

The run is marked **`endpoint-only`**, and the report says so. The phone talks to the issuer and the
verifier directly, so the playground never sees the token request, the credential request or the
`vp_token` — they appear on the timeline as explicit gaps rather than being omitted.

So a green run here proves the **endpoints** interoperated with a real wallet. It is weaker evidence
than a fully-traced run, and the two are deliberately not reported the same way.

## If the scan fails

| Symptom | Cause |
| --- | --- |
| Wallet says the offer is unreachable | `PUBLIC_URL` still localhost, or the tunnel dropped. Check the startup banner. |
| Camera will not lock on | Check the `qr.capacity` check in the run. Anything above ~1,200 bytes is marginal; the playground reports the size and what compression would save. |
| Wallet accepts the credential but presentation fails | Look at the verifier's own result — the presentation leg is a separate exchange with its own nonce. |
| Wallet rejects the credential | Read the run's conformance checks. If they are green, the finding is in the wallet, which is the interesting outcome. |
