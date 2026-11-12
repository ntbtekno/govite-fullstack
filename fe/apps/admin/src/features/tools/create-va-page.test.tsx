import { describe, expect, it } from "vitest"
import { render } from "@/test-utils"
import { CreateVAPage } from "./create-va-page"

describe("CreateVAPage", () => {
  it("renders only the page header (blank page)", async () => {
    const { host } = await render(<CreateVAPage />)

    expect(host.querySelector("h1")?.textContent).toBe("Create VA")
    // No form, no API-driven content: just header.
    expect(host.querySelector("form")).toBeNull()
    expect(host.querySelector("input")).toBeNull()
    expect(host.querySelector("button")).toBeNull()
  })
})
