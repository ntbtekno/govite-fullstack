import type { MitraCredentialDelivery } from "@app/contracts"

let pending: MitraCredentialDelivery | null = null

export function storeCredentialDelivery(value: MitraCredentialDelivery) {
  pending = value
}

export function takeCredentialDelivery() {
  const value = pending
  pending = null
  return value
}
