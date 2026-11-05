import { describe, expect, it } from "vitest"
import { PageSkeleton } from "./page-skeleton"
import { AdminLayoutSkeleton } from "./admin-skeleton"
import { render } from "@/test-utils"

describe("Skeleton components", () => {
  it("renders PageSkeleton with data-testid='page-skeleton'", async () => {
    const { host, unmount } = await render(<PageSkeleton />)
    const el = host.querySelector('[data-testid="page-skeleton"]')
    expect(el).toBeDefined()
    expect(el).not.toBeNull()
    await unmount()
  })

  it("renders AdminLayoutSkeleton with data-testid='page-skeleton'", async () => {
    const { host, unmount } = await render(<AdminLayoutSkeleton />)
    const el = host.querySelector('[data-testid="page-skeleton"]')
    expect(el).toBeDefined()
    expect(el).not.toBeNull()
    await unmount()
  })
})
