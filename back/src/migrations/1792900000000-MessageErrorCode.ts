/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 *
 * Adds `error_code` (nullable text) to `messages`, `chat_messages` and `ocr_documents`: why a generation, a chat reply or an
 * OCR reading failed when the user can act on it (`memory`: the engine's free-memory check refused the load, "go on anyway").
 * Nullable columns: existing rows are untouched.
 */

import { MigrationInterface, QueryRunner } from "typeorm";

const TABLES = ['messages', 'chat_messages', 'ocr_documents'];

export class MessageErrorCode1792900000000 implements MigrationInterface {
    name = 'MessageErrorCode1792900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of TABLES) await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN "error_code" varchar`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of TABLES) await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "error_code"`);
    }

}
