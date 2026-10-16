/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
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
