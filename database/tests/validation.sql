-- Validation suite for a disposable database that already has the schema and
-- reference seeds. This script writes temporary fixture rows and rolls them
-- back. Never run it against production or an unapproved database.
-- Authorization and migration-runner behavior is tested in server/test/.

DROP PROCEDURE IF EXISTS wellexsa_assert_rejected;
DROP PROCEDURE IF EXISTS wellexsa_assert_equal;
DELIMITER //
CREATE PROCEDURE wellexsa_assert_rejected(
  IN p_sql TEXT,
  IN p_label VARCHAR(128),
  IN p_expected_errno INT
)
BEGIN
  DECLARE statement_failed BOOLEAN DEFAULT FALSE;
  DECLARE actual_errno INT DEFAULT 0;
  SET @wellexsa_validation_sql = p_sql;
  PREPARE wellexsa_validation_statement FROM @wellexsa_validation_sql;
  BEGIN
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
    BEGIN
      GET DIAGNOSTICS CONDITION 1 actual_errno = MYSQL_ERRNO;
      SET statement_failed = TRUE;
    END;
    EXECUTE wellexsa_validation_statement;
  END;
  DEALLOCATE PREPARE wellexsa_validation_statement;
  IF statement_failed = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = p_label;
  END IF;
  IF actual_errno <> p_expected_errno THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Statement failed for an unexpected reason.';
  END IF;
END//
CREATE PROCEDURE wellexsa_assert_equal(
  IN p_actual BIGINT,
  IN p_expected BIGINT,
  IN p_label VARCHAR(128)
)
BEGIN
  IF p_actual <> p_expected THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = p_label;
  END IF;
END//
DELIMITER ;

