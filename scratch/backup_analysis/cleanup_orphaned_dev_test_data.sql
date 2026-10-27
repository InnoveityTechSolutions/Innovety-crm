-- ==============================================================================
-- InnovEity CRM - Surgical Cleanup of Orphaned Development Test Records
-- Target Environment: Local Development Only (innoveity_crm)
-- Description: Removes specifically identified development test records whose
--              referenced users (Vinith, Test Emp Phase 3, Phase 4 Employee)
--              do not exist in the live database.
-- ==============================================================================

-- 1. Remove 5 orphaned compoffconsumption records
DELETE FROM `compoffconsumption` WHERE `id` IN (
  '4c8bbfb1-04e4-4bee-831e-55746502d946',
  '66560919-5eae-40cf-8959-47694ac83e51',
  'ad361e95-4fb2-41ac-aac3-85f75ce66d3a',
  'b4e3c102-08f5-4343-a772-db2754e90e97',
  'c40670c8-bda6-4523-be63-7348dc6d64b7'
);

-- 2. Remove 6 orphaned compoffcredit records
DELETE FROM `compoffcredit` WHERE `id` IN (
  '3f519217-64fc-42e7-b00c-eba87828dc84',
  '6fcc644b-6e02-4cd0-b3f9-a58fd15a89d3',
  'd79df6f9-cd37-4247-a896-cb296da701b3',
  'dc4aff71-5d0a-4438-8b94-eecae19dc8bd',
  'e3534e5d-bd47-4e56-824e-9059c1fdc9b7',
  'ef401fe0-7c67-4367-81a6-69646011e6d3'
);

-- 3. Remove 3 orphaned meetingattendee records
DELETE FROM `meetingattendee` WHERE `id` IN (
  '712d5713-1f7c-4968-a9dd-a0da45cec4e3',
  'fcfc5705-936f-4f0b-b593-74058162ae9a',
  'db20b4a0-77c1-4738-a1d0-2ebec555940a'
);
