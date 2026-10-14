import { randomUUID } from 'node:crypto'
import {
  canTransition,
  changeTaskSchema,
  riskRequiresApproval,
  type ChangeRisk,
  type ChangeTask,
  type ChangeTaskState,
} from '../../shared/change-task'

export class ChangeTaskStore {
  private readonly tasks = new Map<string, ChangeTask>()
  private readonly listeners = new Set<(task: ChangeTask) => void>()

  create(input: { repositoryRoot: string; prompt: string; risk?: ChangeRisk }) {
    const now = new Date().toISOString()
    const risk = input.risk ?? 'renderer-behavior'
    const task = changeTaskSchema.parse({
      id: randomUUID(),
      repositoryRoot: input.repositoryRoot,
      worktreePath: null,
      baselineCommit: null,
      prompt: input.prompt,
      plan: null,
      state: 'requested',
      risk,
      changedFiles: [],
      checks: [],
      preview: { status: 'not-started' },
      approval: { required: riskRequiresApproval(risk), approved: false },
      createdAt: now,
      updatedAt: now,
    })
    this.tasks.set(task.id, task)
    this.publish(task)
    return structuredClone(task)
  }

  get(id: string) {
    const task = this.tasks.get(id)
    if (!task) throw new Error('Change task not found.')
    return structuredClone(task)
  }

  list() {
    return [...this.tasks.values()].map((task) => structuredClone(task))
  }

  transition(id: string, state: ChangeTaskState, patch: Partial<ChangeTask> = {}) {
    const task = this.require(id)
    if (!canTransition(task.state, state))
      throw new Error(`Cannot move a task from ${task.state} to ${state}.`)
    const next = changeTaskSchema.parse({
      ...task,
      ...patch,
      state,
      updatedAt: new Date().toISOString(),
    })
    this.tasks.set(id, next)
    this.publish(next)
    return structuredClone(next)
  }

  setPlan(id: string, plan: string) {
    if (!plan.trim()) throw new Error('A non-empty plan is required before editing begins.')
    const task = this.require(id)
    if (!['requested', 'planning', 'failed'].includes(task.state))
      throw new Error('A plan can only be recorded before editing begins.')
    const next = changeTaskSchema.parse({ ...task, plan, updatedAt: new Date().toISOString() })
    this.tasks.set(id, next)
    this.publish(next)
    return structuredClone(next)
  }

  update(id: string, patch: Partial<ChangeTask>) {
    const task = this.require(id)
    const next = changeTaskSchema.parse({ ...task, ...patch, updatedAt: new Date().toISOString() })
    this.tasks.set(id, next)
    this.publish(next)
    return structuredClone(next)
  }

  approve(id: string) {
    const task = this.require(id)
    if (task.state !== 'awaiting-approval') throw new Error('Only previewed tasks can be approved.')
    return this.transition(id, 'applied', {
      approval: { ...task.approval, approved: true, approvedAt: new Date().toISOString() },
    })
  }

  subscribe(listener: (task: ChangeTask) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private require(id: string) {
    const task = this.tasks.get(id)
    if (!task) throw new Error('Change task not found.')
    return task
  }

  private publish(task: ChangeTask) {
    for (const listener of this.listeners) listener(structuredClone(task))
  }
}