SELECT COUNT(*) INTO @owner_missing_permissions
FROM permissions AS p
JOIN roles AS r ON r.code = 'owner'
WHERE p.code IN (
  'crm.staff.read', 'crm.staff.manage', 'crm.roles.manage',
  'crm.customers.read.assigned', 'crm.customers.read.all', 'crm.customers.create',
  'crm.customers.update.assigned', 'crm.customers.update.all', 'crm.customers.archive',
  'crm.customers.assign', 'crm.customer_links.review',
  'crm.enquiries.read.assigned', 'crm.enquiries.read.all',
  'crm.enquiries.update.assigned', 'crm.enquiries.update.all', 'crm.enquiries.assign',
  'crm.contacts.log.assigned', 'crm.contacts.log.all',
  'crm.followups.read.assigned', 'crm.followups.read.all',
  'crm.followups.create.assigned', 'crm.followups.create.all',
  'crm.followups.update.assigned', 'crm.followups.update.all', 'crm.followups.cancel',
  'crm.sales.read.assigned', 'crm.sales.read.all', 'crm.sales.create',
  'crm.sales.update.assigned', 'crm.sales.update.all', 'crm.sales.archive',
  'catalog.read', 'catalog.manage', 'media.upload', 'media.manage',
  'homepage_slides.manage', 'website_settings.manage', 'business_settings.manage',
  'reports.read', 'activity_logs.read'
)
AND NOT EXISTS (
  SELECT 1
  FROM role_permissions AS rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
CALL wellexsa_assert_equal(
  @owner_missing_permissions, 0, 'Owner role is missing a required permission.'
);

SELECT COUNT(*) INTO @staff_forbidden_permissions
FROM permissions AS p
JOIN roles AS r ON r.code = 'staff'
JOIN role_permissions AS rp ON rp.role_id = r.id AND rp.permission_id = p.id
WHERE p.code IN (
  'crm.staff.manage', 'crm.roles.manage',
  'crm.customers.read.all', 'crm.customers.update.all', 'crm.customers.archive', 'crm.customers.assign',
  'crm.enquiries.read.all', 'crm.enquiries.update.all', 'crm.enquiries.assign',
  'crm.contacts.log.all', 'crm.followups.read.all', 'crm.followups.create.all',
  'crm.followups.update.all', 'crm.sales.read.all', 'crm.sales.update.all', 'crm.sales.archive',
  'catalog.manage', 'media.upload', 'media.manage', 'homepage_slides.manage',
  'website_settings.manage', 'business_settings.manage', 'reports.read', 'activity_logs.read'
);
CALL wellexsa_assert_equal(
  @staff_forbidden_permissions, 0, 'Staff role contains a permission outside its approved scope.'
);

SELECT COUNT(*) INTO @customer_crm_permissions
FROM permissions AS p
JOIN roles AS r ON r.code = 'customer'
JOIN role_permissions AS rp ON rp.role_id = r.id AND rp.permission_id = p.id
WHERE p.code LIKE 'crm.%';
CALL wellexsa_assert_equal(
  @customer_crm_permissions, 0, 'Customer role must not receive CRM permissions.'
);

START TRANSACTION;

SELECT id INTO @staff_role_id FROM roles WHERE code = 'staff';
SELECT id INTO @owner_role_id FROM roles WHERE code = 'owner';
SET @validation_uid = CONCAT('schema-validation-', REPLACE(UUID(), '-', ''));

INSERT INTO users (firebase_uid, display_name, primary_role_id)
VALUES (@validation_uid, 'Validation Staff', @staff_role_id);
SET @staff_user_id = LAST_INSERT_ID();
INSERT INTO staff_profiles (user_id) VALUES (@staff_user_id);

SET @owner_uid = CONCAT('schema-validation-owner-', REPLACE(UUID(), '-', ''));
INSERT INTO users (firebase_uid, display_name, primary_role_id)
VALUES (@owner_uid, 'Validation Owner', @owner_role_id);
SET @owner_user_id = LAST_INSERT_ID();

-- Owners are users but do not need unrelated staff_profiles rows to record sales.
INSERT INTO customers (name, search_name, source, status)
VALUES ('Validation Customer', 'validation customer', 'imported', 'new');
SET @customer_id = LAST_INSERT_ID();

INSERT INTO customers (name, search_name, source, status)
VALUES ('Shared Number Validation Customer', 'shared number validation customer', 'imported', 'new');
SET @shared_customer_id = LAST_INSERT_ID();

-- Identical keyed phone lookups across customers must remain possible for
-- shared family numbers; the encrypted bytes here are non-decryptable fixtures.
INSERT INTO customer_phone_numbers (
  customer_id, phone_ciphertext, encryption_nonce, authentication_tag,
  encryption_key_version, lookup_hmac, lookup_key_version
) VALUES
  (@customer_id, X'01', UNHEX(REPEAT('11', 12)), UNHEX(REPEAT('22', 16)), 1,
    UNHEX(REPEAT('AA', 32)), 1),
  (@shared_customer_id, X'02', UNHEX(REPEAT('33', 12)), UNHEX(REPEAT('44', 16)), 1,
    UNHEX(REPEAT('AA', 32)), 1);
SELECT COUNT(*) INTO @shared_phone_count
FROM customer_phone_numbers
WHERE lookup_key_version = 1 AND lookup_hmac = UNHEX(REPEAT('AA', 32));
CALL wellexsa_assert_equal(
  @shared_phone_count, 2, 'Shared phone lookup across customers was blocked.'
);

-- Two pending follow-ups for one customer must both succeed.
INSERT INTO follow_ups (
  customer_id, assigned_staff_user_id, due_at, status, origin, created_by_user_id
) VALUES
  (@customer_id, @staff_user_id, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY), 'pending', 'new', @staff_user_id),
  (@customer_id, @staff_user_id, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 DAY), 'pending', 'new', @staff_user_id);
SELECT COUNT(*) INTO @pending_follow_up_count
FROM follow_ups WHERE customer_id = @customer_id AND status = 'pending';
CALL wellexsa_assert_equal(
  @pending_follow_up_count, 2, 'Multiple pending follow-ups were not preserved.'
);

INSERT INTO sales (
  record_type, customer_id, recorded_by_user_id, sale_date, currency,
  subtotal, discount_amount, total_amount
) VALUES (
  'new_showroom', @customer_id, @staff_user_id, UTC_TIMESTAMP(6), 'INR', 100.00, 0.00, 100.00
);
SET @sale_id = LAST_INSERT_ID();
INSERT INTO sale_items (
  sale_id, sale_record_type, product_name_snapshot, quantity, unit_price, line_total
) VALUES (@sale_id, 'new_showroom', 'Validation Scooter', 1, 100.00, 100.00);

INSERT INTO sales (
  record_type, customer_id, recorded_by_user_id, sale_date, currency,
  subtotal, discount_amount, total_amount
) VALUES (
  'new_showroom', @customer_id, @owner_user_id, UTC_TIMESTAMP(6), 'INR', 200.00, 0.00, 200.00
);

