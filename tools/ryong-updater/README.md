# Ryong verified update transfer core

The native update path validates an Ed25519-signed manifest, exact board/model,
monotonic release version, payload SHA-256, UF2 block integrity/family/address
ranges, and exactly one matching bootloader before transferring. It reports
byte progress; a transfer receipt is **not** reboot/reconnection success.
The application must then verify the same physical unit and expected build.

No production signing key or actual board policy is supplied. Never invent
application ranges or bootloader Board-ID values. Application-level signatures
do not make an existing UF2 bootloader enforce secure boot. The public API is
for an independently validated desktop integration, not an installable release.
`platform_roots` supports native Mac/Windows mounts; browser directory pickers
are not presented as automatic firmware updating.

Tests use a fixed **test-only** signing key, synthetic UF2 blocks and temporary
folders. They exercise signature/hash/model/downgrade/family/range rejection,
identity recheck, ambiguous targets, complete byte transfer and refusal to
clobber an existing file. No test writes to a real USB drive.

Primary format source: https://github.com/microsoft/uf2 README, inspected from
its repository during implementation. This implementation deliberately accepts
only 256-byte application blocks with the family-ID flag, rejecting extensions
and file-container flags until explicitly audited.
