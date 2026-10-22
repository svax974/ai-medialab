/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 *
 * Adds `chat_messages.generations` (nullable JSON): the images, videos and sounds a chat reply asked the studios for
 * (creation tools of the chat). A nullable column: existing rows are untouched.
 */

import { MigrationInterface, QueryRunner } from "typeorm";

export class ChatGenerations1792070000000 implements MigrationInterface {
    name = 'ChatGenerations1792070000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_messages" ADD COLUMN "generations" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "generations"`);
    }

}
