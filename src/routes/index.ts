import { Router } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ordersRouter from "./orders";
import confirmRouter from "./confirm";
import locationRouter from "./location";
import ridersRouter from "./riders";
import riderRouter from "./rider";

const router = Router();

router.use("/health", healthRouter);
router.use("/auth", authRouter);
router.use("/riders", ridersRouter);
router.use("/rider", riderRouter);
router.use("/orders", ordersRouter);
router.use("/orders", confirmRouter);
router.use("/orders", locationRouter);

export default router;
