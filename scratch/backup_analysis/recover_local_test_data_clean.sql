-- ==============================================================================
-- InnovEity CRM - Clean Local Development Test Data (Verified Foreign Keys Only)
-- Total Records: 48 valid development test records
-- Note: All records reference verified live users and organizations.
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Attendance Locations (2 records)
INSERT INTO `attendancelocation` VALUES 
('02eaa3f1-c9ec-450a-94c0-2ed28d9cabb1','cmu43zvwm0000exne7d53m25e','St. Thomas hall','Bell Tower, Major Mukund Varadharajan Salai, IOB Colony, East Tambaram, Tambaram, Chengalpattu, Tamil Nadu, 600073, India',12.920252,80.121764,10,1,'2026-10-09 09:01:47.350','2026-10-09 10:41:26.116'),
('5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','cmu43zvwm0000exne7d53m25e','MCC MRF Innovation Park','Bell Tower, Major Mukund Varadharajan Salai, IOB Colony, East Tambaram, Tambaram, Chengalpattu, Tamil Nadu, 600073, India',12.920368,80.12169,10,1,'2026-10-09 09:00:48.293','2026-10-09 10:42:16.193')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- 2. User Attendance Location Mappings (10 records - all users exist in live DB)
INSERT INTO `userattendancelocation` VALUES 
('0c2e5172-832b-4deb-97c4-2f8539a1a6dd','e9b4c8ee-b4d3-46bb-9fec-00f44af6ad09','5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','2026-10-09 11:18:28.077'),
('347b0665-77a4-4514-aa72-b2c2bac484d2','d98878eb-3380-41ca-810e-e0eb588df428','5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','2026-10-09 11:18:28.077'),
('54bd9487-593e-405f-98b9-64104529057b','4b7eb095-c2ae-47f1-868a-59d81df55054','02eaa3f1-c9ec-450a-94c0-2ed28d9cabb1','2026-10-12 05:27:49.061'),
('5c9e32fb-67ce-4b81-be06-eb05e9b4dabb','26820ba7-fe42-4015-bfa2-096da9b46844','5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','2026-10-09 11:18:28.077'),
('6aaa4966-5d8a-4acf-ba03-474f961aa945','42c50c9a-25bd-4fde-9253-8a532a972e5a','5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','2026-10-12 05:23:19.462'),
('c9d6e0e3-d09d-4123-8e47-f40e001db60f','56b6e992-8048-457e-b49d-8710e56e1314','5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','2026-10-09 11:18:28.077'),
('d0abf2f8-3267-4f37-83bb-0f7644479b8a','f6b18536-db78-4c09-a866-dba66e47be18','5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','2026-10-09 11:18:28.077'),
('e194d9f0-302d-449f-a4bc-a98e16206c10','56b6e992-8048-457e-b49d-8710e56e1314','02eaa3f1-c9ec-450a-94c0-2ed28d9cabb1','2026-10-09 11:18:20.176'),
('ec0fc241-d820-47ca-83bd-11daf83fa00a','42c50c9a-25bd-4fde-9253-8a532a972e5a','02eaa3f1-c9ec-450a-94c0-2ed28d9cabb1','2026-10-12 05:23:19.462'),
('f366adf1-c995-43da-8cd2-03609986a724','e2b80aec-e340-4c93-8385-3cb3146bc1e0','5bb8433e-d9ed-4b9a-8d74-39c0c0ab51ba','2026-10-09 11:18:28.077')
ON DUPLICATE KEY UPDATE `assignedAt`=VALUES(`assignedAt`);

-- 3. Access Template & Permissions (1 + 15 = 16 records)
INSERT INTO `accesstemplate` VALUES 
('cmv5aijtn0043iwdly7qza29w','Finance',NULL,'ADMIN','cmu43zvwm0000exne7d53m25e','ACTIVE','1f3d7421-c926-4958-8c56-984bc6f7f5d3','2026-10-12 13:30:55.067','2026-10-12 13:43:05.562')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

