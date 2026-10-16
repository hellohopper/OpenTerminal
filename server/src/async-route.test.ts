import { describe, it, expect, vi } from "vitest";
import { asyncRoute } from "./async-route.js";
import type { Request, Response } from "express";
describe("async route failures", () => {
  it("forwards rejected database operations to Express error middleware", async () => {
    const error = new Error("connection unavailable"),
      next = vi.fn();
    await asyncRoute(async () => {
      await Promise.resolve();
      throw error;
    })({} as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
