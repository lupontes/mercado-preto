// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

function Hello() {
  return <p>admin test harness works</p>
}

describe("admin test harness", () => {
  it("renders a React component under jsdom", () => {
    render(<Hello />)
    expect(screen.getByText("admin test harness works")).toBeInTheDocument()
  })
})
