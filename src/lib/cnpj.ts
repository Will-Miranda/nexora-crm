export function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, '')
}

export function formatCnpj(value: string): string {
  const digits = normalizeCnpj(value).slice(0, 14)

  if (digits.length > 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
  }
  if (digits.length > 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`
  }
  if (digits.length > 5) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`
  }
  if (digits.length > 2) {
    return `${digits.slice(0, 2)}.${digits.slice(2)}`
  }
  return digits
}

function calculateCheckDigit(base: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => {
    return total + Number(base[index]) * weight
  }, 0)
  const remainder = sum % 11

  return remainder < 2 ? 0 : 11 - remainder
}

export function isValidCnpj(value: string): boolean {
  const digits = normalizeCnpj(value)

  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) {
    return false
  }

  const firstDigit = calculateCheckDigit(
    digits.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  )
  const secondDigit = calculateCheckDigit(
    digits.slice(0, 13),
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  )

  return digits.endsWith(`${firstDigit}${secondDigit}`)
}