INSERT INTO sale_requests (
  requesting_user_id, requesting_firebase_uid, request_id, sale_id
) VALUES (@staff_user_id, @validation_uid, 'validation-request-000001', @sale_id);
CALL wellexsa_assert_rejected(
  CONCAT(
    'INSERT INTO sale_requests (requesting_user_id, requesting_firebase_uid, request_id, sale_id) VALUES (',
    @staff_user_id, ', ''', @validation_uid, ''', ''validation-request-000001'', ', @sale_id, ')'
  ),
  'Duplicate sale request ID was accepted.',
  1062
);

INSERT INTO enquiries (
  request_id, record_type, created_at, legacy_source_collection, legacy_document_id
) VALUES (
  'validation-enquiry-token', 'legacy', NULL, 'validation', 'enquiry-one'
);
CALL wellexsa_assert_rejected(
  'INSERT INTO enquiries (request_id, record_type, created_at, legacy_source_collection, legacy_document_id) VALUES (''validation-enquiry-token'', ''legacy'', NULL, ''validation'', ''enquiry-two'')',
  'Duplicate enquiry request ID was accepted.',
  1062
);

-- A historical CRM purchase with unknown date, quantity, price, and currency
-- must be retained without fabricated values.
INSERT INTO sales (record_type) VALUES ('legacy_crm_purchase');
SET @legacy_sale_id = LAST_INSERT_ID();
INSERT INTO sale_items (sale_id, sale_record_type)
VALUES (@legacy_sale_id, 'legacy_crm_purchase');

CALL wellexsa_assert_rejected(
  CONCAT(
    'INSERT INTO users (firebase_uid, display_name, primary_role_id) VALUES (''',
    @validation_uid, ''', ''Duplicate UID'', ', @staff_role_id, ')'
  ),
  'Duplicate Firebase UID was accepted.',
  1062
);

CALL wellexsa_assert_rejected(
  CONCAT(
    'INSERT INTO customer_notes (customer_id, note) VALUES (18446744073709551615, ''bad foreign key'')'
  ),
  'Foreign-key integrity was not enforced.',
  1452
);

CALL wellexsa_assert_rejected(
  CONCAT(
    'INSERT INTO user_permissions (user_id, permission_id, effect, changed_by_user_id) VALUES (',
    @staff_user_id, ', 65535, ''grant'', ', @owner_user_id, ')'
  ),
  'Unknown permission was accepted.',
  1452
);

CALL wellexsa_assert_rejected(
  CONCAT(
    'INSERT INTO sale_items (sale_id, sale_record_type, product_name_snapshot, quantity, unit_price, line_total) ',
    'VALUES (', @sale_id, ', ''new_showroom'', ''Invalid quantity'', 0, 100.00, 0.00)'
  ),
  'Non-positive sale quantity was accepted.',
  3819
);

CALL wellexsa_assert_rejected(
  CONCAT(
    'INSERT INTO sale_items (sale_id, sale_record_type, product_name_snapshot, quantity, unit_price, line_total) ',
    'VALUES (', @sale_id, ', ''new_showroom'', ''Missing price'', 1, NULL, NULL)'
  ),
  'Missing price on a new sale item was accepted.',
  3819
);

CALL wellexsa_assert_rejected(
  CONCAT(
    'INSERT INTO sales (record_type, customer_id, recorded_by_user_id, sale_date, currency, ',
    'subtotal, discount_amount, total_amount) VALUES (''new_showroom'', ', @customer_id, ', ',
    @staff_user_id, ', UTC_TIMESTAMP(6), ''INR'', 100.00, 0.00, 99.00)'
  ),
  'Inconsistent sale total was accepted.',
  3819
);

CALL wellexsa_assert_rejected(
  CONCAT('DELETE FROM customers WHERE id = ', @customer_id),
  'Deletion of a customer with historical records was accepted.',
  1451
);

-- A single primary role is represented by users.primary_role_id; no user_roles
-- junction is part of this design.
SELECT COUNT(*) INTO @user_roles_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'user_roles';
CALL wellexsa_assert_equal(
  @user_roles_table_count, 0, 'Unexpected multiple-role junction table exists.'
);

ROLLBACK;
DROP PROCEDURE IF EXISTS wellexsa_assert_equal;
DROP PROCEDURE IF EXISTS wellexsa_assert_rejected;
