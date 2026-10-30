import type { CalendarEvent } from "@calcom/types/Calendar";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { getReplyToHeader } from "./getReplyToHeader";

/**
 * RFC 5322 (Internet Message Format) specifies that the Reply-To header must be
 * a comma-separated list of addresses, not an array. Many SMTP servers reject arrays.
 * Spec: https://datatracker.ietf.org/doc/html/rfc5322#section-3.6.2
 */

const createMockCalEvent = (organizerEmail: string): CalendarEvent => ({
  type: "Meeting",
  title: "Test meeting",
  startTime: "2026-10-30T10:00:00Z",
  endTime: "2026-10-30T10:30:00Z",
  attendees: [],
  organizer: {
    name: "Organizer",
    email: organizerEmail,
    timeZone: "UTC",
    language: { locale: "en", translate: createInstance().getFixedT("en", "common") },
  },
  hideOrganizerEmail: false,
});

describe("getReplyToHeader", () => {
  describe("return type", () => {
    it("always returns replyTo as a string, never an array", () => {
      const calEvent = createMockCalEvent("organizer@test.com");
      const result = getReplyToHeader(calEvent, ["attendee1@test.com", "attendee2@test.com"]);

      expect(result).toHaveProperty("replyTo");
      expect(typeof result.replyTo).toBe("string");
      // Should NOT be an array
      expect(Array.isArray(result.replyTo)).toBe(false);
    });
  });

  describe("with single email", () => {
    it("returns single email as string", () => {
      const calEvent = createMockCalEvent("organizer@test.com");
      const result = getReplyToHeader(calEvent);

      expect(result).toEqual({ replyTo: "organizer@test.com" });
    });

    it("returns additionalEmail as string when provided alone", () => {
      const calEvent = createMockCalEvent("organizer@test.com");
      const result = getReplyToHeader(calEvent, "additional@test.com", true);

      expect(result).toEqual({ replyTo: "additional@test.com" });
    });
  });

  describe("with multiple emails", () => {
    it("returns comma-separated string for multiple emails", () => {
      const calEvent = createMockCalEvent("organizer@test.com");
      const result = getReplyToHeader(calEvent, ["attendee1@test.com", "attendee2@test.com"]);

      expect(result).toEqual({
        replyTo: "attendee1@test.com, attendee2@test.com, organizer@test.com",
      });
    });

    it("returns comma-separated string when additionalEmails is array", () => {
      const calEvent = createMockCalEvent("organizer@test.com");
      const result = getReplyToHeader(calEvent, ["a@test.com", "b@test.com", "c@test.com"], true);

      expect(result).toEqual({
        replyTo: "a@test.com, b@test.com, c@test.com",
      });
    });
  });

  describe("with no emails", () => {
    it("returns empty object when no emails available", () => {
      const calEvent = { ...createMockCalEvent(""), hideOrganizerEmail: true };
      const result = getReplyToHeader(calEvent, undefined, true);

      expect(result).toEqual({});
    });
  });

  describe("with a hidden organizer email", () => {
    it.each([
      undefined,
      false,
      true,
    ])("keeps the custom reply-to address when excludeOrganizerEmail is %s", (excludeOrganizerEmail) => {
      const calEvent = {
        ...createMockCalEvent("organizer@test.com"),
        hideOrganizerEmail: true,
        customReplyToEmail: "custom@test.com",
      };

      expect(getReplyToHeader(calEvent, undefined, excludeOrganizerEmail)).toEqual({
        replyTo: "custom@test.com",
      });
    });

    it("does not expose the organizer when no custom reply-to address is set", () => {
      const calEvent = { ...createMockCalEvent("organizer@test.com"), hideOrganizerEmail: true };

      expect(getReplyToHeader(calEvent)).toEqual({});
      expect(getReplyToHeader(calEvent, ["attendee@test.com"])).toEqual({
        replyTo: "attendee@test.com",
      });
    });
  });

  describe("SMTP compatibility", () => {
    it("produces RFC 5322 compliant Reply-To header format", () => {
      const calEvent = createMockCalEvent("organizer@test.com");
      const result = getReplyToHeader(calEvent, ["a@test.com", "b@test.com"]);

      // RFC 5322 specifies comma-separated list for multiple addresses
      expect(result.replyTo).toMatch(/^[^,]+, [^,]+, [^,]+$/);
      expect(result.replyTo).not.toContain("[");
      expect(result.replyTo).not.toContain("]");
    });
  });
});
