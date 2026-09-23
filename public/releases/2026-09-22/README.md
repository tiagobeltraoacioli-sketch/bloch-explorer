# Bloch PoS validator upgrade — 2026-09-22

This is the signed Linux x86-64 upgrade binary built from source commit
`dade5a330181a7dd136cab1f6f173f31dbd70966`.

Download all verification files into one directory, then run:

```bash
minisign -Vm SHA256SUMS -p bloch-release-20260922.pub
sha256sum --check SHA256SUMS
./bloch-pos --version
```

Expected binary SHA-256:

```text
1962c4a26c526e362e128a1b4ce45c20eded2c009e48f5d9eaea17741b9f5041
```

This artifact upgrades an existing synchronized Genesis-4 node. It does not
include validator keys, passphrases, chain data, genesis material or a current
weak-subjectivity checkpoint. Preserve the existing node arguments and
slashing-protection data, stop the old process cleanly, replace only the
executable, and retain the prior executable for rollback.
