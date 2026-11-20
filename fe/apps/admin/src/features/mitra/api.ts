import {
  authedPage,
  authedRequest,
  qs,
  type ListParams,
} from "@/lib/authed-request"
import type {
  CreateMitraRequest,
  CreateMitraResponse,
  MitraResponse,
  RotateMitraResponse,
  UpdateMitraRequest,
} from "@app/contracts"

export const mitraApi = {
  list: (p: ListParams) => authedPage<MitraResponse>(`/mitra?${qs({ ...p })}`),
  get: (id: string) => authedRequest<MitraResponse>(`/mitra/${id}`),
  create: (body: CreateMitraRequest) =>
    authedRequest<CreateMitraResponse, CreateMitraRequest>("/mitra", {
      method: "POST",
      body,
    }),
  update: (id: string, body: UpdateMitraRequest) =>
    authedRequest<MitraResponse, UpdateMitraRequest>(`/mitra/${id}`, {
      method: "PUT",
      body,
    }),
  setActive: (id: string, isActive: boolean) =>
    authedRequest<MitraResponse, { isActive: boolean }>(
      `/mitra/${id}/active`,
      { method: "PATCH", body: { isActive } }
    ),
  rotateSecret: (id: string) =>
    authedRequest<RotateMitraResponse>(`/mitra/${id}/rotate-secret`, {
      method: "POST",
    }),
}
