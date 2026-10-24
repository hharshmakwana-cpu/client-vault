# Tests

Browser tests for Client Vault. They open the app in Chromium (via Playwright) and click through it
like a person would: demo mode for most screens, and a stand-in for Firebase (`fake-firebase.js`,
which follows the same access rules as `../firebase/firestore.rules`) for sign-up, approvals,
offline saving and two devices editing at once. Nothing touches the real Firebase project.

Run them all from the repository root:

    tests/run.sh

| Test | What it checks |
|---|---|
| features | new filings, due-date extensions, GST invoices, tabs, keyboard shortcuts, phone + desktop layout |
| new-user | welcome screen, short client form, suggested returns, checklist, simpler Settings |
| contacts | contact persons, Income Tax login = PAN, older records upgraded |
| firm-details | separate address / bank fields, their checks, older text split up |
| logo | firm logo in Firm details, invoices, PDF, unlock screen, sidebar |
| screens | every screen opens without errors |
| face-id | Face ID unlock starts by itself only when it should |
| offline | saving offline, uploading later, reopening offline |
| team | sign-up, email verification, owner approval, erase data, delete account |
| conflict | two devices editing the same client — both changes kept |
| audit | every problem from the October 2026 audit stays fixed |
