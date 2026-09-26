---
name: PostgreSQL TLS environments
description: Different TLS requirements for the Railway production database and local development database.
---

Railway PostgreSQL presents a certificate chain the DigitalOcean app cannot verify, while the local development database rejects SSL connections. Changes to the PostgreSQL connection must account for both environments rather than enabling or disabling TLS unconditionally.

**Why:** Adding a pool SSL option alone did not fix Railway because URL SSL settings took precedence. Removing the URL SSL setting and unconditionally enabling TLS then broke local development migrations.

**How to apply:** When changing connection setup, verify the effective options for both a TLS-required production URL and an explicitly non-SSL development URL, then confirm local database-backed startup. Do not store database credentials in this note.