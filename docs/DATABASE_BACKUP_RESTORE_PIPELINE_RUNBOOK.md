# InnovEity CRM — Production-Safe Backup & Restore Pipeline Runbook
**Document Version:** 1.0.0  
**Target Environments:** Local Development, Staging, and Production Release Preparation  
**Security Classification:** Internal Engineering Standard  

---

## 1. Executive Summary
This runbook defines the operational standards and engineering procedures for creating disaster-recovery database backups, safely restoring production snapshots into local development environments without schema regression, managing Prisma schema migrations, and executing production releases with zero data loss.

---

## 2. Architecture & Pipeline Overview

The backup and restore pipeline consists of three core components:
1. **`backend/src/services/backupService.js`**: Creates transaction-consistent MySQL dumps (`--single-transaction`) packaged in ZIP archives with structured metadata (`backup_info.json`), automated parity checks, and manifest tracking.
2. **`backend/src/services/restoreService.js`**: Orchestrates a 14-stage sandbox-first restore workflow, concurrency locking, target safety verification, automated Prisma migration discovery and execution, read-only foreign-key integrity audits, and safe promotion.
3. **`backend/prisma/migrations/`**: Version-controlled migration definitions tracked via `_prisma_migrations`.

```
[Uploaded Backup Archive (.zip / .sql)]
                │
                ▼
      [Archive Integrity Validation]
                │
                ▼
     [Target Safety Gate (Local Whitelist)]
                │
                ▼
   [Create Isolated Staging Sandbox DB]
                │
                ▼
    [Stream Import Dump into Sandbox]
                │
                ▼
   [Inspect Schema & Migration History]
                │
    ┌───────────┴───────────┐
    │ Table Count < 94 or   │ Table Count == 94 &
    │ Migrations Pending    │ Parity Satisfied
    ▼                       ▼
[Apply Version-Controlled  [Skip Migrations]
 Migration (.sql)]          │
    │                       │
    └───────────┬───────────┘
                │
                ▼
   [Read-Only Data Integrity Audit]
    - Scans for orphaned foreign keys
    - Verifies Organization & Super Admin
                │
                ▼
   [Post-Restore Application Health Checks]
                │
    ┌───────────┴───────────┐
    │ Promoted to Active    │ Sandbox Inspection Only
    ▼                       ▼
[Mandatory Pre-Restore    [Return Audit Report]
 Safety Backup of Active]   │
    │                       ▼
    ▼                     [Clean Drop Sandbox]
[Copy Sandbox to Active DB]
    │
    ▼
[Verify Active Database & Manifest Update]
    │
    ▼
[Clean Drop Staging Sandbox]
```

---

## 3. How to Create and Verify Backups

### A. Via the Super Admin Web Interface
1. Log in as Super Admin (`superadmin@enterprise-crm.com`).
2. Navigate to **System Administration → Database Backup & Restore** (`/super-admin/backups`).
3. Click **"Create Live Backup"**.
4. The system executes `mysqldump` with `--single-transaction`, packages `innoveity_live.sql`, `backup_info.json`, and `README.txt`, verifies uncompressibility and table row parity, and stores the archive in `backend/backups/`.
5. Download the backup via the table's download action.

### B. Programmatically via API
```bash
# Generate Live Production Backup (Requires Super Admin JWT)
curl -X POST http://localhost:5000/api/backups/live \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -H "Content-Type: application/json"
```

### C. Manual CLI Backup Creation (Local / Staging)
```powershell
# Run from repository root
cd backend
mysqldump -h localhost -P 3306 -u root --single-transaction --routines --triggers --events --quick --hex-blob --default-character-set=utf8mb4 innoveity_crm > ../scratch/manual_backup_$(Get-Date -Format 'yyyyMMdd_HHmm').sql
```

---

## 4. How to Restore a Live Backup into Local Development

### Safety Principles
1. **Never restore directly over active data:** The pipeline always stages imports into a disposable sandbox database (`innoveity_restore_sandbox_*`) first.
2. **Automatic Schema Upgrade:** When restoring an older live backup (80 tables), the pipeline automatically applies pending version-controlled migrations (`20261024120000_sync_crm_features/migration.sql`), bringing the database to 94 tables and full column parity.
3. **Mandatory Safety Backup:** Before overwriting the active local database, the pipeline generates an automatic safety backup (`pre_restore_backup_*.zip`).

### A. Restoring via the Super Admin Web Interface
1. Navigate to `/super-admin/backups`.
2. Click **"Restore from Backup Archive"**.
3. Select the `.zip` backup package.
4. Review the pre-restore inspection modal (displays database name, table count, record count, and schema version).
5. Click **"Execute Restore"**. The system executes the sandbox-first staging pipeline, applies pending migrations, takes a pre-restore safety backup, promotes the data, and displays the verification report.

### B. Programmatic Execution in Automated Scripts / Node.js
```javascript
const { executeLiveRestore } = require('./backend/src/services/restoreService');

// Safe, sandbox-orchestrated restore
const result = await executeLiveRestore({
  tempFileName: 'innoveity_live_backup_2026-10-23_11-29.zip',
  originalFileName: 'live_backup.zip',
  user: { name: 'Super Admin', role: 'SUPER_ADMIN' },
  promoteToActive: true,      // Set to false for preview / validation only
  runMigrations: true         // Automatically upgrades older 80-table schema to 94 tables
});

console.log('Restored tables:', result.tablesRestored);
console.log('Applied migrations:', result.appliedMigrations);
```

