-- ============================================================
-- DataVault Pro - Complete MySQL Database Schema & Seed Data
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- CREATE DATABASE
-- ============================================================
CREATE DATABASE IF NOT EXISTS datavault CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE datavault;

-- ============================================================
-- TENANT TABLE
-- ============================================================
DROP TABLE IF EXISTS `Tenant`;
CREATE TABLE `Tenant` (
  `id` varchar(191) NOT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `status` enum('ACTIVE','INACTIVE','SUSPENDED','TRIAL') NOT NULL DEFAULT 'ACTIVE',
  `plan` enum('FREE','PRO','BUSINESS','ENTERPRISE') NOT NULL DEFAULT 'FREE',
  `logo` text,
  `website` varchar(500),
  `country` varchar(50),
  `timezone` varchar(50) NOT NULL DEFAULT 'UTC',
  `storageUsed` bigint NOT NULL DEFAULT '0',
  `storageLimit` bigint NOT NULL DEFAULT '1073741824',
  `userCount` int NOT NULL DEFAULT '0',
  `userLimit` int NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `trialEndsAt` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Tenant_slug_key` (`slug`),
  KEY `Tenant_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- USER TABLE
-- ============================================================
DROP TABLE IF EXISTS `User`;
CREATE TABLE `User` (
  `id` varchar(191) NOT NULL,
  `email` varchar(255) NOT NULL,
  `passwordHash` varchar(255) NOT NULL,
  `firstName` varchar(100) NOT NULL,
  `lastName` varchar(100) NOT NULL,
  `avatar` text,
  `role` enum('SUPER_ADMIN','TENANT_ADMIN','FORENSIC_ANALYST','RECOVERY_TECHNICIAN','SUPPORT_ENGINEER','BILLING_ADMIN','TEAM_MANAGER','MEMBER','GUEST') NOT NULL DEFAULT 'MEMBER',
  `status` enum('ACTIVE','INACTIVE','SUSPENDED','PENDING') NOT NULL DEFAULT 'ACTIVE',
  `emailVerified` tinyint(1) NOT NULL DEFAULT '0',
  `twoFactorEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `twoFactorSecret` varchar(255),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `lastLoginAt` timestamp NULL,
  `tenantId` varchar(191),
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`),
  KEY `User_email_idx` (`email`),
  KEY `User_tenantId_idx` (`tenantId`),
  KEY `User_status_idx` (`status`),
  CONSTRAINT `User_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SESSION TABLE
-- ============================================================
DROP TABLE IF EXISTS `Session`;
CREATE TABLE `Session` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `ipAddress` varchar(45),
  `userAgent` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  KEY `Session_userId_idx` (`userId`),
  KEY `Session_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- REFRESH TOKEN TABLE
-- ============================================================
DROP TABLE IF EXISTS `RefreshToken`;
CREATE TABLE `RefreshToken` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `tokenHash` varchar(255) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NOT NULL,
  `revokedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `RefreshToken_tokenHash_key` (`tokenHash`),
  KEY `RefreshToken_userId_idx` (`userId`),
  KEY `RefreshToken_tokenHash_idx` (`tokenHash`),
  CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PASSWORD RESET TABLE
-- ============================================================
DROP TABLE IF EXISTS `PasswordReset`;
CREATE TABLE `PasswordReset` (
  `id` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `tokenHash` varchar(255) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `PasswordReset_tokenHash_key` (`tokenHash`),
  KEY `PasswordReset_userId_idx` (`userId`),
  CONSTRAINT `PasswordReset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- JOB TABLE
-- ============================================================
DROP TABLE IF EXISTS `Job`;
CREATE TABLE `Job` (
  `id` varchar(191) NOT NULL,
  `tenantId` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `status` enum('PENDING','QUEUED','SCANNING','PAUSED','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `type` enum('QUICK_SCAN','DEEP_SCAN','SIGNATURE_SCAN','CARVING','RAID_RECOVERY','PARTITION_RECOVERY','CLOUD_BACKUP','FORENSIC') NOT NULL,
  `sourceType` enum('UPLOAD','AGENT','CLOUD') NOT NULL,
  `sourceId` varchar(255),
  `progress` int NOT NULL DEFAULT '0',
  `filesFound` int NOT NULL DEFAULT '0',
  `filesRecovered` int NOT NULL DEFAULT '0',
  `storageUsed` bigint NOT NULL DEFAULT '0',
  `fileSystem` enum('NTFS','FAT32','EXFAT','EXT2','EXT3','EXT4','XFS','BTRFS','HFS_PLUS','APFS','UNKNOWN'),
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `error` text,
  `settings` json NOT NULL DEFAULT ('{}'),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `diskImageId` varchar(191),
  PRIMARY KEY (`id`),
  KEY `Job_tenantId_idx` (`tenantId`),
  KEY `Job_userId_idx` (`userId`),
  KEY `Job_status_idx` (`status`),
  KEY `Job_createdAt_idx` (`createdAt`),
  CONSTRAINT `Job_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE,
  CONSTRAINT `Job_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE,
  CONSTRAINT `Job_diskImageId_fkey` FOREIGN KEY (`diskImageId`) REFERENCES `DiskImage` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DISK IMAGE TABLE
-- ============================================================
DROP TABLE IF EXISTS `DiskImage`;
CREATE TABLE `DiskImage` (
  `id` varchar(191) NOT NULL,
  `tenantId` varchar(191) NOT NULL,
  `name` varchar(255) NOT NULL,
  `originalName` varchar(255) NOT NULL,
  `size` bigint NOT NULL,
  `hash` varchar(255) NOT NULL,
  `fileSystem` enum('NTFS','FAT32','EXFAT','EXT2','EXT3','EXT4','XFS','BTRFS','HFS_PLUS','APFS','UNKNOWN'),
  `partitions` json NOT NULL DEFAULT ('[]'),
  `uploadedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processedAt` timestamp NULL,
  `status` enum('UPLOADING','PROCESSING','READY','FAILED') NOT NULL DEFAULT 'UPLOADING',
  `url` text,
  PRIMARY KEY (`id`),
  KEY `DiskImage_tenantId_idx` (`tenantId`),
  KEY `DiskImage_hash_idx` (`hash`),
  CONSTRAINT `DiskImage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- RECOVERED FILE TABLE
-- ============================================================
DROP TABLE IF EXISTS `RecoveredFile`;
CREATE TABLE `RecoveredFile` (
  `id` varchar(191) NOT NULL,
  `jobId` varchar(191) NOT NULL,
  `name` varchar(255) NOT NULL,
  `originalPath` text NOT NULL,
  `currentPath` text,
  `size` bigint NOT NULL,
  `type` varchar(50) NOT NULL,
  `extension` varchar(20) NOT NULL,
  `hash` varchar(255),
  `recoverable` tinyint(1) NOT NULL DEFAULT '1',
  `recoveryProbability` int NOT NULL,
  `isFragmented` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modifiedAt` timestamp NULL,
  `deletedAt` timestamp NULL,
  `previewAvailable` tinyint(1) NOT NULL DEFAULT '0',
  `metadata` json NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (`id`),
  KEY `RecoveredFile_jobId_idx` (`jobId`),
  KEY `RecoveredFile_type_idx` (`type`),
  CONSTRAINT `RecoveredFile_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `Job` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- USER INVITE TABLE
-- ============================================================
DROP TABLE IF EXISTS `UserInvite`;
CREATE TABLE `UserInvite` (
  `id` varchar(191) NOT NULL,
  `email` varchar(255) NOT NULL,
  `role` enum('SUPER_ADMIN','TENANT_ADMIN','FORENSIC_ANALYST','RECOVERY_TECHNICIAN','SUPPORT_ENGINEER','BILLING_ADMIN','TEAM_MANAGER','MEMBER','GUEST') NOT NULL,
  `department` varchar(100),
  `status` enum('PENDING','ACCEPTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `tenantId` varchar(191) NOT NULL,
  `invitedBy` varchar(191) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `UserInvite_tenantId_idx` (`tenantId`),
  KEY `UserInvite_email_idx` (`email`),
  CONSTRAINT `UserInvite_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- RECOVERY JOB TABLE
-- ============================================================
DROP TABLE IF EXISTS `RecoveryJob`;
CREATE TABLE `RecoveryJob` (
  `id` varchar(191) NOT NULL,
  `sourceJobId` varchar(191) NOT NULL,
  `userId` varchar(191) NOT NULL,
  `status` enum('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  `totalSize` bigint NOT NULL DEFAULT '0',
  `destination` json NOT NULL,
  `tenantId` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `RecoveryJob_tenantId_idx` (`tenantId`),
  KEY `RecoveryJob_sourceJobId_idx` (`sourceJobId`),
  CONSTRAINT `RecoveryJob_sourceJobId_fkey` FOREIGN KEY (`sourceJobId`) REFERENCES `Job` (`id`) ON DELETE CASCADE,
  CONSTRAINT `RecoveryJob_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE,
  CONSTRAINT `RecoveryJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SUBSCRIPTION TABLE
-- ============================================================
DROP TABLE IF EXISTS `Subscription`;
CREATE TABLE `Subscription` (
  `id` varchar(191) NOT NULL,
  `tenantId` varchar(191) NOT NULL,
  `planId` varchar(50) NOT NULL,
  `plan` enum('FREE','PRO','BUSINESS','ENTERPRISE') NOT NULL,
  `status` enum('ACTIVE','PAST_DUE','CANCELLED','TRIALING','INCOMPLETE','INCOMPLETE_EXPIRED','UNPAID') NOT NULL DEFAULT 'ACTIVE',
  `currentPeriodStart` timestamp NOT NULL,
  `currentPeriodEnd` timestamp NOT NULL,
  `cancelAtPeriodEnd` tinyint(1) NOT NULL DEFAULT '0',
  `cancelledAt` timestamp NULL,
  `trialEndsAt` timestamp NULL,
  `stripeSubscriptionId` varchar(255),
  `stripeCustomerId` varchar(255),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Subscription_tenantId_key` (`tenantId`),
  KEY `Subscription_tenantId_idx` (`tenantId`),
  KEY `Subscription_status_idx` (`status`),
  CONSTRAINT `Subscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- AUDIT LOG TABLE
-- ============================================================
DROP TABLE IF EXISTS `AuditLog`;
CREATE TABLE `AuditLog` (
  `id` varchar(191) NOT NULL,
  `tenantId` varchar(191) NOT NULL,
  `userId` varchar(191),
  `action` varchar(100) NOT NULL,
  `resource` varchar(100) NOT NULL,
  `resourceId` varchar(255),
  `metadata` json,
  `ipAddress` varchar(45),
  `userAgent` text,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `AuditLog_tenantId_idx` (`tenantId`),
  KEY `AuditLog_userId_idx` (`userId`),
  KEY `AuditLog_timestamp_idx` (`timestamp`),
  KEY `AuditLog_action_idx` (`action`),
  CONSTRAINT `AuditLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE,
  CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- API KEY TABLE
-- ============================================================
DROP TABLE IF EXISTS `ApiKey`;
CREATE TABLE `ApiKey` (
  `id` varchar(191) NOT NULL,
  `tenantId` varchar(191) NOT NULL,
  `name` varchar(100) NOT NULL,
  `keyHash` varchar(255) NOT NULL,
  `keyPrefix` varchar(20) NOT NULL,
  `permissions` json NOT NULL DEFAULT ('[]'),
  `lastUsedAt` timestamp NULL,
  `expiresAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ApiKey_keyHash_key` (`keyHash`),
  KEY `ApiKey_tenantId_idx` (`tenantId`),
  KEY `ApiKey_keyHash_idx` (`keyHash`),
  CONSTRAINT `ApiKey_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- WEBHOOK TABLE
-- ============================================================
DROP TABLE IF EXISTS `Webhook`;
CREATE TABLE `Webhook` (
  `id` varchar(191) NOT NULL,
  `tenantId` varchar(191) NOT NULL,
  `url` text NOT NULL,
  `events` json NOT NULL DEFAULT ('[]'),
  `secret` varchar(255) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `Webhook_tenantId_idx` (`tenantId`),
  CONSTRAINT `Webhook_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- SEED DATA - TENANTS
-- ============================================================
INSERT INTO `Tenant` (`id`, `name`, `slug`, `status`, `plan`, `userLimit`, `storageLimit`, `storageUsed`, `timezone`, `createdAt`, `updatedAt`) VALUES
('tenant-1', 'Acme Corporation', 'acme-corp', 'ACTIVE', 'PRO', 50, 107374182400, 53687091200, 'America/New_York', DATE_SUB(NOW(), INTERVAL 90 DAY), NOW()),
('tenant-2', 'TechStart Inc', 'techstart', 'ACTIVE', 'BUSINESS', 100, 536870912000, 134217728000, 'America/Los_Angeles', DATE_SUB(NOW(), INTERVAL 60 DAY), NOW()),
('tenant-3', 'DataSecure LLC', 'datasecure', 'ACTIVE', 'FREE', 5, 10737418240, 2147483648, 'Europe/London', DATE_SUB(NOW(), INTERVAL 30 DAY), NOW());

-- ============================================================
-- SEED DATA - USERS
-- ============================================================
-- Password: password123 (hash: $2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq)
INSERT INTO `User` (`id`, `email`, `passwordHash`, `firstName`, `lastName`, `role`, `status`, `emailVerified`, `twoFactorEnabled`, `tenantId`, `createdAt`, `updatedAt`) VALUES
('user-1', 'john.smith@acme.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'John', 'Smith', 'TENANT_ADMIN', 'ACTIVE', 1, 0, 'tenant-1', DATE_SUB(NOW(), INTERVAL 85 DAY), NOW()),
('user-2', 'sarah.johnson@acme.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Sarah', 'Johnson', 'FORENSIC_ANALYST', 'ACTIVE', 1, 1, 'tenant-1', DATE_SUB(NOW(), INTERVAL 60 DAY), NOW()),
('user-3', 'mike.wilson@acme.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Mike', 'Wilson', 'RECOVERY_TECHNICIAN', 'ACTIVE', 1, 0, 'tenant-1', DATE_SUB(NOW(), INTERVAL 45 DAY), NOW()),
('user-4', 'admin@techstart.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Admin', 'User', 'TENANT_ADMIN', 'ACTIVE', 1, 1, 'tenant-2', DATE_SUB(NOW(), INTERVAL 55 DAY), NOW()),
('user-5', 'demo@datasecure.com', '$2b$12$s2Zb6AsPz2ItYVbmON6KpuKCVniVv/ouw17juY6Gj.E0vz8xUCvVq', 'Demo', 'User', 'TENANT_ADMIN', 'ACTIVE', 1, 0, 'tenant-3', DATE_SUB(NOW(), INTERVAL 25 DAY), NOW());

-- ============================================================
-- SEED DATA - SESSIONS
-- ============================================================
INSERT INTO `Session` (`id`, `userId`, `ipAddress`, `userAgent`, `createdAt`, `expiresAt`) VALUES
('session-1', 'user-1', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_ADD(NOW(), INTERVAL 7 DAY)),
('session-2', 'user-2', '192.168.1.101', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36', DATE_SUB(NOW(), INTERVAL 1 HOUR), DATE_ADD(NOW(), INTERVAL 7 DAY)),
('session-3', 'user-3', '192.168.1.102', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0', DATE_SUB(NOW(), INTERVAL 30 MINUTE), DATE_ADD(NOW(), INTERVAL 7 DAY));

-- ============================================================
-- SEED DATA - DISK IMAGES
-- ============================================================
INSERT INTO `DiskImage` (`id`, `tenantId`, `name`, `originalName`, `size`, `hash`, `fileSystem`, `partitions`, `uploadedAt`, `processedAt`, `status`) VALUES
('img-1', 'tenant-1', 'Windows_System_HDD', 'windows_primary_drive.img', 500000000000, 'a1b2c3d4e5f6g7h8i9j0', 'NTFS', '[]', DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 20 DAY), 'READY'),
('img-2', 'tenant-1', 'Linux_Server_Disk', 'ubuntu_server.img', 1000000000000, 'k9l8m7n6o5p4q3r2s1t0', 'EXT4', '[]', DATE_SUB(NOW(), INTERVAL 15 DAY), DATE_SUB(NOW(), INTERVAL 15 DAY), 'READY'),
('img-3', 'tenant-1', 'USB_Recovery', 'sandisk_cruzer.img', 32000000000, 'u1v2w3x4y5z6a7b8c9d0', 'FAT32', '[]', DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_SUB(NOW(), INTERVAL 10 DAY), 'READY'),
('img-4', 'tenant-2', 'MacBook_Pro_SSD', 'macbook_pro.dmg', 250000000000, 'e1f2g3h4i5j6k7l8m9n0', 'APFS', '[]', DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 5 DAY), 'READY');

-- ============================================================
-- SEED DATA - JOBS
-- ============================================================
INSERT INTO `Job` (`id`, `tenantId`, `userId`, `name`, `description`, `status`, `type`, `sourceType`, `progress`, `filesFound`, `filesRecovered`, `storageUsed`, `fileSystem`, `createdAt`, `startedAt`, `completedAt`, `updatedAt`) VALUES
('job-1', 'tenant-1', 'user-1', 'Windows HDD Recovery', 'Recover deleted files from Windows system drive', 'COMPLETED', 'QUICK_SCAN', 'UPLOAD', 100, 1250, 1187, 4500000000, 'NTFS', DATE_SUB(NOW(), INTERVAL 18 DAY), DATE_SUB(NOW(), INTERVAL 18 DAY), DATE_SUB(NOW(), INTERVAL 17 DAY), DATE_SUB(NOW(), INTERVAL 17 DAY)),
('job-2', 'tenant-1', 'user-3', 'Linux Server Deep Scan', 'Comprehensive scan for lost partition', 'COMPLETED', 'DEEP_SCAN', 'UPLOAD', 100, 3450, 2890, 12500000000, 'EXT4', DATE_SUB(NOW(), INTERVAL 12 DAY), DATE_SUB(NOW(), INTERVAL 12 DAY), DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_SUB(NOW(), INTERVAL 10 DAY)),
('job-3', 'tenant-1', 'user-2', 'USB File Carving', 'Raw data recovery from corrupted USB', 'COMPLETED', 'CARVING', 'UPLOAD', 100, 890, 654, 1200000000, 'FAT32', DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 7 DAY), DATE_SUB(NOW(), INTERVAL 7 DAY)),
('job-4', 'tenant-2', 'user-4', 'Mac SSD Forensic', 'Forensic analysis of MacBook SSD', 'COMPLETED', 'FORENSIC', 'UPLOAD', 100, 5670, 0, 0, 'APFS', DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY)),
('job-5', 'tenant-1', 'user-1', 'RAID Array Recovery', 'Recover from RAID 5 failure', 'SCANNING', 'RAID_RECOVERY', 'UPLOAD', 67, 1240, 0, 0, 'NTFS', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), NULL, NOW()),
('job-6', 'tenant-1', 'user-3', 'Quick Scan Test', 'Test scan on new image', 'PENDING', 'QUICK_SCAN', 'UPLOAD', 0, 0, 0, 0, NULL, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL, NULL, NOW());

-- ============================================================
-- SEED DATA - RECOVERED FILES
-- ============================================================
INSERT INTO `RecoveredFile` (`id`, `jobId`, `name`, `originalPath`, `size`, `type`, `extension`, `recoverable`, `recoveryProbability`, `createdAt`) VALUES
('file-1', 'job-1', 'annual_report_2025.xlsx', '/Users/John/Documents/annual_report_2025.xlsx', 2457600, 'document', 'xlsx', 1, 95, DATE_SUB(NOW(), INTERVAL 17 DAY)),
('file-2', 'job-1', 'project_presentation.pptx', '/Users/John/Documents/project_presentation.pptx', 5242880, 'document', 'pptx', 1, 90, DATE_SUB(NOW(), INTERVAL 17 DAY)),
('file-3', 'job-1', 'backup.zip', '/Users/John/Desktop/backup.zip', 15728640, 'archive', 'zip', 1, 85, DATE_SUB(NOW(), INTERVAL 17 DAY)),
('file-4', 'job-2', 'photo_collection', '/home/admin/photos/photo_collection', 104857600, 'image', 'jpg', 1, 88, DATE_SUB(NOW(), INTERVAL 10 DAY)),
('file-5', 'job-2', 'server_logs.txt', '/var/log/syslog', 5242880, 'document', 'txt', 1, 92, DATE_SUB(NOW(), INTERVAL 10 DAY)),
('file-6', 'job-3', 'important_doc.pdf', '/media/recovered/important_doc.pdf', 1048576, 'document', 'pdf', 1, 78, DATE_SUB(NOW(), INTERVAL 7 DAY));

-- ============================================================
-- SEED DATA - SUBSCRIPTIONS
-- ============================================================
INSERT INTO `Subscription` (`id`, `tenantId`, `planId`, `plan`, `status`, `currentPeriodStart`, `currentPeriodEnd`, `createdAt`, `updatedAt`) VALUES
('sub-1', 'tenant-1', 'PRO', 'PRO', 'ACTIVE', DATE_SUB(NOW(), INTERVAL 30 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 85 DAY), NOW()),
('sub-2', 'tenant-2', 'BUSINESS', 'BUSINESS', 'ACTIVE', DATE_SUB(NOW(), INTERVAL 15 DAY), DATE_ADD(NOW(), INTERVAL 15 DAY), DATE_SUB(NOW(), INTERVAL 55 DAY), NOW()),
('sub-3', 'tenant-3', 'FREE', 'FREE', 'ACTIVE', DATE_SUB(NOW(), INTERVAL 25 DAY), DATE_ADD(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 25 DAY), NOW());

-- ============================================================
-- SEED DATA - AUDIT LOGS
-- ============================================================
INSERT INTO `AuditLog` (`id`, `tenantId`, `userId`, `action`, `resource`, `resourceId`, `ipAddress`, `userAgent`, `timestamp`) VALUES
('audit-1', 'tenant-1', 'user-1', 'USER_LOGIN', 'AUTH', 'user-1', '192.168.1.100', 'Chrome/120', DATE_SUB(NOW(), INTERVAL 2 HOUR)),
('audit-2', 'tenant-1', 'user-1', 'JOB_CREATED', 'JOB', 'job-6', '192.168.1.100', 'Chrome/120', DATE_SUB(NOW(), INTERVAL 1 HOUR)),
('audit-3', 'tenant-1', 'user-2', 'FILE_DOWNLOADED', 'FILE', 'file-1', '192.168.1.101', 'Safari/537', DATE_SUB(NOW(), INTERVAL 30 MINUTE)),
('audit-4', 'tenant-1', NULL, 'FAILED_LOGIN', 'AUTH', NULL, '45.33.32.156', 'Python/3.11', DATE_SUB(NOW(), INTERVAL 1 DAY)),
('audit-5', 'tenant-1', 'user-1', 'USER_INVITED', 'USER', 'invite-1', '192.168.1.100', 'Chrome/120', DATE_SUB(NOW(), INTERVAL 3 DAY)),
('audit-6', 'tenant-1', 'user-1', 'TENANT_UPDATED', 'SETTINGS', 'tenant-1', '192.168.1.100', 'Chrome/120', DATE_SUB(NOW(), INTERVAL 5 DAY)),
('audit-7', 'tenant-1', 'user-1', 'SUBSCRIPTION_UPGRADED', 'BILLING', 'sub-1', '192.168.1.100', 'Chrome/120', DATE_SUB(NOW(), INTERVAL 80 DAY));

-- ============================================================
-- SEED DATA - API KEYS
-- ============================================================
INSERT INTO `ApiKey` (`id`, `tenantId`, `name`, `keyHash`, `keyPrefix`, `expiresAt`, `createdAt`) VALUES
('api-1', 'tenant-1', 'Production Key', 'a1b2c3d4e5f6g7h8i9j0', 'dv_live_', DATE_ADD(NOW(), INTERVAL 90 DAY), DATE_SUB(NOW(), INTERVAL 30 DAY)),
('api-2', 'tenant-1', 'Development Key', 'b2c3d4e5f6g7h8i9j0k1', 'dv_test_', DATE_ADD(NOW(), INTERVAL 180 DAY), DATE_SUB(NOW(), INTERVAL 45 DAY));

-- ============================================================
-- SEED DATA - WEBHOOKS
-- ============================================================
INSERT INTO `Webhook` (`id`, `tenantId`, `url`, `events`, `secret`, `active`, `createdAt`) VALUES
('webhook-1', 'tenant-1', 'https://acme.com/api/webhooks/datavault', '["job.completed","job.failed"]', 'whsec_abc123', 1, DATE_SUB(NOW(), INTERVAL 20 DAY)),
('webhook-2', 'tenant-1', 'https://acme.com/api/webhooks/security', '["user.login","user.logout","security.alert"]', 'whsec_def456', 1, DATE_SUB(NOW(), INTERVAL 15 DAY));

-- ============================================================
-- SEED DATA - USER INVITES
-- ============================================================
INSERT INTO `UserInvite` (`id`, `email`, `role`, `department`, `status`, `tenantId`, `invitedBy`, `expiresAt`, `createdAt`) VALUES
('invite-1', 'newuser@acme.com', 'MEMBER', 'Engineering', 'PENDING', 'tenant-1', 'user-1', DATE_ADD(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)),
('invite-2', 'contractor@acme.com', 'GUEST', 'Consulting', 'PENDING', 'tenant-1', 'user-2', DATE_ADD(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY));

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT 'Database seeded successfully!' AS message;
SELECT 'Tenants:' AS info, COUNT(*) AS count FROM Tenant;
SELECT 'Users:' AS info, COUNT(*) AS count FROM User;
SELECT 'Jobs:' AS info, COUNT(*) AS count FROM Job;
SELECT 'DiskImages:' AS info, COUNT(*) AS count FROM DiskImage;
SELECT 'AuditLogs:' AS info, COUNT(*) AS count FROM AuditLog;

-- Default login: john.smith@acme.com / password123