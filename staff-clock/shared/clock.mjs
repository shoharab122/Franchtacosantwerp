export const CLOCK_CODE_LENGTH = 4
export const CLOCK_CODE_PATTERN = `[0-9]{${CLOCK_CODE_LENGTH}}`
const clockCode = new RegExp(`^${CLOCK_CODE_PATTERN}$`)

export const isClockCode = value => typeof value === 'string' && clockCode.test(value)

export const SIGNATURE_WIDTH = 360
export const SIGNATURE_HEIGHT = 120
export const SIGNATURE_MAX_POINTS = 1500

export function hasSignature(strokes) {
  return strokes.some(stroke => {
    const [x, y] = stroke[0]
    return stroke.some(([px, py]) => px !== x || py !== y)
  })
}

export function signaturePath(strokes) {
  return strokes.map(stroke => {
    const [[x, y], ...rest] = stroke
    const lines = rest.length ? rest : [[x + 0.01, y]]
    return `M${x},${y} ` + lines.map(([px, py]) => `L${px},${py}`).join(' ')
  }).join(' ')
}
