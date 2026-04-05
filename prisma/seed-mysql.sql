-- DataVault Pro - MySQL Database Seed Script
-- Run this to populate the database with sample data

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================
-- TENANTS (Companies/Workspaces)
-- ============================================

INSERT INTO `Tenant` (id, name, slug, status, plan, userLimit, storageLimit, storageUsed, timezone, createdAt, updatedAt) VALUES
('tenant-1', 'Acme Corporation', 'acme-corp', 'ACTIVE', 'PRO', 50, 107374182400, 53687091200, 'America/New_York', NOW() - INTERVAL 90 DAY, NOW()),
('tenant-2', 'TechStart Inc', 'techstart', 'ACTIVE', 'BUSINESS', 100, 536870912000, 134217728000, 'America/Los_Angeles', NOW() - INTERVAL 60 DAY, NOW()),
('tenant-3', 'DataSecure LLC', 'datasecure', 'ACTIVE', 'FREE', 5, 10737418240, 2147483648, 'Europe/London', NOW() - INTERVAL 30 DAY, NOW());

-- ============================================
-- USERS
-- ============================================

INSERT INTO `User` (id, email, passwordHash, firstName, lastName, role, status, emailVerified, twoFactorEnabled, tenantId, createdAt, updatedAt) VALUES
('user-1', 'john.smith@acme.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'John', 'Smith', 'TENANT_ADMIN', 'ACTIVE', 1, 0, 'tenant-1', NOW() - INTERVAL 85 DAY, NOW()),
('user-2', 'sarah.johnson@acme.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Sarah', 'Johnson', 'FORENSIC_ANALYST', 'ACTIVE', 1, 1, 'tenant-1', NOW() - INTERVAL 60 DAY, NOW()),
('user-3', 'mike.wilson@acme.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Mike', 'Wilson', 'RECOVERY_TECHNICIAN', 'ACTIVE', 1, 0, 'tenant-1', NOW() - INTERVAL 45 DAY, NOW()),
('user-4', 'admin@techstart.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Admin', 'User', 'TENANT_ADMIN', 'ACTIVE', 1, 1, 'tenant-2', NOW() - INTERVAL 55 DAY, NOW()),
('user-5', 'demo@datasecure.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Demo', 'User', 'TENANT_ADMIN', 'ACTIVE', 1, 0, 'tenant-3', NOW() - INTERVAL 25 DAY, NOW());

-- ============================================
-- SESSIONS
-- ============================================

INSERT INTO `Session` (id, userId, ipAddress, userAgent, createdAt, expiresAt) VALUES
('session-1', 'user-1', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', NOW() - INTERVAL 2 HOUR, NOW() + INTERVAL 7 DAY),
('session-2', 'user-2', '192.168.1.101', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36', NOW() - INTERVAL 1 HOUR, NOW() + INTERVAL 7 DAY),
('session-3', 'user-3', '192.168.1.102', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0', NOW() - INTERVAL 30 MINUTE, NOW() + INTERVAL 7 DAY);

-- ============================================
-- DISK IMAGES
-- ============================================

INSERT INTO `DiskImage` (id, name, originalName, size, hash, fileSystem, status, tenantId, uploadedAt, processedAt, createdAt, updatedAt) VALUES
('img-1', 'Windows_System_HDD', 'windows_primary_drive.img', 500000000000, 'a1b2c3d4e5f6g7h8i9j0', 'NTFS', 'READY', 'tenant-1', NOW() - INTERVAL 20 DAY, NOW() - INTERVAL 20 DAY, NOW() - INTERVAL 20 DAY, NOW()),
('img-2', 'Linux_Server_Disk', 'ubuntu_server.img', 1000000000000, 'k9l8m7n6o5p4q3r2s1t0', 'EXT4', 'READY', 'tenant-1', NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 15 DAY, NOW()),
('img-3', 'USB_Recovery', 'sandisk_cruzer.img', 32000000000, 'u1v2w3x4y5z6a7b8c9d0', 'FAT32', 'READY', 'tenant-1', NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 10 DAY, NOW()),
('img-4', 'MacBook_Pro_SSD', 'macbook_pro.dmg', 250000000000, 'e1f2g3h4i5j6k7l8m9n0', 'APFS', 'READY', 'tenant-2', NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY, NOW());

-- ============================================
-- JOBS
-- ============================================

INSERT INTO `Job` (id, tenantId, userId, name, description, type, sourceType, status, progress, filesFound, filesRecovered, storageUsed, fileSystem, createdAt, startedAt, completedAt, updatedAt) VALUES
('job-1', 'tenant-1', 'user-1', 'Windows HDD Recovery', 'Recover deleted files from Windows system drive', 'QUICK_SCAN', 'UPLOAD', 'COMPLETED', 100, 1250, 1187, 4500000000, 'NTFS', NOW() - INTERVAL 18 DAY, NOW() - INTERVAL 18 DAY, NOW() - INTERVAL 17 DAY, NOW() - INTERVAL 17 DAY),
('job-2', 'tenant-1', 'user-3', 'Linux Server Deep Scan', 'Comprehensive scan for lost partition', 'DEEP_SCAN', 'UPLOAD', 'COMPLETED', 100, 3450, 2890, 12500000000, 'EXT4', NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 10 DAY),
('job-3', 'tenant-1', 'user-2', 'USB File Carving', 'Raw data recovery from corrupted USB', 'CARVING', 'UPLOAD', 'COMPLETED', 100, 890, 654, 1200000000, 'FAT32', NOW() - INTERVAL 8 DAY, NOW() - INTERVAL 8 DAY, NOW() - INTERVAL 7 DAY, NOW() - INTERVAL 7 DAY),
('job-4', 'tenant-2', 'user-4', 'Mac SSD Forensic', 'Forensic analysis of MacBook SSD', 'FORENSIC', 'UPLOAD', 'COMPLETED', 100, 5670, 0, 0, 'APFS', NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY),
('job-5', 'tenant-1', 'user-1', 'RAID Array Recovery', 'Recover from RAID 5 failure', 'RAID_RECOVERY', 'UPLOAD', 'IN_PROGRESS', 67, 1240, 0, 0, 'NTFS', NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 2 DAY, NULL, NOW()),
('job-6', 'tenant-1', 'user-3', 'Quick Scan Test', 'Test scan on new image', 'QUICK_SCAN', 'UPLOAD', 'PENDING', 0, 0, 0, 0, NULL, NOW() - INTERVAL 1 DAY, NULL, NULL, NOW());

-- ============================================
-- RECOVERED FILES
-- ============================================

INSERT INTO `RecoveredFile` (id, jobId, name, originalPath, size, type, extension, recoverable, recoveryProbability, createdAt) VALUES
('file-1', 'job-1', 'annual_report_2025.xlsx', '/Users/John/Documents/annual_report_2025.xlsx', 2457600, 'document', 'xlsx', 1, 95, NOW() - INTERVAL 17 DAY),
('file-2', 'job-1', 'project_presentation.pptx', '/Users/John/Documents/project_presentation.pptx', 5242880, 'document', 'pptx', 1, 90, NOW() - INTERVAL 17 DAY),
('file-3', 'job-1', 'backup.zip', '/Users/John/Desktop/backup.zip', 15728640, 'archive', 'zip', 1, 85, NOW() - INTERVAL 17 DAY),
('file-4', 'job-2', 'photo_collection', '/home/admin/photos/photo_collection', 104857600, 'image', 'jpg', 1, 88, NOW() - INTERVAL 10 DAY),
('file-5', 'job-2', 'server_logs.txt', '/var/log/syslog', 5242880, 'document', 'txt', 1, 92, NOW() - INTERVAL 10 DAY),
('file-6', 'job-3', 'important_doc.pdf', '/media/recovered/important_doc.pdf', 1048576, 'document', 'pdf', 1, 78, NOW() - INTERVAL 7 DAY);

-- ============================================
-- SUBSCRIPTIONS
-- ============================================

INSERT INTO `Subscription` (id, tenantId, planId, plan, status, currentPeriodStart, currentPeriodEnd, createdAt, updatedAt) VALUES
('sub-1', 'tenant-1', 'PRO', 'PRO', 'ACTIVE', NOW() - INTERVAL 30 DAY, NOW() + INTERVAL 1 DAY, NOW() - INTERVAL 85 DAY, NOW()),
('sub-2', 'tenant-2', 'BUSINESS', 'BUSINESS', 'ACTIVE', NOW() - INTERVAL 15 DAY, NOW() + INTERVAL 15 DAY, NOW() - INTERVAL 55 DAY, NOW()),
('sub-3', 'tenant-3', 'FREE', 'FREE', 'ACTIVE', NOW() - INTERVAL 25 DAY, NOW() + INTERVAL 5 DAY, NOW() - INTERVAL 25 DAY, NOW());

-- ============================================
-- AUDIT LOGS
-- ============================================

INSERT INTO `AuditLog` (id, tenantId, userId, action, resource, resourceId, ipAddress, userAgent, timestamp) VALUES
('audit-1', 'tenant-1', 'user-1', 'USER_LOGIN', 'AUTH', 'user-1', '192.168.1.100', 'Chrome/120', NOW() - INTERVAL 2 HOUR),
('audit-2', 'tenant-1', 'user-1', 'JOB_CREATED', 'JOB', 'job-6', '192.168.1.100', 'Chrome/120', NOW() - INTERVAL 1 HOUR),
('audit-3', 'tenant-1', 'user-2', 'FILE_DOWNLOADED', 'FILE', 'file-1', '192.168.1.101', 'Safari/537', NOW() - INTERVAL 30 MINUTE),
('audit-4', 'tenant-1', NULL, 'FAILED_LOGIN', 'AUTH', NULL, '45.33.32.156', 'Python/3.11', NOW() - INTERVAL 1 DAY),
('audit-5', 'tenant-1', 'user-1', 'USER_INVITED', 'USER', 'invite-1', '192.168.1.100', 'Chrome/120', NOW() - INTERVAL 3 DAY),
('audit-6', 'tenant-1', 'user-1', 'TENANT_UPDATED', 'SETTINGS', 'tenant-1', '192.168.1.100', 'Chrome/120', NOW() - INTERVAL 5 DAY),
('audit-7', 'tenant-1', 'user-1', 'SUBSCRIPTION_UPGRADED', 'BILLING', 'sub-1', '192.168.1.100', 'Chrome/120', NOW() - INTERVAL 80 DAY);

-- ============================================
-- API KEYS
-- ============================================

INSERT INTO `ApiKey` (id, tenantId, userId, name, keyHash, keyPrefix, expiresAt, createdAt) VALUES
('api-1', 'tenant-1', 'user-1', 'Production Key', 'a1b2c3d4e5f6g7h8i9j0', 'dv_live_', NOW() + INTERVAL 90 DAY, NOW() - INTERVAL 30 DAY),
('api-2', 'tenant-1', 'user-2', 'Development Key', 'b2c3d4e5f6g7h8i9j0k1', 'dv_test_', NOW() + INTERVAL 180 DAY, NOW() - INTERVAL 45 DAY);

-- ============================================
-- WEBHOOKS
-- ============================================

INSERT INTO `Webhook` (id, tenantId, url, events, secret, active, createdAt) VALUES
('webhook-1', 'tenant-1', 'https://acme.com/api/webhooks/datavault', '["job.completed", "job.failed"]', 'whsec_abc123', 1, NOW() - INTERVAL 20 DAY),
('webhook-2', 'tenant-1', 'https://acme.com/api/webhooks/security', '["user.login", "user.logout", "security.alert"]', 'whsec_def456', 1, NOW() - INTERVAL 15 DAY);

-- ============================================
-- TEAM INVITES
-- ============================================

INSERT INTO `UserInvite` (id, email, role, tenantId, invitedBy, status, expiresAt, createdAt) VALUES
('invite-1', 'newuser@acme.com', 'MEMBER', 'tenant-1', 'user-1', 'PENDING', NOW() + INTERVAL 5 DAY, NOW() - INTERVAL 2 DAY),
('invite-2', 'contractor@acme.com', 'GUEST', 'tenant-1', 'user-2', 'PENDING', NOW() + INTERVAL 3 DAY, NOW() - INTERVAL 1 DAY);

-- ============================================
-- ENABLE FOREIGN KEYS
-- ============================================

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================
-- VERIFICATION
-- ============================================

SELECT 'Tenants:' AS info, COUNT(*) AS count FROM Tenant;
SELECT 'Users:' AS info, COUNT(*) AS count FROM User;
SELECT 'Jobs:' AS info, COUNT(*) AS count FROM Job;
SELECT 'DiskImages:' AS info, COUNT(*) AS count FROM DiskImage;
SELECT 'AuditLogs:' AS info, COUNT(*) AS count FROM AuditLog;

-- Print completion message
-- Database seeded successfully!
-- Default login: john.smith@acme.com / password123