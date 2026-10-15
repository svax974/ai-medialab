/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * The engine holds one model at a time (shared memory): a chat reply and a media generation never run together, and
 * it answers 409 to whichever comes second. This gauge lets the two sides of Nest respect that without importing each
 * other: the chat takes it for the length of a reply (`tryAcquire`), the generation queue does not submit a job while
 * it is held and resumes when it is released (`released$`). The queue is the reverse check, done by the chat through
 * `GenerationQueueService.snapshot()`.
 */
@Injectable()
export class EngineBusyGate {
  private holder: string | null = null;
  private readonly releasedSubject = new Subject<void>();

  /** Emits each time the gauge is released. */
  get released$(): Observable<void> {
    return this.releasedSubject.asObservable();
  }

  get busy(): boolean {
    return this.holder !== null;
  }

  /** Who holds the gauge (for messages), or null. */
  get heldBy(): string | null {
    return this.holder;
  }

  /** True when the gauge was free and is now held by `owner`; the caller must `release` it. */
  tryAcquire(owner: string): boolean {
    if (this.holder !== null) return false;
    this.holder = owner;
    return true;
  }

  /** Releases the gauge if `owner` holds it (a late release by someone else is ignored). */
  release(owner: string): void {
    if (this.holder !== owner) return;
    this.holder = null;
    this.releasedSubject.next();
  }
}
