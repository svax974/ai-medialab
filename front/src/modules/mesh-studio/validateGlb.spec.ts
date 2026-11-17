import { describe, expect, it } from 'vitest'
import { validateGlb } from './validateGlb'

function glb(json: object): ArrayBuffer {
  const source = JSON.stringify(json)
  const text = new TextEncoder().encode(source.padEnd(Math.ceil(source.length / 4) * 4, ' '))
  const result = new ArrayBuffer(20 + text.length)
  const view = new DataView(result)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.byteLength, true)
  view.setUint32(12, text.length, true); view.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(result, 20).set(text)
  return result
}
describe('GLB preview validation', () => {
  it('accepts embedded assets and rejects external resources and remote decoders', () => {
    expect(validateGlb(glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 1 }] }))).toBe(true)
    expect(validateGlb(glb({ images: [{ uri: 'https://example.com/image.png' }] }))).toBe(false)
    expect(validateGlb(glb({ extensionsUsed: ['KHR_draco_mesh_compression'] }))).toBe(false)
    expect(validateGlb(new ArrayBuffer(3))).toBe(false)
    const truncated = glb({ asset: { version: '2.0' } })
    new DataView(truncated).setUint32(12, truncated.byteLength, true)
    expect(validateGlb(truncated)).toBe(false)
    const mismatchedLength = glb({ asset: { version: '2.0' } })
    new DataView(mismatchedLength).setUint32(8, 20, true)
    expect(validateGlb(mismatchedLength)).toBe(false)
  })
})
