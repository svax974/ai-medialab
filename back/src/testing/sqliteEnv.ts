/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/**
 * Import this module FIRST in every spec that loads the studio entities: their JSON columns pick `simple-json`
 * (SQLite) or `jsonb` (Postgres) when the decorators run, i.e. at import time.
 */
process.env.DB_ENGINE = 'sqlite';
process.env.DB_ENGINE = 'sqlite';
process.env.CRYPT_DB_MASTER_KEY = process.env.CRYPT_DB_MASTER_KEY ?? Buffer.alloc(32, 7).toString('base64');
