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
Hosted CI identity/OIDC attestation is a separate, unimplemented trust mechanism.
