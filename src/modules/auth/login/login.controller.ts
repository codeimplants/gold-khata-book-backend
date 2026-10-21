import express from "express";
import crypto from "crypto";
import dotenv from "dotenv";
import { Request, Response } from "express";
import authController from "../auth.controller";
import { sendOtpSchema, verifyOtpSchema } from "../auth.schema";
import Admin from "../../admin/admin.model";
import { Dukandar } from "../../dukandar/dukandar.model";
import { maskPhone } from "../../../common/utils/maskPhone";
import { MessagingApiError } from "@codeimplants/messaging-node";
import { messagingClient } from "../../../common/messaging";
const router = express.Router();

dotenv.config();

/**
 * What the client keeps between send and verify: the session id, opaque to it,
 * and a hash binding that session to this phone for five minutes, so a session
 * cannot be finished against another number.
 */
function otpSession(phone: string, sessionId: string) {
  const expires = Date.now() + 5 * 60 * 1000;
  const hash = crypto
    .createHmac("sha256", process.env.HASH_KEY || "234")
    .update(`${phone}.${sessionId}.${expires}`)
    .digest("hex");
  return { phone, sessionId, fullhash: `${hash}.${expires}` };
}

const sendOtp = async (req: Request, res: Response) => {
  const { phone } = sendOtpSchema.parse(req.body);

  try {
    const DEFAULT_PHONE = "1234567890";

    // Apple-review test number: bypass messaging entirely and hand back a
    // TEST_SESSION so the static OTP (123456) can verify it. This must work in
    // production too — App Review hits the live backend. No real SMS is sent.
    if (String(phone).trim() === DEFAULT_PHONE) {
      const sessionId = "TEST_SESSION";
      const ttl = 5 * 60 * 1000;
      const expires = Date.now() + ttl;
      const data = `${phone}.${sessionId}.${expires}`;

      const hash = crypto
        .createHmac("sha256", process.env.HASH_KEY || "234")
        .update(data)
        .digest("hex");
      const fullhash = `${hash}.${expires}`;

      return res.status(200).send({
        phone,
        sessionId,
        fullhash,
        msg: "OTP (test) sent successfully!",
        success: true,
        note: "Using default phone number - OTP bypassed",
      });
    }

    // Code Implants Messaging sends and checks every code (src/common/messaging.ts).
    // Its otpId stands where 2Factor's session id used to, so the app saw no
    // change. Asking again inside the 30 s cooldown returns the code already on
    // its way, not an error: this app's client retries a 429 and then shows a
    // full-screen error, so only a real limit, such as the daily cap per number,
    // ever reaches it as one.
    //
    // One OTP path in every environment, as before: SoneBill once generated dev
    // codes locally, so dev exercised a login path prod did not have. Here dev
    // runs this same code against messaging's dev service, which sends nothing
    // and answers 123456 (owner's decision, 2026-10-21: no real SMS outside prod).
    const messaging = messagingClient();
    if (!messaging) {
      return res.status(500).send({ msg: "OTP service unavailable", success: false });
    }
    try {
      const otp = await messaging.otp.send({ phone: String(phone).trim(), purpose: "login" });
      // Logged so that two sessions created for one phone seconds apart are
      // visible. A client that retries send-otp and keeps only the last reply
      // must be traceable; "(reused)" marks a repeat answered with the code
      // already sent rather than a second SMS.
      const reused = "reused" in otp && otp.reused ? " (reused)" : "";
      console.log(
        `[Auth] OTP session created rid=${req.id} phone=${maskPhone(phone)} sessionId=${otp.otpId}${reused}`,
      );
      return res.status(200).send({
        ...otpSession(phone, otp.otpId),
        msg: "OTP sent successfully!",
        success: true,
      });
    } catch (error) {
      if (error instanceof MessagingApiError && error.isQuotaRefusal) {
        const retryAfterSec = error.retryAfterSeconds ?? 60;
        return res
          .status(429)
          .set("Retry-After", String(retryAfterSec))
          .send({
            success: false,
            msg:
              error.code === "cooldown_active"
                ? `Please wait ${retryAfterSec} seconds before requesting another OTP.`
                : "Too many OTP requests for this number. Please try again later.",
            retryAfterSec,
          });
      }
      const status = error instanceof MessagingApiError ? error.status : null;
      console.error(
        `[Auth] OTP send failed rid=${req.id} phone=${maskPhone(phone)}:`,
        error instanceof MessagingApiError ? `${error.status} ${error.code} ${error.message}` : error,
      );
      // Refused (a number 2Factor would not take, or every route failed) is a
      // 400, as it always was; no answer at all is a 500.
      if (status === 400 || status === 502) {
        return res.status(400).send({ msg: "Failed to send OTP. Please try again.", success: false });
      }
      return res.status(500).send({ msg: "Failed to send OTP", success: false });
    }
  } catch (error: any) {
    console.error("Error sending OTP:", error.message);
    res.status(500).send({ msg: "Server error", success: false });
  }
};

