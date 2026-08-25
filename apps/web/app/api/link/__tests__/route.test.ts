import { confirmHandler } from "@calcom/trpc/server/routers/viewer/bookings/confirm.handler";
import type { NextRequest } from "next/server";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConfirmHandler = confirmHandler as unknown as Mock<typeof confirmHandler>;

vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir:
    (handler: (req: NextRequest) => Promise<Response>) =>
    (req: NextRequest, _context: { params: Promise<Record<string, string>> }) =>
      handler(req),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    redirect: vi.fn((url: string | URL, init?: { status?: number }) => {
      const location = typeof url === "string" ? url : url.toString();
      return {
        status: init?.status ?? 302,
        headers: {
          get: (name: string) => (name.toLowerCase() === "location" ? location : null),
        },
      } as unknown as Response;
    }),
  },
}));

vi.mock("@calcom/lib/crypto", () => ({
  symmetricDecrypt: vi.fn().mockReturnValue(
    JSON.stringify({
      bookingUid: "test-booking-uid",
      userId: 1,
    })
  ),
}));

vi.mock("@calcom/i18n/server", () => ({
  getTranslation: vi.fn().mockResolvedValue((key: string) => key),
}));

vi.mock("@calcom/prisma", () => {
  const mockBookingFindUniqueOrThrow = vi.fn().mockResolvedValue({
    id: 1,
    uid: "test-booking-uid",
    recurringEventId: null,
  });
  const mockUserFindUniqueOrThrow = vi.fn().mockResolvedValue({
    id: 1,
    uuid: "user-uuid",
    email: "test@example.com",
    username: "testuser",
    role: "USER",
    locale: "en",
    destinationCalendar: null,
  });
  const mockPrismaObj = {
    booking: {
      findUniqueOrThrow: mockBookingFindUniqueOrThrow,
    },
    user: {
      findUniqueOrThrow: mockUserFindUniqueOrThrow,
    },
  };
  return {
    default: mockPrismaObj,
    prisma: mockPrismaObj,
  };
});

vi.mock("@calcom/trpc/server/routers/viewer/bookings/confirm.handler", () => ({
  confirmHandler: vi.fn(),
}));

vi.mock("@calcom/lib/tracing/factory", () => ({
  distributedTracing: {
    createTrace: vi.fn().mockReturnValue({}),
  },
}));

import prisma from "@calcom/prisma";
// Import after mocks are set up
import { GET, POST } from "../route";

const createMockRequest = (url: string, method: "GET" | "POST" = "GET"): NextRequest => {
  const urlObj = new URL(url);
  return {
    method,
    url,
    nextUrl: {
      searchParams: urlObj.searchParams,
    },
  } as unknown as NextRequest;
};

// Vitest sets NEXT_PUBLIC_WEBAPP_URL to http://app.cal.local:3000 (see vitest.config.mts)
const EXPECTED_REDIRECT_ORIGIN = "http://app.cal.local:3000";

describe("link route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET handler", () => {
    it.each(["accept", "reject"])("does not mutate the booking when a %s link is fetched", async (action) => {
      const req = createMockRequest(
        `https://app.example.com/api/link?action=${action}&token=encrypted-token`
      );

      const res = await GET(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(200);
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });

    it("renders an explicit confirmation form that posts back to the same URL", async () => {
      const req = createMockRequest(
        "https://app.example.com/api/link?action=accept&token=encrypted-token"
      );

      const res = await GET(req, { params: Promise.resolve({}) });
      const body = await res.text();

      expect(body).toContain('<form method="post">');
      expect(body).toContain("confirm_or_reject_request");
      expect(body).toContain(">confirm<");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    });

    it("renders the reject action without changing booking state", async () => {
      const req = createMockRequest(
        "https://app.example.com/api/link?action=reject&token=encrypted-token"
      );

      const res = await GET(req, { params: Promise.resolve({}) });
      const body = await res.text();

      expect(body).toContain(">reject<");
      expect(mockConfirmHandler).not.toHaveBeenCalled();
    });
  });

  describe("POST handler", () => {
    it("calls confirmHandler with confirmed=true for accept", async () => {
      const req = createMockRequest(
        "https://app.example.com/api/link?action=accept&token=encrypted-token",
        "POST"
      );

      const res = await POST(req, { params: Promise.resolve({}) });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 1,
            confirmed: true,
            emailsEnabled: true,
          }),
        })
      );
      expect(res.status).toBe(303);
      expect(new URL(res.headers.get("location")!).origin).toBe(EXPECTED_REDIRECT_ORIGIN);
    });

    it("calls confirmHandler with confirmed=false for reject", async () => {
      const req = createMockRequest(
        "https://app.example.com/api/link?action=reject&token=encrypted-token",
        "POST"
      );

      await POST(req, { params: Promise.resolve({}) });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 1,
            confirmed: false,
            emailsEnabled: true,
          }),
        })
      );
    });

    it("passes recurringEventId when booking has one", async () => {
      vi.mocked(prisma.booking.findUniqueOrThrow).mockResolvedValueOnce({
        id: 1,
        uid: "test-booking-uid",
        recurringEventId: "recurring-123",
      } as Awaited<ReturnType<typeof prisma.booking.findUniqueOrThrow>>);
      const req = createMockRequest(
        "https://app.example.com/api/link?action=accept&token=encrypted-token",
        "POST"
      );

      await POST(req, { params: Promise.resolve({}) });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            bookingId: 1,
            recurringEventId: "recurring-123",
            confirmed: true,
          }),
        })
      );
    });

    it("passes user context to confirmHandler", async () => {
      const req = createMockRequest(
        "https://app.example.com/api/link?action=accept&token=encrypted-token",
        "POST"
      );

      await POST(req, { params: Promise.resolve({}) });

      expect(mockConfirmHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.objectContaining({
            user: expect.objectContaining({
              id: 1,
              uuid: "user-uuid",
              email: "test@example.com",
              username: "testuser",
              role: "USER",
            }),
          }),
        })
      );
    });

    it("uses WEBAPP_URL for successful redirects", async () => {
      const req = createMockRequest(
        "https://custom-domain.company.com/api/link?action=accept&token=encrypted-token",
        "POST"
      );

      const res = await POST(req, { params: Promise.resolve({}) });
      const location = res.headers.get("location");

      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(redirectUrl.pathname).toBe("/booking/test-booking-uid");
      expect(location).not.toContain("localhost");
    });

    it("uses WEBAPP_URL and preserves TRPC errors in error redirects", async () => {
      const { TRPCError } = await import("@trpc/server");
      mockConfirmHandler.mockRejectedValueOnce(
        new TRPCError({ code: "BAD_REQUEST", message: "Custom error" })
      );
      const req = createMockRequest(
        "https://self-hosted.company.org/api/link?action=accept&token=encrypted-token",
        "POST"
      );

      const res = await POST(req, { params: Promise.resolve({}) });
      const location = res.headers.get("location");

      expect(location).toBeTruthy();
      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe(EXPECTED_REDIRECT_ORIGIN);
      expect(redirectUrl.pathname).toBe("/booking/test-booking-uid");
      expect(redirectUrl.searchParams.get("error")).toBe("Custom error");
      expect(res.status).toBe(303);
    });
  });
});
