# Firebase CRM migration plan

## Current state

- Firebase Authentication remains the identity provider.
- Existing CRM pages and CRM Functions continue to use their current Firebase/Firestore behavior.
- The new Express API verifies Firebase ID tokens and maps the verified UID to a MySQL user. A first-time sync can create only a Customer profile; it cannot assign Owner or Staff.
- No Firestore data is copied, deleted, or modified by the Express API.

## Safe cutover sequence

1. Review and apply the MySQL schema and reference seed only through approved local/test procedures.
2. Provision Owner and Staff identities server-side; never accept role values from browser requests.
3. Implement and test replacement API operations for customer assignment, enquiry/history, follow-ups, offline sales, catalogue, staff, slides, settings, and activity logs.
4. Build a read-only reconciliation/export process and validate UID and historical-record mappings on a disposable copy. Do not write to or delete Firebase production data.
5. Test authentication, authorization, assignment scoping, error handling, retries, and rollback behavior against local/test resources.
6. Obtain explicit approval before migrating real data, changing production clients, or deploying.
7. Keep existing Functions and Firestore rules until replacement parity, backup, and rollback have been verified and separately approved.

## Retire only after approved cutover

The existing CRM callables, Firestore collections/rules, Firebase CRM configuration, and frontend `httpsCallable`/Firestore code are not retired by this project change. Any future retirement requires a reviewed inventory, validated data export, successful replacement testing, and explicit deployment approval.