const verifyOtp = async (req: Request, res: Response) => {
  const { phone, otp, fullhash, sessionId, deviceInfo } = verifyOtpSchema.parse(req.body);

  const [hashValue, expires] = fullhash.split(".");
  const now = Date.now();

  if (now > parseInt(expires)) {
    return res.status(504).json({
      success: false,
      msg: "Timeout! Please try again.",
    });
  }

  const data = `${phone}.${sessionId}.${expires}`;
  const calculatedHash = crypto
    .createHmac("sha256", process.env.HASH_KEY || "234")
    .update(data)
    .digest("hex");

  if (calculatedHash !== hashValue) {
    return res.status(400).json({
      success: false,
      msg: "Invalid session",
    });
  }

  const DEFAULT_OTP = "123456";
  const DEFAULT_PHONE = "1234567890";
  let otpVerified = false;

  try {
    if (String(phone).trim() === DEFAULT_PHONE) {
      // Apple-review test phone: its send-otp bypass never contacts messaging,
      // so the static OTP is the ONLY code that can verify it — never forward
      // it (its TEST_SESSION would be not_found there). Every real phone must
      // pass messaging's check; in prod, 123456 is not accepted for them.
      otpVerified = String(otp) === DEFAULT_OTP;
    } else {
      // Every session comes from messaging (see sendOtp); an id that is not
      // one, such as a 2Factor session from before the move, is simply
      // not_found and answers "Invalid OTP".
      const messaging = messagingClient();
      if (!messaging) {
        return res.status(500).json({
          success: false,
          msg: "OTP service unavailable",
        });
      }
      // Every way a code can fail comes back as a result, never an exception,
      // so only a real transport failure reaches the catch below. With 2Factor
      // a wrong or stale code arrived as an HTTP 400 that axios threw, so it
      // reached the client as a 500 its retry policy then re-sent against a
      // spent session.
      const result = await messaging.otp.verify({ otpId: sessionId, code: String(otp) });
      if (result.verified) {
        otpVerified = true;
      } else {
        // `already_used` is a duplicate of a verify that worked. 2Factor's
        // "No Entry Exists" could not tell that apart from a session that never
        // existed, which is what made the 15 Aug 2026 incident unanswerable
        // (see the success log below). Messaging names it, so log the name.
        console.error(
          `[Auth] OTP rejected rid=${req.id} phone=${maskPhone(phone)} ` +
            `sessionId=${sessionId} reason=${result.reason}`,
        );
        if (result.reason === "expired") {
          return res.status(504).json({
            success: false,
            msg: "Timeout! Please try again.",
          });
        }
      }
    }
  } catch (error: any) {
    // Only reachable now for a genuine transport failure talking to messaging
    // (DNS, timeout, connection reset), not for a rejected OTP.
    console.error("Error verifying OTP:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      msg: "Server error during verification",
    });
  }

  if (!otpVerified) {
    return res.status(400).json({
      success: false,
      msg: "Invalid OTP. Please try again.",
    });
  }

  // Logged on the SUCCESS path, not only on failure. This is the line whose
  // absence made the 15 Aug 2026 incident unanswerable: a 2Factor session that
  // a successful verify already consumed and one that never existed both come
  // back as "No Entry Exists", so the failures alone cannot distinguish "the
  // code was wrong" from "this request is a duplicate of one that worked".
  // Only a record of the success tells them apart.
  console.log(
    `[Auth] OTP verified rid=${req.id} phone=${maskPhone(phone)} sessionId=${sessionId}`,
  );

  // Deliberately outside the try: anything that fails from here on is an
  // authentication or database problem, not a verification one. Express 5
  // forwards a rejected async handler to the error middleware, which logs it
  // and answers properly, instead of it being mislabelled as an OTP failure.
  req.body.phone = phone;
  req.body.deviceInfo = deviceInfo;
  return authController.authUser(req, res);
};

const logout = (req: Request, res: Response) => {
  res.status(200).json({
    message: "Logged out successfully",
    success: true
  });
};

const me = async (req: Request, res: Response) => {
  const { sub, role } = req.auth!;

  if (role === "admin") {
    const admin = await Admin.findById(sub).lean();
    if (!admin) {
      return res.status(403).json({ success: false, message: "Admin access revoked" });
    }
    return res.status(200).json({ success: true, userType: "admin" });
  }

  const dukandar = await Dukandar.findById(sub).lean();
  if (!dukandar) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const { ShopDetail } = await import("../../shopDetail/shopDetails.model");
  const shopDetail = await ShopDetail.findById(dukandar.shopDetails).select("shopName").lean();
  const needsRegistration = !shopDetail?.shopName || !shopDetail.shopName.trim();

  return res.status(200).json({ success: true, userType: "dukandar", needsRegistration });
};

export default {
  sendOtp,
  verifyOtp,
  logout,
  me,
};