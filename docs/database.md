# MySQL database operations

## Scope and permissions

The Express application uses the dedicated `wellexsa_app` account for runtime CRUD only. The migration runner uses separate `MYSQL_MIGRATION_USER` and `MYSQL_MIGRATION_PASSWORD` credentials. Never use a MySQL administrator account in the application.

The schema is MySQL 8.0.16+ compatible by declaration and is targeted at MySQL 8.0.42. Compatibility has not been verified by executing migrations in this task.

## Explicit migration process

From Windows CMD:

```cmd
cd /d C:\Users\COMP\Desktop\Wellexsa\server
copy .env.migrations.example .env.migrations
notepad .env.migrations
npm run db:migrate -- --confirm-database wellexsa
```

The runner only reads `database/migrations/`; it does not apply seeds. It checks the server version, schema-migrations table shape, consecutive history, and SHA-256 checksums. A `running`, `failed`, empty pre-existing ledger, checksum mismatch, or untracked table blocks automatic continuation. MySQL DDL may commit statement-by-statement: inspect the target schema manually after a blocked/failed run. Do not delete a migration history row to force a rerun.

The runner has not been integration-tested against MySQL. Do not run it until the migration account, database target, backup, and schema review are confirmed.

## Disposable MySQL integration test preparation

The integration suite is opt-in and separate from `npm test`. It accepts only MySQL on `127.0.0.1`, a database named `wellexsa_it_<unique-lowercase-suffix>`, an explicit matching `WELLEXSA_TEST_DATABASE`, and a dedicated `wellexsa_it_*` application account. It checks the selected database and complete migration checksums before inserting one temporary Owner fixture; it removes that fixture afterward. It injects a local token verifier and does not contact Firebase. It does not create/drop databases, run migrations, or apply seeds.

Use a unique disposable schema name for each run, for example `wellexsa_it_20261123_1752`. Never substitute `wellexsa`, reuse the application/production account, or point the test file at a remote server. The migration runner itself accepts any database name, so the exact `--confirm-database` value and the integration suite's additional guards are both important.

After explicit approval, an administrator can create the isolated schema and two separate local accounts. MySQL prints the generated passwords; store them only in the ignored local `.env.integration` file and a password manager. Do not paste them into chat or source control.

```sql
CREATE DATABASE wellexsa_it_20261123_1752
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'wellexsa_it_app'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
CREATE USER 'wellexsa_it_migrator'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD;
GRANT SELECT, INSERT, UPDATE, DELETE ON wellexsa_it_20261123_1752.* TO 'wellexsa_it_app'@'127.0.0.1';
GRANT CREATE, REFERENCES, SELECT, INSERT, UPDATE ON wellexsa_it_20261123_1752.* TO 'wellexsa_it_migrator'@'127.0.0.1';
SHOW GRANTS FOR 'wellexsa_it_app'@'127.0.0.1';
SHOW GRANTS FOR 'wellexsa_it_migrator'@'127.0.0.1';
```

In Command Prompt, copy the ignored integration environment example, replace the database name in both database fields with the exact unique name above, enter the generated passwords locally, and leave the integration opt-in disabled until the database, schema, and seed are approved:

```cmd
cd /d C:\Users\COMP\Desktop\Wellexsa\server
copy .env.integration.example .env.integration
notepad .env.integration
```

Only after reviewing the target and approving schema changes, run the migration explicitly. This command applies schema DDL only to the exact test database confirmed on the command line:

```cmd
node --env-file=.env.integration scripts/migrate.js --confirm-database wellexsa_it_20261123_1752
```

Only after separately approving the seed, apply reference data to that same test schema:

```cmd
mysql --host=127.0.0.1 --port=3306 --user=wellexsa_it_migrator --password --database=wellexsa_it_20261123_1752 < ..\database\seeds\001_reference_data.sql
```

The existing `database/tests/validation.sql` creates and drops helper procedures, runs constraint checks, and rolls back its fixture transaction. It is not safe for a production schema. If it is approved for the disposable schema, use a temporary validator account with only that schema's `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE ROUTINE`, `ALTER ROUTINE`, and `EXECUTE` privileges; do not broaden the app account.

Then run the separate HTTP/API smoke suite:

```cmd
npm run test:integration
```

After approval, set `WELLEXSA_INTEGRATION_TESTS=YES` in `.env.integration`, then run this command. It uses the real local MySQL pool for schema/seed checks and API reads, creates and removes a unique test Owner profile, rejects non-loopback or non-`wellexsa_it_*` targets before connecting, and uses a fake local bearer-token verifier rather than Firebase. `npm test` remains the mock-based unit suite and does not need `.env.integration`.

No commands in this section have been executed. Keep the disposable database until test results are reviewed; any eventual schema/user cleanup is a separate destructive operation and should be approved separately.

## Seeds and validation

`database/seeds/001_reference_data.sql` defines roles, permission codes, and role grants. It is not applied by the migration runner or API startup. Review the role matrix before explicitly applying it.

`database/tests/validation.sql` creates and drops named helper procedures and writes temporary fixtures inside a transaction. Run it only against a disposable test database after schema and seed setup.

## Data handling

Customer and enquiry phone columns use application-level AES-256-GCM encryption and a separate HMAC-SHA-256 lookup key. The public enquiry endpoint stores encrypted phone data only; no API response includes ciphertext or an encryption key. Customer phone management, authorized phone decryption, and key re-encryption/rotation jobs are not implemented.

The local server reads versioned keys from `server/.env`:

```text
PHONE_ENCRYPTION_ACTIVE_VERSION=1
PHONE_ENCRYPTION_KEYS_JSON={"1":"<base64-key>"}
PHONE_LOOKUP_ACTIVE_VERSION=1
PHONE_LOOKUP_KEYS_JSON={"1":"<different-base64-key>"}
```

Generate two independent 32-byte keys in CMD with Node 22:

```cmd
cd /d C:\Users\COMP\Desktop\Wellexsa\server
node -e "const c=require('node:crypto');console.log(JSON.stringify({encryption:c.randomBytes(32).toString('base64'),lookup:c.randomBytes(32).toString('base64')}))"
```

Copy each generated value into its respective JSON key ring in the ignored `server/.env`; do not put real keys in `.env.example`, source code, documentation, or commits. The `.env.example` values are intentionally invalid placeholders. For managed environments, use an approved secret manager instead of uploading `.env`.

During rotation, retain old encryption and lookup key versions in their respective key rings and switch only the active version after deployment of the new key. Removing an old encryption key before a separately planned re-encryption process makes existing ciphertext unreadable. The current API does not expose decryption or perform data re-encryption.

The schema records timestamps in `DATETIME(6)` and migration/seed sessions set UTC. API queries and writes must continue to use UTC; convert to `Asia/Kolkata` only for display.
