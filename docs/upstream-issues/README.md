# Upstream issue drafts

Ready to file against the relevant MOSIP repositories. Each is written to stand on its own — a
maintainer should not have to read this playground's source to act on it.

**Nothing here has been filed.** Filing is a deliberate step, and these should be checked against the
latest release first: several were found on pinned versions (Certify 0.14.0, verify-service 0.18.2,
Mimoto 0.21.0) and may already be fixed on `develop`.

| File | Repository | Severity |
| --- | --- | --- |
| `certify-preauth-blockers.md` | `mosip/inji-certify` | blocker — pre-authorized code flow unusable as shipped |
| `verify-didweb-port.md` | `mosip/inji-verify` | blocker for any non-default-port deployment |
| `verify-db-schema.md` | `mosip/inji-verify` | blocker — shipped schema does not match shipped image |
| `verify-context-and-x5c.md` | `mosip/inji-verify` | interoperability limits |

The findings not drafted here are either documentation points, notes about this playground's own
code, or a third-party library issue — see [`../FINDINGS.md`](../FINDINGS.md).