---

## 5. How Schema Migrations Are Handled

### Rules for Schema Changes
1. **Never use `prisma db push --accept-data-loss` in any environment:** `db push` causes silent column drops, data corruption, and migration history drift.
2. **Version-Controlled Migration Files:** All schema changes must be declared as standalone SQL files in:
   `backend/prisma/migrations/<YYYYMMDDHHMMSS>_<description>/migration.sql`
3. **Topological Order:** The migration engine executes migrations in ascending order based on timestamp prefix.
4. **Idempotent Reconciliation:** Applied migrations are recorded with their SHA256 checksum in `_prisma_migrations`. Migrations already applied are skipped safely.

### Migration Status Inspection
To check pending migrations on any local or staging database:
```javascript
const { getPendingMigrations } = require('./backend/src/services/restoreService');
const status = await getPendingMigrations(dbConfig, 'innoveity_crm');
console.log('Needs upgrade:', status.needsUpgrade);
console.log('Pending migrations:', status.pendingMigrations.map(m => m.name));
```

---

## 6. Development Test Data Isolation & Recovery

### Separation of Production and Test Data
- Live production backup restoration **never** imports local development test fixtures automatically.
- Recovered mock test data must remain strictly isolated in local development.

### Recovering Local Development Data (Optional Development Action)
When developing features locally that require mock locations, templates, and sessions, use the verified clean recovery script:
```powershell
# Applies 48 verified development test records referencing real live users
mysql -h localhost -P 3306 -u root innoveity_crm < scratch/backup_analysis/recover_local_test_data_clean.sql
```

### Surgical Cleanup of Orphaned Development Data
If legacy test records referencing non-existent mock users cause HTTP 500 errors in Meetings or Comp-Off modules:
```powershell
# Executes surgical deletion of specifically identified orphaned tuples
mysql -h localhost -P 3306 -u root innoveity_crm < scratch/backup_analysis/cleanup_orphaned_dev_test_data.sql
```

---

## 7. Deployment Team: Production Release Runbook

### Pre-Deployment Checklist
1. [ ] **Verify Production Backup:** Take a full production backup using the Super Admin UI or native mysqldump and download the verified archive offsite.
2. [ ] **Review Migration SQL:** Inspect `backend/prisma/migrations/20261024120000_sync_crm_features/migration.sql`. Confirm that all statements are non-destructive (`ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`).
3. [ ] **Database Access Gate:** Confirm target is the staging or production instance. Verify zero connections during the 2-minute maintenance window.

### Production Migration Application
```powershell
# Step 1: Pre-deployment transaction-consistent backup
mysqldump -h <PROD_HOST> -P 3306 -u <PROD_USER> -p --single-transaction --routines --triggers --events --quick --hex-blob --default-character-set=utf8mb4 <PROD_DB> > prod_safety_backup_before_sync.sql

# Step 2: Apply the verified feature synchronization migration DDL
mysql -h <PROD_HOST> -P 3306 -u <PROD_USER> -p <PROD_DB> < backend/prisma/migrations/20261024120000_sync_crm_features/migration.sql

# Step 3: Register migration in _prisma_migrations
node -e "
const { applyPendingMigrations, parseDbConfig } = require('./backend/src/services/restoreService');
// Registers migration metadata and checksum
"

# Step 4: Validate application health
curl https://<PROD_DOMAIN>/api/health
```

---

## 8. Failure Recovery & Rollback Procedures

### Scenario A: Restore Interrupted or Failed During Sandbox Phase
- **Impact:** Zero impact on active database.
- **Action:** The sandbox database (`innoveity_restore_sandbox_*`) is automatically dropped by the `finally` block. The restore lock is released. Re-attempt restore.

### Scenario B: Target Database Failure During Promotion
- **Protection:** A verified pre-restore safety backup (`pre_restore_backup_*.zip`) was created in `backend/backups/` before any write occurred to the active database.
- **Rollback Procedure:**
  ```powershell
  # Locate the pre-restore backup from the restore response or backend/backups/
  # Restore the safety backup into the target database:
  unzip backend/backups/pre_restore_backup_<DATE_TIME>.zip -d temp_rollback/
  mysql -h localhost -P 3306 -u root innoveity_crm < temp_rollback/database/innoveity_live.sql
  rm -r temp_rollback/
  ```

---

## 9. Required Approvals & Safety Gates
| Action | Required Role | Environment Restrictions | Automated Safety Gate |
| :--- | :--- | :--- | :--- |
| **Create Backup** | `SUPER_ADMIN` | Local, Staging, Production | Parity validation gate; manifest logging |
| **Restore Live Backup** | `SUPER_ADMIN` | Local Development, Staging | Host whitelisting; sandbox staging; pre-restore backup |
| **Apply Migrations** | Deployment Team | Staging, Production | Topological ordering; `_prisma_migrations` tracking |
| **Import Test Fixtures** | Developer | Local Development Only | Forbidden on staging/production |
