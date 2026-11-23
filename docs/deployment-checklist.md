# Deployment readiness checklist

This is a checklist only. Nothing here has been deployed.

## Before any deployment

- [ ] Approve the MySQL schema, checksum history, role-permission seed, and Owner/Staff provisioning process.
- [ ] Validate key provisioning, backup, rotation, and re-encryption procedures for phone data; the current API has no phone decryption/read endpoint.
- [ ] Implement and test all required CRM API routes and frontend replacements.
- [ ] Test against a disposable MySQL 8.0.42 database and restore a backup to verify recovery.
- [ ] Verify `wellexsa_app` has only runtime CRUD privileges and migration credentials are stored outside source control.
- [ ] Configure production secrets through the approved secret manager; never upload `.env` files.
- [ ] Configure trusted HTTPS origins, rate limiting with a shared store, request monitoring, and safe log retention.
- [ ] Review Firebase Auth token verification, email verification, account status, and server-side authorization end-to-end.
- [ ] Confirm CORS, Helmet headers, input validation, parameterized SQL, transaction rollback, and audit-log behavior.
- [ ] Review privacy, retention, legal terms, incident response, and operator access.
- [ ] Obtain explicit approval for data migration and deployment.

## Prohibited until separately approved

- [ ] Do not deploy Firebase Functions, rules, hosting, or the Express API.
- [ ] Do not enable billing or change Firebase production settings.
- [ ] Do not migrate, delete, or rewrite live Firestore data.
- [ ] Do not run schema migrations or seeds against production.
- [ ] Do not retire existing Firebase Functions or frontend functionality.
