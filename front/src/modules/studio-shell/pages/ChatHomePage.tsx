/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { ChatHome } from '@/modules/chat/components/ChatHome'

/** `/chat`: the chat's home page (module `chat`), loaded on demand (it carries the Markdown renderer). */
export default function ChatHomePage() {
  return <ChatHome />
}
