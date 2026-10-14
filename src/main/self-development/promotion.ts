import { randomUUID } from 'node:crypto'

export type PromotionInput = {
  repository: string
  branch: string
  candidateCommit: string
  baselineCommit: string
  environment: string
  operation: 'promote' | 'rollback'
}

export type PromotionReceipt = {
  operationId: string
  acceptedAt: string
  runUrl?: string
}

export interface PromotionProvider {
  readonly name: string
  promote(input: PromotionInput): Promise<PromotionReceipt>
  rollback(input: PromotionInput): Promise<PromotionReceipt>
}

export class UnconfiguredPromotionProvider implements PromotionProvider {
  readonly name = 'unconfigured'

  async promote(): Promise<PromotionReceipt> {
    throw new Error('Promotion is not configured. Set the protected GitHub Actions credentials.')
  }

  async rollback(): Promise<PromotionReceipt> {
    throw new Error('Rollback is not configured. Set the protected GitHub Actions credentials.')
  }
}

export class MemoryPromotionProvider implements PromotionProvider {
  readonly name = 'memory'
  readonly calls: PromotionInput[] = []

  async promote(input: PromotionInput) {
    this.calls.push({ ...input, operation: 'promote' })
    return { operationId: randomUUID(), acceptedAt: new Date().toISOString() }
  }

  async rollback(input: PromotionInput) {
    this.calls.push({ ...input, operation: 'rollback' })
    return { operationId: randomUUID(), acceptedAt: new Date().toISOString() }
  }
}

export type GitHubActionsPromotionOptions = {
  token: string
  owner: string
  repo: string
  workflow: string
  apiBase?: string
  runUrlBase?: string
}

export class GitHubActionsPromotionProvider implements PromotionProvider {
  readonly name = 'github-actions'

  constructor(private readonly options: GitHubActionsPromotionOptions) {
    if (!options.token || !options.owner || !options.repo || !options.workflow)
      throw new Error('GitHub promotion requires a token, repository, and workflow.')
  }

  async promote(input: PromotionInput) {
    return this.dispatch(input)
  }

  async rollback(input: PromotionInput) {
    return this.dispatch(input)
  }

  private async dispatch(input: PromotionInput): Promise<PromotionReceipt> {
    const operationId = randomUUID()
    const apiBase = this.options.apiBase ?? 'https://api.github.com'
    const response = await fetch(
      `${apiBase}/repos/${encodeURIComponent(this.options.owner)}/${encodeURIComponent(this.options.repo)}/actions/workflows/${encodeURIComponent(this.options.workflow)}/dispatches`,
      {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.options.token}`,
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: input.branch,
          inputs: {
            operation: input.operation,
            commit_sha: input.candidateCommit,
            baseline_sha: input.baselineCommit,
            environment: input.environment,
          },
        }),
      },
    )
    if (!response.ok)
      throw new Error(`GitHub Actions dispatch failed with HTTP ${response.status}.`)
    return {
      operationId,
      acceptedAt: new Date().toISOString(),
      runUrl: this.options.runUrlBase
        ? `${this.options.runUrlBase}/actions/workflows/${this.options.workflow}`
        : undefined,
    }
  }
}
