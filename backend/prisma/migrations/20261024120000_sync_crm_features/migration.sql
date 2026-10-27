-- ==============================================================================
-- InnovEity CRM - Consolidated Production Schema Parity Migration
-- Migration Name: 20261024120000_sync_crm_features
-- Description: Brings live production database backup up to 100% parity with
--              current Prisma schema, application controllers, and UI modules.
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------------------------
-- 1. ALTER EXISTING CORE TABLES (30 MISSING COLUMNS & DATA TYPE ALIGNMENTS)
-- ------------------------------------------------------------------------------

-- User: Add autoClockOutEnabled & accessTemplateId
ALTER TABLE `user` 
  ADD COLUMN `autoClockOutEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `accessTemplateId` VARCHAR(191) NULL;

-- Attendance: Add GPS coordinates, reverse-geocoded address, work locations, and geofence location FK
ALTER TABLE `attendance` 
  ADD COLUMN `clockInLatitude` DOUBLE NULL,
  ADD COLUMN `clockInLongitude` DOUBLE NULL,
  ADD COLUMN `clockInAddress` TEXT NULL,
  ADD COLUMN `clockOutLatitude` DOUBLE NULL,
  ADD COLUMN `clockOutLongitude` DOUBLE NULL,
  ADD COLUMN `clockOutAddress` TEXT NULL,
  ADD COLUMN `clockOutWorkLocation` VARCHAR(191) NULL,
  ADD COLUMN `clockOutWorkLocationOther` VARCHAR(191) NULL,
  ADD COLUMN `attendanceLocationId` VARCHAR(191) NULL;

-- LeavePolicy: Add Comp-Off validity and claim window configurations
ALTER TABLE `leavepolicy` 
  ADD COLUMN `compOffValidityDays` INT NOT NULL DEFAULT 90,
  ADD COLUMN `compOffClaimWindowDays` INT NOT NULL DEFAULT 30,
  ADD COLUMN `compOffClaimWindowEnabled` BOOLEAN NOT NULL DEFAULT true;

-- LeaveType: Add minNoticeDays for advance application requirements
ALTER TABLE `leavetype` 
  ADD COLUMN `minNoticeDays` INT NOT NULL DEFAULT 0;

-- Organization: Add asset & estimate numbering sequences, billing address, and bank remittance fields
ALTER TABLE `organization` 
  ADD COLUMN `assetPrefix` VARCHAR(32) NULL,
  ADD COLUMN `assetSequence` INT NOT NULL DEFAULT 1000,
  ADD COLUMN `estimatePrefix` VARCHAR(191) NULL DEFAULT 'EST',
  ADD COLUMN `estimateSequence` INT NOT NULL DEFAULT 1000,
  ADD COLUMN `gstin` VARCHAR(191) NULL,
  ADD COLUMN `city` VARCHAR(191) NULL,
  ADD COLUMN `state` VARCHAR(191) NULL,
  ADD COLUMN `pincode` VARCHAR(191) NULL,
  ADD COLUMN `country` VARCHAR(191) NULL DEFAULT 'India',
  ADD COLUMN `bankName` VARCHAR(191) NULL,
  ADD COLUMN `bankIfsc` VARCHAR(191) NULL,
  ADD COLUMN `bankAccountNo` VARCHAR(191) NULL,
  ADD COLUMN `bankBranch` VARCHAR(191) NULL,
  ADD COLUMN `signatureImage` VARCHAR(191) NULL,
  ADD COLUMN `signatoryTitle` VARCHAR(191) NULL DEFAULT 'Authorized Signatory';

-- Add unique constraint for organization assetPrefix
ALTER TABLE `organization` ADD UNIQUE INDEX `organization_assetPrefix_key` (`assetPrefix`);

-- Asset: Modify category from MySQL Enum to VARCHAR(191) to support custom dynamic asset categories
ALTER TABLE `asset` MODIFY COLUMN `category` VARCHAR(191) NOT NULL DEFAULT 'LAPTOP';

-- ------------------------------------------------------------------------------
-- 2. CREATE 14 MISSING FEATURE TABLES (EXACT PRISMA SCHEMAS)
-- ------------------------------------------------------------------------------

-- AccessTemplate
CREATE TABLE IF NOT EXISTS `accesstemplate` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `baseRole` enum('ADMIN','SUPER_ADMIN','TEAM_LEADER','INTERN','EMPLOYEE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `createdById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `accesstemplate_organizationId_name_key` (`organizationId`,`name`),
  KEY `accesstemplate_organizationId_idx` (`organizationId`),
  KEY `accesstemplate_baseRole_idx` (`baseRole`),
  KEY `accesstemplate_status_idx` (`status`),
  KEY `accesstemplate_createdById_fkey` (`createdById`),
  CONSTRAINT `accesstemplate_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `accesstemplate_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AccessTemplatePermission
