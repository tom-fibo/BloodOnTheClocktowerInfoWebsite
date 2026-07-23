// No ambiguous characters (I/O/0/1 excluded) so a spoken/handwritten code is easy to type back correctly.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateRoomCode(length = 5): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase()
}
