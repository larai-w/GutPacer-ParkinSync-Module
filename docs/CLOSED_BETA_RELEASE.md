# GutPacer closed-beta release

GutPacer's next release boundary is an invited 3–5 household closed beta, not public self-service
general availability.

## Release gates

- LINE ID tokens are verified before DynamoDB access.
- Existing profiles are allowed. A new household must provide the operator-issued one-time
  onboarding code, which is compared to `INVITE_CODE_HASH`, or be explicitly pre-registered through
  `INVITED_USER_IDS`. Other valid LINE users receive `403 Invite required` without a profile being
  created. The plaintext onboarding code is not committed or stored in the browser.
- All log operations derive the partition from the verified subject.
- Existing single-household records are copied without overwriting any record already created in
  the v2 table; legacy tables remain available for rollback.
- The notifier reads each profile and sends only to that profile's verified LINE subject. One
  household failure does not stop processing of the others, and the Lambda run still fails so its
  CloudWatch alarm can report partial failure.
- Privacy policy, terms, contact, and the 30-day deletion-request policy are linked from the app.
- `npm test` and the public-repository guard pass.

## Owner approvals and external gates

The following are intentionally not automatic:

1. Generate an onboarding code and place only its SHA-256 value in the Lambda `INVITE_CODE_HASH`
   environment variable. Rotate it after the invited households have joined. Pre-registration via
   `INVITED_USER_IDS` remains available when a subject is already known. Treat all values as private
   operational data and never commit them.
2. Run the migration dry-run, review its counts, then run `--execute` and verify readback.
3. Manually run `Deploy GutPacer closed beta` for `api-dev` and then `notifier`.
4. Confirm the development Mini App on a real phone: login, read, create, edit, delete, PDF, logout,
   location switch, and notification destination.
5. Promote the LINE Mini App environment and change the public product status only after the owner
   explicitly approves publication.

## Rollback

- Keep `gutpacer-logs`, `gutpacer-settings`, and the current PIN Lambda unchanged during beta.
- If the LINE beta fails, point the beta frontend back to the PIN API or restore the previous Lambda
  code version. Do not delete v2 tables or legacy tables during rollback.
- Disable the EventBridge notifier target before reverting notifier code if notification routing is
  suspect.
- Migration is additive. Re-running it skips existing v2 dates; it never overwrites beta-created
  records or an existing profile.

## Go/no-go evidence

Record only aggregate evidence in public issues: test totals, migrated counts, number of invited
households, and pass/fail. Never publish LINE subjects, household data, notes, or health records.