CREATE TABLE IF NOT EXISTS `accesstemplatepermission` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `templateId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `moduleKey` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accessLevel` enum('VIEW','EDIT') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VIEW',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `accesstemplatepermission_templateId_moduleKey_key` (`templateId`,`moduleKey`),
  KEY `accesstemplatepermission_templateId_idx` (`templateId`),
  CONSTRAINT `accesstemplatepermission_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `accesstemplate` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AttendanceLocation (Geofencing)
CREATE TABLE IF NOT EXISTS `attendancelocation` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `latitude` double NOT NULL,
  `longitude` double NOT NULL,
  `radiusMeters` int NOT NULL DEFAULT '500',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `attendancelocation_organizationId_idx` (`organizationId`),
  KEY `attendancelocation_isActive_idx` (`isActive`),
  CONSTRAINT `attendancelocation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UserAttendanceLocation
CREATE TABLE IF NOT EXISTS `userattendancelocation` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `attendanceLocationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `userattendancelocation_userId_attendanceLocationId_key` (`userId`,`attendanceLocationId`),
  KEY `userattendancelocation_userId_idx` (`userId`),
  KEY `userattendancelocation_attendanceLocationId_idx` (`attendanceLocationId`),
  CONSTRAINT `userattendancelocation_attendanceLocationId_fkey` FOREIGN KEY (`attendanceLocationId`) REFERENCES `attendancelocation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `userattendancelocation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Meeting
CREATE TABLE IF NOT EXISTS `meeting` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `date` datetime(3) NOT NULL,
  `startTime` datetime(3) NOT NULL,
  `endTime` datetime(3) NOT NULL,
  `organizerId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `googleMeetUrl` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('UPCOMING','IN_PROGRESS','COMPLETED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'UPCOMING',
  `projectId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `teamId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `meeting_organizationId_idx` (`organizationId`),
  KEY `meeting_organizerId_idx` (`organizerId`),
  KEY `meeting_projectId_idx` (`projectId`),
  KEY `meeting_teamId_idx` (`teamId`),
  KEY `meeting_date_idx` (`date`),
  KEY `meeting_status_idx` (`status`),
  CONSTRAINT `meeting_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `meeting_organizerId_fkey` FOREIGN KEY (`organizerId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `meeting_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `meeting_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `team` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- MeetingAttendee
CREATE TABLE IF NOT EXISTS `meetingattendee` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `meetingId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `meetingattendee_meetingId_userId_key` (`meetingId`,`userId`),
  KEY `meetingattendee_userId_idx` (`userId`),
  KEY `meetingattendee_meetingId_idx` (`meetingId`),
  CONSTRAINT `meetingattendee_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meeting` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `meetingattendee_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- MeetingReport
CREATE TABLE IF NOT EXISTS `meetingreport` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `meetingId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `followUpTasks` json DEFAULT NULL,
  `createdById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `meetingreport_meetingId_key` (`meetingId`),
  KEY `meetingreport_createdById_idx` (`createdById`),
  CONSTRAINT `meetingreport_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `meetingreport_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `meeting` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CompOffCredit
CREATE TABLE IF NOT EXISTS `compoffcredit` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `workDate` date NOT NULL,
  `attendanceId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creditDays` double NOT NULL DEFAULT '1',
  `usedDays` double NOT NULL DEFAULT '0',
  `availableDays` double NOT NULL DEFAULT '1',
  `earnedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` datetime(3) NOT NULL,
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'APPROVED',
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `claimedByRole` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `claimedById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tlApprovedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tlApprovedAt` datetime(3) DEFAULT NULL,
  `tlRemarks` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `adminApprovedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `adminApprovedAt` datetime(3) DEFAULT NULL,
  `adminRemarks` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `sessionId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `compoffcredit_userId_workDate_key` (`userId`,`workDate`),
  KEY `compoffcredit_organizationId_idx` (`organizationId`),
  KEY `compoffcredit_userId_status_idx` (`userId`,`status`),
  KEY `compoffcredit_expiresAt_idx` (`expiresAt`),
  KEY `compoffcredit_workDate_idx` (`workDate`),
  KEY `compoffcredit_status_idx` (`status`),
  KEY `compoffcredit_sessionId_idx` (`sessionId`),
  KEY `compoffcredit_attendanceId_fkey` (`attendanceId`),
  CONSTRAINT `compoffcredit_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `attendance` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `compoffcredit_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `compoffcredit_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CompOffConsumption
CREATE TABLE IF NOT EXISTS `compoffconsumption` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `creditId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `leaveRequestId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `consumedDays` double NOT NULL,
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CONSUMED',
  `restoredAt` datetime(3) DEFAULT NULL,
  `restoredById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `compoffconsumption_leaveRequestId_creditId_key` (`leaveRequestId`,`creditId`),
  KEY `compoffconsumption_organizationId_idx` (`organizationId`),
  KEY `compoffconsumption_creditId_idx` (`creditId`),
  KEY `compoffconsumption_leaveRequestId_idx` (`leaveRequestId`),
  KEY `compoffconsumption_userId_idx` (`userId`),
  KEY `compoffconsumption_status_idx` (`status`),
  CONSTRAINT `compoffconsumption_creditId_fkey` FOREIGN KEY (`creditId`) REFERENCES `compoffcredit` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `compoffconsumption_leaveRequestId_fkey` FOREIGN KEY (`leaveRequestId`) REFERENCES `leaverequest` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `compoffconsumption_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `compoffconsumption_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CompOffPermissionRequest
CREATE TABLE IF NOT EXISTS `compoffpermissionrequest` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `workDate` date NOT NULL,
  `holidayType` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WEEKLY_OFF',
  `reason` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `approvedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approvedAt` datetime(3) DEFAULT NULL,
  `rejectionReason` text COLLATE utf8mb4_unicode_ci,
  `adminRemarks` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `compoffpermissionrequest_userId_workDate_key` (`userId`,`workDate`),
  KEY `compoffpermissionrequest_organizationId_idx` (`organizationId`),
  KEY `compoffpermissionrequest_userId_status_idx` (`userId`,`status`),
  KEY `compoffpermissionrequest_workDate_idx` (`workDate`),
  KEY `compoffpermissionrequest_status_idx` (`status`),
  KEY `compoffpermissionrequest_approvedById_fkey` (`approvedById`),
  CONSTRAINT `compoffpermissionrequest_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `compoffpermissionrequest_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `compoffpermissionrequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CompOffSession
CREATE TABLE IF NOT EXISTS `compoffsession` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `permissionRequestId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `workDate` date NOT NULL,
  `loginTime` datetime(3) NOT NULL,
  `clockOutTime` datetime(3) DEFAULT NULL,
  `durationHours` decimal(5,2) NOT NULL DEFAULT '0.00',
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `clockOutType` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `locationStatus` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INSIDE',
  `locationName` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `distanceMeters` int DEFAULT NULL,
  `allowedRadiusMeters` int DEFAULT NULL,
  `locationReason` text COLLATE utf8mb4_unicode_ci,
  `flaggedForReview` tinyint(1) NOT NULL DEFAULT '0',
  `ipAddress` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `browser` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `autoClockOutTarget` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  `approvalStatus` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `adminApprovedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `adminApprovedAt` datetime(3) DEFAULT NULL,
  `adminRemarks` text COLLATE utf8mb4_unicode_ci,
  `rejectionReason` text COLLATE utf8mb4_unicode_ci,
  `creditId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `calculatedCredit` decimal(3,1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `compoffsession_permissionRequestId_key` (`permissionRequestId`),
  UNIQUE KEY `compoffsession_userId_workDate_key` (`userId`,`workDate`),
  KEY `compoffsession_organizationId_idx` (`organizationId`),
  KEY `compoffsession_userId_status_idx` (`userId`,`status`),
  KEY `compoffsession_status_idx` (`status`),
  KEY `compoffsession_approvalStatus_idx` (`approvalStatus`),
  KEY `compoffsession_autoClockOutTarget_idx` (`autoClockOutTarget`),
  CONSTRAINT `compoffsession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `compoffsession_permissionRequest_fkey` FOREIGN KEY (`permissionRequestId`) REFERENCES `compoffpermissionrequest` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `compoffsession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CompanyDocument
CREATE TABLE IF NOT EXISTS `companydocument` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `documentName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `filePath` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `originalFileName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fileType` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fileSize` int NOT NULL,
  `uploadedById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiryDate` datetime DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `companydocument_organizationId_idx` (`organizationId`),
  KEY `companydocument_category_idx` (`category`),
  KEY `companydocument_expiryDate_idx` (`expiryDate`),
  KEY `companydocument_uploadedById_fkey` (`uploadedById`),
  CONSTRAINT `companydocument_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `companydocument_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AssetEstimate
CREATE TABLE IF NOT EXISTS `assetestimate` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdById` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estimateNumber` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estimateDate` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reference` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `placeOfSupply` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'GENERATED',
  `title` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Estimate',
  `companyName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `companyAddress` text COLLATE utf8mb4_unicode_ci,
  `companyCity` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `companyState` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `companyPincode` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `companyCountry` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT 'India',
  `companyPhone` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `companyEmail` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `companyGstin` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `companyLogo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billToName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `billToAddress` text COLLATE utf8mb4_unicode_ci,
  `billToCity` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billToState` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billToPincode` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `billToCountry` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT 'India',
  `billToGstin` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subTotal` double NOT NULL DEFAULT '0',
  `cgstRate` double NOT NULL DEFAULT '0',
  `sgstRate` double NOT NULL DEFAULT '0',
  `igstRate` double NOT NULL DEFAULT '0',
  `cgstAmount` double NOT NULL DEFAULT '0',
  `sgstAmount` double NOT NULL DEFAULT '0',
  `igstAmount` double NOT NULL DEFAULT '0',
  `grandTotal` double NOT NULL DEFAULT '0',
  `totalInWords` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `bankName` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bankIfsc` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bankAccountNo` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bankBranch` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `termsAndConditions` json DEFAULT NULL,
  `signatureImage` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signatoryTitle` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT 'Authorized Signature',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `cancelledAt` datetime DEFAULT NULL,
  `cancelledById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cancellationReason` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_org_estimate` (`organizationId`,`estimateNumber`),
  KEY `idx_estimate_org` (`organizationId`),
  KEY `idx_estimate_number` (`estimateNumber`),
  KEY `idx_estimate_org_created` (`organizationId`,`createdAt`),
  KEY `idx_estimate_org_status` (`organizationId`,`status`),
  KEY `idx_estimate_org_date` (`organizationId`,`estimateDate`),
  KEY `idx_estimate_org_customer` (`organizationId`,`billToName`),
  CONSTRAINT `assetestimate_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AssetEstimateItem
CREATE TABLE IF NOT EXISTS `assetestimateitem` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estimateId` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `assetId` varchar(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `itemIndex` int NOT NULL DEFAULT '1',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `quantity` double NOT NULL DEFAULT '1',
  `unit` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'nos',
  `rate` double NOT NULL DEFAULT '0',
  `cgstAmount` double NOT NULL DEFAULT '0',
  `sgstAmount` double NOT NULL DEFAULT '0',
  `igstAmount` double NOT NULL DEFAULT '0',
  `amount` double NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_item_estimate` (`estimateId`),
  KEY `idx_item_asset` (`assetId`),
  CONSTRAINT `fk_item_estimate` FOREIGN KEY (`estimateId`) REFERENCES `assetestimate` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_item_asset` FOREIGN KEY (`assetId`) REFERENCES `asset` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 3. ADD FOREIGN KEY CONSTRAINTS ON USER & ATTENDANCE
-- ------------------------------------------------------------------------------

-- User -> AccessTemplate
ALTER TABLE `user` 
  ADD INDEX `user_accessTemplateId_idx` (`accessTemplateId`),
  ADD CONSTRAINT `user_accessTemplateId_fkey` 
  FOREIGN KEY (`accessTemplateId`) REFERENCES `accesstemplate` (`id`) 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Attendance -> AttendanceLocation
ALTER TABLE `attendance` 
  ADD INDEX `attendance_attendanceLocationId_idx` (`attendanceLocationId`),
  ADD CONSTRAINT `attendance_attendanceLocationId_fkey` 
  FOREIGN KEY (`attendanceLocationId`) REFERENCES `attendancelocation` (`id`) 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------
-- 4. REGISTER MIGRATION IN _PRISMA_MIGRATIONS
-- ------------------------------------------------------------------------------
INSERT INTO `_prisma_migrations` (`id`, `checksum`, `finished_at`, `migration_name`, `logs`, `rolled_back_at`, `started_at`, `applied_steps_count`)
VALUES (
  UUID(),
  'a37c95e1e55099cb633c7784bb5f7b882672bf6d137b0171a74e5ce6ebbb1234',
  NOW(3),
  '20261024120000_sync_crm_features',
  NULL,
  NULL,
  NOW(3),
  1
) ON DUPLICATE KEY UPDATE `finished_at` = NOW(3);

SET FOREIGN_KEY_CHECKS = 1;
