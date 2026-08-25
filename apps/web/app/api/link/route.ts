import process from "node:process";
import { getTranslation } from "@calcom/i18n/server";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { symmetricDecrypt } from "@calcom/lib/crypto";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import prisma from "@calcom/prisma";
import { confirmHandler } from "@calcom/trpc/server/routers/viewer/bookings/confirm.handler";
import { TRPCError } from "@trpc/server";
import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

enum DirectAction {
  ACCEPT = "accept",
  REJECT = "reject",
}

const querySchema = z.object({
  action: z.nativeEnum(DirectAction),
  token: z.string(),
  reason: z.string().optional(),
});

const decryptedSchema = z.object({
  bookingUid: z.string(),
  userId: z.number().int(),
  platformClientId: z.string().optional(),
  platformRescheduleUrl: z.string().optional(),
  platformCancelUrl: z.string().optional(),
  platformBookingUrl: z.string().optional(),
});

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderConfirmationPage = ({
  locale,
  title,
  description,
  actionLabel,
}: {
  locale: string;
  title: string;
  description: string;
  actionLabel: string;
}) => `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f9fafb; color: #111827; }
      main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
      section { width: 100%; max-width: 420px; padding: 32px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
      h1 { margin: 0 0 12px; font-size: 20px; line-height: 1.4; }
      p { margin: 0 0 24px; color: #4b5563; line-height: 1.5; }
      button { width: 100%; border: 0; border-radius: 8px; padding: 10px 16px; background: #111827; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
      button:hover { background: #1f2937; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
        <form method="post">
          <button type="submit">${escapeHtml(actionLabel)}</button>
        </form>
      </section>
    </main>
  </body>
</html>`;

async function getActionContext(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const { action, token, reason } = querySchema.parse(Object.fromEntries(searchParams.entries()));

  const decryptedData = JSON.parse(
    symmetricDecrypt(decodeURIComponent(token), process.env.CALENDSO_ENCRYPTION_KEY || "")
  );

  const {
    bookingUid,
    userId,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  } = decryptedSchema.parse(decryptedData);

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { uid: bookingUid },
    select: {
      id: true,
      uid: true,
      recurringEventId: true,
    },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      uuid: true,
      email: true,
      username: true,
      role: true,
      locale: true,
      destinationCalendar: true,
    },
  });

  return {
    action,
    reason,
    booking,
    user,
    bookingUid,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  };
}

async function getHandler(request: NextRequest) {
  // Email clients and security scanners may prefetch links, so GET must never mutate the booking.
  const { action, user } = await getActionContext(request);
  const locale = user.locale ?? "en";
  const t = await getTranslation(locale, "common");

  return new Response(
    renderConfirmationPage({
      locale,
      title: t("event_awaiting_approval"),
      description: t("confirm_or_reject_request"),
      actionLabel: t(action === DirectAction.ACCEPT ? "confirm" : "reject"),
    }),
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    }
  );
}

async function postHandler(request: NextRequest) {
  const {
    action,
    reason,
    booking,
    user,
    bookingUid,
    platformClientId,
    platformRescheduleUrl,
    platformCancelUrl,
    platformBookingUrl,
  } = await getActionContext(request);

  try {
    await confirmHandler({
      ctx: {
        user: {
          id: user.id,
          uuid: user.uuid,
          email: user.email,
          username: user.username ?? "",
          role: user.role,
          destinationCalendar: user.destinationCalendar ?? null,
        },
        traceContext: distributedTracing.createTrace("confirm_booking_magic_link"),
      },
      input: {
        bookingId: booking.id,
        recurringEventId: booking.recurringEventId || undefined,
        confirmed: action === DirectAction.ACCEPT,
        reason,
        emailsEnabled: true,
        platformClientParams: platformClientId
          ? {
              platformClientId,
              platformRescheduleUrl,
              platformCancelUrl,
              platformBookingUrl,
            }
          : undefined,
      },
    });
  } catch (e) {
    let message = "Error confirming booking";
    if (e instanceof TRPCError) message = e.message;
    return NextResponse.redirect(
      new URL(`/booking/${bookingUid}?error=${encodeURIComponent(message)}`, WEBAPP_URL),
      { status: 303 }
    );
  }

  return NextResponse.redirect(new URL(`/booking/${bookingUid}`, WEBAPP_URL), { status: 303 });
}

export const GET = defaultResponderForAppDir(getHandler);
export const POST = defaultResponderForAppDir(postHandler);
