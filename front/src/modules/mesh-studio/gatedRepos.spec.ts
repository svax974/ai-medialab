import { describe, expect, it } from 'vitest'
import { gatedRepoUrl } from './gatedRepos'

describe('gated repository links', () => {
  it('links valid owner/repository identifiers to Hugging Face', () => {
    expect(gatedRepoUrl('facebook/dinov3-vitl16-pretrain-lvd1689m')).toBe('https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m')
  })
  it('rejects URLs, paths and other malformed identifiers', () => {
    for (const repo of ['https://example.org/x', '//evil.test/x', 'owner/../evil', 'owner/repo?x=1', 'owner/repo/extra', 'owner/@evil']) expect(gatedRepoUrl(repo)).toBeNull()
  })
})
