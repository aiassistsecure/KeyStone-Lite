# Windows Code Signing — Keystone Lite

Status: **cert purchased, awaiting issuance** (Certum Open Source Code
Signing in the Cloud, order ZoZE/023004/EU/11/07/2026, 2026-07-10).
macOS signing is unaffected — electron-builder auto-discovers the
Developer ID identity in the Keychain, as it always has.

## How Windows signing works here

- Cert: Certum **Open Source Code Signing in the Cloud** (SimplySign).
  The private key lives in Certum's cloud HSM; **SimplySign Desktop**
  mounts it locally as a virtual smartcard, which puts the certificate
  in the Windows certificate store where `signtool.exe` (and therefore
  electron-builder) finds it by subject name.
- Unsigned is the intentional default until the cert is active:
  electron-builder skips real signing when no certificate is configured
  (the `signing with signtool.exe` lines in an unconfigured build are
  resource/integrity passes — `Get-AuthenticodeSignature` shows
  `NotSigned`).

## Activation checklist (once Certum issues the cert)

1. Install **SimplySign Desktop** on the build machine and log in —
   verify the cert appears: `certutil -user -store My` (note the exact
   **Subject CN**, it will carry the developer name, not the company —
   that is expected for the Open Source cert class).
2. Add to the `"win"` block of `package.json` → `"build"`:

   ```json
   "win": {
     "certificateSubjectName": "<EXACT SUBJECT CN FROM THE CERT>",
     "rfc3161TimeStampServer": "http://time.certum.pl",
     "signingHashAlgorithms": ["sha256"]
   }
   ```

3. Keep SimplySign Desktop running (it prompts its mobile-app OTP for
   signing operations), then `npm run dist`.
4. Verify — every shipped exe should now show a real signature:

   ```powershell
   Get-AuthenticodeSignature 'release\win-unpacked\Keystone Lite.exe' |
     Format-List Status,SignerCertificate
   # Expect: Status : Valid
   ```

   electron-builder signs the app exe AND the unpacked native helpers
   (node-pty's winpty-agent/OpenConsole, nedbd-v2-win-x64.exe) — all of
   them should report Valid.

## Notes

- **Timestamping matters**: the `rfc3161TimeStampServer` line means
  signatures stay valid after the cert itself expires. Never sign
  without it.
- **Reputation accrues per certificate** — renew the same cert line
  rather than switching CAs casually; each new cert restarts SmartScreen
  reputation from zero.
- Build-machine prerequisites for native modules (discovered the hard
  way, 2026-07-10): VS 2022 Build Tools with the C++ workload, a
  Windows 10/11 SDK, **and** the "MSVC v143 Spectre-mitigated libs"
  individual component (node-pty's projects require Spectre-mitigated
  runtimes — MSB8040 if missing).
- Company-branded signing (certificate reading "Interchained LLC")
  is a separate future track: Azure Artifact Signing (~$10/mo, org
  validation) or SSL.com eSigner. The OSS cert covers Keystone-Lite
  as an open-source product today.
