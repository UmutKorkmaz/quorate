# Portable proof statements

A local proof uses a machine-local HMAC. To share it, export an Ed25519-signed
statement and explicitly pin the signer's public key on the receiving machine.
No key inside an artifact, repository config, or network response is auto-trusted.

```sh
# Producer: keep the private key outside the checkout and never distribute it.
quorate proof keygen --private-key /secure/proof.key --public-key /secure/proof.pub
quorate proof run --name tests -- npm test
quorate proof export --signing-key /secure/proof.key --output /tmp/proof.json

# Receiver: obtain the public key through an authenticated, independent channel.
# Use the same reviewed commit and worktree contents.
quorate proof verify --artifact /tmp/proof.json --trusted-key /trusted/proof.pub
quorate review --proof /tmp/proof.json --proof-key /trusted/proof.pub
```

Export requires a currently valid local proof. Files are not overwritten.
Verification checks the Ed25519 signature, artifact hash, Markdown digest, schema,
and current checkout fingerprint. A failed command remains failed evidence even
when its signature verifies. Review attachments remain untrusted model input.
An explicitly selected stale artifact is labeled stale, as with local proofs.

Trust means accepting the named signer's statement about execution. It does not
prove that a runner was uncompromised or independently attest to execution.
Do not give untrusted PR jobs a signing key. Distribute public keys through your
own trusted channel and revoke trust by ceasing to pass a compromised key.
The private key is never needed by a recipient; never share local HMAC keys.

Acceptance covers independent checkouts and an offline Linux container with only
the public key and envelope mounted. Wrong keys, changed signed payloads,
malformed signatures, invalid proof content, and stale worktrees are rejected.
GitHub-hosted provenance uses the separate verification mode below.

## GitHub-hosted provenance

The manually dispatched `Attested proof` workflow runs only on `main`, records
actual test/typecheck/build steps, verifies the local proof, and publishes GitHub
OIDC/SLSA provenance for the raw `latest.json`. No long-lived signing secret is
needed. Download the `quorate-proof` artifact from that run into a path outside
your clean checkout at the same source commit, then run:

```sh
quorate proof verify-github /tmp/latest.json \
  --repo UmutKorkmaz/quorate --workflow .github/workflows/proof.yml
quorate review --proof /tmp/latest.json \
  --proof-github-repo UmutKorkmaz/quorate \
  --proof-github-workflow .github/workflows/proof.yml
```

Requires an authenticated current `gh` CLI. The verifier pins repository,
workflow, branch (default `refs/heads/main`), source commit, signer commit, OIDC
issuer and SLSA predicate, and rejects self-hosted runners. It verifies a private
snapshot so changing the original file during verification cannot substitute
accepted contents. It also checks proof hashes and the reviewed checkout.

This establishes provenance from the expected hosted workflow. It does not
establish that trusted workflow code or GitHub's runner infrastructure is free of
compromise. Private-key statements and GitHub provenance are distinct modes;
use the one matching your trust policy.
