import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { selfUpdateRecordSchema, type SelfUpdateRecord } from '../../shared/self-development'

export type AuditEvent = {
  id: string
  updateId: string
  actor: string
  action:
    | 'proposed'
    | 'approved'
    | 'promotion-requested'
    | 'verified'
    | 'rolled-back'
    | 'failed'
    | 'cancelled'
  createdAt: string
  details: Record<string, string | number | boolean | null>
}

export interface SelfUpdateStore {
  create(record: SelfUpdateRecord): Promise<SelfUpdateRecord>
  get(id: string): Promise<SelfUpdateRecord>
  update(id: string, patch: Partial<SelfUpdateRecord>): Promise<SelfUpdateRecord>
  list(): Promise<SelfUpdateRecord[]>
}

export interface AuditStore {
  append(event: AuditEvent): Promise<AuditEvent>
  forUpdate(updateId: string): Promise<AuditEvent[]>
}

export class MemorySelfUpdateStore implements SelfUpdateStore {
  private readonly records = new Map<string, SelfUpdateRecord>()

  async create(record: SelfUpdateRecord) {
    const value = structuredClone(selfUpdateRecordSchema.parse(record))
    this.records.set(value.id, value)
    return structuredClone(value)
  }

  async get(id: string) {
    const record = this.records.get(id)
    if (!record) throw new Error('Self-update record not found.')
    return structuredClone(record)
  }

  async update(id: string, patch: Partial<SelfUpdateRecord>) {
    const current = await this.get(id)
    const next = selfUpdateRecordSchema.parse({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    })
    this.records.set(id, next)
    return structuredClone(next)
  }

  async list() {
    return [...this.records.values()].map((record) => structuredClone(record))
  }
}

export class FileSelfUpdateStore implements SelfUpdateStore {
  private readonly fallback = new MemorySelfUpdateStore()
  private loaded = false

  constructor(private readonly filePath: string) {}

  async create(record: SelfUpdateRecord) {
    await this.load()
    const value = await this.fallback.create(record)
    await this.persist()
    return value
  }

  async get(id: string) {
    await this.load()
    return this.fallback.get(id)
  }

  async update(id: string, patch: Partial<SelfUpdateRecord>) {
    await this.load()
    const value = await this.fallback.update(id, patch)
    await this.persist()
    return value
  }

  async list() {
    await this.load()
    return this.fallback.list()
  }

  private async load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const records = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(records)) throw new Error('Invalid self-update store.')
      for (const record of records) await this.fallback.create(selfUpdateRecordSchema.parse(record))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('The self-update store is invalid or unreadable.')
    }
  }

  private async persist() {
    const temporary = this.filePath + '.tmp'
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(temporary, JSON.stringify(await this.fallback.list(), null, 2), 'utf8')
    await rename(temporary, this.filePath)
  }
}

export class MemoryAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = []

  async append(event: AuditEvent) {
    const value = structuredClone(event)
    this.events.push(value)
    return structuredClone(value)
  }

  async forUpdate(updateId: string) {
    return this.events.filter((event) => event.updateId === updateId).map((event) => structuredClone(event))
  }
}

export class FileAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = []
  private loaded = false

  constructor(private readonly filePath: string) {}

  async append(event: AuditEvent) {
    await this.load()
    this.events.push(structuredClone(event))
    await this.persist()
    return structuredClone(event)
  }

  async forUpdate(updateId: string) {
    await this.load()
    return this.events.filter((event) => event.updateId === updateId).map((event) => structuredClone(event))
  }

  private async load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const events = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      if (!Array.isArray(events)) throw new Error('Invalid self-update audit log.')
      this.events.push(...(events as AuditEvent[]))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('The self-update audit log is invalid or unreadable.')
    }
  }

  private async persist() {
    const temporary = this.filePath + '.tmp'
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(temporary, JSON.stringify(this.events, null, 2), 'utf8')
    await rename(temporary, this.filePath)
  }
}

export function newAuditEvent(
  updateId: string,
  action: AuditEvent['action'],
  actor: string,
  details: AuditEvent['details'] = {},
): AuditEvent {
  return {
    id: randomUUID(),
    updateId,
    actor: actor.slice(0, 200),
    action,
    createdAt: new Date().toISOString(),
    details,
  }
}
