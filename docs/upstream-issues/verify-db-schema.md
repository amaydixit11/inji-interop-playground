**Repository:** `mosip/inji-verify` · **Version:** `injistack/inji-verify-service:0.18.2`

# `docker-compose/db-init/init.sql` does not match the 0.18.2 image, so every VP submission returns 500

## What happens

Bringing up the stack exactly as `docker-compose/README.md` describes, then posting a presentation:

```
POST /v1/verify/vp-submission/direct-post   → HTTP 500

org.postgresql.util.PSQLException: ERROR: column v1_0.response_code does not exist
```

## Cause

`docker-compose/db-init/init.sql` creates `verify.vp_submission` without the response-code columns.
The authoritative DDL at `db_scripts/inji_verify/ddl/verify-vp_submission.sql` has them:

```sql
response_code            character varying(200) NULL,
response_code_expiry_at  TIMESTAMP WITH TIME ZONE NULL,
response_code_used       boolean DEFAULT false,
```

The compose folder's copy predates the response-code feature.

## Impact

Anyone following the docker-compose README gets a verifier that accepts a presentation and then fails
to record it, with an opaque 500. The failure is at submission time, so it looks like a wallet problem.

## Suggested fix

Generate `docker-compose/db-init/init.sql` from `db_scripts/inji_verify/ddl/`, or delete it and mount
the DDL directory directly, so the two cannot drift again.
