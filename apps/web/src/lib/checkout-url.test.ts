import { describe, expect, it } from "vitest";
import { findCheckoutUrl } from "./checkout-url";

describe("link do checkout da InfinitePay", () => {
  it("encontra o link seja qual for o campo, só https", () => {
    expect(findCheckoutUrl({ url: "https://checkout.infinitepay.io/x" })).toBe("https://checkout.infinitepay.io/x");
    expect(findCheckoutUrl({ data: { checkout_url: "https://pay/y" } })).toBe("https://pay/y");
    expect(findCheckoutUrl("https://z")).toBe("https://z");
    expect(findCheckoutUrl({ url: "http://inseguro" })).toBeNull();
    expect(findCheckoutUrl({ success: false })).toBeNull();
    expect(findCheckoutUrl(null)).toBeNull();
  });
});
