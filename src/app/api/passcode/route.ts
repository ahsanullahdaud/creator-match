import {
  clearPasscodeCookie,
  passcodeConfigured,
  passcodeCookie,
  verifyPasscode,
} from "@/lib/access";
import { getCache } from "@/lib/cache";
import { getConfig, LIMITS } from "@/lib/config";
import { AppError, fromZodError } from "@/lib/errors";
import { countPasscodeAttempt, visitorId } from "@/lib/rate-limit";
import { handle, json, readJson } from "@/lib/route";
import { PasscodeRequest, type PasscodeResponse } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Grants the bypass cookie when the passcode matches. Attempts are capped per visitor. */
export const POST = handle("passcode", async (request, ctx) => {
  const parsed = PasscodeRequest.safeParse(await readJson(request));
  if (!parsed.success) throw fromZodError(parsed.error);

  const config = getConfig();
  const cache = getCache();
  const visitor = visitorId(request, config);
  ctx.log.visitor = visitor;

  if (!passcodeConfigured(config)) {
    throw new AppError(
      "forbidden",
      "No passcode is configured on this deployment.",
    );
  }
  const attempts = await countPasscodeAttempt({ cache, config, visitor });
  if (attempts > LIMITS.PASSCODE_ATTEMPTS_PER_DAY) {
    throw new AppError("visitor_limit", "Too many passcode attempts today.");
  }
  if (!verifyPasscode(parsed.data.passcode, config)) {
    throw new AppError("forbidden", "That passcode is not right.");
  }

  ctx.log.bypass = true;
  const body: PasscodeResponse = { bypass: true };
  return json(body, {
    headers: { "set-cookie": passcodeCookie(request, config) },
  });
});

export const DELETE = handle("passcode", async () => {
  const body: PasscodeResponse = { bypass: false };
  return json(body, { headers: { "set-cookie": clearPasscodeCookie() } });
});
