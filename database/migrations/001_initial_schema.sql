-- WELLEXSA MySQL schema. Requires MySQL 8.0.16+.
-- Do not run until the schema and permission matrix are approved.
-- Requires 000_schema_migrations.sql; run through a checksum-aware migration runner.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE roles (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code),
  CONSTRAINT chk_roles_code CHECK (code REGEXP '^[a-z][a-z0-9_]{1,31}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE permissions (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code),
  CONSTRAINT chk_permissions_code CHECK (code REGEXP '^[a-z][a-z0-9._]{1,99}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  firebase_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  email VARCHAR(254) NULL,
  display_name VARCHAR(100) NOT NULL DEFAULT '',
  email_verified_at DATETIME(6) NULL,
  primary_role_id SMALLINT UNSIGNED NOT NULL,
  account_status ENUM('active', 'disabled', 'suspended') NOT NULL DEFAULT 'active',
  last_login_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_firebase_uid (firebase_uid),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_role_status (primary_role_id, account_status),
  CONSTRAINT fk_users_primary_role FOREIGN KEY (primary_role_id) REFERENCES roles (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_users_firebase_uid CHECK (CHAR_LENGTH(firebase_uid) BETWEEN 1 AND 128)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_permissions (
  role_id SMALLINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  granted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  granted_by_user_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY ix_role_permissions_permission (permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_role_permissions_granted_by FOREIGN KEY (granted_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  effect ENUM('grant', 'deny') NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, permission_id),
  KEY ix_user_permissions_permission (permission_id),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_user_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_user_permissions_changed_by FOREIGN KEY (changed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE staff_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  employee_code VARCHAR(64) NULL,
  employment_status ENUM('active', 'on_leave', 'terminated') NOT NULL DEFAULT 'active',
  title VARCHAR(100) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_staff_profiles_employee_code (employee_code),
  CONSTRAINT fk_staff_profiles_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NULL,
  search_name VARCHAR(100) NULL,
  email VARCHAR(254) NULL,
  customer_type ENUM('new', 'existing') NULL DEFAULT 'new',
  source ENUM('showroom', 'website', 'website_enquiry', 'imported') NULL,
  source_firebase_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  status ENUM('new', 'active', 'not_interested', 'purchased') NULL DEFAULT 'new',
  interest_status ENUM(
    'Very Interested', 'Interested', 'Need More Time', 'Not Interested', 'Already Purchased'
  ) NULL,
  call_status ENUM('Answered', 'Not Answered', 'Switched Off', 'Busy', 'Wrong Number') NULL,
  interested_bike VARCHAR(100) NULL,
  assigned_staff_user_id BIGINT UNSIGNED NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at DATETIME(6) NULL,
  archived_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_customers_assigned_status (assigned_staff_user_id, is_archived, status, id),
  KEY ix_customers_search_name (search_name),
  KEY ix_customers_created_at (created_at, id),
  KEY ix_customers_source_uid (source_firebase_uid),
  CONSTRAINT fk_customers_assigned_staff FOREIGN KEY (assigned_staff_user_id)
    REFERENCES staff_profiles (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_customers_archived_by FOREIGN KEY (archived_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_customers_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer_phone_numbers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  phone_ciphertext VARBINARY(512) NOT NULL,
  encryption_nonce BINARY(12) NOT NULL,
  authentication_tag BINARY(16) NOT NULL,
  encryption_key_version SMALLINT UNSIGNED NOT NULL,
  phone_is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  lookup_hmac BINARY(32) NULL,
  lookup_key_version SMALLINT UNSIGNED NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  primary_customer_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(is_primary = TRUE, customer_id, NULL)) STORED,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  shared_number_status ENUM('unreviewed', 'approved_shared') NOT NULL DEFAULT 'unreviewed',
  shared_reviewed_by_user_id BIGINT UNSIGNED NULL,
  shared_reviewed_at DATETIME(6) NULL,
  shared_review_note VARCHAR(500) NULL,
  verified_at DATETIME(6) NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_phone_primary (primary_customer_id),
  UNIQUE KEY uq_customer_phone_hmac (customer_id, lookup_hmac, lookup_key_version),
  KEY ix_customer_phone_lookup (lookup_key_version, lookup_hmac, is_active),
  KEY ix_customer_phone_customer_active (customer_id, is_active),
  CONSTRAINT fk_customer_phones_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_customer_phones_reviewed_by FOREIGN KEY (shared_reviewed_by_user_id)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_customer_phone_key_versions CHECK (
    encryption_key_version > 0 AND
    ((phone_is_valid = TRUE AND lookup_hmac IS NOT NULL AND lookup_key_version > 0) OR
      (phone_is_valid = FALSE AND lookup_hmac IS NULL AND lookup_key_version IS NULL))
  ),
  CONSTRAINT chk_customer_phone_shared_review CHECK (
    (shared_number_status = 'unreviewed' AND shared_reviewed_by_user_id IS NULL AND shared_reviewed_at IS NULL) OR
    (shared_number_status = 'approved_shared' AND shared_reviewed_by_user_id IS NOT NULL AND
      shared_reviewed_at IS NOT NULL AND shared_review_note IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer_user_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'verified', 'revoked') NOT NULL DEFAULT 'pending',
  ownership_verified_at DATETIME(6) NULL,
  verified_by_user_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_user_link (customer_id, user_id),
  KEY ix_customer_user_links_user_status (user_id, status),
  CONSTRAINT fk_customer_user_links_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_customer_user_links_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_customer_user_links_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_customer_user_links_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_customer_user_link_verified CHECK (
    (status = 'verified' AND ownership_verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL) OR
    (status <> 'verified' AND ownership_verified_at IS NULL AND verified_by_user_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(50) NULL,
  address_line_1 VARCHAR(200) NOT NULL,
  address_line_2 VARCHAR(200) NULL,
  city VARCHAR(100) NOT NULL,
  state_or_region VARCHAR(100) NULL,
  postal_code VARCHAR(24) NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'IN',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_customer_addresses_customer (customer_id, is_primary),
  CONSTRAINT fk_customer_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_customer_address_country CHECK (country_code REGEXP '^[A-Z]{2}$')
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE customer_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NULL,
  note TEXT NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_notes_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_customer_notes_customer_date (customer_id, created_at, id),
  CONSTRAINT fk_customer_notes_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_customer_notes_author FOREIGN KEY (author_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_customer_notes_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE lead_intakes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_firebase_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  name VARCHAR(100) NULL,
  email VARCHAR(254) NULL,
  phone_ciphertext VARBINARY(512) NULL,
  encryption_nonce BINARY(12) NULL,
  authentication_tag BINARY(16) NULL,
  encryption_key_version SMALLINT UNSIGNED NULL,
  phone_is_valid BOOLEAN NOT NULL DEFAULT FALSE,
  phone_lookup_hmac BINARY(32) NULL,
  lookup_key_version SMALLINT UNSIGNED NULL,
  matched_customer_id BIGINT UNSIGNED NULL,
  assigned_staff_user_id BIGINT UNSIGNED NULL,
  status ENUM('needs_review', 'resolved') NOT NULL DEFAULT 'needs_review',
  reason VARCHAR(64) NULL,
  resolved_customer_id BIGINT UNSIGNED NULL,
  resolved_by_user_id BIGINT UNSIGNED NULL,
  resolved_at DATETIME(6) NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_intakes_source_uid (source_firebase_uid),
  UNIQUE KEY uq_lead_intakes_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_lead_intakes_staff_status (assigned_staff_user_id, status, created_at, id),
  KEY ix_lead_intakes_phone_lookup (lookup_key_version, phone_lookup_hmac),
  CONSTRAINT fk_lead_intakes_matched_customer FOREIGN KEY (matched_customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lead_intakes_resolved_customer FOREIGN KEY (resolved_customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lead_intakes_assigned_staff FOREIGN KEY (assigned_staff_user_id)
    REFERENCES staff_profiles (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lead_intakes_resolved_by FOREIGN KEY (resolved_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_lead_intake_phone_encryption CHECK (
    (phone_ciphertext IS NULL AND encryption_nonce IS NULL AND authentication_tag IS NULL AND
      encryption_key_version IS NULL) OR
    (phone_ciphertext IS NOT NULL AND encryption_nonce IS NOT NULL AND authentication_tag IS NOT NULL AND
      encryption_key_version IS NOT NULL)
  ),
  CONSTRAINT chk_lead_intake_phone_lookup CHECK (
    (phone_is_valid = FALSE AND phone_lookup_hmac IS NULL AND lookup_key_version IS NULL) OR
    (phone_is_valid = TRUE AND phone_ciphertext IS NOT NULL AND phone_lookup_hmac IS NOT NULL AND
      lookup_key_version IS NOT NULL)
  ),
  CONSTRAINT chk_lead_intake_resolution CHECK (
    (status = 'needs_review' AND resolved_customer_id IS NULL AND resolved_by_user_id IS NULL AND resolved_at IS NULL) OR
    (status = 'resolved' AND resolved_customer_id IS NOT NULL AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT chk_lead_intake_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bike_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bike_categories_name (name),
  UNIQUE KEY uq_bike_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bike_brands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bike_brands_name (name),
  UNIQUE KEY uq_bike_brands_slug (slug)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE media_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  storage_provider VARCHAR(40) NOT NULL,
  container_name VARCHAR(128) NOT NULL,
  object_key VARBINARY(1024) NOT NULL,
  access_level ENUM('public', 'private') NOT NULL,
  public_url VARCHAR(2048) NULL,
  original_filename VARCHAR(255) NULL,
  mime_type VARCHAR(127) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  sha256_checksum BINARY(32) NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  status ENUM('pending', 'active', 'replaced', 'deleted', 'orphaned') NOT NULL DEFAULT 'pending',
  replaced_by_media_asset_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_media_object (storage_provider, container_name, object_key),
  KEY ix_media_assets_status_created (status, created_at),
  KEY ix_media_assets_owner_status (owner_user_id, status),
  CONSTRAINT fk_media_assets_owner FOREIGN KEY (owner_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_media_assets_replacement FOREIGN KEY (replaced_by_media_asset_id) REFERENCES media_assets (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_media_assets_size CHECK (byte_size > 0),
  CONSTRAINT chk_media_assets_private_url CHECK (access_level <> 'private' OR public_url IS NULL)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bikes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  model VARCHAR(150) NULL,
  brand_id BIGINT UNSIGNED NULL,
  category_id BIGINT UNSIGNED NULL,
  price DECIMAL(12,2) NULL,
  short_description VARCHAR(500) NULL,
  description TEXT NULL,
  stock_quantity INT UNSIGNED NULL,
  status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bikes_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_bikes_public_catalog (status, brand_id, category_id, id),
  KEY ix_bikes_model (model),
  CONSTRAINT fk_bikes_brand FOREIGN KEY (brand_id) REFERENCES bike_brands (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_bikes_category FOREIGN KEY (category_id) REFERENCES bike_categories (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_bikes_price CHECK (price IS NULL OR price >= 0),
  CONSTRAINT chk_bikes_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bike_specifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bike_id BIGINT UNSIGNED NOT NULL,
  specification_name VARCHAR(100) NOT NULL,
  specification_value TEXT NOT NULL,
  unit VARCHAR(40) NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bike_specification_name (bike_id, specification_name),
  KEY ix_bike_specifications_order (bike_id, display_order),
  CONSTRAINT fk_bike_specifications_bike FOREIGN KEY (bike_id) REFERENCES bikes (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bike_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bike_id BIGINT UNSIGNED NOT NULL,
  media_asset_id BIGINT UNSIGNED NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bike_image_asset (bike_id, media_asset_id),
  UNIQUE KEY uq_bike_image_order (bike_id, display_order),
  KEY ix_bike_images_media (media_asset_id),
  CONSTRAINT fk_bike_images_bike FOREIGN KEY (bike_id) REFERENCES bikes (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_bike_images_media FOREIGN KEY (media_asset_id) REFERENCES media_assets (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE homepage_slides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(160) NOT NULL,
  description VARCHAR(1000) NULL,
  button_text VARCHAR(100) NULL,
  button_url VARCHAR(2048) NULL,
  media_asset_id BIGINT UNSIGNED NULL,
  display_order INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_active BOOLEAN NULL,
  status ENUM('published', 'draft') NOT NULL DEFAULT 'draft',
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_homepage_slides_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_homepage_slides_public (status, enabled, display_order, id),
  CONSTRAINT fk_homepage_slides_media FOREIGN KEY (media_asset_id) REFERENCES media_assets (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_homepage_slide_image CHECK (status <> 'published' OR media_asset_id IS NOT NULL),
  CONSTRAINT chk_homepage_slides_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE website_settings (
  setting_key VARCHAR(128) NOT NULL,
  setting_value JSON NOT NULL,
  visibility ENUM('public', 'private') NOT NULL DEFAULT 'private',
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_website_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE business_settings (
  setting_key VARCHAR(128) NOT NULL,
  setting_value JSON NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_business_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE enquiries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(128) NOT NULL,
  record_type ENUM('public', 'legacy') NOT NULL DEFAULT 'public',
  customer_id BIGINT UNSIGNED NULL,
  customer_name_snapshot VARCHAR(100) NULL,
  customer_email VARCHAR(254) NULL,
  phone_ciphertext VARBINARY(512) NULL,
  encryption_nonce BINARY(12) NULL,
  authentication_tag BINARY(16) NULL,
  encryption_key_version SMALLINT UNSIGNED NULL,
  phone_lookup_hmac BINARY(32) NULL,
  lookup_key_version SMALLINT UNSIGNED NULL,
  bike_id BIGINT UNSIGNED NULL,
  bike_model_snapshot VARCHAR(150) NULL,
  assigned_staff_user_id BIGINT UNSIGNED NULL,
  status ENUM('new', 'contacted', 'converted', 'closed') NOT NULL DEFAULT 'new',
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_enquiries_request_id (request_id),
  UNIQUE KEY uq_enquiries_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_enquiries_staff_status_created (assigned_staff_user_id, status, created_at, id),
  KEY ix_enquiries_customer_created (customer_id, created_at, id),
  KEY ix_enquiries_phone_lookup (lookup_key_version, phone_lookup_hmac),
  CONSTRAINT fk_enquiries_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_enquiries_bike FOREIGN KEY (bike_id) REFERENCES bikes (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_enquiries_assigned_staff FOREIGN KEY (assigned_staff_user_id)
    REFERENCES staff_profiles (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_enquiries_public_request_id CHECK (
    record_type = 'legacy' OR
    request_id REGEXP '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
  ),
  CONSTRAINT chk_enquiries_phone_encryption CHECK (
    (phone_ciphertext IS NULL AND encryption_nonce IS NULL AND authentication_tag IS NULL AND
      encryption_key_version IS NULL) OR
    (phone_ciphertext IS NOT NULL AND encryption_nonce IS NOT NULL AND authentication_tag IS NOT NULL AND
      encryption_key_version IS NOT NULL)
  ),
  CONSTRAINT chk_enquiries_phone_lookup CHECK (
    (phone_lookup_hmac IS NULL AND lookup_key_version IS NULL) OR
    (phone_lookup_hmac IS NOT NULL AND lookup_key_version IS NOT NULL)
  ),
  CONSTRAINT chk_public_enquiry_phone CHECK (
    record_type = 'legacy' OR
    (phone_ciphertext IS NOT NULL AND phone_lookup_hmac IS NOT NULL AND lookup_key_version IS NOT NULL)
  ),
  CONSTRAINT chk_enquiries_phone_key_version CHECK (
    encryption_key_version IS NULL OR encryption_key_version > 0
  ),
  CONSTRAINT chk_enquiries_lookup_key_version CHECK (
    lookup_key_version IS NULL OR lookup_key_version > 0
  ),
  CONSTRAINT chk_public_enquiry_required_fields CHECK (
    record_type = 'legacy' OR
    (customer_name_snapshot IS NOT NULL AND bike_model_snapshot IS NOT NULL AND created_at IS NOT NULL)
  ),
  CONSTRAINT chk_enquiries_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE enquiry_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enquiry_id BIGINT UNSIGNED NOT NULL,
  from_status ENUM('new', 'contacted', 'converted', 'closed') NULL,
  to_status ENUM('new', 'contacted', 'converted', 'closed') NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NULL,
  changed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_enquiry_status_history (enquiry_id, changed_at, id),
  CONSTRAINT fk_enquiry_status_history_enquiry FOREIGN KEY (enquiry_id) REFERENCES enquiries (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_enquiry_status_history_user FOREIGN KEY (changed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE contact_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  origin ENUM('new', 'legacy') NOT NULL DEFAULT 'new',
  customer_id BIGINT UNSIGNED NOT NULL,
  enquiry_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_name_snapshot VARCHAR(100) NULL,
  channel ENUM('call', 'whatsapp', 'sms', 'email', 'in_person', 'other') NOT NULL,
  call_status ENUM('Answered', 'Not Answered', 'Switched Off', 'Busy', 'Wrong Number') NULL,
  interest_status ENUM(
    'Very Interested', 'Interested', 'Need More Time', 'Not Interested', 'Already Purchased'
  ) NULL,
  notes TEXT NULL,
  contacted_at DATETIME(6) NULL,
  legacy_next_follow_up_at DATETIME(6) NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contact_events_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_contact_events_customer_date (customer_id, contacted_at, id),
  KEY ix_contact_events_actor_date (actor_user_id, contacted_at, id),
  CONSTRAINT fk_contact_events_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_contact_events_enquiry FOREIGN KEY (enquiry_id) REFERENCES enquiries (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_contact_events_actor FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_new_contact_event_required CHECK (
    origin = 'legacy' OR
    (actor_user_id IS NOT NULL AND contacted_at IS NOT NULL AND call_status IS NOT NULL AND
      interest_status IS NOT NULL AND interest_status <> 'Already Purchased')
  ),
  CONSTRAINT chk_contact_events_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE follow_ups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  enquiry_id BIGINT UNSIGNED NULL,
  assigned_staff_user_id BIGINT UNSIGNED NULL,
  due_at DATETIME(6) NULL,
  status ENUM('pending', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  origin ENUM('new', 'legacy') NOT NULL DEFAULT 'new',
  created_by_user_id BIGINT UNSIGNED NULL,
  completed_by_user_id BIGINT UNSIGNED NULL,
  completed_at DATETIME(6) NULL,
  cancelled_by_user_id BIGINT UNSIGNED NULL,
  cancelled_at DATETIME(6) NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_follow_ups_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_follow_ups_staff_due (assigned_staff_user_id, status, due_at, id),
  KEY ix_follow_ups_customer_status_due (customer_id, status, due_at, id),
  KEY ix_follow_ups_enquiry (enquiry_id, status, due_at),
  CONSTRAINT fk_follow_ups_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_ups_enquiry FOREIGN KEY (enquiry_id) REFERENCES enquiries (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_ups_assigned_staff FOREIGN KEY (assigned_staff_user_id)
    REFERENCES staff_profiles (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_ups_created_by FOREIGN KEY (created_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_ups_completed_by FOREIGN KEY (completed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_ups_cancelled_by FOREIGN KEY (cancelled_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_new_follow_up_required_fields CHECK (
    origin = 'legacy' OR
    (assigned_staff_user_id IS NOT NULL AND due_at IS NOT NULL AND created_by_user_id IS NOT NULL AND
      created_at IS NOT NULL)
  ),
  CONSTRAINT chk_follow_up_completion CHECK (
    status <> 'completed' OR origin = 'legacy' OR
    (completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL)
  ),
  CONSTRAINT chk_follow_up_cancellation CHECK (
    status <> 'cancelled' OR origin = 'legacy' OR
    (cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL)
  ),
  CONSTRAINT chk_follow_up_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE follow_up_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  follow_up_id BIGINT UNSIGNED NOT NULL,
  change_type ENUM('created', 'rescheduled', 'reassigned', 'status_changed') NOT NULL,
  old_due_at DATETIME(6) NULL,
  new_due_at DATETIME(6) NULL,
  old_assigned_staff_user_id BIGINT UNSIGNED NULL,
  new_assigned_staff_user_id BIGINT UNSIGNED NULL,
  old_status ENUM('pending', 'completed', 'cancelled') NULL,
  new_status ENUM('pending', 'completed', 'cancelled') NULL,
  changed_by_user_id BIGINT UNSIGNED NULL,
  changed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_follow_up_history_follow_up (follow_up_id, changed_at, id),
  CONSTRAINT fk_follow_up_history_follow_up FOREIGN KEY (follow_up_id) REFERENCES follow_ups (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_up_history_old_assignee FOREIGN KEY (old_assigned_staff_user_id)
    REFERENCES staff_profiles (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_up_history_new_assignee FOREIGN KEY (new_assigned_staff_user_id)
    REFERENCES staff_profiles (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_follow_up_history_actor FOREIGN KEY (changed_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  record_type ENUM('new_showroom', 'legacy_crm_purchase') NOT NULL DEFAULT 'new_showroom',
  customer_id BIGINT UNSIGNED NULL,
  customer_phone_number_id BIGINT UNSIGNED NULL,
  customer_name_snapshot VARCHAR(100) NULL,
  recorded_by_user_id BIGINT UNSIGNED NULL,
  sale_date DATETIME(6) NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  subtotal DECIMAL(14,2) NULL,
  discount_amount DECIMAL(14,2) NULL,
  total_amount DECIMAL(14,2) NULL,
  purchase_status ENUM('completed', 'pending_delivery') NULL,
  payment_status ENUM('unpaid', 'partial', 'paid') NULL,
  delivery_status ENUM('pending', 'ready', 'delivered') NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at DATETIME(6) NULL,
  archived_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_id_record_type (id, record_type),
  UNIQUE KEY uq_sales_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_sales_customer_date (customer_id, sale_date, id),
  KEY ix_sales_recorded_by_date (recorded_by_user_id, sale_date, id),
  KEY ix_sales_status_date (is_archived, purchase_status, sale_date, id),
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_sales_customer_phone FOREIGN KEY (customer_phone_number_id)
    REFERENCES customer_phone_numbers (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_sales_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES staff_profiles (user_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_sales_archived_by FOREIGN KEY (archived_by_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_sales_new_required_fields CHECK (
    record_type = 'legacy_crm_purchase' OR
    (customer_id IS NOT NULL AND recorded_by_user_id IS NOT NULL AND sale_date IS NOT NULL AND
      currency IS NOT NULL AND subtotal IS NOT NULL AND discount_amount IS NOT NULL AND total_amount IS NOT NULL AND
      created_at IS NOT NULL)
  ),
  CONSTRAINT chk_sales_currency CHECK (currency IS NULL OR currency REGEXP '^[A-Z]{3}$'),
  CONSTRAINT chk_sales_amounts CHECK (
    (subtotal IS NULL OR subtotal >= 0) AND
    (discount_amount IS NULL OR discount_amount >= 0) AND
    (total_amount IS NULL OR total_amount >= 0) AND
    (subtotal IS NULL OR discount_amount IS NULL OR discount_amount <= subtotal) AND
    (subtotal IS NULL OR discount_amount IS NULL OR total_amount IS NULL OR
      total_amount = subtotal - discount_amount)
  ),
  CONSTRAINT chk_sales_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  sale_record_type ENUM('new_showroom', 'legacy_crm_purchase') NOT NULL,
  bike_id BIGINT UNSIGNED NULL,
  product_name_snapshot VARCHAR(150) NULL,
  model_snapshot VARCHAR(150) NULL,
  battery_type ENUM('Lithium', 'Lead Acid', 'Other', 'Not Applicable') NULL,
  warranty_details VARCHAR(1000) NULL,
  quantity INT UNSIGNED NULL,
  unit_price DECIMAL(12,2) NULL,
  line_total DECIMAL(14,2) NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sale_items_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_sale_items_sale (sale_id, id),
  KEY ix_sale_items_bike (bike_id, sale_id),
  CONSTRAINT fk_sale_items_sale FOREIGN KEY (sale_id, sale_record_type)
    REFERENCES sales (id, record_type)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_sale_items_bike FOREIGN KEY (bike_id) REFERENCES bikes (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_sale_item_new_required CHECK (
    sale_record_type = 'legacy_crm_purchase' OR
    (product_name_snapshot IS NOT NULL AND CHAR_LENGTH(TRIM(product_name_snapshot)) > 0 AND
      quantity IS NOT NULL AND unit_price IS NOT NULL AND line_total IS NOT NULL)
  ),
  CONSTRAINT chk_sale_item_quantity CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT chk_sale_item_price CHECK (unit_price IS NULL OR unit_price > 0),
  CONSTRAINT chk_sale_item_line_total CHECK (
    line_total IS NULL OR line_total >= 0
  ),
  CONSTRAINT chk_sale_item_total_math CHECK (
    quantity IS NULL OR unit_price IS NULL OR
    (line_total IS NOT NULL AND line_total = quantity * unit_price)
  ),
  CONSTRAINT chk_sale_items_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  action ENUM('created', 'updated', 'archived', 'restored') NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  change_summary JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_sale_history_sale_date (sale_id, created_at, id),
  CONSTRAINT fk_sale_history_sale FOREIGN KEY (sale_id) REFERENCES sales (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_sale_history_actor FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sale_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  origin ENUM('new', 'legacy') NOT NULL DEFAULT 'new',
  requesting_user_id BIGINT UNSIGNED NULL,
  requesting_firebase_uid VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sale_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sale_request_user_token (requesting_firebase_uid, request_id),
  UNIQUE KEY uq_sale_requests_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_sale_requests_sale (sale_id),
  CONSTRAINT fk_sale_requests_user FOREIGN KEY (requesting_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_sale_requests_sale FOREIGN KEY (sale_id) REFERENCES sales (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_new_sale_request_required CHECK (
    origin = 'legacy' OR
    (requesting_user_id IS NOT NULL AND sale_id IS NOT NULL AND created_at IS NOT NULL)
  ),
  CONSTRAINT chk_sale_request_token CHECK (
    CHAR_LENGTH(request_id) BETWEEN 16 AND 64 AND request_id REGEXP '^[A-Za-z0-9-]+$'
  ),
  CONSTRAINT chk_sale_requests_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_role_code VARCHAR(32) NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  details JSON NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  legacy_source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  legacy_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activity_logs_legacy_source (legacy_source_collection, legacy_document_id),
  KEY ix_activity_logs_created (created_at, id),
  KEY ix_activity_logs_actor_created (actor_user_id, created_at, id),
  KEY ix_activity_logs_entity (entity_type, entity_id, created_at),
  CONSTRAINT fk_activity_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_activity_logs_legacy_ref CHECK (
    (legacy_source_collection IS NULL AND legacy_document_id IS NULL) OR
    (legacy_source_collection IS NOT NULL AND legacy_document_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE migration_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  migration_name VARCHAR(100) NOT NULL,
  source_system VARCHAR(40) NOT NULL,
  source_collection VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  source_document_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  target_table VARCHAR(64) NULL,
  target_record_id VARCHAR(128) NULL,
  status ENUM('pending', 'migrated', 'skipped', 'failed') NOT NULL DEFAULT 'pending',
  source_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  error_code VARCHAR(64) NULL,
  migrated_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_migration_source_record (
    migration_name, source_system, source_collection, source_document_id
  ),
  KEY ix_migration_ledger_status (migration_name, status, id),
  KEY ix_migration_ledger_target (target_table, target_record_id),
  CONSTRAINT chk_migration_ledger_target CHECK (
    (target_table IS NULL AND target_record_id IS NULL) OR
    (target_table IS NOT NULL AND target_record_id IS NOT NULL)
  ),
  CONSTRAINT chk_migration_ledger_migrated_at CHECK (
    status <> 'migrated' OR migrated_at IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