INSERT INTO `accesstemplatepermission` VALUES 
('cmv5ay7i2004tiwdlji18ujyf','cmv5aijtn0043iwdly7qza29w','profile','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i2004uiwdljryvxwuo','cmv5aijtn0043iwdly7qza29w','attendance','VIEW','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i2004viwdlxmo5icqe','cmv5aijtn0043iwdly7qza29w','attendance_audit','VIEW','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i2004wiwdlzqwn0uk6','cmv5aijtn0043iwdly7qza29w','work_calendar','VIEW','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i2004xiwdli9cifhkz','cmv5aijtn0043iwdly7qza29w','assets','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i2004yiwdlmq1advmc','cmv5aijtn0043iwdly7qza29w','company_documents','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i2004ziwdlh5oqs85d','cmv5aijtn0043iwdly7qza29w','payroll_dashboard','VIEW','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i20050iwdlsfka5um9','cmv5aijtn0043iwdly7qza29w','payroll_templates','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i20051iwdlvxqs1tje','cmv5aijtn0043iwdly7qza29w','payroll_structures','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i20052iwdltm08k5wh','cmv5aijtn0043iwdly7qza29w','payroll_process','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i20053iwdlt8q8yqgj','cmv5aijtn0043iwdly7qza29w','payroll_payslips','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i20054iwdlk2zooyer','cmv5aijtn0043iwdly7qza29w','payroll_holidays','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i20055iwdl5l4tm8ba','cmv5aijtn0043iwdly7qza29w','payroll_reports','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i30056iwdlsirgrk88','cmv5aijtn0043iwdly7qza29w','payroll_settings','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594'),
('cmv5ay7i30057iwdl0ggeoxb3','cmv5aijtn0043iwdly7qza29w','my_payroll','EDIT','2026-10-12 13:43:05.594','2026-10-12 13:43:05.594')
ON DUPLICATE KEY UPDATE `permissionLevel`=VALUES(`permissionLevel`);

-- 4. Meetings (6 records)
INSERT INTO `meeting` VALUES 
('042f2bf6-d8eb-4254-a46e-9bf39122b3ea','cmu43zvwm0000exne7d53m25e','Morning Standup (Past Time Today)','Morning sync earlier today','2026-10-14 00:00:00.000','2026-10-14 06:00:00.000','2026-10-14 06:30:00.000','939e83b4-c679-469f-aacf-613885652d55',NULL,'CANCELLED',NULL,NULL,'2026-10-14 11:18:54.492','2026-10-14 11:25:51.621'),
('46537298-5cdb-4882-93fc-4e49962797cc','cmu43zvwm0000exne7d53m25e','Sprint Planning (Future Meeting)',NULL,'2026-10-17 00:00:00.000','2026-10-17 15:00:00.000','2026-10-17 16:00:00.000','939e83b4-c679-469f-aacf-613885652d55',NULL,'UPCOMING',NULL,NULL,'2026-10-14 11:18:54.533','2026-10-14 11:18:54.533'),
('805413c0-6fd8-4237-a5e4-23def61a2d44','cmu43zvwm0000exne7d53m25e','Test 3',NULL,'2026-10-15 00:00:00.000','2026-10-15 04:30:00.000','2026-10-15 05:30:00.000','939e83b4-c679-469f-aacf-613885652d55','https://meet.google.com/tto-vtsq-gpf','CANCELLED',NULL,NULL,'2026-10-14 11:24:55.512','2026-10-14 11:25:14.564'),
('d6fd291f-5541-4f8a-b4c9-287ad47aac6d','cmu43zvwm0000exne7d53m25e','Testing',NULL,'2026-10-14 00:00:00.000','2026-10-14 09:30:00.000','2026-10-14 10:30:00.000','939e83b4-c679-469f-aacf-613885652d55','https://meet.google.com/tto-vtsq-gpf','COMPLETED',NULL,NULL,'2026-10-14 09:02:28.090','2026-10-14 09:02:51.173'),
('ea263387-71c1-46ba-8806-8528a3d58459','cmu43zvwm0000exne7d53m25e','Test 4',NULL,'2026-10-15 00:00:00.000','2026-10-15 04:30:00.000','2026-10-15 05:30:00.000','939e83b4-c679-469f-aacf-613885652d55','https://meet.google.com/tto-vtsq-gpf','UPCOMING',NULL,NULL,'2026-10-14 11:26:21.464','2026-10-14 11:26:21.464'),
('f18ae978-70c0-4852-b81d-6bc977cf1c06','cmu43zvwm0000exne7d53m25e','Historical Retrospective Sync (Past Meeting)','Reviewing sprint work that occurred last week','2026-10-09 00:00:00.000','2026-10-09 09:30:00.000','2026-10-09 10:30:00.000','939e83b4-c679-469f-aacf-613885652d55',NULL,'COMPLETED',NULL,NULL,'2026-10-14 11:18:54.422','2026-10-14 11:18:54.597')
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 5. Meeting Attendees (4 verified records referencing real users Akshat P & Anto A)
INSERT INTO `meetingattendee` VALUES 
('3d40a4e5-d1b7-4d71-ac3b-79aea7978bc1','f18ae978-70c0-4852-b81d-6bc977cf1c06','213eb98a-de19-4c5e-b5dd-f02dea75e12e','2026-10-14 11:18:54.422'),
('45f28851-b44a-4acf-ae29-705b7f383979','46537298-5cdb-4882-93fc-4e49962797cc','213eb98a-de19-4c5e-b5dd-f02dea75e12e','2026-10-14 11:18:54.533'),
('b96d245e-ce73-4bea-9680-5d8d82ebff60','042f2bf6-d8eb-4254-a46e-9bf39122b3ea','213eb98a-de19-4c5e-b5dd-f02dea75e12e','2026-10-14 11:18:54.492'),
('efcc3235-2d89-4d27-9f75-b1fea182d8b3','d6fd291f-5541-4f8a-b4c9-287ad47aac6d','42c50c9a-25bd-4fde-9253-8a532a972e5a','2026-10-14 09:02:28.090')
ON DUPLICATE KEY UPDATE `createdAt`=VALUES(`createdAt`);

