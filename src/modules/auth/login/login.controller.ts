import express from "express";
import crypto from "crypto";
import axios from "axios";
import dotenv from "dotenv";
import { Request, Response } from "express";
import authController from "../auth.controller";
import { sendOtpSchema, verifyOtpSchema } from "../auth.schema";
import Admin from "../../admin/admin.model";
import { Dukandar } from "../../dukandar/dukandar.model";
import { maskPhone } from "../../../common/utils/maskPhone";
const router = express.Router();

dotenv.config();

const sendOtp = async (req: Request, res: Response) => {
  const { phone } = sendOtpSchema.parse(req.body);

  try {
    const DEFAULT_PHONE = "1234567890";

    // Apple-review test number: bypass 2Factor entirely and hand back a
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

    // Every environment uses the real 2Factor SMS flow.
    //
    // SoneBill short-circuited this in dev: it generated the code locally,
    // returned it in the response body and never contacted 2Factor, so dev
    // exercised a login path that production did not have. Gold Khata Book
    // deliberately uses one OTP path everywhere, so a login that works in dev
    // is evidence the same login works in prod. The only bypass left is the
    // store-review test number handled above, which behaves identically in
    // both. Note that dev logins now send real SMS and spend real quota.
    const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY;
    const TEMPLATE_NAME = "OTP1";

    if (!TWOFACTOR_API_KEY) {
      return res.status(500).send({
        msg: "OTP service unavailable",
        success: false,
      });
    }

    const twoFactorUrl = `https://2factor.in/API/V1/${TWOFACTOR_API_KEY}/SMS/${phone}/AUTOGEN/${TEMPLATE_NAME}`;

    const response = await axios.get(twoFactorUrl, { timeout: 10000 });

    if (response.data && response.data.Status === "Success") {
      const sessionId = response.data.Details;

      const ttl = 5 * 60 * 1000;
      const expires = Date.now() + ttl;
      const data = `${phone}.${sessionId}.${expires}`;

      const hash = crypto
        .createHmac("sha256", process.env.HASH_KEY || "234")
        .update(data)
        .digest("hex");
      const fullhash = `${hash}.${expires}`;

      // Logged so that two sessions created for one phone seconds apart are
      // visible. A client that retries send-otp gets a NEW session each time
      // and keeps only the last reply; if an earlier reply is the one it kept,
      // the user verifies against a session the app has already discarded, and
      // nothing in the failure alone reveals that a second send ever happened.
      console.log(
        `[Auth] OTP session created rid=${req.id} phone=${maskPhone(phone)} sessionId=${sessionId}`,
      );

      res.status(200).send({
        phone,
        sessionId,
        fullhash,
        msg: "OTP sent successfully!",
        success: true,
      });
    } else {
      console.error("2Factor API Error:", response.data);
      return res.status(400).send({
        msg: "Failed to send OTP. Please try again.",
        success: false,
        error: response.data,
      });
    }
  } catch (error: any) {
    console.error("Error sending OTP:", error.message);

    if (error.response && error.response.data) {
      return res.status(500).send({
        msg: "Failed to send OTP",
        error: error.response.data,
        success: false,
      });
    }

    res.status(500).send({
      msg: "Server error",
      error: error.message,
      success: false,
    });
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
      // Apple-review test phone: its send-otp bypass never contacts 2Factor,
      // so the static OTP is the ONLY code that can verify it — never forward
      // it to 2Factor (its TEST_SESSION would be rejected there). Every real
      // phone must pass 2Factor verification; 123456 is not accepted for them.
      otpVerified = String(otp) === DEFAULT_OTP;
    } else {
      const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY;

      if (!TWOFACTOR_API_KEY) {
        return res.status(500).json({
          success: false,
          msg: "OTP service unavailable",
        });
      }

      const verifyUrl = `https://2factor.in/API/V1/${TWOFACTOR_API_KEY}/SMS/VERIFY/${sessionId}/${otp}`;
      // 2Factor answers every rejection — wrong code, expired session, or a
      // session an earlier verify already consumed — with HTTP 400, which axios
      // throws on by default. That throw jumped straight past the "Invalid OTP"
      // branch below into the catch, so an ordinary wrong/stale OTP reached the
      // client as a 500 "Server error during verification", which the client's
      // retry policy then treated as retryable and re-sent against a session
      // that was already spent. Accept any status as data and decide on Status.
      const response = await axios.get(verifyUrl, {
        timeout: 10000,
        validateStatus: () => true,
      });

      if (response.data?.Status === "Success") {
        otpVerified = true;
      } else {
        console.error(
          `[Auth] 2Factor rejected verification rid=${req.id} phone=${maskPhone(phone)} ` +
            `sessionId=${sessionId} httpStatus=${response.status} details=${response.data?.Details}`,
        );
      }
    }
  } catch (error: any) {
    // Only reachable now for a genuine transport failure talking to 2Factor
    // (DNS, timeout, connection reset) — not for a rejected OTP.
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