import { authedRequest } from "@/lib/authed-request"

export interface CreateVARequest {
  customerNo: string
  trxId: string
  virtualAccountName: string
  amount: string
  trxType: "F" | "P"
  expiredDate: string
  description: string
  phone?: string
}

export interface CreateVAResponse {
  virtualAccountNo: string
  status: string
}

export const vaApi = {
  create: (body: CreateVARequest) =>
    authedRequest<CreateVAResponse, CreateVARequest>("/va", {
      method: "POST",
      body,
    }),
}