-- 6. Meeting Reports (2 records)
INSERT INTO `meetingreport` VALUES 
('3f00340b-0ca5-460f-8e51-80955571ab3f','d6fd291f-5541-4f8a-b4c9-287ad47aac6d','cawvcw','[]','939e83b4-c679-469f-aacf-613885652d55','2026-10-14 09:02:51.226','2026-10-14 09:02:51.226'),
('fe35b7df-db28-4dfe-a1d8-771f4e251cd1','f18ae978-70c0-4852-b81d-6bc977cf1c06','Executive recap: successfully completed past retrospective review.','[{\"title\": \"Action item from retrospective\", \"deadline\": null, \"priority\": \"HIGH\", \"assigneeId\": \"213eb98a-de19-4c5e-b5dd-f02dea75e12e\", \"description\": \"\"}]','939e83b4-c679-469f-aacf-613885652d55','2026-10-14 11:18:54.627','2026-10-14 11:18:54.627')
ON DUPLICATE KEY UPDATE `summary`=VALUES(`summary`);

-- 7. Comp-Off Credits (1 verified record referencing real user Anto A)
INSERT INTO `compoffcredit` VALUES 
('de35a381-8d5a-4bb0-a5af-301af1fc22a9','cmu43zvwm0000exne7d53m25e','42c50c9a-25bd-4fde-9253-8a532a972e5a','2026-10-22',NULL,1,0,1,'2026-10-22 09:29:56.542','2027-01-20 18:29:59.999','APPROVED','Approved upon administrative verification.','ADMIN','939e83b4-c679-469f-aacf-613885652d55',NULL,NULL,NULL,'939e83b4-c679-469f-aacf-613885652d55','2026-10-22 09:29:56.530','Approved upon administrative verification.','2026-10-22 09:29:56.542','2026-10-22 09:29:56.542','9abfa8f4-e313-480d-8380-aa61a39b5b32')
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`);

-- 8. Comp-Off Permission Requests (3 records referencing real user Anto A)
INSERT INTO `compoffpermissionrequest` VALUES 
('7986a12e-0521-4fcd-9a18-204dfc54ac4c','cmu43zvwm0000exne7d53m25e','42c50c9a-25bd-4fde-9253-8a532a972e5a','2026-10-24','WEEKLY_OFF','Testing','APPROVED','939e83b4-c679-469f-aacf-613885652d55','2026-10-21 08:57:05.691',NULL,'Approved upon administrative verification.','2026-10-21 08:56:26.345','2026-10-21 08:57:05.694'),
('b62af024-789b-4da3-aa77-ee097f2a5b58','cmu43zvwm0000exne7d53m25e','42c50c9a-25bd-4fde-9253-8a532a972e5a','2026-10-28','COMPANY_HOLIDAY','Testing','REJECTED','939e83b4-c679-469f-aacf-613885652d55','2026-10-21 10:05:10.318','No i can\'t',NULL,'2026-10-21 09:45:41.349','2026-10-21 10:05:10.321'),
('b7a47c7f-fb7a-4171-b142-55bbc7b56373','cmu43zvwm0000exne7d53m25e','42c50c9a-25bd-4fde-9253-8a532a972e5a','2026-10-22','COMPANY_HOLIDAY','Testing','APPROVED','939e83b4-c679-469f-aacf-613885652d55','2026-10-21 10:04:34.092',NULL,'Approved upon administrative verification.','2026-10-21 10:00:46.718','2026-10-21 10:04:34.095')
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`);

