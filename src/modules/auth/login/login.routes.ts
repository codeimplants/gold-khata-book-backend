import express from "express";
import loginController from "./login.controller";
import { authMiddleware } from "../../../common/middlewares/auth.middleware";
const router = express.Router();

router.post("/send-otp", loginController.sendOtp);
router.post("/verify-otp", loginController.verifyOtp);
router.post("/logout", loginController.logout);
router.get("/me", authMiddleware, loginController.me);

export default router;