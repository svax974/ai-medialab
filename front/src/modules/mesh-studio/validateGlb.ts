/** Verify the binary container and forbid external resources before handing it to a renderer. */
export function validateGlb(bytes: ArrayBuffer): boolean {
  try {
    const view = new DataView(bytes)
    if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) return false
    const length = view.getUint32(12, true)
    if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20) return false
    const json: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)))
    const hasUri = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false
      if (Array.isArray(value)) return value.some(hasUri)
      return Object.entries(value).some(([key, child]) => key.toLowerCase() === 'uri' || hasUri(child))
    }
    // These compressed formats can make the viewer load remote decoder binaries.
    const serialized = JSON.stringify(json)
    return !hasUri(json) && !/KHR_draco_mesh_compression|EXT_meshopt_compression|KHR_texture_basisu/.test(serialized)
  } catch { return false }
}