-- 9. Comp-Off Session (1 record referencing real user Anto A)
INSERT INTO `compoffsession` VALUES 
('9abfa8f4-e313-480d-8380-aa61a39b5b32','cmu43zvwm0000exne7d53m25e','42c50c9a-25bd-4fde-9253-8a532a972e5a','b7a47c7f-fb7a-4171-b142-55bbc7b56373','2026-10-22','2026-10-22 06:23:47.042','2026-10-22 07:35:55.236',1.20,'COMPLETED','MANUAL',12.9201360,80.1217220,'OUTSIDE','St. Thomas hall',14,10,'Home (Remote): Work from home',1,'::1','Desktop','Chrome',NULL,'2026-10-22 06:23:47.111','2026-10-22 09:29:56.558','APPROVED','939e83b4-c679-469f-aacf-613885652d55','2026-10-22 09:29:56.530','Approved upon administrative verification.',NULL,'de35a381-8d5a-4bb0-a5af-301af1fc22a9',1.0)
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`);

-- 10. Company Document (1 record uploaded by Super Admin)
INSERT INTO `companydocument` VALUES 
('cmuzai5b3000p4f2yagdgrx2m','cmu43zvwm0000exne7d53m25e','Bill','Company Documents',NULL,'doc_1791449039133_6a5ace.pdf','88306.pdf','PDF',551989,'939e83b4-c679-469f-aacf-613885652d55',NULL,'2026-10-08 08:43:59.199','2026-10-08 08:43:59.199')
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 11. Asset Estimate & Items (1 + 1 = 2 records created by Super Admin)
INSERT INTO `assetestimate` VALUES 
('b4a8082d-85d3-4503-b988-17c4cd5eac4d','cmu43zvwm0000exne7d53m25e','939e83b4-c679-469f-aacf-613885652d55','EST-001005','2026-10-08 00:00:00',NULL,'Tamil Nadu (33)','GENERATED','Estimate','Innoveity Tech','MCC - MFR Innovation Park, East Tambaram, Chennai 600059 Tamil Nadu, India','Chennai','Tamil Nadu','600059','India','+91 9094021161','contact@innoveity.com','33ACFPN3295D2ZQ','/uploads/logos/1789711179526-761765952-Innoveity_Globs1.png','Innoveity',NULL,NULL,'Tamil Nadu',NULL,'India',NULL,100000,0,0,0,0,0,0,100000,'Indian Rupee One Lakh Only','INDIAN BANK','IDIB000M126','453691659','MADIPAKKAM','Looking forward for your business.','[\"1. Delivery: 2 days against P.O\", \"2. Payment: 100% advance\", \"3. Taxes: As applicable\", \"4. Validity of Quote: 7 days only\"]',NULL,'Authorized Signatory','2026-10-08 04:56:04','2026-10-08 04:56:04',NULL,NULL,NULL)
ON DUPLICATE KEY UPDATE `estimateNumber`=VALUES(`estimateNumber`);

INSERT INTO `assetestimateitem` VALUES 
('684c5cde-6cf8-4d00-928f-5e7482648406','b4a8082d-85d3-4503-b988-17c4cd5eac4d',NULL,1,'OmniBook','S/N: 756747689 | IDs: INNT-1007',1,'nos',100000,0,0,0,100000)
ON DUPLICATE KEY UPDATE `itemName`=VALUES(`itemName`);

SET FOREIGN_KEY_CHECKS = 1;
