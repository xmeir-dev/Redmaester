import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandLink } from "./brand-link";

describe("BrandLink", () => {
  it("renders the Redmaester wordmark as a link to the home page", () => {
    render(<BrandLink />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/");
    expect(screen.getByText("Red")).toBeInTheDocument();
    expect(screen.getByText("maester")).toBeInTheDocument();
  });
});
