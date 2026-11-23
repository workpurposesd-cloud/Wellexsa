-- Reference rows only. Apply explicitly after the schema migration.
-- This does not create user accounts or run automatically at server startup.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT IGNORE INTO roles (code, name, description, is_system) VALUES
  ('owner', 'Owner', 'Business owner role; access remains permission-gated.', TRUE),
  ('staff', 'Staff', 'Showroom staff role; customer data is assignment-scoped by default.', TRUE),
  ('customer', 'Customer', 'Customer account role; access is limited to verified self-links.', TRUE);

INSERT IGNORE INTO permissions (code, description) VALUES
  ('crm.staff.read', 'Read staff accounts and profiles.'),
  ('crm.staff.manage', 'Create, update, disable, and manage staff accounts.'),
  ('crm.roles.manage', 'Manage role permission grants.'),
  ('crm.customers.read.assigned', 'Read customers assigned to the acting staff member.'),
  ('crm.customers.read.all', 'Read all customers, subject to the actor role.'),
  ('crm.customers.create', 'Create a customer record.'),
  ('crm.customers.update.assigned', 'Update customers assigned to the acting staff member.'),
  ('crm.customers.update.all', 'Update any customer, subject to the actor role.'),
  ('crm.customers.archive', 'Archive or restore customer records.'),
  ('crm.customers.assign', 'Assign customers to active staff.'),
  ('crm.customer_links.review', 'Review and verify customer account ownership links.'),
  ('crm.enquiries.read.assigned', 'Read enquiries assigned to the acting staff member.'),
  ('crm.enquiries.read.all', 'Read all enquiries, subject to the actor role.'),
  ('crm.enquiries.update.assigned', 'Update assigned enquiries.'),
  ('crm.enquiries.update.all', 'Update any enquiry, subject to the actor role.'),
  ('crm.enquiries.assign', 'Assign enquiries to active staff.'),
  ('crm.contacts.log.assigned', 'Record contact events for assigned customers.'),
  ('crm.contacts.log.all', 'Record contact events for any customer, subject to the actor role.'),
  ('crm.followups.read.assigned', 'Read follow-ups assigned to the acting staff member.'),
  ('crm.followups.read.all', 'Read all follow-ups, subject to the actor role.'),
  ('crm.followups.create.assigned', 'Create a follow-up assigned to the acting staff member.'),
  ('crm.followups.create.all', 'Create a follow-up assigned to any staff member.'),
  ('crm.followups.update.assigned', 'Reschedule or update follow-ups assigned to the actor.'),
  ('crm.followups.update.all', 'Reschedule or update any follow-up, subject to the actor role.'),
  ('crm.followups.cancel', 'Cancel a follow-up while preserving its history.'),
  ('crm.sales.read.assigned', 'Read sales for customers assigned to the acting staff member or recorded by them.'),
  ('crm.sales.read.all', 'Read all showroom sales, subject to the actor role.'),
  ('crm.sales.create', 'Record a manual offline showroom sale.'),
  ('crm.sales.update.assigned', 'Update sales in the acting staff member permitted scope.'),
  ('crm.sales.update.all', 'Update any showroom sale, subject to the actor role.'),
  ('crm.sales.archive', 'Archive or restore showroom sales.'),
  ('catalog.read', 'Read the public scooter catalogue.'),
  ('catalog.manage', 'Create and manage scooter catalogue records.'),
  ('media.upload', 'Upload and attach approved media assets.'),
  ('media.manage', 'Replace, retire, and reconcile media assets.'),
  ('homepage_slides.manage', 'Create and manage homepage slides.'),
  ('website_settings.manage', 'Manage public website settings.'),
  ('business_settings.manage', 'Manage private business settings.'),
  ('reports.read', 'Read authorized CRM reports.'),
  ('activity_logs.read', 'Read activity logs.'),
  ('customer.profile.read.self', 'Read the signed-in customer profile.'),
  ('customer.profile.update.self', 'Update the signed-in customer profile.'),
  ('customer.history.read.self', 'Read history linked to the signed-in customer account.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN (
  'crm.staff.read',
  'crm.staff.manage',
  'crm.roles.manage',
  'crm.customers.read.assigned',
  'crm.customers.read.all',
  'crm.customers.create',
  'crm.customers.update.assigned',
  'crm.customers.update.all',
  'crm.customers.archive',
  'crm.customers.assign',
  'crm.customer_links.review',
  'crm.enquiries.read.assigned',
  'crm.enquiries.read.all',
  'crm.enquiries.update.assigned',
  'crm.enquiries.update.all',
  'crm.enquiries.assign',
  'crm.contacts.log.assigned',
  'crm.contacts.log.all',
  'crm.followups.read.assigned',
  'crm.followups.read.all',
  'crm.followups.create.assigned',
  'crm.followups.create.all',
  'crm.followups.update.assigned',
  'crm.followups.update.all',
  'crm.followups.cancel',
  'crm.sales.read.assigned',
  'crm.sales.read.all',
  'crm.sales.create',
  'crm.sales.update.assigned',
  'crm.sales.update.all',
  'crm.sales.archive',
  'catalog.read',
  'catalog.manage',
  'media.upload',
  'media.manage',
  'homepage_slides.manage',
  'website_settings.manage',
  'business_settings.manage',
  'reports.read',
  'activity_logs.read'
)
WHERE r.code = 'owner';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN (
  'crm.customers.read.assigned',
  'crm.customers.create',
  'crm.customers.update.assigned',
  'crm.enquiries.read.assigned',
  'crm.enquiries.update.assigned',
  'crm.contacts.log.assigned',
  'crm.followups.read.assigned',
  'crm.followups.create.assigned',
  'crm.followups.update.assigned',
  'crm.followups.cancel',
  'crm.sales.read.assigned',
  'crm.sales.create',
  'catalog.read'
)
WHERE r.code = 'staff';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles AS r
JOIN permissions AS p ON p.code IN (
  'customer.profile.read.self',
  'customer.profile.update.self',
  'customer.history.read.self'
)
WHERE r.code = 'customer';
