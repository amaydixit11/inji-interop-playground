# Demo script

Three to five minutes, covering one full `issue → hold → present → verify` cycle with the protocol
inspector visible, then the part that makes this more than a demo.

Before recording: `docker compose -f docker-compose.inji.yml up -d`, then `npm run dev`. Wait for
Certify to answer on `:8091`. Have the **Explain** toggle on (it is on by default).

---

## 0:00 — What it is (20s)

> "This is an interoperability playground for the Inji stack. You pick an issuer, a wallet and a
> verifier, run a credential through all four phases, and see every protocol message that passes
> between them."

On screen: the landing page, eleven scenario cards.

> "Each of these answers one question. Two of them are expected to fail, and those are the
> interesting ones."

---

## 0:20 — One full cycle (70s)

Click **"Does the whole cycle work?"**

Let it finish — about 30ms, so pause on the result rather than the progress.

> "A W3C credential, issued over OpenID4VCI, held by a wallet, presented over OpenID4VP, verified.
> Twenty-seven conformance checks, each citing the clause it asserts."

Point at the five-phase timeline, then the **Protocol inspector**. Click *Token Request*.

> "Every exchange is captured — request, response, headers, decoded body. And with Explain on, each
> one says what it is and why the protocol has it."

Scroll the conformance panel briefly.

> "These are not pass/fail on the whole run. Each is a named assertion, attributed to whichever
> participant is answerable for it."

---

## 1:30 — Story view (30s)

Switch to **Story**.

> "Same run, for someone who does not work on identity protocols. What was issued, what the verifier
> asked for, what the wallet shared — and what it held back."

Point at *held back*.

> "Three of five claims withheld. The verifier can still tell the hidden ones were not tampered with,
> without learning what they are."

---

## 2:00 — Fault injection (40s)

Back to **Live**, click **"Is a revoked credential still accepted?"**

> "Now a credential that is issued, then revoked, then presented. The signature is still perfectly
> valid."

On the result:

> "The run passes — because the verifier rejected it. A tampered run succeeds when the fault is
> caught. This is the one failure mode where everything is cryptographically correct and the answer is
> still no."

---

## 2:40 — Finding real bugs (60s)

Click **Run all**.

> "Every scenario, in sequence."

While it runs:

> "Two go red on purpose: the ones pointed at real Inji Certify and real Inji Verify."

When it settles on *All outcomes were as expected*:

> "Ten of ten as expected — including the two failures, which is the point. A batch where everything
> passed would mean the runs that find real defects had stopped finding them."

Switch to **Compare**. Pick the reference-verifier run as baseline and the Inji Verify run as the
comparison.

> "Same credential, same wallet, one participant swapped. One check disagrees — and seven that only
> the baseline ever got far enough to evaluate. That is how a vague 'it does not work' becomes a line
> you can file."

---

## 3:40 — What it found (40s)

Open `docs/FINDINGS.md`.

> "Twenty-five findings against real MOSIP software. Inji Certify cannot complete a single
> pre-authorized-code issuance with the configuration it ships — three separate causes, each hiding
> the next. Inji Verify does not percent-decode the port in a `did:web`, which rules out every
> development deployment."

> "Five of them are bugs in this project, found because a real counterparty saw them. One is that our
> own adapter misread a verify-service response and reported every success as a failure — which is the
> failure mode a tool like this is least able to notice, so it is in the record."

---

## 4:20 — Close (20s)

> "It runs from one Docker Compose file, ships a CI mode that fails on regressions against a
> baseline, and every finding is drafted as an issue ready to file."

---

## Optional: the phone (60s)

If a tunnel is up (see `PHONE-TEST.md`), pick **"Does it work with a real phone wallet?"**, scan with
Inji Wallet, and show the `endpoint-only` badge on the result.

> "The phone talks to the issuer directly, so the playground cannot see those exchanges. It marks the
> run endpoint-only and shows the gaps, rather than pretending it saw everything."

---

## What not to do

- Do not open the manual configuration panel — six dropdowns will lose the audience. The scenarios
  carry the demo.
- Do not read the findings aloud from the file. Name two and point at the document.
- Do not apologise for the red runs. They are the deliverable.
