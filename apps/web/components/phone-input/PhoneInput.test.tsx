import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BasePhoneInput from "./PhoneInput";

const country = vi.hoisted((): { fromStore?: string; fromQuery?: { countryCode: string } } => ({}));

vi.mock("@calcom/atoms/hooks/useIsPlatform", () => ({ useIsPlatform: () => false }));
vi.mock("@calcom/features/bookings/Booker/store", () => ({ useBookerStore: () => country.fromStore }));
vi.mock("@calcom/trpc/react", () => ({
  trpc: { viewer: { public: { countryCode: { useQuery: () => ({ data: country.fromQuery }) } } } },
}));

describe("BasePhoneInput", () => {
  beforeEach(() => {
    country.fromStore = "lv";
    country.fromQuery = { countryCode: "LV" };
  });

  it("preserves a calling code supplied after the initial render", () => {
    const onChange = vi.fn();
    const { rerender } = render(<BasePhoneInput value="" onChange={onChange} />);

    rerender(<BasePhoneInput value="+371" onChange={onChange} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value.replace(/\D/g, "")).toBe("371");

    rerender(<BasePhoneInput value="+447911123456" onChange={onChange} />);

    expect(input.value.replace(/\D/g, "")).toBe("447911123456");
    expect(screen.getByTitle("United Kingdom: + 44")).toBeTruthy();
  });

  it.each(["geolocation", "stored country"])("preserves a prefilled number when %s resolves", (source) => {
    country.fromStore = undefined;
    country.fromQuery = undefined;
    const onChange = vi.fn();
    const { rerender } = render(<BasePhoneInput value="+447911123456" onChange={onChange} />);

    if (source === "geolocation") {
      country.fromQuery = { countryCode: "LV" };
    } else {
      country.fromStore = "lv";
    }
    rerender(<BasePhoneInput value="+447911123456" onChange={onChange} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value.replace(/\D/g, "")).toBe("447911123456");
    expect(screen.getByTitle("United Kingdom: + 44")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies geolocation to an empty field", () => {
    country.fromStore = undefined;
    country.fromQuery = undefined;
    const onChange = vi.fn();
    const { rerender } = render(<BasePhoneInput value="" onChange={onChange} />);

    country.fromQuery = { countryCode: "LV" };
    rerender(<BasePhoneInput value="" onChange={onChange} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value.replace(/\D/g, "")).toBe("371");
    expect(screen.getByTitle("Latvia: + 371")).toBeTruthy();
  });
});
