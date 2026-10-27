SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `compoffcredit`;
CREATE TABLE `compoffcredit` (
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

SET FOREIGN_KEY_CHECKS = 1;
