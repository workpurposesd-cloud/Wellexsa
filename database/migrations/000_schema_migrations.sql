-- Migration-control table bootstrap. Run only on an approved local/test schema.
-- The runner must verify this table's shape and checksum before continuing.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL,
  checksum_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('running', 'applied', 'failed') NOT NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  applied_at DATETIME(6) NULL,
  applied_by VARCHAR(128) NOT NULL,
  error_code VARCHAR(64) NULL,
  PRIMARY KEY (version),
  CONSTRAINT chk_schema_migrations_state CHECK (
    (status = 'running' AND applied_at IS NULL AND error_code IS NULL) OR
    (status = 'applied' AND applied_at IS NOT NULL AND error_code IS NULL) OR
    (status = 'failed' AND applied_at IS NULL AND error_code IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
