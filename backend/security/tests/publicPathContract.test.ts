import assert from "node:assert/strict";
import { isPublicPath } from "../../../proxy";

const publicPaths = [
  "/",
  "/login",
  "/pricing",
  "/billing/success",
  "/billing/cancel",
  "/faq",
  "/contact",
  "/content-removal",
  "/terms",
  "/privacy",
  "/acceptable-use",
  "/dmca",
  "/complaints",
  "/community-guidelines",
  "/underage-policy",
  "/age",
  "/blocked-content",
  "/2257-exemption",
  "/affiliate-terms",
];

for (const pathname of publicPaths) {
  assert.equal(isPublicPath(pathname), true, `${pathname} is public`);
}

const protectedPaths = [
  "/account",
  "/billing",
  "/dashboard",
  "/generate",
  "/sirens-mind",
  "/affiliate",
  "/autopost",
];

for (const pathname of protectedPaths) {
  assert.equal(isPublicPath(pathname), false, `${pathname} is protected`);
}

for (const pathname of ["/dmca/extra", "/age-gate", "/affiliate-terms-old"]) {
  assert.equal(isPublicPath(pathname), false, `${pathname} is not made public by a partial match`);
}

console.log("Proxy public-path contract tests passed");
